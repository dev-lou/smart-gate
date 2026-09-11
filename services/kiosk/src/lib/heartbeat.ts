"use client";

/**
 * Kiosk Heartbeat Module
 * ======================
 * Reports live kiosk health to Supabase (`kiosk_heartbeats` table,
 * migration 007) so the Admin Dashboard can show which gates are
 * online and what state they are in.
 *
 * Design:
 *   - One row per kiosk (upsert on `kiosk_id`)
 *   - Sent every 60s while the kiosk page is open
 *   - A kiosk is considered OFFLINE on the dashboard when its
 *     `updated_at` is older than 90 seconds
 *   - A stable `kiosk_id` is generated once and kept in IndexedDB
 */

import { getSetting, storeSetting } from "./db";
import { getSupabaseClient, initSupabase } from "./supabase";

// ─── Types ──────────────────────────────────────────────────

export interface HeartbeatInput {
  kioskName: string;
  cameraOk: boolean;
  gateConnected: boolean;
  gateState: string | null;
  studentsCount: number;
  unsyncedLogs: number;
  lastSync: string | null;
  fps: number;
  lastError: string | null;
}

export interface HeartbeatRow {
  kiosk_id: string;
  kiosk_name: string;
  camera_ok: boolean;
  gate_connected: boolean;
  gate_state: string | null;
  students_count: number;
  unsynced_logs: number;
  last_sync: string | null;
  fps: number;
  last_error: string | null;
  updated_at: string;
}

// ─── Constants ──────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 60_000;
const KIKSK_ID_KEY = "kiosk_id";

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatPaused = false;
let kioskIdPromise: Promise<string> | null = null;

// ─── Error detection ────────────────────────────────────────

/**
 * True when the failure is caused by the `kiosk_heartbeats` table (or
 * `gate_state` column) not existing yet — i.e. migration 007 has not been
 * run on this Supabase project. The heartbeat loop pauses in that case
 * instead of spamming the console every 60s.
 */
export function isHeartbeatTableMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string; status?: number };
  return (
    e.code === "PGRST205" ||
    (typeof e.message === "string" && e.message.includes("Could not find the table")) ||
    e.status === 404
  );
}

// ─── Kiosk ID ───────────────────────────────────────────────

/**
 * Get (or generate + persist) the stable kiosk identifier.
 */
export function getKioskId(): Promise<string> {
  if (kioskIdPromise) return kioskIdPromise;

  kioskIdPromise = (async () => {
    const existing = await getSetting(KIKSK_ID_KEY);
    if (existing) return existing;

    const generated = `kiosk_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .substring(2, 10)}`;
    await storeSetting(KIKSK_ID_KEY, generated);
    return generated;
  })();

  return kioskIdPromise;
}

// ─── Payload builder (pure, unit-testable) ──────────────────

export function buildHeartbeatRow(input: HeartbeatInput, kioskId: string): HeartbeatRow {
  return {
    kiosk_id: kioskId,
    kiosk_name: input.kioskName,
    camera_ok: input.cameraOk,
    gate_connected: input.gateConnected,
    gate_state: input.gateState,
    students_count: input.studentsCount,
    unsynced_logs: input.unsyncedLogs,
    last_sync: input.lastSync,
    fps: input.fps,
    last_error: input.lastError,
    updated_at: new Date().toISOString(),
  };
}

// ─── Send ───────────────────────────────────────────────────

/**
 * Upsert one heartbeat row into Supabase.
 */
export async function sendHeartbeat(input: HeartbeatInput): Promise<void> {
  const kioskId = await getKioskId();
  const row = buildHeartbeatRow(input, kioskId);

  if (!initSupabase()) {
    throw new Error("Supabase not configured");
  }
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error("Supabase not initialized");

  const { error } = await supabase.from("kiosk_heartbeats").upsert(row, {
    onConflict: "kiosk_id",
  });

  if (error) throw error;
}

// ─── Lifecycle ──────────────────────────────────────────────

/**
 * Start the heartbeat loop. Immediately sends one heartbeat,
 * then repeats every `intervalMs` (default 60s).
 */
export function startHeartbeat(
  provider: () => Promise<HeartbeatInput> | HeartbeatInput,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  if (heartbeatTimer || heartbeatPaused) return;

  const tick = () => {
    Promise.resolve()
      .then(provider)
      .then(sendHeartbeat)
      .catch((err) => {
        if (isHeartbeatTableMissing(err)) {
          // Migration 007 not run yet — pause and tell the operator once.
          heartbeatPaused = true;
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
          console.warn(
            "[Heartbeat] Paused — run database/migrations/007_gate_health.sql in Supabase, then reload the kiosk.",
          );
          return;
        }
        console.warn("[Heartbeat] Send failed:", err);
      });
  };

  tick();
  heartbeatTimer = setInterval(tick, intervalMs);
}

/**
 * Stop the heartbeat loop.
 */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
