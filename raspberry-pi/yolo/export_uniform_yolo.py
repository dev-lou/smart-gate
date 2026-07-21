"""Export a trained YOLO11 model and run a quick validation pass.

Usage:
  .\\face_env\\Scripts\\python.exe yolo\\export_uniform_yolo.py \\
      --weights models\\uniform_yolo11n\\weights\\best.pt
"""

from __future__ import annotations

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate and export trained YOLO11 model")
    parser.add_argument(
        "--weights",
        type=str,
        required=True,
        help="Path to trained best.pt",
    )
    parser.add_argument(
        "--data",
        type=str,
        default="yolo/data/uniform_dataset.yaml",
        help="Path to dataset yaml for val metrics",
    )
    parser.add_argument(
        "--format",
        type=str,
        default="onnx",
        help="Export format (onnx, torchscript, openvino, etc)",
    )
    parser.add_argument("--imgsz", type=int, default=640, help="Validation/export image size")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    weights = Path(args.weights)
    if not weights.exists():
        raise FileNotFoundError(f"Weights not found: {weights}")

    from ultralytics import YOLO

    model = YOLO(str(weights))

    print("Running validation...")
    metrics = model.val(data=args.data, imgsz=args.imgsz, split="val", verbose=True)
    print(f"mAP50: {float(metrics.box.map50):.4f}")
    print(f"mAP50-95: {float(metrics.box.map):.4f}")

    print(f"Exporting format={args.format}...")
    export_path = model.export(format=args.format, imgsz=args.imgsz)
    print(f"Export complete: {export_path}")


if __name__ == "__main__":
    main()
