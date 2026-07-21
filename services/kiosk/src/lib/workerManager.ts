/**
 * Shared Web Worker Manager
 * ==========================
 * Manages a single ONNX Runtime Web Worker shared between face.ts and uniform.ts.
 * This prevents duplicate workers (each loading ~10MB of WASM) on memory-constrained tablets.
 *
 * 🔴 FIX CRITIQUE #1: Single shared worker instead of two separate workers.
 *
 * Usage:
 *   import { sendToWorker } from "./workerManager";
 *   const result = await sendToWorker("init_face", { modelUrl: "..." });
 *   const embedding = await sendToWorker("get_embedding", { pixels, width, height });
 */

// ─── Types ──────────────────────────────────────────────────

type WorkerCallback = (data: unknown) => void;

// ─── State ──────────────────────────────────────────────────

let inferenceWorker: Worker | null = null;
const callbacks = new Map<string, WorkerCallback>();
const timeoutMap = new Map<string, ReturnType<typeof setTimeout>>();
let requestCounter = 0;

// ─── Worker Lifecycle ───────────────────────────────────────

/**
 * Lazily create the shared inference worker.
 */
function getWorker(): Worker {
  if (inferenceWorker) return inferenceWorker;

  inferenceWorker = new Worker(
    new URL("./inference.worker.ts", import.meta.url),
    { type: "module" }
  );

  inferenceWorker.onmessage = (event: MessageEvent) => {
    const { type, id, data } = event.data;

    const callback = callbacks.get(id);
    if (callback) {
      callback(data);
      callbacks.delete(id);

      // Clear timeout
      const timeout = timeoutMap.get(id);
      if (timeout) {
        clearTimeout(timeout);
        timeoutMap.delete(id);
      }
    }
  };

  inferenceWorker.onerror = (err) => {
    console.error("[WorkerManager] Worker error:", err);
  };

  return inferenceWorker;
}

// ─── Communication ──────────────────────────────────────────

/**
 * Send a message to the shared inference worker and wait for response.
 *
 * @param type - Message type (e.g., "init_face", "init_yolo", "get_embedding", "yolo_infer")
 * @param data - Payload to send
 * @param transfer - Optional Transferable[] for zero-copy transfer
 * @param timeoutMs - Timeout in milliseconds (default: 60000)
 * @returns Promise resolving with the worker's response
 */
export function sendToWorker(
  type: string,
  data?: unknown,
  transfer?: Transferable[],
  timeoutMs: number = 60000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `req_${++requestCounter}_${Date.now()}`;
    const worker = getWorker();

    callbacks.set(id, (result) => {
      if (result === null || result === undefined) {
        reject(new Error(`Worker returned null/undefined for ${type}`));
      } else {
        resolve(result);
      }
    });

    // Timeout
    const timeout = setTimeout(() => {
      callbacks.delete(id);
      timeoutMap.delete(id);
      reject(new Error(`Worker request "${type}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    timeoutMap.set(id, timeout);

    try {
      worker.postMessage({ type, id, data }, transfer ?? []);
    } catch (err) {
      clearTimeout(timeout);
      timeoutMap.delete(id);
      callbacks.delete(id);
      reject(err);
    }
  });
}

/**
 * Check if the worker has been created.
 */
export function isWorkerReady(): boolean {
  return inferenceWorker !== null;
}

// ─── Cleanup ────────────────────────────────────────────────

/**
 * Terminate the shared worker and clear all pending callbacks.
 */
export function terminateWorker(): void {
  // Clear all pending timeouts
  for (const timeout of timeoutMap.values()) {
    clearTimeout(timeout);
  }
  timeoutMap.clear();
  callbacks.clear();

  if (inferenceWorker) {
    inferenceWorker.terminate();
    inferenceWorker = null;
  }

  requestCounter = 0;
}
