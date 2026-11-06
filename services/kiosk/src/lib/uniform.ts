"use client";

import * as ort from "onnxruntime-web";

/**
 * Uniform Detection Module (CLIP zero-shot, runs in the browser)
 * ==============================================================
 * WHY NOT THE TRAINED YOLO MODEL ANY MORE
 * ---------------------------------------
 * The YOLO detector was trained on 97 photos, one class, every positive
 * showing the CICT polo. Nothing in that set said "a person in plain clothes is
 * NOT the uniform", so the model learned the garment pattern broadly and scored
 * a plain white t-shirt / grey polo at 0.97 — a false accept no threshold can
 * fix, because the model genuinely believes it.
 *
 * This module asks a different question. CLIP was trained on hundreds of
 * millions of image/text pairs, so it already knows the difference between
 * "a school uniform polo" and "a plain t-shirt" / "a hoodie" / "a jacket".
 * Zero-shot: no training, no dataset, no labels — the prompts ARE the classes.
 *
 * Pipeline:
 * 1. Cut the torso band under the face (torsoRegion)
 * 2. Cover-resize it to 224x224 and normalize with CLIP's constants
 * 3. Run the CLIP vision encoder (ONNX, ~89 MB, cached by the service worker)
 * 4. Softmax the image embedding against precomputed prompt embeddings
 * 5. Grant only when the uniform prompts win clearly over every negative one
 *
 * The prompt embeddings are precomputed (uniform_prompts.json) so the tablet
 * only ever downloads the vision encoder — no tokenizer, no text encoder.
 */

export interface UniformCheckResult {
  ok: boolean;
  confidence: number;
  detail: string;
  detectedType?: string;
  classId?: number;
  bbox?: [number, number, number, number];
}

// ─── Constants ──────────────────────────────────────────────

const CLIP_MODEL_URL = "/models/clip_vision_q8.onnx";
const PROMPTS_URL = "/models/uniform_prompts.json";

const CLIP_SIZE = 224;
// CLIP's own preprocessing constants (openai/clip-vit-base-patch32).
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD = [0.26862954, 0.26130258, 0.27577711];

/** Temperature CLIP's text encoder was trained with (logit_scale ≈ 100). */
const LOGIT_SCALE = 100;

/**
 * How sure the uniform prompts must be before entry is granted.
 *
 * Measured on real samples: uniform photos score 0.93–0.97, plain t-shirt /
 * grey polo / hoodie land at 0.17–0.25. 0.60 sits in the empty middle of that
 * gap, and the margin rule keeps a borderline case (two prompts near-tied) from
 * being read as a uniform just because it edged past the threshold.
 */
const MIN_UNIFORM_PROBABILITY = 0.6;

/** How far ahead of the best negative prompt the uniform prompts must be. */
const MIN_UNIFORM_MARGIN = 0.2;

// ─── State ──────────────────────────────────────────────────

let session: ort.InferenceSession | null = null;
let promptEmbeds: Float32Array[] = [];
let positiveIdx: number[] = [];
let loading: Promise<boolean> | null = null;

// ─── Initialization ─────────────────────────────────────────

/**
 * Load the CLIP vision encoder + the precomputed prompt embeddings.
 * Returns true when the uniform check is usable. Idempotent and safe to call
 * from a boot sequence that also loads the face models.
 */
export async function initUniformDetector(): Promise<boolean> {
  if (session && promptEmbeds.length > 0) return true;
  if (loading) return loading;

  loading = (async () => {
    try {
      const res = await fetch(PROMPTS_URL, { cache: "force-cache" });
      if (!res.ok) throw new Error(`prompts HTTP ${res.status}`);
      const meta = (await res.json()) as {
        prompts: string[];
        positive: number[];
        embeddings: number[][];
      };
      // Prompt wording is only used to build the embeddings — the kiosk never
      // echoes it back, so a denial can't tell the student what it thought they
      // were wearing ("reads as a hoodie" reads like an accusation).
      positiveIdx = meta.positive;
      promptEmbeds = meta.embeddings.map((e) => Float32Array.from(e));

      ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";
      // WASM, not WebGPU: the int8-quantized encoder is the small download and
      // runs reliably on the tablet's WASM backend; one 224x224 pass per student
      // is ~150-300 ms, which the "Reading uniform…" phase already covers.
      session = await ort.InferenceSession.create(CLIP_MODEL_URL, {
        executionProviders: ["wasm"],
      });
      return true;
    } catch (err) {
      console.error("[Uniform] CLIP model failed to load:", err);
      session = null;
      promptEmbeds = [];
      return false;
    } finally {
      loading = null;
    }
  })();

  return loading;
}

/** True once the vision encoder and the prompts are both ready. */
export function isUniformModelLoaded(): boolean {
  return session !== null && promptEmbeds.length > 0;
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
  const vw = video.videoWidth || CLIP_SIZE;
  const vh = video.videoHeight || CLIP_SIZE;

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

// ─── Preprocessing ──────────────────────────────────────────

/**
 * Cut the torso band out of the live video and turn it into CLIP's input
 * tensor: 224x224, cover-cropped (no stretching), RGB, CLIP-normalized CHW.
 */
function torsoToClipInput(
  video: HTMLVideoElement,
  region: { x: number; y: number; width: number; height: number },
): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = CLIP_SIZE;
  canvas.height = CLIP_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("no 2d context");

  // Cover: scale so the band fills the square, then centre-crop the overhang.
  // Stretching would change the garment's proportions and cost accuracy.
  const scale = Math.max(CLIP_SIZE / region.width, CLIP_SIZE / region.height);
  const dw = region.width * scale;
  const dh = region.height * scale;
  ctx.drawImage(
    video,
    region.x,
    region.y,
    region.width,
    region.height,
    (CLIP_SIZE - dw) / 2,
    (CLIP_SIZE - dh) / 2,
    dw,
    dh,
  );

  const { data } = ctx.getImageData(0, 0, CLIP_SIZE, CLIP_SIZE);
  const pixels = CLIP_SIZE * CLIP_SIZE;
  const out = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    const o = i * 4;
    out[i] = (data[o] / 255 - CLIP_MEAN[0]) / CLIP_STD[0];
    out[pixels + i] = (data[o + 1] / 255 - CLIP_MEAN[1]) / CLIP_STD[1];
    out[2 * pixels + i] = (data[o + 2] / 255 - CLIP_MEAN[2]) / CLIP_STD[2];
  }
  return out;
}

// ─── Main Check ─────────────────────────────────────────────

/**
 * Is this student wearing the uniform?
 *
 * @param video - The video element with the camera feed
 * @param faceBbox - Face bounding box [x, y, w, h] as ratios of the frame
 * @param _expectedUniform - Kept for call-site compatibility; CLIP decides on
 *   the garment itself, so the course's uniform name no longer changes the run.
 * @param _canvas - Unused (kept for call-site compatibility).
 */
export async function checkUniform(
  video: HTMLVideoElement,
  faceBbox: [number, number, number, number],
  _expectedUniform = "",
  _canvas?: HTMLCanvasElement,
): Promise<UniformCheckResult> {
  // The encoder is ~89 MB, so it can still be arriving when the first student
  // steps up. Wait for the in-flight load rather than denying a uniform that is
  // actually being worn — the caller already shows "Reading uniform…" here.
  if (!session || promptEmbeds.length === 0) {
    const ready = await initUniformDetector().catch(() => false);
    if (!ready || !session || promptEmbeds.length === 0) {
      return { ok: false, confidence: 0, detail: "Uniform detector not loaded" };
    }
  }

  try {
    const region = torsoRegion(faceBbox, video);
    const input = torsoToClipInput(video, region);
    const tensor = new ort.Tensor("float32", input, [1, 3, CLIP_SIZE, CLIP_SIZE]);
    const feeds: Record<string, ort.Tensor> = { pixel_values: tensor };
    const results = await session.run(feeds);
    const raw = results[session.outputNames[0]].data as Float32Array;

    let norm = 0;
    for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
    norm = Math.sqrt(norm) || 1;

    // Cosine similarity against every prompt, then CLIP's own softmax.
    const sims = promptEmbeds.map((pe) => {
      let dot = 0;
      for (let i = 0; i < pe.length; i++) dot += pe[i] * raw[i];
      return dot / norm;
    });
    const scaled = sims.map((s) => s * LOGIT_SCALE);
    const maxScaled = Math.max(...scaled);
    const exps = scaled.map((s) => Math.exp(s - maxScaled));
    const total = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((e) => e / total);

    // Every "uniform" phrasing together vs the strongest "plain clothes"
    // prompt. The garment the negatives landed on is NOT reported: naming it
    // ("reads as a hoodie") told the student what the model guessed they wore,
    // which is not the terminal's business and reads as an accusation.
    const positive = positiveIdx.reduce((a, i) => a + probs[i], 0);
    let bestNegative = 0;
    for (let i = 0; i < probs.length; i++) {
      if (positiveIdx.includes(i)) continue;
      if (probs[i] > bestNegative) bestNegative = probs[i];
    }

    const ok = positive >= MIN_UNIFORM_PROBABILITY && positive - bestNegative >= MIN_UNIFORM_MARGIN;

    return {
      ok,
      confidence: positive,
      detail: ok
        ? "✅ School uniform detected"
        : "❌ No school uniform detected — wear your uniform to enter",
      detectedType: ok ? "cict_male_uniform" : undefined,
      bbox: [
        region.x / (video.videoWidth || 1),
        region.y / (video.videoHeight || 1),
        region.width / (video.videoWidth || 1),
        region.height / (video.videoHeight || 1),
      ],
    };
  } catch (err) {
    console.error("[Uniform] CLIP inference error:", err);
    // Fail closed: an unavailable detector must never wave anyone through.
    return { ok: false, confidence: 0, detail: "Uniform detector unavailable" };
  }
}
