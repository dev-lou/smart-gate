-- ============================================================
-- Migration 003: Add sync_id column to access_logs
-- ============================================================
-- This enables future server-side deduplication of access logs.
-- The kiosk already generates sync_id locally in IndexedDB.
-- Run this to prepare the database for full idempotency support.
-- ============================================================

-- Add sync_id column (nullable for backward compatibility with existing logs)
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS sync_id TEXT;

-- Index for dedup lookups when the kiosk re-uploads with same sync_id
CREATE INDEX IF NOT EXISTS idx_access_logs_sync_id ON access_logs(sync_id);

-- Optional: enable unique constraint once all existing data has sync_id populated
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_access_logs_sync_id_unique ON access_logs(sync_id) WHERE sync_id IS NOT NULL;

-- ============================================================
-- To apply this migration:
-- 1. Go to Supabase Dashboard → SQL Editor
-- 2. Paste and run this file
-- 3. The kiosk will continue working without it (sync_id omitted from insert payload)
-- 4. After running, uncomment the sync_id line in supabase.ts uploadLogs()
-- ============================================================
