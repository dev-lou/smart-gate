# YOLO11 Uniform Detection Training Guide

This guide explains how to train a custom **YOLO11 nano** model to detect school uniform tops for your specific courses.

> For a visual step-by-step walkthrough, see **[uniform-training.html](uniform-training.html)**.

---

## Why YOLO11 Nano?

| Model | Size | Speed | Accuracy | Use Case |
|-------|------|-------|----------|----------|
| **YOLO11n** | 5.3 MB | Fast | Good | Browser deployment (ONNX) |
| YOLO11s | 21.5 MB | Moderate | Better | Development/testing |
| YOLO11m | 68 MB | Slow | Best | Training ground truth |

**Recommendation**: Use **YOLO11n** — it's small enough for fast browser download (~2s on 5G) and fast inference (~50-100ms with WebGPU).

---

## Workflow Overview

```
1. Collect photos ──→ 2. Label on Roboflow ──→ 3. Export YOLO format
                                                        │
                                                        ▼
                         6. Update kiosk URL ←── 5. Upload ONNX ←── 4. Train + Export ONNX
```

---

## Step 1: Collect Photos

Take **100+ photos per uniform type** with your phone or camera.

### Photo Requirements

| Requirement | Why |
|------------|-----|
| **640×640 or higher** | YOLO resizes to 640×640 internally |
| **Diverse angles** | Front, side, slightly angled |
| **Varied lighting** | Indoor, outdoor, bright, dim |
| **Background variety** | Hallways, classrooms, outdoors |
| **Occlusion** | Include bags/books partially covering uniform |
| **Multiple students** | Different body types, heights |

### What to Annotate

- **Only the upper body uniform** (shirt, vest, blouse, polo)
- Do NOT annotate shoes, pants, or accessories
- Each uniform type = one class

### Example Classes

```
uniform_bsit        → BS Information Technology uniform
uniform_chm         → BS Chemistry uniform
uniform_coagri      → BS Agriculture uniform
uniform_education   → Education uniform
uniform_pe          → PE uniform
```

---

## Step 2: Label on Roboflow

[Roboflow](https://roboflow.com) is a free tool for labeling images and exporting in YOLO format.

### 2.1 Create a Project

1. Go to [roboflow.com](https://roboflow.com) and sign up (free tier)
2. Click **Create New Project**
3. Set:
   - **Project Name**: `smart-gate-uniforms`
   - **Project Type**: Object Detection (YOLO)
   - **Annotation Group**: Bounding Box
4. Click **Create Project**

### 2.2 Upload Images

1. Click **Upload** → drag all your photos
2. Organize into folders by uniform type (optional but helpful)
3. Wait for upload to complete

### 2.3 Label Images

1. Click **Annotate** on any image
2. Draw a **bounding box** around the uniform top area
3. Select the correct class (e.g., `uniform_bsit`)
4. Repeat for all images

**Tips:**
- Be consistent — always draw boxes around the same body area
- Include the full upper uniform (shoulders to waist)
- Don't include the face or background

### 2.4 Generate Dataset Version

1. Click **Generate New Version**
2. Apply preprocessing:
   - **Auto-Orient**: Applied
   - **Resize**: 640×640 (stretch to fit)
3. Apply augmentation:
   - **Rotation**: ±15°
   - **Brightness**: ±25%
   - **Blur**: Up to 2.5px
   - **Noise**: Up to 5%
4. Click **Generate**

---

## Step 3: Export in YOLO Format

1. Go to your generated version
2. Click **Export Dataset**
3. Select format: **YOLO11 (Ultralytics)**
4. Choose:
   - **Download ZIP** to your computer
   - Or use the **Roboflow API** for automated training

The export will contain:
```
dataset/
├── train/
│   ├── images/     # Training images (640×640)
│   └── labels/     # YOLO format .txt files
├── valid/
│   ├── images/     # Validation images
│   └── labels/     # Corresponding labels
├── test/           # (optional) Test images
├── data.yaml       # Class definitions
└── README.roboflow.txt
```

### YOLO Label Format

Each `.txt` file contains one line per object:
```
<class_id> <x_center> <y_center> <width> <height>
```

All values are normalized (0-1):
```
0 0.5 0.5 0.4 0.6
```

---

## Step 4: Train + Export to ONNX

### Option A: Train on Roboflow (Easiest)

1. On the dataset version page, click **Train with Roboflow**
2. Select **YOLO11n** as the model type
3. Set:
   - **Epochs**: 100
   - **Batch Size**: 16
   - **Image Size**: 640
4. Start training (free tier includes 1000 training images)
5. Once complete, download the **ONNX export**

### Option B: Train Locally with Python

If you prefer local training:

```bash
# 1. Install Ultralytics
pip install ultralytics

# 2. Place the exported dataset in a folder:
#    ./datasets/uniforms/
#    ├── train/
#    ├── valid/
#    └── data.yaml

# 3. Train
yolo detect train \
  model=yolo11n.pt \
  data=./datasets/uniforms/data.yaml \
  epochs=100 \
  imgsz=640 \
  batch=16 \
  device=cpu  # or cuda:0 for GPU

# 4. Export to ONNX
yolo export \
  model=runs/detect/train/weights/best.pt \
  format=onnx \
  imgsz=640
```

---

## Step 5: Upload the ONNX Model

Once you have `best.onnx` (or `uniform_yolo11n.onnx`):

### Option A: Vercel Project (Recommended)

1. Open your kiosk Vercel project
2. Go to **Storage** → place file in `public/models/uniform_yolo11n.onnx`
3. Or upload to any static file hosting (CDN, GitHub Pages, etc.)

### Option B: Hugging Face

1. Upload to a Hugging Face repository
2. Get the raw download URL

---

## Step 6: Update Kiosk Configuration

Update the YOLO model URL in `services/kiosk/src/lib/uniform.ts`:

```typescript
const YOLO_MODEL_URL = "https://your-domain.com/models/uniform_yolo11n.onnx";
```

After updating, the kiosk will:
1. Download the new model on next load
2. Cache it in the Service Worker for offline use
3. Run YOLO inference via the Web Worker for uniform checks

---

## Testing the Model

You can test detection accuracy by:

1. Opening the kiosk at `http://localhost:3002`
2. Pointing the camera at a person wearing the uniform
3. Checking the console for detection results:
   ```
   [Uniform] YOLO detected: uniform_bsit (confidence: 0.87)
   [Uniform] Expected: uniform_bsit → Match!
   ```

### Accuracy Expectations

| Model Quality | Images per Class | Expected mAP@0.5 |
|--------------|-----------------|-----------------|
| Minimum | 50 | ~70-80% |
| Good | 100-200 | ~80-90% |
| Production | 300+ | ~90-95% |

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Model loads but detects nothing | Wrong image size | Ensure export uses 640×640 |
| Low confidence detections | Not enough training data | Add 50+ more images per class |
| False positives | Background noise | Include more background variety in training |
| Slow inference | No WebGPU | Falls back to WebGL (~2x slower) or WASM (~5x slower) |
| Model not loading | Wrong URL format | Use direct download URL (not a page URL) |
