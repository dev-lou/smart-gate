-- ============================================================
-- 019: Bring back uniform enforcement (reverses the policy half of 016)
-- The kiosk once again reads the student's torso with the CLIP uniform
-- check after a face match and denies entry (WRONG_UNIFORM / NO_UNIFORM)
-- when the grey uniform is not detected. Safe to run more than
-- once, and safe on databases where 016 never ran.
-- Run in Supabase SQL Editor AFTER deploying the kiosk code that writes
-- access_logs.uniform_ok.
-- ============================================================

-- ─── 1. Restore the enforcement toggle ──────────────────────
INSERT INTO system_settings (key, value, description)
VALUES ('uniform_detection_enabled', 'true', 'Whether to enforce the uniform check (CLIP torso check) at the gate')
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Restore the uniform result column on access logs ─────
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS uniform_ok BOOLEAN;

-- ─── 3. Verification ────────────────────────────────────────
-- SELECT key, value FROM system_settings WHERE key = 'uniform_detection_enabled';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'access_logs' AND column_name = 'uniform_ok';
