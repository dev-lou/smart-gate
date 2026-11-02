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
 *   - get_embedding: Compute face embedding from pixel data
 *
 * Each message is async and responds with the same id for correlation.
 */

import * as ort from "onnxruntime-web";

// ─── Benign ORT chatter filter ──────────────────────────────
// ONNX Runtime prints informational warnings about execution-provider
// fallback while creating sessions (e.g. "removing requested execution
// provider webgl...", "Some nodes were not assigned..."). These are
// expected and harmless — inference simply runs on the WASM/CPU path.
// The main-thread console filter (consoleFilter.ts) cannot see logs
// printed inside this worker, so we patch the worker console here.
const BENIGN_ORT_PATTERNS: RegExp[] = [
  /removing requested execution provider .* because it is not available/i,
  /Some nodes were not assigned to the preferred execution providers/i,
  /Rerunning with verbose output on a non-minimal build will show node assignments\./i,
];

function installWorkerConsoleFilter(): void {
  const origWarn = self.console.warn.bind(self.console);
  const origError = self.console.error.bind(self.console);

  self.console.warn = (...args: unknown[]) => {
    if (args.some((a) => typeof a === "string" && BENIGN_ORT_PATTERNS.some((re) => re.test(a))))
      return;
    origWarn(...args);
  };
  self.console.error = (...args: unknown[]) => {
    if (args.some((a) => typeof a === "string" && BENIGN_ORT_PATTERNS.some((re) => re.test(a))))
      return;
    origError(...args);
  };
}

installWorkerConsoleFilter();

// ─── Types ──────────────────────────────────────────────────

interface WorkerMessage {
  type: "init_face" | "get_embedding";
  id: string;
  data?: unknown;
}

interface InitFaceData {
  modelUrl: string;
}

interface EmbeddingData {
  /** RGBA pixel data from a 112x112 cropped face (ArcFace spec) */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

// ─── Worker State ───────────────────────────────────────────

let faceSession: ort.InferenceSession | null = null;

// Constants
const FACE_INPUT_SIZE = 112; // ArcFace w600k_mbf: 112x112 input

// ─── Message Handler ────────────────────────────────────────

// ONNX Runtime Web sessions are not safe for overlapping `run()` calls.
// Serialize all worker messages so embeddings cannot corrupt the session
// or fail with "Session already started" on fast camera loops.
let messageQueue = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  messageQueue = messageQueue.then(() => handleWorkerMessage(event));
};

async function handleWorkerMessage(event: MessageEvent<WorkerMessage>) {
  const { type, id, data } = event.data;

  try {
    switch (type) {
      case "init_face":
        await initFaceSession((data as InitFaceData).modelUrl);
        self.postMessage({ type: "init_face_done", id, data: true });
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
}

// ─── Initialization ─────────────────────────────────────────

/**
 * Pick execution providers that actually exist in this browser.
 * Requesting an EP that isn't loaded makes ORT log warnings and
 * waste time during session creation. WebGPU is used when exposed
 * (Chrome/Android tablets); everything else runs on WASM/CPU.
 * WebGL is never requested: the wasm bundle used here has no WebGL
 * backend, so it always falls back anyway.
 */
export function resolveExecutionProviders(gpuAvailable: boolean): Array<"webgpu" | "wasm"> {
  return gpuAvailable ? ["webgpu", "wasm"] : ["wasm"];
}

function isWebGpuAvailable(): boolean {
  try {
    return (
      typeof navigator !== "undefined" &&
      "gpu" in navigator &&
      !!(navigator as { gpu?: unknown }).gpu
    );
  } catch {
    return false;
  }
}

async function initFaceSession(modelUrl: string): Promise<void> {
  if (faceSession) return;

  // Keep CDN WASM binaries exactly aligned with the installed runtime version.
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/";

  faceSession = await ort.InferenceSession.create(modelUrl, {
    executionProviders: resolveExecutionProviders(isWebGpuAvailable()),
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
