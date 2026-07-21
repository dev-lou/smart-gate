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

// ─── Types ──────────────────────────────────────────────────

export interface FaceResult {
  /** Bounding box [x, y, width, height] as ratio of frame */
  bbox: [number, number, number, number];
  /** Face embedding vector (128-dim) */
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
  /** 🔴 ACCURACY FIX #4: Multiple embeddings per student (different angles) */
  embeddings: Float32Array[];
}

export interface MatchResult {
  person: EnrolledFace | null;
  confidence: number;
  matched: boolean;
}

// ─── Constants ──────────────────────────────────────────────

import { sendToWorker } from "./workerManager";

const MATCH_THRESHOLD = 0.6; // Cosine similarity threshold
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
const ONNX_MODEL_URL =
  "https://huggingface.co/WePrompt/buffalo_sc/resolve/main/w600k_mbf.onnx";

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
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
    );

    faceDetector = await FaceDetector.createFromModelPath(
      vision,
      FACE_DETECTOR_MODEL
    );
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
export function detectFaces(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): FaceResult[] {
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
  canvas: HTMLCanvasElement
): Promise<Float32Array | null> {
  if (!faceWorkerReady) return null;

  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const [x, y, w, h] = bbox;
    const sx = Math.floor(x * video.videoWidth);
    const sy = Math.floor(y * video.videoHeight);
    const sw = Math.floor(w * video.videoWidth);
    const sh = Math.floor(h * video.videoHeight);

    // 🔴 ACCURACY FIX #2: ArcFace expects 112x112 input
    const FACE_INPUT_SIZE = 112;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = FACE_INPUT_SIZE;
    tempCanvas.height = FACE_INPUT_SIZE;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return null;

    tempCtx.drawImage(video, sx, sy, sw, sh, 0, 0, FACE_INPUT_SIZE, FACE_INPUT_SIZE);

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
      30000
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
  enrolledFaces: EnrolledFace[]
): MatchResult {
  if (enrolledFaces.length === 0) {
    return { person: null, confidence: 0, matched: false };
  }

  let bestScore = -1;
  let bestPerson: EnrolledFace | null = null;

  for (const enrolled of enrolledFaces) {
    // Compare against ALL embeddings for this student (multiple angles)
    for (const emb of enrolled.embeddings) {
      const score = cosineSimilarity(embedding, emb);
      if (score > bestScore) {
        bestScore = score;
        bestPerson = enrolled;
      }
    }
  }

  const matched = bestScore >= MATCH_THRESHOLD;

  return {
    person: matched ? bestPerson : null,
    confidence: bestScore,
    matched,
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
  bbox: [number, number, number, number]
): Promise<Float32Array | null> {
  if (!faceWorkerReady) return null;

  try {
    const [x, y, w, h] = bbox;
    const sx = Math.floor(x * canvas.width);
    const sy = Math.floor(y * canvas.height);
    const sw = Math.floor(w * canvas.width);
    const sh = Math.floor(h * canvas.height);

    // 🔴 ACCURACY FIX #2: ArcFace expects 112x112 input
    const FACE_INPUT_SIZE = 112;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = FACE_INPUT_SIZE;
    tempCanvas.height = FACE_INPUT_SIZE;
    const tempCtx = tempCanvas.getContext("2d");
    if (!tempCtx) return null;

    tempCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, FACE_INPUT_SIZE, FACE_INPUT_SIZE);

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
      30000
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
