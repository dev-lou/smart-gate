# Uniform + Face Recognition Research Note (October 2026)

Primary sources only: Ultralytics YOLO26/YOLO11/export docs, ONNX Runtime Web
docs, MediaPipe Tasks Vision docs, InsightFace evaluation guide, NIST FATE PAD.
Secondary write-ups were not used. All repo numbers below were measured on
this machine (11th Gen i3 CPU, ultralytics 8.4.120, onnxruntime 1.23.2).

## 1. Model choice: YOLO11n is no longer the default

- Benchmark **YOLO26n** against YOLO11n. Ultralytics reports 40.9 vs 39.5 COCO
  mAP50-95 and up to 43% faster CPU ONNX inference for YOLO26n — but those are
  server numbers, not browser numbers. Measure on your data + your kiosk.
  https://docs.ultralytics.com/models/yolo26 · https://docs.ultralytics.com/models/yolo11
- YOLO26 offers an optional NMS-free one-to-one head (`nms=False` export,
  outputs up to 300 `[x1, y1, x2, y2, confidence, class_id]`), which simplifies
  browser postprocessing. Slightly lower COCO mAP than the one-to-many head.
  https://docs.ultralytics.com/guides/end2end-detection
- YOLO12 is community-driven, flagged for training instability and slower CPU
  throughput; Ultralytics recommends YOLO11 or YOLO26 for production.
  https://docs.ultralytics.com/models/yolo12
- YOLOv13 (independent project, nano COCO mAP50-95 41.6) deserves only a
  controlled comparison, not an automatic switch.
  https://github.com/iMoonLab/yolov13
- Status in this repo: YOLO26n training launched Oct 2026, same recipe as the
  11n run (100 epochs, imgsz 640, batch 16, patience 30, seed 0), output at
  `runs/detect/runs/detect/train_yolo26/` (nested path is an Ultralytics
  project-dir quirk). yolo26n.pt (5.3 MB) downloads from
  https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n.pt

## 2. Measured baseline (your trained YOLO11n, `runs/detect/train/weights/best.pt`)

Dataset: 984 images (train 693 / valid 194 / test 97), 9 classes.
Train label instances per class: 0:47, 1:43, 2:**11**, 3:52, 4:49, 5:113,
6:76, 7:97, 8:256. Class 2 (cici_blazer) has 23x less data than class 8.

Training curve: best val mAP50 0.693 at epoch 38, decayed to 0.643 at epoch
100 (P 0.644 / R 0.674) — mild overfitting; early stopping would have helped.

Held-out TEST split, Oct 2026 (`yolo val ... split=test`, conf 0.45):

| class | P | R | mAP50 |
|---|---|---|---|
| all | 0.680 | 0.738 | 0.738 |
| cbmsd_chef_male | 0.436 | 0.429 | 0.436 |
| cbmsd_universal_male | 0.567 | 0.500 | 0.505 |
| cici_blazer | 0.701 | 1.000 | 0.995 (n=2, unreliable) |
| cici_female | 0.338 | 0.429 | 0.419 |
| cici_male | 0.712 | 0.857 | 0.774 |
| coag_female | 0.817 | 0.840 | 0.876 |
| coag_male | 0.899 | 0.810 | 0.823 |
| education_female | 0.890 | 1.000 | 0.995 |
| education_male | 0.761 | 0.774 | 0.823 |

## 3. Confidence-threshold sweep (test split, same weights)

| conf | P | R | mAP50 |
|---|---|---|---|
| 0.25 | 0.723 | 0.754 | 0.703 |
| 0.35 | 0.728 | 0.698 | 0.658 |
| 0.45 (kiosk default) | 0.680 | 0.738 | 0.738 |
| 0.55 | 0.760 | 0.565 | 0.549 |

Reading: 0.45 is defensible; 0.25 loses nothing in precision and gains recall;
0.55 collapses recall. Implemented as an **uncertain band** in
`services/kiosk/src/lib/uniform.ts`: right course + conf < 0.4 now says
"looks right but unclear — hold still" instead of "wrong uniform".

## 4. Deployed-ONNX parity test (kiosk-equivalent pipeline)

Deployed `services/kiosk/public/models/uniform_yolo11n.onnx` is bit-identical
to training output (MD5 `77c7b94c3e5fa54ee3a95dc4b52a5a58`). One image per
class through letterbox + RGB/255 + conf 0.45 + class-aware NMS: 9/9 identical
classes and confidences (torch vs ONNX). The browser pipeline is faithful —
no export bug. Note: 2 of 9 samples produced NO detection at 0.45, so the
operating point sits on a knife-edge for hard cases.

## 5. Preprocessing contract (verified in code)

RGB → letterbox to 640 (aspect preserved, gray-114 pad) → /255 → NCHW FP32,
no mean/std normalization — matches Ultralytics training preprocessing.
https://docs.ultralytics.com/guides/preprocessing-annotated-data
The kiosk additionally crops a torso band under the chin (`torsoRegion()` in
`uniform.ts`); whole-frame input collapses class scores into noise (measured).
Keep deployed input size = training imgsz.

## 6. Dataset prescription (fixes the weak classes)

- Add 50–100 images each for classes 0, 1, 3, and especially 2 (blazer).
  Track instances AND images per class; report both.
- Keep the same person / capture session in ONE split (no leakage).
- Add ~5% background-only negatives to cut false positives.
- Don't hue-augment (color carries class meaning); use lighting/geometric
  augmentation, applied to train only, and inspect samples.
- If male/female variants of one course are visually identical, consider
  merging to one garment class per course (more samples/class) — the kiosk
  already decides at course-family level (`familyOf()`), so nothing downstream
  changes. https://docs.ultralytics.com/guides/data-collection-and-annotation

## 7. Face pipeline: what to change and what to keep

- Keep: BlazeFace short-range @ 0.5, ArcFace w600k_mbf 512-dim @ 112x112 with
  (pixel-127.5)/127.5 normalization, 3-angle enrollment templates with
  best-score matching, L2 normalization. All match the reference recipe.
  https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector/web_js ·
  https://www.insightface.ai/guides/choose-face-recognition-model-and-evaluate
- Calibrate: the 0.6 cosine default was never tuned on enrolled students.
  InsightFace reports typical 1:1 operating points of 0.30–0.45 at example
  false-match rates — that is NOT your threshold, it is a reason to run the
  procedure: collect genuine/impostor scores on enrolled students, pick a
  target FMR, sweep, freeze, then report FMR/FNMR + ROC on a separate set.
  `matchThreshold` is already a runtime setting, so no code change is needed.
- Liveness: face detector + cosine match is NOT anti-spoofing. Minimum honest
  posture for the capstone: name photo-print and screen-replay as threats,
  add a prompted-movement check, and keep guard review as the fallback.
  https://pages.nist.gov/frvt/html/frvt_pad.html

## 8. Browser runtime (verified in code)

WebGPU-first with WASM fallback (`resolveExecutionProviders`), worker-thread
inference with serialized sessions, versioned model + service-worker cache.
Matches ONNX Runtime Web guidance; WebGL is legacy-only, don't build on it.
https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html ·
https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html

## 9. Kiosk changes implemented Oct 2026

- `page.tsx` `drawOverlays()`: draws the torso scan band actually fed to YOLO
  ("UNIFORM SCAN AREA"), keeps face brackets + `FACE %` chip + uniform box
  visible through the granted/denied hold. Labels stay telemetry-only.
- `uniform.ts` `checkUniform()`: uncertain band messaging (see §3).
- `face.ts`: fixed `128-dim` docstring (model output is 512-dim).
- Deploying a retrained model = export ONNX (static batch-1, opset default,
  `simplify=True`), copy to `services/kiosk/public/models/`, keep the 9-class
  order in `uniform/data.yaml` ↔ `005_align_uniforms_to_model.sql` ↔
  `DEFAULT_CLASSES` byte-identical. DB migration does NOT need a re-run.
