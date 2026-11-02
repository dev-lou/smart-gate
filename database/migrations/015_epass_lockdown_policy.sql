-- ============================================================
-- 015: Guest E-Pass + Lockdown + explainable decisions
-- Features 1-2-3-8-11. Soft-disables YOLO uniform (no drops).
-- Safe to run more than once. Run in Supabase SQL Editor.
-- ============================================================

-- ─── 1. Guest E-Pass fields ─────────────────────────────────
ALTER TABLE guests ADD COLUMN IF NOT EXISTS host_name TEXT;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;
ALTER TABLE guests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
CREATE INDEX IF NOT EXISTS idx_guests_valid_until ON guests(valid_until);

-- Backfill: guests without expiry default to end of creation day (18:00)
UPDATE guests SET valid_until = (created_at::date + TIME '18:00') AT TIME ZONE 'UTC'
WHERE valid_until IS NULL;

-- ─── 2. Lockdown mode (campus-level, read by kiosk/guard) ──
INSERT INTO system_settings (key, value, description) VALUES
  ('lockdown_mode', 'false', 'Campus lockdown: when true the kiosk denies everyone with LOCKDOWN_ACTIVE except manual staff override.'),
  ('lockdown_reason', '', 'Reason shown on kiosk during lockdown (e.g. Emergency drill).')
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Explainable decisions on access_logs ────────────────
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS reason_code TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS decision_note TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS client_id TEXT;
CREATE INDEX IF NOT EXISTS idx_access_logs_reason ON access_logs(reason_code);
CREATE INDEX IF NOT EXISTS idx_access_logs_client ON access_logs(client_id);

-- ─── 4. Uniform soft-off (no drops, keeps history) ─────────
-- Kiosk skips YOLO when this is 'false'; UI hides the pill.
UPDATE system_settings SET value = 'false', description = 'DEPRECATED — uniform vision disabled by policy. Kept for history only; kiosk grants on face + pass/policy.'
WHERE key = 'uniform_detection_enabled';

-- ─── 5. Verification ────────────────────────────────────────
-- SELECT key, value FROM system_settings WHERE key IN ('lockdown_mode','uniform_detection_enabled');
-- SELECT column_name FROM information_schema.columns WHERE table_name='guests' ORDER BY ordinal_position;
-- SELECT column_name FROM information_schema.columns WHERE table_name='access_logs' ORDER BY ordinal_position;
