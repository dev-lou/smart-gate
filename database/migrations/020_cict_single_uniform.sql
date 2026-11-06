-- ============================================================
-- 020: Switch the kiosk to the retrained 1-class CICT uniform model
-- (Roboflow project smart-gate-cict-uniform v1, YOLOv11n 640x640).
-- The kiosk reads `uniform_class_names` from system_settings at boot
-- and matches worker class ids against it, so this setting MUST be
-- reseeded to the single trained class. Safe to run more than once.
-- Run in Supabase SQL Editor AFTER deploying the kiosk code that
-- ships the new uniform_yolo11n.onnx.
-- ============================================================

-- ─── 1. Reseed the kiosk class-name mapping (id MUST match model) ───
INSERT INTO system_settings (key, value, description) VALUES
('uniform_class_names',
 '[{"id":0,"name":"cict_male_uniform","label":"CICT Male Uniform"}]',
 'JSON mapping of YOLO class_id → uniform name (EXACT order of the retrained 1-class CICT model)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW();

-- ─── 2. Point the uniform type at model class 0 ────────────────────
UPDATE uniform_types SET class_id = 0 WHERE name = 'cict_male_uniform';

-- ─── 3. Verification ───────────────────────────────────────────────
-- SELECT key, value FROM system_settings WHERE key = 'uniform_class_names';
-- SELECT class_id, name FROM uniform_types WHERE name = 'cict_male_uniform';