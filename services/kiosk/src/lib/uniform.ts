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
  /** Normalized [x, y, w, h] of the winning detection — used to draw the
   *  live uniform box on the kiosk overlay so the operator can see what the
   *  model is actually looking at. */
  bbox?: [number, number, number, number];
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

// Default class names — EXACT ORDER of the trained YOLO model (uniform/data.yaml, 9 classes).
// Class id MUST match the model's class index — the worker reads class scores by index.
// `name` MUST equal uniform_types.name in Supabase — the guard stores that value as
// students.uniform_type, and checkUniform() matches on it.
//
// Model classes (from uniform/data.yaml, in order):
//   0 cbmsd_chef_male_uniform      1 cbmsd_universal_male_uniform
//   2 cici_blazer_uniform          3 cici_female_uniform
//   4 cici_male_uniform            5 coag_female_uniform
//   6 coag_male_uniform            7 education_female_uniform
//   8 education_male_uniform
const DEFAULT_CLASSES: UniformClass[] = [
  { id: 0, name: "cbmsd_chef_male_uniform", label: "CBMSD Chef Male Uniform" },
  { id: 1, name: "cbmsd_universal_male_uniform", label: "CBMSD Universal Male Uniform" },
  { id: 2, name: "cici_blazer_uniform", label: "CICI Blazer Uniform" },
  { id: 3, name: "cici_female_uniform", label: "CICI Female Uniform" },
  { id: 4, name: "cici_male_uniform", label: "CICI Male Uniform" },
  { id: 5, name: "coag_female_uniform", label: "COAG Female Uniform" },
  { id: 6, name: "coag_male_uniform", label: "COAG Male Uniform" },
  { id: 7, name: "education_female_uniform", label: "Education Female Uniform" },
  { id: 8, name: "education_male_uniform", label: "Education Male Uniform" },
];

// Number of classes the deployed ONNX model was trained on (uniform/data.yaml: nc: 9).
// Must match the model output shape [1, 4 + 9, 8400] — never guess from classNames.
const NUM_YOLO_CLASSES = 9;

// YOLO model URL — replace with your trained model
// Until you train and upload your model, this won't load.
const YOLO_MODEL_URL = "/models/uniform_yolo11n.onnx"; // e.g., "/models/uniform_yolo11n.onnx"

// ─── Constants ──────────────────────────────────────────────

const INPUT_SIZE = 640;
const MIN_UNIFORM_CONFIDENCE = 0.4;

// Course families — a student's uniform is verified when ANY detected uniform
// belongs to their course (e.g. a CICI student passes with cici_blazer,
// cici_female, or cici_male; CBMSD/COAG/Education work the same way).
const COURSE_FAMILIES: Array<[string, string]> = [
  ["cbmsd", "cbmsd"],
  ["cici", "cici"],
  ["coag", "coag"],
  ["education", "education"],
];

export function familyOf(uniformName: string): string {
  const n = (uniformName || "").toLowerCase();
  for (const [marker, family] of COURSE_FAMILIES) {
    if (n.includes(marker)) return family;
  }
  return "";
}

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
    console.warn(
      "[Uniform] No YOLO model URL configured. Uniform detection disabled until you train a model.",
    );
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

// ─── Region of Interest ─────────────────────────────────────

/**
 * The torso band that actually contains the uniform.
 *
 * Starts just under the chin (a little above, to catch a collar), spans ~3x the
 * face width for the shoulders, and runs to the bottom of the frame — how much
 * torso fits on screen is decided by the camera, not by a fixed ratio. If the
 * person is standing so close that only a sliver of torso is visible, the band
 * is widened upward to include the head, giving the model a whole-person view
 * instead of a meaningless strip.
 */
export function torsoRegion(
  faceBbox: [number, number, number, number],
  video: { videoWidth: number; videoHeight: number },
): { x: number; y: number; width: number; height: number } {
  const vw = video.videoWidth || INPUT_SIZE;
  const vh = video.videoHeight || INPUT_SIZE;

  const faceW = faceBbox[2] * vw;
  const faceH = faceBbox[3] * vh;
  const faceTop = faceBbox[1] * vh;
  const faceCentreX = (faceBbox[0] + faceBbox[2] / 2) * vw;

  const width = Math.min(vw, Math.max(faceW * 2.4, vw * 0.34));
  let top = Math.max(0, faceTop + faceH * 0.85);

  // Too little torso in view to judge — back off to a head-and-shoulders framing.
  if (vh - top < vh * 0.25) top = Math.max(0, faceTop - faceH * 0.15);

  return {
    x: Math.max(0, Math.min(vw - 1, faceCentreX - width / 2)),
    y: top,
    width,
    height: Math.max(1, vh - top),
  };
}

// ─── Main Detection Function ────────────────────────────────

/**
 * Check uniform by running YOLO inference on the body region.
 *
 * @param video - The video element with the camera feed
 * @param faceBbox - Face bounding box [x, y, w, h] as ratios
 * @param expectedUniform - The uniform type name expected (e.g., "cici_male_uniform")
 * @param canvas - Canvas for drawing/processing
 * @returns Uniform check result
 */
export async function checkUniform(
  video: HTMLVideoElement,
  faceBbox: [number, number, number, number],
  expectedUniform: string,
  canvas: HTMLCanvasElement,
): Promise<UniformCheckResult> {
  // If YOLO model is loaded in Web Worker, use it
  if (yoloWorkerInitialized) {
    try {
      const detections = await runYoloInference(video, canvas, torsoRegion(faceBbox, video));

      if (detections.length > 0) {
        // Best detection by confidence
        const bestDet = detections.reduce((a, b) => (a.confidence > b.confidence ? a : b));

        const detectedClass = classNames.find((c) => c.id === bestDet.classId);
        const detectedLabel = detectedClass?.label || `class_${bestDet.classId}`;

        // Check if the detected uniform matches the expected one
        const expectedClass = classNames.find(
          (c) =>
            c.label.toLowerCase() === expectedUniform.toLowerCase() ||
            c.name.toLowerCase() === expectedUniform.toLowerCase(),
        );

        // Course-level matching: a student is verified when ANY uniform of their
        // course is detected (CICI blazer/female/male all verify a CICI student).
        // An exact class match still wins when the expected type is specific.
        const expectedFamily = familyOf(expectedUniform);
        const detectedFamily = detectedClass ? familyOf(detectedClass.name) : "";
        const exactMatch = expectedClass ? bestDet.classId === expectedClass.id : false;
        const familyMatch = expectedFamily !== "" && expectedFamily === detectedFamily;
        const isMatch = exactMatch || familyMatch;
        const ok = isMatch && bestDet.confidence >= MIN_UNIFORM_CONFIDENCE;

        // Authorize on exact match OR course-family match. When the expected
        // type isn't in the mapping (e.g. a course name like "CICI"), only a
        // family match can authorize. A known course family with a mismatched
        // detected uniform is a clear WRONG UNIFORM denial, not a config error.
        if (expectedClass || expectedFamily !== "") {
          return {
            ok,
            confidence: bestDet.confidence,
            detail: ok
              ? `✅ ${detectedLabel} detected (${(bestDet.confidence * 100).toFixed(0)}%)`
              : expectedFamily !== "" && detectedFamily !== ""
                ? `❌ Wrong uniform: detected ${detectedLabel}, expected a ${expectedFamily.toUpperCase()} uniform`
                : `❌ Wrong uniform: detected ${detectedLabel}, expected ${expectedUniform}`,
            detectedType: detectedLabel,
            classId: bestDet.classId,
            bbox: bestDet.bbox,
          };
        }

        // Never allow access when the expected class is not mapped. A stale or
        // incomplete database mapping must fail closed instead of silently
        // bypassing uniform enforcement.
        return {
          ok: false,
          confidence: bestDet.confidence,
          detail: `Uniform mapping unavailable for expected type: ${expectedUniform}`,
          detectedType: detectedLabel,
          classId: bestDet.classId,
          bbox: bestDet.bbox,
        };
      }

      // No uniform detected in the frame. The classifier is very sensitive to a
      // soft image — at ~2px of blur a 95% detection drops to 57%, and by 3px it
      // starts naming the wrong uniform entirely. A dim room forces the camera to
      // lengthen its exposure, which is what blurs a moving person, so tell the
      // student the two things that actually fix it.
      return {
        ok: false,
        confidence: 0,
        detail: "No uniform detected — hold still and make sure your uniform is lit and in view",
      };
    } catch (err) {
      console.error("[Uniform] YOLO inference error:", err);
      // Fail closed. The color fallback was not reliable enough to authorize
      // access and could silently bypass uniform enforcement.
      return {
        ok: false,
        confidence: 0,
        detail: "Uniform detector unavailable",
      };
    }
  }

  // No model means uniform enforcement cannot be verified.
  return {
    ok: false,
    confidence: 0,
    detail: "Uniform detector not loaded",
  };
}

// ─── YOLO Inference via Web Worker ─────────────────────────

/**
 * Run YOLO11n inference by sending frame pixel data to Web Worker.
 * Returns detected objects with bounding boxes and class IDs.
 */
async function runYoloInference(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  region?: { x: number; y: number; width: number; height: number },
): Promise<YoloDetection[]> {
  if (!yoloWorkerInitialized) return [];

  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  const videoW = video.videoWidth || INPUT_SIZE;
  const videoH = video.videoHeight || INPUT_SIZE;

  // 1. Analyse the REGION OF INTEREST, not the whole frame.
  // The model was trained on pictures where a uniform fills the image. Feeding
  // it a whole-room shot leaves the uniform a few percent of the input and its
  // class scores collapse into noise — measured on a student plainly wearing a
  // CICI uniform: either no detection at all, or "education_female_uniform".
  // Callers pass the torso band under the face; without one we fall back to the
  // full frame.
  const regionX = Math.max(0, Math.min(videoW - 1, region?.x ?? 0));
  const regionY = Math.max(0, Math.min(videoH - 1, region?.y ?? 0));
  const regionW = Math.max(1, Math.min(videoW - regionX, region?.width ?? videoW));
  const regionH = Math.max(1, Math.min(videoH - regionY, region?.height ?? videoH));

  // 2. Preprocess that region with LETTERBOX (aspect-preserving resize + gray
  // padding). YOLO11n was trained on letterboxed 640x640 images; stretching to
  // square distorts aspect ratio and tanks detection accuracy.
  const scale = Math.min(INPUT_SIZE / regionW, INPUT_SIZE / regionH);
  const newW = Math.max(1, Math.round(regionW * scale));
  const newH = Math.max(1, Math.round(regionH * scale));
  const padX = Math.round((INPUT_SIZE - newW) / 2);
  const padY = Math.round((INPUT_SIZE - newH) / 2);

  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = INPUT_SIZE;
  tempCanvas.height = INPUT_SIZE;
  const tempCtx = tempCanvas.getContext("2d");
  if (!tempCtx) return [];

  // Gray 114 padding (YOLO letterbox convention)
  tempCtx.fillStyle = "#727272"; // 114,114,114
  tempCtx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
  tempCtx.drawImage(video, regionX, regionY, regionW, regionH, padX, padY, newW, newH);
  const imageData = tempCtx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);

  // 2. Send pixel data to shared Web Worker for expensive inference
  const result = await sendToWorker(
    "yolo_infer",
    {
      pixels: imageData.data,
      width: INPUT_SIZE,
      height: INPUT_SIZE,
      numClasses: NUM_YOLO_CLASSES,
    },
    [imageData.data.buffer], // Transfer for zero-copy
    60000,
  );

  const detections = (result as YoloDetection[]) || [];

  // 3. Map normalized letterbox coordinates back to the ORIGINAL video frame.
  // Worker returns boxes relative to the 640x640 letterboxed canvas; undo the
  // padding, the scaling and the region offset so boxes align with the live feed.
  return detections.map((det) => {
    const [bx, by, bw, bh] = det.bbox;
    const px = bx * INPUT_SIZE;
    const py = by * INPUT_SIZE;
    const pw = bw * INPUT_SIZE;
    const ph = bh * INPUT_SIZE;

    const ox = Math.max(0, regionX + (px - padX) / scale);
    const oy = Math.max(0, regionY + (py - padY) / scale);
    const ow = Math.min(videoW - ox, pw / scale);
    const oh = Math.min(videoH - oy, ph / scale);

    return {
      ...det,
      bbox: [ox / videoW, oy / videoH, ow / videoW, oh / videoH],
    };
  });
}

// ─── Color Fallback ─────────────────────────────────────────

/**
 * Fallback color-based uniform detection (used when YOLO model isn't loaded).
 */
async function colorFallbackCheck(
  video: HTMLVideoElement,
  faceBbox: [number, number, number, number],
  expectedUniform: string,
  canvas: HTMLCanvasElement,
): Promise<UniformCheckResult> {
  // Retained only for compatibility with callers; color alone is not safe
  // enough to authorize access.
  return {
    ok: false,
    confidence: 0,
    detail: "Uniform detector unavailable; color fallback disabled",
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
  videoHeight: number,
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
    Math.min(videoHeight - bodyTop, bodyHeight),
  );
}

/**
 * Cleanup YOLO resources.
 */
export function cleanupUniformDetector(): void {
  yoloWorkerInitialized = false;
}
