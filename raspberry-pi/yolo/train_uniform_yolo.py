"""Train a custom YOLO11 model for school uniform detection.

Usage (from raspberry-pi folder):
  .\\face_env\\Scripts\\python.exe yolo\\train_uniform_yolo.py \\
      --data yolo\\data\\uniform_dataset.yaml \\
      --model yolo11n.pt \\
      --epochs 120 \\
      --imgsz 640
"""

from __future__ import annotations

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train YOLO11 for uniform detection")
    parser.add_argument(
        "--data",
        type=str,
        default="yolo/data/uniform_dataset.yaml",
        help="Path to YOLO dataset yaml",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="yolo11n.pt",
        help="Base model checkpoint to fine-tune",
    )
    parser.add_argument("--epochs", type=int, default=120, help="Number of training epochs")
    parser.add_argument("--imgsz", type=int, default=640, help="Training image size")
    parser.add_argument("--batch", type=int, default=16, help="Batch size")
    parser.add_argument(
        "--project",
        type=str,
        default="models",
        help="Output project directory",
    )
    parser.add_argument(
        "--name",
        type=str,
        default="uniform_yolo11n",
        help="Run name inside project directory",
    )
    parser.add_argument("--device", type=str, default="cpu", help="cpu, 0, 0,1, etc")
    parser.add_argument(
        "--patience",
        type=int,
        default=30,
        help="Early stopping patience",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    data_yaml = Path(args.data)
    if not data_yaml.exists():
        raise FileNotFoundError(
            f"Dataset yaml not found: {data_yaml}. Copy yolo/data/uniform_dataset.example.yaml first."
        )

    from ultralytics import YOLO

    model = YOLO(args.model)
    results = model.train(
        data=str(data_yaml),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        project=args.project,
        name=args.name,
        patience=args.patience,
        pretrained=True,
        workers=0,
        verbose=True,
    )

    run_dir = Path(results.save_dir)
    best_model = run_dir / "weights" / "best.pt"
    print("Training complete")
    print(f"Run dir: {run_dir}")
    print(f"Best model: {best_model}")
    print("Set config.USE_YOLO_FOR_UNIFORM=True and config.YOLO_MODEL_PATH to this best.pt")


if __name__ == "__main__":
    main()
