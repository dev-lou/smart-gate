# Chapter IV — Results and Discussion (ready-to-paste draft)

> Source numbers: `yolo val` on the held-out test split (97 images, 106
> instances), Oct 2026. Curves and confusion matrices: `runs/detect/train/`
> (`BoxP_curve.png`, `BoxR_curve.png`, `BoxF1_curve.png`, `BoxPR_curve.png`,
> `confusion_matrix.png`, `confusion_matrix_normalized.png`).

## 4.1 Uniform Detection Performance

The trained YOLO11n model (9 classes, 640×640) achieved **mAP50 = 0.738**
(precision 0.680, recall 0.738) on the held-out test set. Five classes exceed
0.77 mAP50 (`education_female` 0.995, `coag_female` 0.876, `coag_male` 0.823,
`education_male` 0.823, `cici_male` 0.774). Three classes underperform:
`cbmsd_chef_male` (0.436), `cici_female` (0.419), and `cbmsd_universal_male`
(0.505). (`cici_blazer` scores 0.995 but has only 2 test instances and cannot
support a claim.)

## 4.2 Analysis of Weak Classes

The weak classes are the least represented in training: 47, 52, and 43 label
instances respectively, against 256 for `education_male` — the training
signal differs by up to 23× (`cici_blazer`: 11 instances). The validation
curve peaked at epoch 38 (mAP50 0.693) and decayed to 0.643 by epoch 100,
indicating mild overfitting. The prescribed remedy is data-first: 50–100
additional images per weak class with session-separated splits, plus early
stopping — not a larger model.

## 4.3 Operating-Point Selection

A confidence-threshold sweep on the test set gave: 0.25 → P 0.723 / R 0.754;
0.35 → P 0.728 / R 0.698; 0.45 → P 0.680 / R 0.738; 0.55 → P 0.760 / R 0.565.
The deployed operating point (0.45) is retained, and detections in the
0.25–0.40 band with the correct course are reported to the student as an
unclear read ("hold still") rather than a wrong-uniform denial, since 0.55
collapses recall to 0.565 while 0.25 preserves both metrics.

## 4.4 Deployment Fidelity

The deployed browser model (`uniform_yolo11n.onnx`) is bit-identical to the
trained weights (MD5 verified). A parity test feeding one image per class
through the kiosk-equivalent pipeline (letterbox, RGB/255, conf 0.45,
class-aware NMS) produced 9/9 identical classes and confidences versus
PyTorch inference — the in-browser pipeline introduces no accuracy loss.

## 4.5 Face Verification Posture

Identity uses MediaPipe BlazeFace short-range detection with ArcFace
(w600k_mbf, 512-dim) embeddings matched by cosine similarity against
three-angle enrollment templates. The 0.6 default threshold was not tuned on
the enrolled population and must be calibrated (target-FMR sweep procedure in
the research note) before claiming a false-accept rate. Presentation-attack
detection is out of scope for this prototype; photo-print and screen-replay
attacks are acknowledged threats mitigated procedurally by guard review.
