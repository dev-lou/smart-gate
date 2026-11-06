"use client";

/**
 * Face Recognition Module
 * ========================
 * Uses MediaPipe Tasks Vision for face detection (WASM) on main thread.
 * ONNX face embedding inference is delegated to a Web Worker.
 *
 * 🔴 FIX BUG #6: ONNX Runtime Web runs in a Web Worker to keep the
 * main thread free for UI rendering.
 */

import { FilesetResolver, FaceDetector, type FaceDetectorResult } from "@mediapipe/tasks-vision";
import { faceTooSmall, squarePadRect } from "./faceCrop";

// ─── Types ──────────────────────────────────────────────────

export interface FaceResult {
  /** Bounding box [x, y, width, height] as ratio of frame */
  bbox: [number, number, number, number];
  /** Face embedding vector (512-dim ArcFace w600k_mbf) */
  embedding?: Float32Array;
  /** Detection confidence */
  confidence: number;
}

export interface EnrolledFace {
  id: string;
  name: string;
  student_id: string;
  department: string;
  uniform_type: string;
  /** 015 guest pass (null for students) */
  host_name?: string | null;
  purpose?: string | null;
  valid_until?: string | null;
  /** 🔴 ACCURACY FIX #4: Multiple embeddings per student (different angles) */
  embeddings: Float32Array[];
}

export interface MatchResult {
  person: EnrolledFace | null;
  confidence: number;
  matched: boolean;
  /** Best similarity among every OTHER enrolled profile (anti-false-accept margin). */
  runnerUp: number;
  /** Winner is too close to the runner-up to name — a lookalike collision. */
  ambiguous: boolean;
}

// ─── Constants ──────────────────────────────────────────────

import { sendToWorker } from "./workerManager";

/**
 * Default cosine similarity for a match.
 *
 * Measured on this stack, the SAME student settles around 0.63 while a stranger
 * stays near 0.3-0.4, so a 0.7 default sat ABOVE the true score: the right
 * student failed nearly every frame and was shown as an unknown visitor, passing
 * only on an occasional lucky frame. 0.58 clears the true score with room for
 * lighting changes, and AMBIGUOUS_GAP still keeps lookalikes apart.
 */
const MATCH_THRESHOLD = 0.58;
/** Nothing below this is trusted, whatever the dashboard setting says. */
export const MIN_MATCH_THRESHOLD = 0.5;
/** Winner must beat the runner-up by this much before a name is shown. */
export const AMBIGUOUS_GAP = 0.08;
const MODEL_BASE_URL = "https://storage.googleapis.com/mediapipe-models";
// ✅ Updated 2026 model URLs — verified working
// MediaPipe face detector:
const FACE_DETECTOR_MODEL = `${MODEL_BASE_URL}/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`;

// 🔴 ACCURACY FIX #2: InsightFace ArcFace MobileFaceNet (w600k_mbf)
// 99.4% LFW accuracy — the industry standard for browser face recognition
//
// Model specs:
//   Input:  [1, 3, 112, 112]  — RGB, normalized to [-1, 1]
//   Output: 512-dim embedding  — caller applies L2 normalization
//   Size:   ~6MB
//   Source (updated 2026): https://huggingface.co/WePrompt/buffalo_sc
const ONNX_MODEL_URL = "https://huggingface.co/WePrompt/buffalo_sc/resolve/main/w600k_mbf.onnx";

let faceDetector: FaceDetector | null = null;
let modelLoading = false;
let faceWorkerReady = false;

/**
 * Check if the face recognition worker is ready (called by sendToWorker timeout handler).
 * The shared workerManager handles connection — this module just tracks if init succeeded.
 */

// ─── Face Detection (MediaPipe) ─────────────────────────────

export async function initFaceDetector(): Promise<boolean> {
  if (faceDetector) return true;
  if (modelLoading) return false;
  modelLoading = true;

  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm",
    );

    faceDetector = await FaceDetector.createFromModelPath(vision, FACE_DETECTOR_MODEL);
    modelLoading = false;
    return true;
  } catch (err) {
    console.error("Failed to load face detector:", err);
    modelLoading = false;
    return false;
  }
}

export async function initFaceRecognizer(): Promise<boolean> {
  if (faceWorkerReady) return true;

  try {
    await sendToWorker("init_face", { modelUrl: ONNX_MODEL_URL });
    faceWorkerReady = true;
    console.log("[Face] Using ArcFace w600k_mbf (~99.4% LFW accuracy)");
    return true;
  } catch (err) {
    console.error("Failed to load face recognition model:", err);
    return false;
  }
}

/**
 * Detect faces in a video frame using MediaPipe.
 */
export function detectFaces(video: HTMLVideoElement, canvas: HTMLCanvasElement): FaceResult[] {
  if (!faceDetector) return [];

  const ctx = canvas.getContext("2d");
  if (!ctx) return [];

  // Draw video frame to canvas for MediaPipe
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  try {
    const result: FaceDetectorResult = faceDetector.detect(canvas);

    if (!result.detections || result.detections.length === 0) return [];

    return result.detections.map((det) => {
      const box = det.boundingBox!;
      return {
        bbox: [
          box.originX / canvas.width,
          box.originY / canvas.height,
          box.width / canvas.width,
          box.height / canvas.height,
        ],
        confidence: det.categories?.[0]?.score ?? 0,
      };
    });
  } catch (err) {
    console.error("Face detection error:", err);
    return [];
  }
}

/**
 * Crop face region from video, get pixel data, and send to Web Worker.
 */
export async function getFaceEmbedding(
  video: HTMLVideoElement,
  bbox: [number, number, number, number],
  canvas: HTMLCanvasElement,
): Promise<Float32Array | null> {
  if (!faceWorkerReady) return null;

  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    if (faceTooSmall(bbox)) return null;
    const rect = squarePadRect(bbox, video.videoWidth, video.videoHeight);

    // 🔴 ACCURACY FIX #2: ArcFace expects 112x112 input
    const FACE_INPUT_SIZE = 112;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = FACE_INPUT_SIZE;
    tempCanvas.height = FACE_INPUT_SIZE;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return null;

    tempCtx.drawImage(
      video,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      0,
      0,
      FACE_INPUT_SIZE,
      FACE_INPUT_SIZE,
    );

    // Get pixel data
    const imageData = tempCtx.getImageData(0, 0, FACE_INPUT_SIZE, FACE_INPUT_SIZE);

    // 🔴 Send pixel data to shared Web Worker for inference
    const result = await sendToWorker(
      "get_embedding",
      {
        pixels: imageData.data,
        width: FACE_INPUT_SIZE,
        height: FACE_INPUT_SIZE,
      },
      [imageData.data.buffer],
      30000,
    );

    return result as Float32Array;
  } catch (err) {
    console.error("Embedding error:", err);
    return null;
  }
}

/**
 * Match a face embedding against enrolled faces using cosine similarity.
 * Compares against ALL embeddings per student (multiple angles) and takes the best score.
 * Returns the best match or null if below threshold.
 *
 * 🔴 ACCURACY FIX #4: Student with multiple embeddings (front, left, right angles)
 * is compared from all angles — best score wins.
 */
export function matchFace(
  embedding: Float32Array,
  enrolledFaces: EnrolledFace[],
  threshold: number = MATCH_THRESHOLD,
): MatchResult {
  if (enrolledFaces.length === 0) {
    return { person: null, confidence: 0, matched: false, runnerUp: -1, ambiguous: false };
  }

  let bestScore = -1;
  let bestPerson: EnrolledFace | null = null;
  const bestByPerson = new Map<string, { person: EnrolledFace; score: number }>();

  for (const enrolled of enrolledFaces) {
    // Compare against ALL embeddings for this student (multiple angles)
    for (const emb of enrolled.embeddings) {
      if (embedding.length !== emb.length || embedding.length === 0) continue;
      const score = cosineSimilarity(embedding, emb);
      if (score > bestScore) {
        bestScore = score;
        bestPerson = enrolled;
      }
      const prev = bestByPerson.get(enrolled.id);
      if (!prev || score > prev.score) bestByPerson.set(enrolled.id, { person: enrolled, score });
    }
  }

  // Runner-up: best score from any OTHER identity (margin against lookalikes).
  let runnerUp = -1;
  for (const [id, entry] of bestByPerson) {
    if (bestPerson && id === bestPerson.id) continue;
    if (entry.score > runnerUp) runnerUp = entry.score;
  }

  const matched = bestScore >= threshold;
  const ambiguous = matched && runnerUp >= 0 && bestScore - runnerUp < AMBIGUOUS_GAP;

  return {
    person: matched ? bestPerson : null,
    confidence: bestScore,
    matched,
    runnerUp,
    ambiguous,
  };
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Detect faces in a canvas directly (for processing photos, not live video).
 */
export function detectFacesFromCanvas(canvas: HTMLCanvasElement): FaceResult[] {
  if (!faceDetector) return [];

  try {
    const result: FaceDetectorResult = faceDetector.detect(canvas);

    if (!result.detections || result.detections.length === 0) return [];

    return result.detections.map((det) => {
      const box = det.boundingBox!;
      return {
        bbox: [
          box.originX / canvas.width,
          box.originY / canvas.height,
          box.width / canvas.width,
          box.height / canvas.height,
        ],
        confidence: det.categories?.[0]?.score ?? 0,
      };
    });
  } catch (err) {
    console.error("Face detection error:", err);
    return [];
  }
}

/**
 * Compute face embedding from a canvas (for processing photos).
 */
export async function getFaceEmbeddingFromCanvas(
  canvas: HTMLCanvasElement,
  bbox: [number, number, number, number],
): Promise<Float32Array | null> {
  if (!faceWorkerReady) return null;

  try {
    if (faceTooSmall(bbox)) return null;
    const rect = squarePadRect(bbox, canvas.width, canvas.height);

    // 🔴 ACCURACY FIX #2: ArcFace expects 112x112 input
    const FACE_INPUT_SIZE = 112;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = FACE_INPUT_SIZE;
    tempCanvas.height = FACE_INPUT_SIZE;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return null;

    tempCtx.drawImage(
      canvas,
      rect.x,
      rect.y,
      rect.w,
      rect.h,
      0,
      0,
      FACE_INPUT_SIZE,
      FACE_INPUT_SIZE,
    );

    const imageData = tempCtx.getImageData(0, 0, FACE_INPUT_SIZE, FACE_INPUT_SIZE);

    // 🔴 Send to shared Web Worker for inference
    const result = await sendToWorker(
      "get_embedding",
      {
        pixels: imageData.data,
        width: FACE_INPUT_SIZE,
        height: FACE_INPUT_SIZE,
      },
      [imageData.data.buffer],
      30000,
    );

    return result as Float32Array;
  } catch (err) {
    console.error("Embedding error:", err);
    return null;
  }
}

/**
 * Cleanup resources.
 */
export function cleanupFaceResources(): void {
  faceDetector?.close();
  faceDetector = null;
  faceWorkerReady = false;
}

// Keep old name for backward compatibility
export function cleanupFaceDetector(): void {
  cleanupFaceResources();
}
