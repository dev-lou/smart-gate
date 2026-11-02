/**
 * Inference Worker Manager (face lane only)
 * ========================================
 * Face-embedding inference runs in a dedicated worker so the main thread
 * stays free for UI rendering. Uniform vision was retired: there is no
 * second lane and no YOLO model.
 *
 * Usage:
 *   import { sendToWorker } from "./workerManager";
 *   const embedding = await sendToWorker("get_embedding", { pixels, width, height });
 */

// ─── Types ──────────────────────────────────────────────────

type WorkerCallback = (data: unknown, error?: Error) => void;

interface WorkerLane {
  worker: Worker | null;
  callbacks: Map<string, WorkerCallback>;
  timeouts: Map<string, ReturnType<typeof setTimeout>>;
  counter: number;
}

// ─── State ──────────────────────────────────────────────────

function createLane(): WorkerLane {
  return { worker: null, callbacks: new Map(), timeouts: new Map(), counter: 0 };
}

/** Face-embedding lane (init_face / get_embedding). */
const faceLane = createLane();

// ─── Worker Lifecycle ───────────────────────────────────────

/**
 * Lazily create the worker for a lane.
 */
function getWorker(lane: WorkerLane, laneName: string): Worker {
  if (lane.worker) return lane.worker;

  lane.worker = new Worker(new URL("./inference.worker.ts", import.meta.url), {
    type: "module",
  });

  lane.worker.onmessage = (event: MessageEvent) => {
    const { type, id, data } = event.data;

    const callback = lane.callbacks.get(id);
    if (callback) {
      const workerError =
        typeof type === "string" && type.endsWith("_error")
          ? new Error(`[Worker] ${type}: ${String(data)}`)
          : undefined;
      callback(data, workerError);
      lane.callbacks.delete(id);

      // Clear timeout
      const timeout = lane.timeouts.get(id);
      if (timeout) {
        clearTimeout(timeout);
        lane.timeouts.delete(id);
      }
    }
  };

  lane.worker.onerror = (err) => {
    console.error(`[WorkerManager:${laneName}] Worker error:`, err);
  };

  return lane.worker;
}

// ─── Communication ──────────────────────────────────────────

/**
 * Send a message to the shared inference worker and wait for response.
 *
 * @param type - Message type (e.g., "init_face", "get_embedding")
 * @param data - Payload to send
 * @param transfer - Optional Transferable[] for zero-copy transfer
 * @param timeoutMs - Timeout in milliseconds (default: 60000)
 * @returns Promise resolving with the worker's response
 */
function sendToLane(
  lane: WorkerLane,
  laneName: string,
  type: string,
  data?: unknown,
  transfer?: Transferable[],
  timeoutMs: number = 60000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `req_${++lane.counter}_${Date.now()}`;
    const worker = getWorker(lane, laneName);

    lane.callbacks.set(id, (result, error) => {
      if (error) {
        reject(error);
      } else if (result === null || result === undefined) {
        reject(new Error(`Worker returned null/undefined for ${type}`));
      } else {
        resolve(result);
      }
    });

    // Timeout
    const timeout = setTimeout(() => {
      lane.callbacks.delete(id);
      lane.timeouts.delete(id);
      reject(new Error(`Worker request "${type}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    lane.timeouts.set(id, timeout);

    try {
      worker.postMessage({ type, id, data }, transfer ?? []);
    } catch (err) {
      clearTimeout(timeout);
      lane.timeouts.delete(id);
      lane.callbacks.delete(id);
      reject(err);
    }
  });
}

export function sendToWorker(
  type: string,
  data?: unknown,
  transfer?: Transferable[],
  timeoutMs: number = 60000,
): Promise<unknown> {
  return sendToLane(faceLane, "face", type, data, transfer, timeoutMs);
}

/**
 * Check if the worker has been created.
 */
export function isWorkerReady(): boolean {
  return faceLane.worker !== null;
}

// ─── Cleanup ────────────────────────────────────────────────

/**
 * Terminate the shared worker and clear all pending callbacks.
 */
export function terminateWorker(): void {
  for (const lane of [faceLane]) {
    // Clear all pending timeouts
    for (const timeout of lane.timeouts.values()) {
      clearTimeout(timeout);
    }
    lane.timeouts.clear();
    lane.callbacks.clear();

    if (lane.worker) {
      lane.worker.terminate();
      lane.worker = null;
    }

    lane.counter = 0;
  }
}
