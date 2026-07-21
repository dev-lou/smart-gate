"use client";

/**
 * Arduino Web Serial Module
 * =========================
 * Communicates with Arduino via Web Serial API (Chrome on Android).
 * Arduino is connected via USB-OTG cable.
 *
 * Protocol:
 *   PC → Arduino: 'O' = open gate, 'C' = close gate, 'S' = status query
 *   Arduino → PC: 'B' = button pressed, 'R' = ready, 'K' = command ack
 *
 * 🔴 FIX BUG #3: Auto-reconnect — when USB disconnects, retry every 5 seconds.
 */

// ─── Web Serial API Type Declarations ───────────────────────
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPort {
  getInfo(): SerialPortInfo;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream;
  writable: WritableStream;
  addEventListener(event: "disconnect", handler: () => void): void;
  removeEventListener(event: "disconnect", handler: () => void): void;
}

interface Serial {
  requestPort(options?: {
    filters?: Array<{ usbVendorId?: number; usbProductId?: number }>;
  }): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

declare global {
  interface Navigator {
    serial: Serial;
  }
}

// ─── Types ──────────────────────────────────────────────────

export interface ArduinoState {
  connected: boolean;
  buttonPressed: boolean;
  portName: string;
}

export type ArduinoEventType =
  "button_press" | "connected" | "disconnected" | "error" | "reconnecting" | "reconnect_failed";

export interface ArduinoEvent {
  type: ArduinoEventType;
  timestamp: number;
  data?: string;
}

type ArduinoCallback = (event: ArduinoEvent) => void;

// ─── State ──────────────────────────────────────────────────

let port: SerialPort | null = null;
let reader: ReadableStreamDefaultReader<string> | null = null;
let writer: WritableStreamDefaultWriter<string> | null = null;
let listeners: ArduinoCallback[] = [];
let reading = false;
let autoReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 12; // Try for ~60 seconds (12 × 5s)
const RECONNECT_INTERVAL = 5000; // 5 seconds

// ─── Connection ─────────────────────────────────────────────

/**
 * Check if Web Serial API is supported.
 */
export function isSerialSupported(): boolean {
  return "serial" in navigator;
}

/**
 * Request Arduino port connection via browser UI.
 */
export async function connectToArduino(): Promise<ArduinoState> {
  if (!isSerialSupported()) {
    throw new Error("Web Serial API not supported. Use Chrome/Edge on Android.");
  }

  // Cancel any pending auto-reconnect
  cancelAutoReconnect();

  try {
    port = await navigator.serial.requestPort();
    await setupPort(port);

    const info = port.getInfo();
    const portName = `USB${info.usbVendorId ? ` (${info.usbVendorId.toString(16)})` : ""}`;

    emit({ type: "connected", timestamp: Date.now(), data: portName });
    reconnectAttempts = 0;

    // Setup disconnect listener
    port.addEventListener("disconnect", handleDisconnect);

    return {
      connected: true,
      buttonPressed: false,
      portName,
    };
  } catch (err) {
    port = null;
    throw err;
  }
}

/**
 * Try to auto-connect to a previously paired Arduino.
 */
export async function tryAutoConnect(): Promise<boolean> {
  if (!isSerialSupported()) return false;

  try {
    const ports = await navigator.serial.getPorts();
    if (ports.length === 0) return false;

    port = ports[0];
    await setupPort(port);

    emit({ type: "connected", timestamp: Date.now() });
    reconnectAttempts = 0;

    // Setup disconnect listener
    port.addEventListener("disconnect", handleDisconnect);

    return true;
  } catch {
    return false;
  }
}

/**
 * Shared port setup: open, create reader/writer, start listening.
 */
async function setupPort(p: SerialPort): Promise<void> {
  await p.open({ baudRate: 9600 });

  const textDecoder = new TextDecoderStream();
  p.readable.pipeTo(textDecoder.writable);
  reader = textDecoder.readable.getReader();

  const textEncoder = new TextEncoderStream();
  textEncoder.readable.pipeTo(p.writable);
  writer = textEncoder.writable.getWriter();

  startListening();
}

/**
 * Handle unexpected disconnect (cable bumped, etc.).
 * Automatically starts retrying connection.
 */
function handleDisconnect(): void {
  console.warn("[Arduino] Port disconnected, starting auto-reconnect...");
  reading = false;
  reader = null;
  writer = null;
  port = null;

  emit({ type: "disconnected", timestamp: Date.now() });

  // 🔴 FIX BUG #3: Auto-reconnect on disconnect
  startAutoReconnect();
}

/**
 * Start auto-reconnect loop.
 */
function startAutoReconnect(): void {
  if (autoReconnectTimer) return;
  reconnectAttempts = 0;

  emit({ type: "reconnecting", timestamp: Date.now() });

  autoReconnectTimer = setTimeout(async () => {
    await attemptReconnect();
  }, RECONNECT_INTERVAL);
}

/**
 * Cancel auto-reconnect loop.
 */
function cancelAutoReconnect(): void {
  if (autoReconnectTimer) {
    clearTimeout(autoReconnectTimer);
    autoReconnectTimer = null;
  }
  reconnectAttempts = 0;
}

/**
 * Attempt to reconnect one time. If it fails, schedule another attempt.
 */
async function attemptReconnect(): Promise<void> {
  autoReconnectTimer = null;
  reconnectAttempts++;

  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.error("[Arduino] Max reconnect attempts reached, giving up.");
    emit({ type: "reconnect_failed", timestamp: Date.now() });
    return;
  }

  console.log(`[Arduino] Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);

  try {
    const ports = await navigator.serial.getPorts();
    if (ports.length === 0) {
      // No port found, try again later
      scheduleNextReconnect();
      return;
    }

    // Found a port, try to open it
    const foundPort = ports[0];

    try {
      await foundPort.open({ baudRate: 9600 });
    } catch {
      // Port might already be opening — schedule retry
      scheduleNextReconnect();
      return;
    }

    port = foundPort;

    const textDecoder = new TextDecoderStream();
    port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();

    const textEncoder = new TextEncoderStream();
    textEncoder.readable.pipeTo(port.writable);
    writer = textEncoder.writable.getWriter();

    // Setup disconnect listener again
    port.addEventListener("disconnect", handleDisconnect);

    startListening();

    console.log("[Arduino] Auto-reconnected successfully!");
    emit({ type: "connected", timestamp: Date.now(), data: "auto-reconnect" });
    reconnectAttempts = 0;
  } catch (err) {
    console.warn(`[Arduino] Reconnect attempt failed:`, err);
    scheduleNextReconnect();
  }
}

/**
 * Schedule the next reconnect attempt.
 */
function scheduleNextReconnect(): void {
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    autoReconnectTimer = setTimeout(attemptReconnect, RECONNECT_INTERVAL);
    emit({ type: "reconnecting", timestamp: Date.now(), data: `Attempt ${reconnectAttempts}` });
  } else {
    emit({ type: "reconnect_failed", timestamp: Date.now() });
  }
}

// ─── Serial Communication ───────────────────────────────────

/**
 * Send open gate command to Arduino.
 */
export async function openGate(): Promise<void> {
  if (!writer) throw new Error("Arduino not connected");
  await writer.write("O");
  console.log("[Arduino] → Open gate");
}

/**
 * Send close gate command to Arduino.
 */
export async function closeGate(): Promise<void> {
  if (!writer) throw new Error("Arduino not connected");
  await writer.write("C");
  console.log("[Arduino] → Close gate");
}

/**
 * Send status query to Arduino.
 */
export async function queryStatus(): Promise<void> {
  if (!writer) return;
  try {
    await writer.write("S");
  } catch {
    // Ignore — disconnect handler will take over
  }
}

/**
 * Listen for incoming serial data (button presses, acknowledgements).
 */
async function startListening(): Promise<void> {
  if (!reader || reading) return;
  reading = true;

  try {
    while (reading) {
      const { value, done } = await reader.read();
      if (done) break;

      if (value) {
        for (const char of value) {
          switch (char) {
            case "B":
              emit({ type: "button_press", timestamp: Date.now() });
              break;
            case "R":
              // Arduino ready signal
              console.log("[Arduino] Ready signal received");
              break;
            case "K":
              // Command acknowledged
              break;
            default:
              // Unknown char — ignore
              break;
          }
        }
      }
    }
  } catch (err) {
    console.error("[Arduino] Read error:", err);
    emit({ type: "error", timestamp: Date.now(), data: String(err) });

    // If this was a port error, trigger auto-reconnect
    if (String(err).includes("disconnected") || String(err).includes("not open")) {
      handleDisconnect();
    }
  } finally {
    reading = false;
  }
}

// ─── Event System ───────────────────────────────────────────

export function onArduinoEvent(callback: ArduinoCallback): () => void {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((l) => l !== callback);
  };
}

function emit(event: ArduinoEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      // Ignore callback errors
    }
  });
}

// ─── Cleanup ────────────────────────────────────────────────

export async function disconnectArduino(): Promise<void> {
  cancelAutoReconnect();
  reading = false;

  if (reader) {
    try {
      await reader.cancel();
    } catch {}
    reader = null;
  }

  if (writer) {
    try {
      await writer.close();
    } catch {}
    writer = null;
  }

  if (port) {
    try {
      port.removeEventListener("disconnect", handleDisconnect);
      await port.close();
    } catch {}
    port = null;
  }

  listeners = [];
  emit({ type: "disconnected", timestamp: Date.now() });
}
