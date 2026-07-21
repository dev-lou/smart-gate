"use client";

/**
 * IndexedDB Offline Storage Module
 * ==================================
 * Uses the `idb` library for a clean Promise-based IndexedDB API.
 * Stores:
 *   - Enrolled students with face embeddings
 *   - Access logs (to sync to Supabase when online)
 *   - System settings
 *
 * 🛡️ Crash-Safe Design:
 *   - Each log has a `sync_id` for idempotent sync (prevents duplicates)
 *   - Logs stay in IndexedDB until explicitly marked synced
 *   - Student data is replaced on each full sync (no merge conflicts)
 *   - DB schema versioned for safe migrations
 */

import { openDB, type IDBPDatabase } from "idb";
import type { EnrolledFace } from "./face";

// ─── Types ──────────────────────────────────────────────────

export interface StoredStudent {
  id: string;
  name: string;
  student_id: string;
  department: string;
  uniform_type: string;
  photo_url: string | null;
  /** 🔴 ACCURACY FIX #4: Multiple embeddings per student (different angles) */
  embeddings: Float32Array[];
  is_active: boolean;
  updated_at: string;
}

export interface StoredLog {
  id?: number;
  person_id: string | null;
  person_name: string | null;
  person_type: string | null;
  direction: string;
  method: string;
  success: boolean;
  confidence: number | null;
  uniform_ok: boolean | null;
  failure_reason: string | null;
  device_timestamp: string;
  /** 🛡️ Idempotency key — prevents duplicate logs on re-sync */
  sync_id: string;
  synced: number; // 0 = unsynced, 1 = synced
}

export interface StoredSetting {
  key: string;
  value: string;
}

// ─── Constants ──────────────────────────────────────────────

const DB_NAME = "smart-gate-kiosk";
const DB_VERSION = 2; // 🛡️ Version 2: Added sync_id to logs

let dbPromise: Promise<IDBPDatabase> | null = null;

// ─── Database Initialization ────────────────────────────────

function getDb(): Promise<IDBPDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      // Version 1: Initial schema
      if (oldVersion < 1) {
        db.createObjectStore("students", { keyPath: "id" });
        const logStore = db.createObjectStore("logs", { keyPath: "id", autoIncrement: true });
        logStore.createIndex("synced", "synced");
        logStore.createIndex("sync_id", "sync_id", { unique: false }); // Created from v1 for simplicity
        db.createObjectStore("settings", { keyPath: "key" });
      }
      // Version 2: Migration from v1 — add sync_id index to logs
      if (oldVersion === 1) {
        const logsStore = transaction.objectStore("logs");
        logsStore.createIndex("sync_id", "sync_id", { unique: false });
      }
    },
  });

  return dbPromise;
}

// ─── Students (Enrolled Faces) ──────────────────────────────

/**
 * Store or update enrolled students in IndexedDB.
 */
export async function storeStudents(students: StoredStudent[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("students", "readwrite");

  for (const student of students) {
    await tx.store.put(student);
  }

  await tx.done;
}

/**
 * Get all enrolled students with face embeddings.
 */
export async function getAllStudents(): Promise<StoredStudent[]> {
  const db = await getDb();
  return db.getAll("students");
}

/**
 * Get active students (ones that should be used for matching).
 */
export async function getActiveStudents(): Promise<StoredStudent[]> {
  const all = await getAllStudents();
  return all.filter((s) => s.is_active);
}

/**
 * Convert stored students to EnrolledFace format for matching.
 */
export async function getEnrolledFaces(): Promise<EnrolledFace[]> {
  const students = await getActiveStudents();
  return students
    .filter((s) => s.embeddings.length > 0) // Skip students with no face embeddings
    .map((s) => ({
      id: s.id,
      name: s.name,
      student_id: s.student_id,
      department: s.department,
      uniform_type: s.uniform_type,
      embeddings: s.embeddings,
    }));
}

/**
 * Get a single student by ID.
 */
export async function getStudent(id: string): Promise<StoredStudent | undefined> {
  const db = await getDb();
  return db.get("students", id);
}

/**
 * Delete a student.
 */
export async function deleteStudent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("students", id);
}

/**
 * Clear all students (for full re-sync).
 */
export async function clearStudents(): Promise<void> {
  const db = await getDb();
  await db.clear("students");
}

// ─── Access Logs (Offline Queue) ────────────────────────────

/**
 * Generate a unique sync_id for a log entry.
 * Format: timestamp_${randomString} — collision-resistant for single-tablet kiosk.
 */
function generateSyncId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

/**
 * Add an access log to the offline queue.
 * Each log gets a unique sync_id for idempotency.
 */
export async function addLog(log: Omit<StoredLog, "id" | "synced" | "sync_id">): Promise<void> {
  const db = await getDb();
  await db.add("logs", {
    ...log,
    sync_id: generateSyncId(),
    synced: 0,
  });
}

/**
 * Get all unsynced logs.
 */
export async function getUnsyncedLogs(): Promise<StoredLog[]> {
  const db = await getDb();
  const index = db.transaction("logs").store.index("synced");
  return index.getAll(0); // 0 = unsynced
}

/**
 * Mark logs as synced.
 */
export async function markLogsSynced(ids: number[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("logs", "readwrite");

  for (const id of ids) {
    const log = await tx.store.get(id);
    if (log) {
      log.synced = 1; // 1 = synced
      await tx.store.put(log);
    }
  }

  await tx.done;
}

/**
 * Delete synced logs older than the given timestamp.
 */
export async function cleanupOldLogs(beforeTimestamp: string): Promise<void> {
  const db = await getDb();
  const all = await db.getAll("logs");

  const tx = db.transaction("logs", "readwrite");
  for (const log of all) {
    if (log.synced && log.device_timestamp < beforeTimestamp) {
      await tx.store.delete(log.id!);
    }
  }

  await tx.done;
}

/**
 * Get total log count.
 */
export async function getLogCount(): Promise<number> {
  const db = await getDb();
  return db.count("logs");
}

// ─── Settings ───────────────────────────────────────────────

/**
 * Store a setting.
 */
export async function storeSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put("settings", { key, value });
}

/**
 * Get a setting value.
 */
export async function getSetting(key: string): Promise<string | undefined> {
  const db = await getDb();
  const setting = await db.get("settings", key);
  return setting?.value;
}

/**
 * Store multiple settings at once.
 */
export async function storeSettings(settings: StoredSetting[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("settings", "readwrite");

  for (const setting of settings) {
    await tx.store.put(setting);
  }

  await tx.done;
}

/**
 * Get all settings.
 */
export async function getAllSettings(): Promise<StoredSetting[]> {
  const db = await getDb();
  return db.getAll("settings");
}

/**
 * Get sync-related settings.
 */
export async function getSyncSettings(): Promise<{
  schoolName: string;
  matchThreshold: number;
  uniformEnabled: boolean;
}> {
  const schoolName = (await getSetting("school_name")) ?? "Smart Academy";
  const threshold = parseFloat((await getSetting("face_recognition_threshold")) ?? "0.6");
  const uniformEnabled = (await getSetting("uniform_detection_enabled")) !== "false";

  return { schoolName, matchThreshold: threshold, uniformEnabled };
}

// ─── Database Stats ─────────────────────────────────────────

export async function getDatabaseStats(): Promise<{
  studentCount: number;
  logCount: number;
  unsyncedCount: number;
}> {
  const db = await getDb();
  const studentCount = await db.count("students");
  const logCount = await db.count("logs");
  const unsynced = await getUnsyncedLogs();

  return {
    studentCount,
    logCount,
    unsyncedCount: unsynced.length,
  };
}

// ─── Clear All Data ─────────────────────────────────────────

export async function clearAllData(): Promise<void> {
  const db = await getDb();
  await Promise.all([db.clear("students"), db.clear("logs"), db.clear("settings")]);
}
