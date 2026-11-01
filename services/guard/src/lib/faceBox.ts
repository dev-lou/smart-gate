"use client";

/**
 * Face-box helper (detection ONLY — no embeddings, no matching).
 * ==============================================================
 * Draws a "finding the face" overlay inside enrollment camera views so the
 * operator/subject can see whether a face is in frame before capturing.
 * Uses the same MediaPipe BlazeFace short-range model as the kiosk, but
 * never touches recognition: this module cannot identify anyone.
 */

import { FilesetResolver, FaceDetector } from "@mediapipe/tasks-vision";

export interface FaceBox {
  /** Bounding box [x, y, width, height] as a ratio of the video frame. */
  bbox: [number, number, number, number];
  /** Detector confidence 0-1. */
  confidence: number;
}

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let detector: FaceDetector | null = null;
let loading = false;

/** Lazily load the detector (safe to call on every frame — resolves fast after init). */
export async function ensureFaceBoxDetector(): Promise<boolean> {
  if (detector) return true;
  if (loading) return false;
  loading = true;
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    detector = await FaceDetector.createFromModelPath(vision, MODEL_URL);
    loading = false;
    return true;
  } catch (err) {
    console.warn("[FaceBox] detector unavailable:", err);
    loading = false;
    return false;
  }
}

/** Detect faces in a live video element. Returns [] when not ready — never throws. */
export function detectFaceBoxes(video: HTMLVideoElement): FaceBox[] {
  if (!detector) return [];
  if (video.readyState < 2 || video.videoWidth === 0) return [];
  try {
    const result = detector.detectForVideo(video, performance.now());
    const dets = result.detections ?? [];
    return dets.map((det) => {
      const box = det.boundingBox!;
      return {
        bbox: [
          box.originX / video.videoWidth,
          box.originY / video.videoHeight,
          box.width / video.videoWidth,
          box.height / video.videoHeight,
        ] as [number, number, number, number],
        confidence: det.categories?.[0]?.score ?? 0,
      };
    });
  } catch {
    return [];
  }
}

/** Paint corner brackets + status chip for the detected boxes (or the guide oval when empty). */
export function paintFaceBoxOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  boxes: FaceBox[],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = (canvas.width = video.clientWidth || video.videoWidth);
  const H = (canvas.height = video.clientHeight || video.videoHeight);
  if (!W || !H) return;
  ctx.clearRect(0, 0, W, H);

  const sx = W / video.videoWidth;
  const sy = H / video.videoHeight;

  if (boxes.length === 0) {
    // Guide oval — faint hint so the subject knows where to stand.
    const pulse = 0.3 + 0.2 * Math.sin(performance.now() / 430);
    const gw = Math.min(W * 0.5, H * 0.52);
    const gh = gw * 1.32;
    ctx.save();
    ctx.setLineDash([14, 12]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(255, 255, 255, ${pulse})`;
    ctx.beginPath();
    ctx.ellipse(W / 2, H * 0.46, gw / 2, gh / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    chip(ctx, W / 2, H * 0.46 + gh / 2 + 34, "POSITION FACE IN THE OVAL", "59, 130, 246");
    return;
  }

  for (const b of boxes) {
    const [x, y, w, h] = b.bbox;
    // Map camera-frame ratios onto the displayed (object-fit: cover) box.
    const scale = Math.max(W / video.videoWidth, H / video.videoHeight);
    const dw = video.videoWidth * scale;
    const dh = video.videoHeight * scale;
    const ox = (W - dw) / 2;
    const oy = (H - dh) / 2;
    void sx;
    void sy;
    const bx = ox + x * dw;
    const by = oy + y * dh;
    const bw = w * dw;
    const bh = h * dh;
    brackets(ctx, bx, by, bw, bh, "34, 197, 94", 1);
    chip(ctx, bx, by - 10, `FACE ${Math.round(b.confidence * 100)}%`, "34, 197, 94", "left");
  }
}

function brackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rgb: string,
  alpha: number,
): void {
  const l = Math.min(w, h) * 0.28;
  ctx.strokeStyle = `rgba(${rgb}, ${alpha})`;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  const corners: Array<[number, number, number, number]> = [
    [x, y + l, x, y],
    [x, y, x + l, y],
    [x + w - l, y, x + w, y],
    [x + w, y, x + w, y + l],
    [x + w, y + h - l, x + w, y + h],
    [x + w, y + h, x + w - l, y + h],
    [x + l, y + h, x, y + h],
    [x, y + h, x, y + h - l],
  ];
  for (const [x1, y1, x2, y2] of corners) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

function chip(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  text: string,
  rgb: string,
  align: "left" | "center" = "center",
): void {
  const fontSize = 15;
  ctx.font = `800 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  const padX = 10;
  const w = ctx.measureText(text).width + padX * 2;
  const h = fontSize + 14;
  const x = align === "center" ? anchorX - w / 2 : anchorX;
  const y = Math.max(4, anchorY - h);
  ctx.save();
  ctx.fillStyle = `rgba(${rgb}, 0.92)`;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  ctx.restore();
}
