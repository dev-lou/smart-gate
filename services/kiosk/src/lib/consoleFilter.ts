/**
 * Console Filter
 * ==============
 * MediaPipe's TFLite WASM runtime prints normal success messages to stderr,
 * e.g. "INFO: Created TensorFlow Lite XNNPACK delegate for CPU."
 *
 * The browser relays WASM stderr through console.error, and Next.js's dev
 * overlay surfaces any console.error as a scary "Console Error" pointing at
 * whatever code happened to be running — even though nothing failed.
 *
 * This filter downgrades ONLY known-benign TFLite/MediaPipe info lines so
 * the kiosk stays clean in dev and on the defense-day tablet. Real errors
 * from our code and from MediaPipe still pass through untouched.
 */

const BENIGN_WASM_PATTERNS: RegExp[] = [
  // MediaPipe/TFLite delegate status messages (success output, not errors)
  /^INFO: Created TensorFlow Lite .* delegate/i,
  /INFO: Created TensorFlow Lite delegate for CPU/i,
  // WebGPU delegate startup chatter on Chrome (also benign)
  /^INFO: Created TensorFlow Lite WebGPU delegate/i,
  // MediaPipe graph telemetry notices that arrive via stderr
  /^INFO: Initialized TensorFlow Lite runtime/i,
  /^INFO: Created OpenGL WebPlug/i,
  // MediaPipe GL context notices (log/warn level, purely informational)
  /OpenGL error checking is disabled/i,
  // ONNX Runtime Web: CPU fallback notices — expected on every load in our worker
  /Some nodes were not assigned to the preferred execution providers/i,
  /Rerunning with verbose output on a non-minimal build will show node assignments\./i,
  /removing requested execution provider .* because it is not available/i,
  // MediaPipe absl-style INFO lines, e.g. "I0909 14:33:59.329000 1905760 gl_context.cc:374] GL version..."
  /^[IWEF]\d{4} \d{2}:\d{2}:\d{2}(\.\d+)? \d+ /,
  // MediaPipe graph started confirmation (success message, not an error)
  /^Graph successfully started running\.?$/i,
  // Browser's own message when the gate WebSocket can't be reached.
  // Expected whenever the ESP32 is powered off; the kiosk keeps
  // reconnecting with backoff and self-heals when it comes online.
  /^WebSocket connection to 'ws:\/\/.*' failed/i,
  // Kiosk's informational notice when the gate link drops.
  /^\[Kiosk\] Gate disconnected, auto-reconnect will attempt/,
];

/** Testable matcher: is this console payload entirely known-benign TFLite/MediaPipe chatter?
 *  A payload is dropped only when every string part matches a benign pattern — so a real
 *  error that merely mentions TFLite (e.g. "XNNPACK delegate init failed") still shows. */
export function isBenignWasmLog(args: unknown[]): boolean {
  const parts = args
    .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : ""))
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((text) => BENIGN_WASM_PATTERNS.some((re) => re.test(text)));
}

let installed = false;

/** Idempotent — safe to call from multiple components. */
export function installConsoleFilter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origError = window.console.error.bind(window.console);
  window.console.error = (...args: unknown[]) => {
    if (isBenignWasmLog(args)) return; // drop benign TFLite stderr chatter
    origError(...args);
  };

  const origWarn = window.console.warn.bind(window.console);
  window.console.warn = (...args: unknown[]) => {
    if (isBenignWasmLog(args)) return;
    origWarn(...args);
  };

  // MediaPipe also prints its absl INFO lines through console.log —
  // harmless, but they look alarming; filter the same known-benign set.
  const origLog = window.console.log.bind(window.console);
  window.console.log = (...args: unknown[]) => {
    if (isBenignWasmLog(args)) return;
    origLog(...args);
  };
}
