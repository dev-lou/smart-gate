-- ============================================================
-- 020: Single-uniform catalogue (grey CICT polo).
-- NOTE: the gate now judges the uniform with CLIP zero-shot, which ignores
-- `uniform_class_names` (nothing in the kiosk reads it anymore); this reseed
-- is kept only so older rows stay interpretable. Safe to run more than once.
-- Run in Supabase SQL Editor AFTER deploying the kiosk code that writes
-- access_logs.uniform_ok (019).
-- ============================================================

-- ─── 1. Reseed the kiosk class-name mapping (id MUST match model) ───
INSERT INTO system_settings (key, value, description) VALUES
('uniform_class_names',
 '[{"id":0,"name":"cict_male_uniform","label":"CICT Male Uniform"}]',
 'Legacy JSON mapping of class_id → uniform name (kept for record; unused by the CLIP uniform check)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW();

-- ─── 2. Point the uniform type at model class 0 ────────────────────
UPDATE uniform_types SET class_id = 0 WHERE name = 'cict_male_uniform';

-- ─── 3. Verification ───────────────────────────────────────────────
-- SELECT key, value FROM system_settings WHERE key = 'uniform_class_names';
-- SELECT class_id, name FROM uniform_types WHERE name = 'cict_male_uniform';