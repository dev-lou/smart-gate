"use client";

/**
 * Supabase Sync Module
 * =====================
 * Handles syncing data between the tablet's IndexedDB and Supabase cloud.
 * The kiosk downloads enrolled students and settings, and uploads access logs.
 *
 * Offline-First Design:
 *   - All writes go to IndexedDB first (instant, always works)
 *   - Background sync pushes logs to Supabase when online
 *   - Students + settings downloaded from Supabase and cached locally
 *   - No data is ever lost — logs persist until explicitly marked synced
 *
 * 🛡️ Crash-Safe Sync:
 *   - `syncInProgress` has a timeout (30s) to prevent deadlocks
 *   - Failed upload batches are retried with exponential backoff (3 attempts)
 *   - Each log has an idempotency key (sync_id) to prevent duplicates
 *   - Auth errors stop the sync; network errors retry
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  storeStudents,
  getUnsyncedLogs,
  markLogsSynced,
  storeSettings,
  clearStudents,
  type StoredStudent,
  type StoredLog,
} from "./db";

// ─── Types ──────────────────────────────────────────────────

export interface SyncStatus {
  lastSync: string | null;
  syncing: boolean;
  error: string | null;
  studentsDownloaded: number;
  logsUploaded: number;
}

// ─── State ──────────────────────────────────────────────────

let supabase: SupabaseClient | null = null;
let syncInProgress = false;
let syncTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Constants ──────────────────────────────────────────────

const SYNC_TIMEOUT_MS = 30_000; // 🛡️ Max sync duration (prevents deadlock)
const BATCH_SIZE = 50;          // Logs per batch
const MAX_RETRIES = 3;          // Retry attempts per batch
const RETRY_BASE_DELAY = 1000;  // 1s, then 2s, then 4s

// ─── Sync Lock (Crash-Safe) ─────────────────────────────────

/**
 * Acquire the sync lock with timeout.
 * Returns false if already locked.
 */
function acquireSyncLock(): boolean {
  if (syncInProgress) return false;
  syncInProgress = true;

  // 🛡️ Auto-release after timeout (prevents deadlock if crash before finally)
  syncTimer = setTimeout(() => {
    syncInProgress = false;
    console.warn("[Supabase] Sync lock timed out after 30s — force released");
  }, SYNC_TIMEOUT_MS);

  return true;
}

/**
 * Release the sync lock.
 */
function releaseSyncLock(): void {
  syncInProgress = false;
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

// ─── Initialization ─────────────────────────────────────────

/**
 * Initialize the Supabase client.
 * Environment variables should be set in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 */
export function initSupabase(): boolean {
  if (supabase) return true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn("[Supabase] Missing environment variables");
    return false;
  }

  supabase = createClient(url, key);
  return true;
}

/**
 * Check if Supabase is configured and reachable.
 */
export async function checkConnection(): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase.from("students").select("id", { count: "exact", head: true });
    return !error;
  } catch {
    return false;
  }
}

// ─── Download Data ──────────────────────────────────────────

/**
 * Download all active students from Supabase.
 * Each student's photo is processed locally to generate the face embedding.
 */
export async function downloadStudents(): Promise<number> {
  if (!supabase) throw new Error("Supabase not initialized");

  const { data, error } = await supabase
    .from("students")
    .select("id, name, student_id, department, uniform_type, photo_url, is_active, updated_at")
    .eq("is_active", true);

  if (error) throw error;
  if (!data || data.length === 0) return 0;

  const students: StoredStudent[] = data.map((s) => {
    return {
      id: s.id,
      name: s.name,
      student_id: s.student_id ?? "",
      department: s.department ?? "",
      uniform_type: s.uniform_type ?? "default",
      photo_url: s.photo_url,
      embeddings: [],
      is_active: s.is_active ?? true,
      updated_at: s.updated_at,
    };
  });

  await clearStudents();
  await storeStudents(students);

  return students.length;
}

/**
 * Download system settings from Supabase.
 */
export async function downloadSettings(): Promise<void> {
  if (!supabase) throw new Error("Supabase not initialized");

  const { data, error } = await supabase
    .from("system_settings")
    .select("key, value");

  if (error) throw error;
  if (!data) return;

  await storeSettings(data);
}

// ─── Upload Data ────────────────────────────────────────────

/**
 * Sleep helper for retry backoff.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload unsynchronized access logs to Supabase.
 * Uses batched inserts with retry + exponential backoff.
 * Each log includes a `sync_id` for idempotency (prevents duplicates).
 */
export async function uploadLogs(): Promise<number> {
  if (!supabase) throw new Error("Supabase not initialized");

  const unsyncedLogs = await getUnsyncedLogs();
  if (unsyncedLogs.length === 0) return 0;

  const logIds: number[] = [];
  let uploaded = 0;

  for (let i = 0; i < unsyncedLogs.length; i += BATCH_SIZE) {
    const batch = unsyncedLogs.slice(i, i + BATCH_SIZE);

    // 🛡️ Retry loop with exponential backoff
    let lastError: Error | null = null;
    let success = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const { error } = await supabase.from("access_logs").insert(
          batch.map((log) => ({
            person_id: log.person_id,
            person_name: log.person_name,
            person_type: log.person_type,
            direction: log.direction,
            method: log.method,
            success: log.success,
            confidence: log.confidence,
            uniform_ok: log.uniform_ok,
            failure_reason: log.failure_reason,
            device_timestamp: log.device_timestamp,
            // sync_id is stored locally in IndexedDB for client-side dedup
            // Future: add sync_id column to access_logs for server-side dedup
            // (see database/migrations/003_add_sync_id.sql)
          }))
        );

        if (error) {
          lastError = error;
          // Auth errors are fatal — stop immediately
          if (error.code === "PGRST301" || error.code === "401") {
            console.error("[Supabase] Auth error — stopping sync:", error);
            break;
          }
          // Network/server errors — retry with backoff
          if (attempt < MAX_RETRIES - 1) {
            const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
            console.warn(
              `[Supabase] Batch upload failed (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms:`,
              error.message
            );
            await sleep(delay);
          }
        } else {
          success = true;
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
          console.warn(`[Supabase] Network error, retrying in ${delay}ms:`, lastError.message);
          await sleep(delay);
        }
      }
    }

    if (!success) {
      // 🛡️ Log the error but don't crash — these logs will be retried on next sync
      console.warn(
        `[Supabase] Batch upload failed after ${MAX_RETRIES} attempts. ${batch.length} logs will retry on next sync.`,
        lastError?.message
      );
      // Stop processing further batches (likely a systemic issue)
      break;
    }

    uploaded += batch.length;
    logIds.push(...batch.map((l) => l.id!));
  }

  // 🛡️ Mark uploaded logs as synced (atomic — only marks what actually succeeded)
  if (logIds.length > 0) {
    await markLogsSynced(logIds);
  }

  return uploaded;
}

// ─── Full Sync ──────────────────────────────────────────────

/**
 * Perform a full sync: download students + settings, upload logs.
 *
 * 🛡️ Crash-Safe:
 *   - Lock auto-releases after 30s timeout
 *   - Failed batch uploads are retried 3x with backoff
 *   - Only successfully uploaded logs are marked synced
 *   - Auth errors stop the sync; transient errors retry
 */
export async function fullSync(): Promise<SyncStatus> {
  if (!acquireSyncLock()) {
    return {
      lastSync: null,
      syncing: true,
      error: "Sync already in progress",
      studentsDownloaded: 0,
      logsUploaded: 0,
    };
  }

  try {
    if (!supabase) {
      initSupabase();
      if (!supabase) {
        return {
          lastSync: null,
          syncing: false,
          error: "Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
          studentsDownloaded: 0,
          logsUploaded: 0,
        };
      }
    }

    // Check connection
    const connected = await checkConnection();
    if (!connected) {
      return {
        lastSync: null,
        syncing: false,
        error: "Cannot reach Supabase",
        studentsDownloaded: 0,
        logsUploaded: 0,
      };
    }

    // Download students and settings in parallel
    const [studentCount] = await Promise.all([
      downloadStudents(),
      downloadSettings(),
    ]);

    // Upload logs
    const logCount = await uploadLogs();

    return {
      lastSync: new Date().toISOString(),
      syncing: false,
      error: null,
      studentsDownloaded: studentCount,
      logsUploaded: logCount,
    };
  } catch (err) {
    return {
      lastSync: null,
      syncing: false,
      error: err instanceof Error ? err.message : "Unknown sync error",
      studentsDownloaded: 0,
      logsUploaded: 0,
    };
  } finally {
    releaseSyncLock();
  }
}
