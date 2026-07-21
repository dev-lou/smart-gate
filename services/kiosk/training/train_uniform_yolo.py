"""
Smart Gate — YOLO11n Uniform Training Script
=============================================
Trains a YOLO11n model to detect school uniforms.

Prerequisites:
    pip install ultralytics

Usage:
    python train_uniform_yolo.py

After training, the model will be exported to ONNX format for
use in the browser kiosk app.
"""

from pathlib import Path

try:
    from ultralytics import YOLO
except ImportError:
    print("Please install ultralytics: pip install ultralytics")
    exit(1)

# ─── Configuration ───────────────────────────────────────────

# Path to your dataset YAML file
DATASET_YAML = "dataset/uniform_dataset.yaml"

# Model size: "n" (nano) for browser, "s" (small) for more accuracy
MODEL_SIZE = "n"  # Options: n, s, m, l, x

# Training parameters
EPOCHS = 100
IMAGE_SIZE = 640
BATCH_SIZE = 16
PATIENCE = 20  # Early stopping patience

# ─── Training ────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("  Smart Gate — YOLO11 Uniform Training")
    print("=" * 60)

    # Check dataset exists
    if not Path(DATASET_YAML).exists():
        print(f"\n❌ Dataset config not found: {DATASET_YAML}")
        print("\nMake sure you have:")
        print("  1. Collected photos of each uniform type")
        print("  2. Labeled them using Roboflow or CVAT")
        print("  3. Organized them in dataset/ directory")
        print("\nSee docs/UNIFORM_TRAINING.md for instructions.\n")
        return

    # Load pretrained YOLO11 model
    print(f"\n📥 Loading YOLO11{ MODEL_SIZE }...")
    model = YOLO(f"yolo11{ MODEL_SIZE }.pt")

    # Train
    print(f"\n🏋️  Starting training ({ EPOCHS } epochs, { IMAGE_SIZE }x{ IMAGE_SIZE })...")
    results = model.train(
        data=DATASET_YAML,
        epochs=EPOCHS,
        imgsz=IMAGE_SIZE,
        batch=BATCH_SIZE,
        patience=PATIENCE,
        project="runs/train",
        name="uniform_detector",
        device="cpu",  # Change to "0" for GPU training
    )

    print(f"\n✅ Training complete! Best model saved to:")
    print(f"   runs/train/uniform_detector/weights/best.pt")

    # Export to ONNX
    print(f"\n📦 Exporting to ONNX format...")
    export_path = model.export(format="onnx", imgsz=IMAGE_SIZE, simplify=True)
    print(f"✅ ONNX model saved to: { export_path }")

    # Show class names for Supabase migration
    print(f"\n📋 Class Names (update in Supabase migration):")
    for i, name in enumerate(model.names.values()):
        print(f"   Class { i }: { name }")

    print(f"\n🎯 Next steps:")
    print(f"   1. Upload { export_path } to your kiosk's public/models/ directory")
    print(f"   2. Run database/migrations/002_uniform_types.sql")
    print(f"   3. Update class names in the migration to match your YOLO classes")
    print(f"   4. Set YOLO_MODEL_URL in uniform.ts to point to your model")
    print()


if __name__ == "__main__":
    main()
