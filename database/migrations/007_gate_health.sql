-- ============================================================
-- Migration 007: Gate feedback + kiosk health monitoring
-- ============================================================
-- Run this AFTER migration 006.
--
-- Adds:
--   1. `gate_state` on access_logs — records whether the gate
--      physically confirmed OPEN after a grant (feedback loop).
--   2. `kiosk_heartbeats` — one row per kiosk tablet with live
--      health (camera, gate link, pending syncs, last error...).
--
-- Safe to run more than once.
-- ============================================================

-- ─── 1. Gate feedback column on access logs ────────────────
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS gate_state TEXT;

CREATE INDEX IF NOT EXISTS idx_access_logs_gate_state ON access_logs(gate_state);

-- ─── 2. Kiosk heartbeat table ──────────────────────────────
CREATE TABLE IF NOT EXISTS kiosk_heartbeats (
    kiosk_id        TEXT PRIMARY KEY,
    kiosk_name      TEXT,
    camera_ok       BOOLEAN NOT NULL DEFAULT false,
    gate_connected  BOOLEAN NOT NULL DEFAULT false,
    gate_state      TEXT,
    students_count  INTEGER NOT NULL DEFAULT 0,
    unsynced_logs   INTEGER NOT NULL DEFAULT 0,
    last_sync       TEXT,
    fps             DOUBLE PRECISION,
    last_error      TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kiosk_heartbeats_updated_at
    ON kiosk_heartbeats(updated_at DESC);

-- ─── 3. RLS ────────────────────────────────────────────────
-- Kiosk (anon publishable key) upserts its own heartbeat row.
-- Heartbeat data is non-sensitive device health, so anonymous
-- upsert/read is acceptable; the Dashboard reads via its
-- authenticated session.
ALTER TABLE kiosk_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Kiosk can upsert heartbeats" ON kiosk_heartbeats;
CREATE POLICY "Kiosk can upsert heartbeats"
    ON kiosk_heartbeats FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can read heartbeats" ON kiosk_heartbeats;
CREATE POLICY "Authenticated users can read heartbeats"
    ON kiosk_heartbeats FOR SELECT TO authenticated
    USING (true);

-- ─── 4. Verification ───────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'access_logs' ORDER BY ordinal_position;
-- SELECT * FROM kiosk_heartbeats ORDER BY updated_at DESC;
-- ============================================================