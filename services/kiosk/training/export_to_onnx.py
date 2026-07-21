"""
Smart Gate — Export Trained YOLO Model to ONNX
===============================================
After training, run this to export your model to ONNX format
for use in the browser kiosk via ONNX Runtime Web.

Usage:
    python export_to_onnx.py --model runs/train/uniform_detector/weights/best.pt
"""

import argparse
from pathlib import Path

try:
    from ultralytics import YOLO
except ImportError:
    print("Please install ultralytics: pip install ultralytics")
    exit(1)


def main():
    parser = argparse.ArgumentParser(description="Export YOLO model to ONNX")
    parser.add_argument(
        "--model",
        type=str,
        required=True,
        help="Path to trained model (.pt file)",
    )
    parser.add_argument(
        "--imgsz",
        type=int,
        default=640,
        help="Input image size (default: 640)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output path (default: same as input with .onnx extension)",
    )
    args = parser.parse_args()

    model_path = Path(args.model)
    if not model_path.exists():
        print(f"❌ Model not found: { model_path }")
        exit(1)

    print(f"📥 Loading model: { model_path }")
    model = YOLO(str(model_path))

    print(f"📦 Exporting to ONNX (imgsz={ args.imgsz })...")
    export_path = model.export(
        format="onnx",
        imgsz=args.imgsz,
        simplify=True,
    )

    output_path = args.output or export_path
    print(f"✅ ONNX model saved to: { output_path }")
    print(f"   Size: { Path(output_path).stat().st_size / 1024 / 1024:.1f} MB")

    print(f"\n📋 Next steps:")
    print(f"   1. Copy { output_path } to services/kiosk/public/models/")
    print(f"   2. Update YOLO_MODEL_URL in services/kiosk/src/lib/uniform.ts")
    print()


if __name__ == "__main__":
    main()
