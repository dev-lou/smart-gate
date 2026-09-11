# Uniform Detection Training Context (YOLO11n)

## 1. What was trained (Task-52 Logs Summary)
We trained a YOLO11n object detection model for **100 epochs** on the uniform dataset. 
- **Model:** YOLO11n (nano)
- **Image Size:** 640x640
- **Batch Size:** 16
- **Results:** The model successfully converged and produced weights located at `runs/detect/train/weights/best.pt`.

## 2. Classes Currently Trained
The model is currently capable of detecting the following **9 uniform classes**:
1. `cbmsd_chef_male_uniform`
2. `cbmsd_universal_male_uniform`
3. `cici_blazer_uniform`
4. `cici_female_uniform`
5. `cici_male_uniform`
6. `coag_female_uniform`
7. `coag_male_uniform`
8. `education_female_uniform`
9. `education_male_uniform`

## 3. ONNX Export & Integration
To run the model directly in the browser (via Web Worker), we exported the PyTorch weights to ONNX format:
- **Command Used:** `yolo export model=runs/detect/train/weights/best.pt format=onnx imgsz=640`
- **Deployment:** The resulting `best.onnx` file was moved to `services/kiosk/public/models/uniform_yolo11n.onnx`.
- **Configuration:** We updated `services/kiosk/src/lib/uniform.ts` to set `YOLO_MODEL_URL = "/models/uniform_yolo11n.onnx"`.

## 4. How to Train Faster Next Time (Adding New Uniforms)
When you want to add a *new* uniform class in the future, you **do not** need to start training from scratch.

1. **Update Dataset**: Add the new photos and labels to your dataset folder (e.g., via Roboflow).
2. **Update `data.yaml`**: Append the new class name to the `names` array and increase `nc` (number of classes).
3. **Transfer Learning**: Instead of training from the base `yolo11n.pt`, use your existing trained weights as the starting point. This will significantly reduce the number of epochs needed to learn the new uniform.
   - Example Command:
     ```bash
     yolo detect train model=runs/detect/train/weights/best.pt data=uniform/data.yaml epochs=50 imgsz=640
     ```
4. **Re-export to ONNX**: After the new training finishes, run the ONNX export command again and replace the `.onnx` file in `services/kiosk/public/models/`.
