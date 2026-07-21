/**
 * ONNX Inference Web Worker
 * ==========================
 * Runs all ONNX Runtime Web inference in a dedicated thread.
 * This keeps the main React thread free for UI rendering.
 *
 * 🔴 FIX BUG #6: Move heavy ONNX inference off the main thread.
 *
 * Messages handled:
 *   - init_face: Load MobileFaceNet ONNX model
 *   - init_yolo: Load YOLO11n ONNX model
 *   - get_embedding: Compute face embedding from pixel data
 *   - yolo_infer: Run YOLO detection on frame pixel data
 *
 * Each message is async and responds with the same id for correlation.
 */

import * as ort from "onnxruntime-web";

// ─── Types ──────────────────────────────────────────────────

interface WorkerMessage {
  type: "init_face" | "init_yolo" | "get_embedding" | "yolo_infer";
  id: string;
  data?: unknown;
}

interface InitFaceData {
  modelUrl: string;
}

interface InitYoloData {
  modelUrl: string;
  classNames?: Array<{ id: number; name: string; label: string }>;
}

interface EmbeddingData {
  /** RGBA pixel data from a 112x112 cropped face (ArcFace spec) */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

interface YoloData {
  /** RGBA pixel data from a 640x640 resized frame */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  /** Number of classes the model was trained on */
  numClasses: number;
}

// ─── Worker State ───────────────────────────────────────────

let faceSession: ort.InferenceSession | null = null;
let yoloSession: ort.InferenceSession | null = null;

// Constants
const FACE_INPUT_SIZE = 112; // ArcFace w600k_mbf: 112x112 input
const YOLO_INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.45;
const NMS_IOU_THRESHOLD = 0.5;

// ─── Message Handler ────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, id, data } = event.data;

  try {
    switch (type) {
      case "init_face":
        await initFaceSession((data as InitFaceData).modelUrl);
        self.postMessage({ type: "init_face_done", id, data: true });
        break;

      case "init_yolo":
        await initYoloSession((data as InitYoloData).modelUrl);
        self.postMessage({ type: "init_yolo_done", id, data: true });
        break;

      case "get_embedding": {
        const embedding = await computeEmbedding(data as EmbeddingData);
        // 🔴 FIX: Use WindowPostMessageOptions to match Window.postMessage typing
        // The `transfer` property works identically in Worker contexts
        self.postMessage(
          { type: "embedding_result", id, data: embedding },
          { transfer: embedding ? [embedding.buffer] : [] },
        );
        break;
      }

      case "yolo_infer": {
        const detections = await runYoloInference(data as YoloData);
        self.postMessage({ type: "yolo_result", id, data: detections });
        break;
      }

      default:
        console.warn(`[Worker] Unknown message type: ${type}`);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    self.postMessage({
      type: `${type}_error` as string,
      id,
      data: errorMsg,
    });
  }
};

// ─── Initialization ─────────────────────────────────────────

async function initFaceSession(modelUrl: string): Promise<void> {
  if (faceSession) return;

  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";

  // 🔴 ACCURACY FIX #1: Use WebGPU + WebGL for GPU acceleration (much faster than WASM)
  faceSession = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["webgpu", "webgl", "wasm"],
  });
}

async function initYoloSession(modelUrl: string): Promise<void> {
  if (yoloSession) return;

  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/";

  yoloSession = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["webgpu", "webgl", "wasm"],
  });
}

// ─── Face Embedding Inference ───────────────────────────────

async function computeEmbedding(data: EmbeddingData): Promise<Float32Array | null> {
  if (!faceSession) return null;

  const { pixels, width, height } = data;

  // Convert RGBA to normalized float32 in CHW format (1, 3, 112, 112)
  // Normalize to [-1, 1] using ArcFace formula: (pixel - 127.5) / 127.5
  const inputSize = width * height;
  const float32Data = new Float32Array(3 * inputSize);

  for (let i = 0; i < inputSize; i++) {
    const offset = i * 4;
    float32Data[i] = (pixels[offset] - 127.5) / 127.5; // R
    float32Data[inputSize + i] = (pixels[offset + 1] - 127.5) / 127.5; // G
    float32Data[2 * inputSize + i] = (pixels[offset + 2] - 127.5) / 127.5; // B
  }

  const inputTensor = new ort.Tensor("float32", float32Data, [1, 3, height, width]);

  const feeds: Record<string, ort.Tensor> = {};
  feeds[faceSession.inputNames[0]] = inputTensor;

  const results = await faceSession.run(feeds);
  const outputName = faceSession.outputNames[0];
  const output = results[outputName];

  // Normalize embedding to unit length
  const rawData = output.data as Float32Array;
  const embedding = new Float32Array(rawData.length);
  let sum = 0;
  for (let i = 0; i < rawData.length; i++) {
    embedding[i] = rawData[i];
    sum += embedding[i] * embedding[i];
  }
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

// ─── YOLO Inference ─────────────────────────────────────────

interface YoloDetection {
  bbox: [number, number, number, number];
  classId: number;
  confidence: number;
}

async function runYoloInference(data: YoloData): Promise<YoloDetection[]> {
  if (!yoloSession) return [];

  const { pixels, width, height, numClasses } = data;

  // Convert RGBA to normalized float32 in CHW format (1, 3, 640, 640)
  const inputSize = width * height;
  const float32Data = new Float32Array(3 * inputSize);

  for (let i = 0; i < inputSize; i++) {
    const offset = i * 4;
    float32Data[i] = pixels[offset] / 255.0; // R
    float32Data[inputSize + i] = pixels[offset + 1] / 255.0; // G
    float32Data[2 * inputSize + i] = pixels[offset + 2] / 255.0; // B
  }

  const inputTensor = new ort.Tensor("float32", float32Data, [1, 3, height, width]);

  const feeds: Record<string, ort.Tensor> = {};
  feeds[yoloSession.inputNames[0]] = inputTensor;

  const results = await yoloSession.run(feeds);
  const outputName = yoloSession.outputNames[0];
  const output = results[outputName];

  // Postprocess YOLO output
  return postprocess(output.data as Float32Array, output.dims!, numClasses);
}

/**
 * Postprocess YOLO output tensor to bounding boxes with NMS.
 * Handles YOLO11n format: [1, 4+N, 8400]
 */
function postprocess(
  output: Float32Array,
  dims: readonly number[],
  numClasses: number,
): YoloDetection[] {
  if (dims.length < 3) return [];

  const [, , numDetections] = dims;
  const boxes: YoloDetection[] = [];

  for (let i = 0; i < numDetections; i++) {
    // Get bounding box (first 4 values)
    const xc = output[i];
    const yc = output[numDetections + i];
    const w = output[2 * numDetections + i];
    const h = output[3 * numDetections + i];

    // Find best class
    let bestClassId = -1;
    let bestClassScore = 0;

    for (let c = 0; c < numClasses; c++) {
      const score = output[(4 + c) * numDetections + i];
      if (score > bestClassScore) {
        bestClassScore = score;
        bestClassId = c;
      }
    }

    if (bestClassScore >= CONFIDENCE_THRESHOLD && bestClassId >= 0) {
      boxes.push({
        bbox: [
          Math.max(0, (xc - w / 2) / YOLO_INPUT_SIZE),
          Math.max(0, (yc - h / 2) / YOLO_INPUT_SIZE),
          Math.min(1, w / YOLO_INPUT_SIZE),
          Math.min(1, h / YOLO_INPUT_SIZE),
        ],
        classId: bestClassId,
        confidence: bestClassScore,
      });
    }
  }

  return nonMaxSuppression(boxes, NMS_IOU_THRESHOLD);
}

/**
 * Non-Maximum Suppression to remove overlapping boxes.
 */
function nonMaxSuppression(detections: YoloDetection[], iouThreshold: number): YoloDetection[] {
  if (detections.length <= 1) return detections;

  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
  const result: YoloDetection[] = [];

  while (sorted.length > 0) {
    const best = sorted.shift()!;
    result.push(best);

    for (let i = sorted.length - 1; i >= 0; i--) {
      const iou = calculateIoU(best.bbox, sorted[i].bbox);
      if (iou > iouThreshold) {
        sorted.splice(i, 1);
      }
    }
  }

  return result;
}

/**
 * Calculate Intersection over Union between two bounding boxes.
 */
function calculateIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;

  const ax1 = ax,
    ay1 = ay,
    ax2 = ax + aw,
    ay2 = ay + ah;
  const bx1 = bx,
    by1 = by,
    bx2 = bx + bw,
    by2 = by + bh;

  const x1 = Math.max(ax1, bx1);
  const y1 = Math.max(ay1, by1);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = aw * ah;
  const areaB = bw * bh;
  const union = areaA + areaB - intersection;

  return union > 0 ? intersection / union : 0;
}
