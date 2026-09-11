"use client";

/**
 * ESP32 Wi-Fi Gate Module (WebSocket transport)
 * ==============================================
 * Talks to the ESP32 gate controller over WebSocket (no USB cable).
 * The ESP32 runs its own hotspot; the tablet connects to
 * ws://192.168.4.1:81 by default (override with NEXT_PUBLIC_GATE_WS_URL).
 *
 * Protocol (identical to the old USB serial protocol):
 *   Tablet → ESP32:  'O' = open gate   'C' = close gate   'S' = status query
 *   ESP32 → Tablet:  'R' = ready       'K' = command ack  'B' = button pressed
 *                    'S:IDLE' / 'S:OPEN' / 'S:OPENING' / 'S:CLOSING' / 'S:ERROR'
 *
 * Auto-reconnect: retries forever with exponential backoff
 * (5s → 10s → 20s → capped at 30s) so the kiosk self-heals whenever
 * the ESP32 comes online — even if it boots after the tablet.
 */

// ─── Types ──────────────────────────────────────────────────

export interface GateWsEvent {
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
}

type GateWsCallback = (event: GateWsEvent) => void;

// ─── Constants ──────────────────────────────────────────────

const DEFAULT_WS_URL = "ws://192.168.4.1:81"; // ESP32 SoftAP default
const RECONNECT_BASE_INTERVAL = 5000;
const RECONNECT_MAX_INTERVAL = 30000;

/**
 * Exponential backoff for reconnect attempts: 5s, 10s, 20s, then 30s max.
 * Pure function so it can be unit-tested.
 */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_BASE_INTERVAL * 2 ** (attempt - 1), RECONNECT_MAX_INTERVAL);
}

// ─── State ──────────────────────────────────────────────────

let socket: WebSocket | null = null;
let listeners: GateWsCallback[] = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let manualClose = false;
let lastGateState: string | null = null;

// ─── Pure parsing (unit-testable) ───────────────────────────

/**
 * Parse one WebSocket text message into a gate event.
 * Returns null for empty/unknown messages.
 */
export function parseGateMessage(raw: string): GateWsEvent | null {
  const msg = raw.trim();
  if (!msg) return null;

  const timestamp = Date.now();

  switch (msg) {
    case "B":
      return { type: "button_press", timestamp };
    case "R":
      return { type: "connected", timestamp, data: "ready" };
    case "K":
      return null; // Command ack — no UI action needed
    default:
      if (msg.startsWith("S:")) {
        return { type: "gate_state", timestamp, data: msg.slice(2) };
      }
      return null;
  }
}

// ─── Connection ─────────────────────────────────────────────

export function isWsSupported(): boolean {
  return typeof WebSocket !== "undefined";
}

function getWsUrl(): string {
  return process.env.NEXT_PUBLIC_GATE_WS_URL || DEFAULT_WS_URL;
}

/**
 * Connect to the ESP32 WebSocket server.
 * Resolves true when the socket actually opens (within timeout).
 */
export function connectWs(timeoutMs = 3000): Promise<boolean> {
  if (!isWsSupported()) return Promise.resolve(false);
  if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(true);

  manualClose = false;
  cancelReconnect();

  return new Promise((resolve) => {
    let settled = false;

    try {
      socket = new WebSocket(getWsUrl());
    } catch {
      socket = null;
      resolve(false);
      return;
    }

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) {
        reconnectAttempts = 0;
        emit({ type: "connected", timestamp: Date.now(), data: "wifi" });
      }
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    socket.onopen = () => {
      // Ask for current gate state immediately
      try {
        socket!.send("S");
      } catch {
        /* ignore */
      }
      finish(true);
    };

    socket.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      const event = parseGateMessage(ev.data);
      if (event) {
        if (event.type === "gate_state") lastGateState = event.data ?? null;
        emit(event);
      }
    };

    socket.onerror = () => {
      /* onclose follows — reconnect logic lives there */
    };

    socket.onclose = () => {
      socket = null;
      emit({ type: "disconnected", timestamp: Date.now() });
      if (!manualClose && !settled) {
        finish(false);
      } else if (!manualClose) {
        startReconnect();
      }
    };
  });
}

// ─── Reconnect ──────────────────────────────────────────────

function startReconnect(): void {
  if (reconnectTimer) return;
  reconnectAttempts = 0;
  emit({ type: "reconnecting", timestamp: Date.now() });
  reconnectTimer = setTimeout(attemptReconnect, RECONNECT_BASE_INTERVAL);
}

function attemptReconnect(): void {
  reconnectTimer = null;
  reconnectAttempts++;

  connectWs(2500).then((ok) => {
    if (ok) {
      reconnectAttempts = 0;
    } else {
      emit({ type: "reconnecting", timestamp: Date.now(), data: `Attempt ${reconnectAttempts}` });
      reconnectTimer = setTimeout(attemptReconnect, reconnectDelayMs(reconnectAttempts));
    }
  });
}

function cancelReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
}

// ─── Commands ───────────────────────────────────────────────

export function openGateWs(): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send("O");
  } else {
    throw new Error("Gate (Wi-Fi) not connected");
  }
}

export function closeGateWs(): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send("C");
  } else {
    throw new Error("Gate (Wi-Fi) not connected");
  }
}

export function queryStatusWs(): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send("S");
  }
}

export function getLastGateState(): string | null {
  return lastGateState;
}

export function resetGateState(): void {
  lastGateState = null;
}

// ─── Events ─────────────────────────────────────────────────

export function onWsEvent(callback: GateWsCallback): () => void {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((fn) => fn !== callback);
  };
}

function emit(event: GateWsEvent): void {
  listeners.forEach((fn) => {
    try {
      fn(event);
    } catch {
      /* ignore callback errors */
    }
  });
}

// ─── Cleanup ────────────────────────────────────────────────

export function disconnectWs(): void {
  manualClose = true;
  cancelReconnect();
  if (socket) {
    try {
      socket.onclose = null;
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }
  lastGateState = null;
  emit({ type: "disconnected", timestamp: Date.now() });
}
