-- ============================================================
-- 016: Remove uniform vision (YOLO retired by policy)
-- The kiosk no longer loads any uniform model, never writes uniform
-- results, and the dashboard/guard no longer read these. Safe to
-- run more than once. Run in Supabase SQL Editor AFTER deploying
-- the app code that stops writing access_logs.uniform_ok.
-- NOTE: students.uniform_type is KEPT — it stores the course plus
-- the 'guest' marker, which the face/pass policy still uses.
-- ============================================================

-- ─── 1. Drop uniform reference tables ───────────────────────
DROP TABLE IF EXISTS course_uniforms;
DROP TABLE IF EXISTS uniform_types;

-- ─── 2. Delete uniform setting rows ─────────────────────────
DELETE FROM system_settings WHERE key IN ('uniform_detection_enabled', 'uniform_class_names');

-- ─── 3. Drop the uniform result column from access logs ─────
-- History text in failure_reason / decision_note is untouched.
ALTER TABLE access_logs DROP COLUMN IF EXISTS uniform_ok;

-- ─── 4. Verification ────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('uniform_types','course_uniforms');
-- SELECT key FROM system_settings WHERE key LIKE '%uniform%';
-- SELECT column_name FROM information_schema.columns WHERE table_name='access_logs' ORDER BY ordinal_position;
