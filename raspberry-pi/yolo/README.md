# YOLO11 Uniform Training

This folder contains scripts to train and deploy a custom YOLO11 model for uniform detection.

## 1) Install dependencies

From `raspberry-pi`:

```powershell
.\face_env\Scripts\python.exe -m pip install -r requirements.txt
```

## 2) Prepare dataset

Use this layout:

```text
yolo/dataset/
  images/
    train/
    val/
  labels/
    train/
    val/
```

Create `yolo/data/uniform_dataset.yaml` by copying `uniform_dataset.example.yaml` and updating `path`.

## 3) Labeling rules

- Draw one bbox around visible upper-body uniform region.
- Use only one class per image unless multiple people are in frame.
- Include hard negatives (same colors but no collar/badge) with no label file or empty label file.
- Include variation: indoor/outdoor, shadows, blur, occlusions, backpacks.

## 4) Train

```powershell
.\face_env\Scripts\python.exe yolo\train_uniform_yolo.py --data yolo\data\uniform_dataset.yaml --model yolo11n.pt --epochs 120 --imgsz 640 --batch 16 --device cpu
```

Outputs are saved to `models/uniform_yolo11n`.

## 5) Validate and export

```powershell
.\face_env\Scripts\python.exe yolo\export_uniform_yolo.py --weights models\uniform_yolo11n\weights\best.pt --data yolo\data\uniform_dataset.yaml --format onnx
```

## 6) Enable in runtime

In `config.py`:

- `USE_YOLO_FOR_UNIFORM = True`
- `YOLO_MODEL_PATH = "models/uniform_yolo11n/weights/best.pt"`
- Keep `YOLO_UNIFORM_CLASS_MAP` aligned with your dataset class names.

## 7) Runtime behavior

When YOLO is enabled, `uniform_utils.py` checks that:

- predicted class belongs to the configured class list for that `uniform_type`
- confidence is above `YOLO_UNIFORM_MIN_CONFIDENCE`

If no valid YOLO hit is found, it falls back to the color/texture method.
