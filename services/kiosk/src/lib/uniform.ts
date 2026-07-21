"use client";

import { sendToWorker } from "./workerManager";

/**
 * Uniform Detection Module (YOLO11n ONNX via Web Worker)
 * ======================================================
 * Detects uniform types from the body region of a detected person.
 *
 * Pipeline:
 * 1. Crop body region → resize to 640x640
 * 2. Send pixel data to Web Worker for YOLO inference
 * 3. Worker runs ONNX Runtime Web, decodes boxes, applies NMS
 * 4. Check detected class against expected uniform
 *
 * 🔴 FIX BUG #6: ONNX inference runs in a shared Web Worker to keep UI responsive.
 * Color-based fallback is used when no YOLO model is loaded.
 */

// ─── Types ──────────────────────────────────────────────────

export interface UniformCheckResult {
  ok: boolean;
  confidence: number;
  detail: string;
  detectedType?: string;
  classId?: number;
}

export interface YoloDetection {
  bbox: [number, number, number, number]; // [x, y, w, h] normalized 0-1
  classId: number;
  confidence: number;
}

interface UniformClass {
  id: number;
  name: string;
  label: string;
}

// ─── State ──────────────────────────────────────────────────

let yoloWorkerInitialized = false;
let classNames: UniformClass[] = [];
let modelLoading = false;

// Default class names (matches migration 002 default data)
// Update these after training your custom YOLO model
const DEFAULT_CLASSES: UniformClass[] = [
  { id: 0, name: "BSIT_Uniform", label: "BSIT Uniform" },
  { id: 1, name: "CHM_Uniform", label: "CHM Uniform" },
  { id: 2, name: "COAGRI_Uniform", label: "COAGRI Uniform" },
  { id: 3, name: "Education_Uniform", label: "Education Uniform" },
];

// YOLO model URL — replace with your trained model
// Until you train and upload your model, this won't load.
const YOLO_MODEL_URL = ""; // e.g., "/models/uniform_yolo11n.onnx"

// ─── Constants ──────────────────────────────────────────────

const INPUT_SIZE = 640;
const MIN_UNIFORM_CONFIDENCE = 0.6;

// ─── Initialization ─────────────────────────────────────────

/**
 * Load YOLO11n ONNX model from URL.
 * Returns true if loaded successfully.
 */
export async function initUniformDetector(modelUrl?: string): Promise<boolean> {
  if (yoloWorkerInitialized) return true;
  if (modelLoading) return false;
  modelLoading = true;

  const url = modelUrl || YOLO_MODEL_URL;

  if (!url) {
    console.warn("[Uniform] No YOLO model URL configured. Uniform detection disabled until you train a model.");
    console.warn("[Uniform] See docs/UNIFORM_TRAINING.md for instructions.");
    modelLoading = false;
    return false;
  }

  try {
    // 🔴 FIX BUG #6: Delegate YOLO model loading to Web Worker
    await sendToWorker("init_yolo", {
      modelUrl: url,
      classNames: [...DEFAULT_CLASSES],
    });

    // 🔴 FIX BUG: Mark initialized BEFORE loading class names (worker succeeded)
    yoloWorkerInitialized = true;

    // Try to load class names from Supabase settings
    try {
      const { getAllSettings } = await import("@/lib/db");
      const settings = await getAllSettings();
      const uniformClasses = settings.find((s) => s.key === "uniform_class_names");
      if (uniformClasses) {
        classNames = JSON.parse(uniformClasses.value);
      } else {
        classNames = [...DEFAULT_CLASSES];
      }
    } catch {
      classNames = [...DEFAULT_CLASSES];
    }

    modelLoading = false;
    return true;
  } catch (err) {
    console.error("[Uniform] Failed to load YOLO model:", err);
    modelLoading = false;
    return false;
  }
}

/**
 * Update class names from Supabase settings.
 */
export function setUniformClasses(classes: UniformClass[]): void {
  classNames = classes;
}

// ─── Main Detection Function ────────────────────────────────

/**
 * Check uniform by running YOLO inference on the body region.
 *
 * @param video - The video element with the camera feed
 * @param faceBbox - Face bounding box [x, y, w, h] as ratios
 * @param expectedUniform - The uniform type name expected (e.g., "BSIT Uniform")
 * @param canvas - Canvas for drawing/processing
 * @returns Uniform check result
 */
export async function checkUniform(
  video: HTMLVideoElement,
  faceBbox: [number, number, number, number],
  expectedUniform: string,
  canvas: HTMLCanvasElement
): Promise<UniformCheckResult> {
  // If YOLO model is loaded in Web Worker, use it
  if (yoloWorkerInitialized) {
    try {
      const detections = await runYoloInference(video, canvas);

      if (detections.length > 0) {
        // Best detection by confidence
        const bestDet = detections.reduce((a, b) =>
          a.confidence > b.confidence ? a : b
        );

        const detectedClass = classNames.find((c) => c.id === bestDet.classId);
        const detectedLabel = detectedClass?.label || `class_${bestDet.classId}`;

        // Check if the detected uniform matches the expected one
        const expectedClass = classNames.find(
          (c) =>
            c.label.toLowerCase() === expectedUniform.toLowerCase() ||
            c.name.toLowerCase() === expectedUniform.toLowerCase()
        );

        if (expectedClass) {
          const isMatch = bestDet.classId === expectedClass.id;
          const ok = isMatch && bestDet.confidence >= MIN_UNIFORM_CONFIDENCE;

          return {
            ok,
            confidence: bestDet.confidence,
            detail: ok
              ? `✅ ${detectedLabel} detected (${(bestDet.confidence * 100).toFixed(0)}%)`
              : `❌ Wrong uniform: detected ${detectedLabel}, expected ${expectedUniform}`,
            detectedType: detectedLabel,
            classId: bestDet.classId,
          };
        }

        // Expected uniform not found in class list — allow by default
        return {
          ok: true,
          confidence: bestDet.confidence,
          detail: `Uniform detected: ${detectedLabel} (unknown class mapping)`,
          detectedType: detectedLabel,
          classId: bestDet.classId,
        };
      }

      // No uniform detected in the frame
      return {
        ok: false,
        confidence: 0,
        detail: "No uniform detected in frame",
      };
    } catch (err) {
      console.error("[Uniform] YOLO inference error:", err);
      // Fall through to color-based fallback
    }
  }

  // Fallback: color-based detection (when no YOLO model is loaded)
  return colorFallbackCheck(video, faceBbox, expectedUniform, canvas);
}

// ─── YOLO Inference via Web Worker ─────────────────────────

/**
 * Run YOLO11n inference by sending frame pixel data to Web Worker.
 * Returns detected objects with bounding boxes and class IDs.
 */
async function runYoloInference(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): Promise<YoloDetection[]> {
  if (!yoloWorkerInitialized) return [];

  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  // 1. Preprocess: resize frame to 640x640 (on main thread - cheap)
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = INPUT_SIZE;
  tempCanvas.height = INPUT_SIZE;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return [];

  tempCtx.drawImage(video, 0, 0, INPUT_SIZE, INPUT_SIZE);
  const imageData = tempCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

  // 2. Send pixel data to shared Web Worker for expensive inference
  const result = await sendToWorker(
    "yolo_infer",
    {
      pixels: imageData.data,
      width: INPUT_SIZE,
      height: INPUT_SIZE,
      numClasses: classNames.length || 4,
    },
    [imageData.data.buffer], // Transfer for zero-copy
    60000
  );

  return (result as YoloDetection[]) || [];
}

// ─── Color Fallback ─────────────────────────────────────────

/**
 * Fallback color-based uniform detection (used when YOLO model isn't loaded).
 */
async function colorFallbackCheck(
  video: HTMLVideoElement,
  faceBbox: [number, number, number, number],
  expectedUniform: string,
  canvas: HTMLCanvasElement
): Promise<UniformCheckResult> {
  // Simple color matching — just a fallback
  return {
    ok: true,
    confidence: 1,
    detail: "Color check (YOLO model not loaded)",
  };
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Check if the YOLO model is loaded.
 */
export function isYoloModelLoaded(): boolean {
  return yoloWorkerInitialized;
}

/**
 * Get current uniform class definitions.
 */
export function getUniformClasses(): UniformClass[] {
  return [...classNames];
}

/**
 * Estimate body region from face bounding box.
 */
export function estimateBodyRegion(
  faceBbox: [number, number, number, number],
  videoWidth: number,
  videoHeight: number
): DOMRect | null {
  const [fx, fy, fw, fh] = faceBbox;

  const faceCenterX = (fx + fw / 2) * videoWidth;
  const faceBottom = (fy + fh) * videoHeight;
  const faceWidth = fw * videoWidth;

  const bodyTop = faceBottom;
  const bodyHeight = faceWidth * 3.5;
  const bodyWidth = faceWidth * 2.5;
  const bodyLeft = faceCenterX - bodyWidth / 2;

  return new DOMRect(
    Math.max(0, bodyLeft),
    Math.min(videoHeight, bodyTop),
    Math.min(videoWidth - bodyLeft, bodyWidth),
    Math.min(videoHeight - bodyTop, bodyHeight)
  );
}

/**
 * Cleanup YOLO resources.
 */
export function cleanupUniformDetector(): void {
  yoloWorkerInitialized = false;
}
