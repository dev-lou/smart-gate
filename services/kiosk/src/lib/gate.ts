"use client";

/**
 * Unified Gate Module
 * ===================
 * One API for the kiosk, two transports:
 *   1. Wi-Fi  — ESP32 over WebSocket (primary, no cable, own hotspot)
 *   2. USB    — Arduino over Web Serial (fallback, existing hardware)
 *
 * The kiosk code imports ONLY from this module. Transport selection
 * happens automatically: Wi-Fi first, USB fallback.
 */

import {
  connectToArduino,
  tryAutoConnect as serialTryAutoConnect,
  disconnectArduino,
  openGate as serialOpenGate,
  closeGate as serialCloseGate,
  queryStatus as serialQueryStatus,
  onArduinoEvent,
  isSerialSupported,
  type ArduinoEvent,
} from "./arduino";
import {
  connectWs,
  disconnectWs,
  openGateWs,
  closeGateWs,
  queryStatusWs,
  onWsEvent,
  resetGateState,
  getLastGateState as getWsGateState,
  isWsSupported,
  type GateWsEvent,
} from "./gateWs";

// ─── Types ──────────────────────────────────────────────────

export type GateTransport = "wifi" | "usb";

export interface GateEvent {
  type:
    | "button_press"
    | "connected"
    | "disconnected"
    | "error"
    | "reconnecting"
    | "reconnect_failed"
    | "gate_state";
  timestamp: number;
  data?: string;
  transport?: GateTransport;
}

export interface GateConnection {
  connected: boolean;
  transport: GateTransport | null;
}

type GateCallback = (event: GateEvent) => void;

// ─── State ──────────────────────────────────────────────────

let activeTransport: GateTransport | null = null;
let listeners: GateCallback[] = [];
let wsUnsub: (() => void) | null = null;
let serialUnsub: (() => void) | null = null;

// Wire underlying transport events once (module load).
wsUnsub = onWsEvent(forwardWsEvent);
serialUnsub = onArduinoEvent(forwardSerialEvent);

// ─── Event forwarding ───────────────────────────────────────

function forwardWsEvent(event: GateWsEvent): void {
  if (event.type === "connected") {
    // Reconnection re-promotes Wi-Fi to active transport.
    activeTransport = "wifi";
    emit({ ...event, transport: "wifi" });
    return;
  }
  if (event.type === "disconnected") {
    if (activeTransport === "wifi") activeTransport = null;
    emit({ ...event, transport: "wifi" });
    return;
  }
  // Only forward live events from the active transport.
  if (activeTransport !== "wifi") return;
  emit({ ...event, transport: "wifi" });
}

function forwardSerialEvent(event: ArduinoEvent): void {
  if (event.type === "connected") {
    activeTransport = "usb";
    emit({ ...event, transport: "usb" });
    return;
  }
  if (event.type === "disconnected") {
    if (activeTransport === "usb") activeTransport = null;
    emit({ ...event, transport: "usb" });
    return;
  }
  if (activeTransport !== "usb") return;
  emit({ ...event, transport: "usb" });
}

// ─── Connection ─────────────────────────────────────────────

/**
 * Check whether any gate transport is available.
 */
export function isGateSupported(): boolean {
  return isWsSupported() || isSerialSupported();
}

/**
 * Auto-connect on kiosk boot: try Wi-Fi first, fall back to USB serial.
 */
export async function tryAutoConnect(): Promise<GateConnection> {
  // 1. Try Wi-Fi (ESP32)
  if (isWsSupported()) {
    const wsOk = await connectWs(3000).catch(() => false);
    if (wsOk) {
      activeTransport = "wifi";
      return { connected: true, transport: "wifi" };
    }
  }

  // 2. Fall back to USB serial (Arduino)
  if (isSerialSupported()) {
    const serialOk = await serialTryAutoConnect().catch(() => false);
    if (serialOk) {
      activeTransport = "usb";
      return { connected: true, transport: "usb" };
    }
  }

  return { connected: false, transport: null };
}

/**
 * User-initiated connect: if Wi-Fi failed or is unavailable,
 * open the Web Serial pairing prompt (Chrome only).
 */
export async function connectToGate(): Promise<GateConnection> {
  if (activeTransport === "wifi") {
    return { connected: true, transport: "wifi" };
  }

  // Try Wi-Fi once more
  if (isWsSupported()) {
    const wsOk = await connectWs(3000).catch(() => false);
    if (wsOk) {
      activeTransport = "wifi";
      return { connected: true, transport: "wifi" };
    }
  }

  // Web Serial pairing prompt
  if (isSerialSupported()) {
    try {
      await connectToArduino();
      activeTransport = "usb";
      return { connected: true, transport: "usb" };
    } catch (err) {
      throw err;
    }
  }

  throw new Error("No gate transport available (WebSocket or Web Serial)");
}

// ─── Commands ───────────────────────────────────────────────

export function openGate(): Promise<void> {
  if (activeTransport === "wifi") {
    openGateWs();
    return Promise.resolve();
  }
  return serialOpenGate();
}

export function closeGate(): Promise<void> {
  if (activeTransport === "wifi") {
    closeGateWs();
    return Promise.resolve();
  }
  return serialCloseGate();
}

export function queryStatus(): Promise<void> {
  if (activeTransport === "wifi") {
    queryStatusWs();
    return Promise.resolve();
  }
  return serialQueryStatus();
}

/**
 * Ask the gate for its current state and wait for a confirmation.
 * Used for the feedback loop: after "open", expect S:OPEN.
 */
export async function confirmGateOpen(timeoutMs = 3000): Promise<boolean> {
  if (activeTransport === null) return false;

  resetGateState();
  await queryStatus().catch(() => {});

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getGateState() === "OPEN") return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return getGateState() === "OPEN";
}

/**
 * Last known gate state (IDLE / OPENING / OPEN / CLOSING / ERROR).
 * Only tracked on the Wi-Fi transport (ESP32 pushes state changes).
 */
export function getGateState(): string | null {
  // Re-exported from the WS transport; USB keeps null (no push).
  return activeTransport === "wifi" ? getWsGateState() : null;
}

// ─── Events ─────────────────────────────────────────────────

export function onGateEvent(callback: GateCallback): () => void {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((fn) => fn !== callback);
  };
}

function emit(event: GateEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      /* ignore callback errors */
    }
  });
}

// ─── Cleanup ────────────────────────────────────────────────

export function disconnectGate(): Promise<void> {
  disconnectWs();
  return disconnectArduino().catch(() => {});
}

export function getActiveTransport(): GateTransport | null {
  return activeTransport;
}
