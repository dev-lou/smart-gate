-- ============================================================
-- Migration 004: REAL Uniform Types (replaces placeholder data)
-- ============================================================
-- ⚠️ Run this INSTEAD OF / AFTER migration 002. It is safe either way:
--    • If you already ran 002 → this deletes the placeholder rows and
--      inserts the real ones (no conflict, no duplicate names).
--    • If you never ran 002 → this creates the tables itself, so it
--      fully replaces 002. You do NOT need 002 anymore.
--
-- Run AFTER database/schema.sql.
--
-- 📛 CLASS NAME FORMAT:  <course>_<type>_uniform
--    This matches your image files exactly:
--      agri_male_uniform_1.jpg      → class:  agri_male_uniform
--      education_female_uniform_1   → class:  education_female_uniform
--      chm_chef_uniform_1.jpg       → class:  chm_chef_uniform
-- ============================================================

-- ─── Tables (CREATE IF NOT EXISTS = works even without 002) ──
CREATE TABLE IF NOT EXISTS uniform_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,                    -- YOLO class name (matches Roboflow + image files)
    description TEXT,                             -- Human-readable label for the guard UI
    class_id INTEGER NOT NULL UNIQUE,            -- YOLO class index (0, 1, 2, ...)
    color_hex TEXT,                              -- Optional reference color for fallback
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uniform_types_class_id ON uniform_types(class_id);

CREATE TABLE IF NOT EXISTS course_uniforms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course TEXT NOT NULL,                         -- e.g., "CHM", "Education", "COAGRI"
    uniform_type_id UUID NOT NULL REFERENCES uniform_types(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(course, uniform_type_id)
);

CREATE INDEX IF NOT EXISTS idx_course_uniforms_course ON course_uniforms(course);

-- ─── 1. Remove placeholder data from 002 (if it was run) ────
-- Deletes the old made-up uniform types and their course links.
-- Nothing happens if they don't exist.
DELETE FROM course_uniforms
WHERE uniform_type_id IN (
    SELECT id FROM uniform_types
    WHERE name IN ('BSIT Uniform', 'CHM Uniform', 'COAGRI Uniform', 'Education Uniform')
);

DELETE FROM uniform_types
WHERE name IN ('BSIT Uniform', 'CHM Uniform', 'COAGRI Uniform', 'Education Uniform');

-- ─── 2. Insert REAL uniform types ───────────────────────────
-- class_id MUST match the order of classes in your trained YOLO model
-- (the order you create classes in Roboflow, as shown in data.yaml).
--
-- Recommended Roboflow class order (create them in THIS order):
--   0 = education_female_uniform
--   1 = education_male_uniform
--   2 = chm_chef_uniform
--   3 = chm_fnb_uniform
--   4 = chm_front_office_uniform
--   5 = chm_universal_uniform
-- ============================================================
INSERT INTO uniform_types (name, description, class_id, color_hex) VALUES
    ('education_female_uniform',   'Education Female Uniform',   0, '#ca8a04'),
    ('education_male_uniform',     'Education Male Uniform',     1, '#b45309'),
    ('chm_chef_uniform',           'CHM Chef Uniform',           2, '#16a34a'),
    ('chm_fnb_uniform',            'CHM F&B Uniform',            3, '#22c55e'),
    ('chm_front_office_uniform',   'CHM Front Office Uniform',   4, '#15803d'),
    ('chm_universal_uniform',      'CHM Universal Uniform',      5, '#4d7c0f')
ON CONFLICT (name) DO NOTHING;

-- ─── 3. Link courses to their allowed uniforms ──────────────
-- CHM students may wear any of the 4 CHM uniforms.
-- Education students may wear the male or female Education uniform.
INSERT INTO course_uniforms (course, uniform_type_id)
SELECT 'Education', id FROM uniform_types WHERE name = 'education_female_uniform'
UNION ALL
SELECT 'Education', id FROM uniform_types WHERE name = 'education_male_uniform'
UNION ALL
SELECT 'CHM', id FROM uniform_types WHERE name = 'chm_chef_uniform'
UNION ALL
SELECT 'CHM', id FROM uniform_types WHERE name = 'chm_fnb_uniform'
UNION ALL
SELECT 'CHM', id FROM uniform_types WHERE name = 'chm_front_office_uniform'
UNION ALL
SELECT 'CHM', id FROM uniform_types WHERE name = 'chm_universal_uniform'
ON CONFLICT (course, uniform_type_id) DO NOTHING;

-- ─── 4. Kiosk class-name mapping setting ────────────────────
-- The kiosk reads this JSON to map YOLO class_id → uniform name.
-- name = YOLO class name (must match students.uniform_type values).
-- label = human-readable text shown in logs/UI.
INSERT INTO system_settings (key, value, description) VALUES
('uniform_class_names',
 '[{"id":0,"name":"education_female_uniform","label":"Education Female Uniform"},{"id":1,"name":"education_male_uniform","label":"Education Male Uniform"},{"id":2,"name":"chm_chef_uniform","label":"CHM Chef Uniform"},{"id":3,"name":"chm_fnb_uniform","label":"CHM F&B Uniform"},{"id":4,"name":"chm_front_office_uniform","label":"CHM Front Office Uniform"},{"id":5,"name":"chm_universal_uniform","label":"CHM Universal Uniform"}]',
 'JSON mapping of YOLO class_id → uniform name (must match trained model order)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW();

-- ─── 5. Existing students with old placeholder uniforms ─────
-- If you enrolled students while 002 placeholders were active, their
-- uniform_type column still says e.g. "BSIT Uniform". Fix them with:
-- UPDATE students SET uniform_type = 'chm_universal_uniform' WHERE uniform_type = 'CHM Uniform';
-- (Or re-enroll them from the Guard Station.)

-- ─── 6. Row Level Security (idempotent) ─────────────────────
ALTER TABLE uniform_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_uniforms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can read uniform_types" ON uniform_types;
DROP POLICY IF EXISTS "Anon can read course_uniforms" ON course_uniforms;
DROP POLICY IF EXISTS "Authenticated users can manage uniform_types" ON uniform_types;
DROP POLICY IF EXISTS "Authenticated users can manage course_uniforms" ON course_uniforms;

CREATE POLICY "Anon can read uniform_types"
    ON uniform_types FOR SELECT USING (true);

CREATE POLICY "Anon can read course_uniforms"
    ON course_uniforms FOR SELECT USING (true);

CREATE POLICY "Authenticated users can manage uniform_types"
    ON uniform_types FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage course_uniforms"
    ON course_uniforms FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- ============================================================
-- ➕ ADD BSIT & AGRI LATER (after you train those uniforms)
-- ============================================================
-- Follow the SAME naming format: <course>_<type>_uniform
-- Just uncomment and run after training the new YOLO classes
-- (class_ids 6-9):
--
-- INSERT INTO uniform_types (name, description, class_id, color_hex) VALUES
--     ('bsit_male_uniform',    'BSIT Male Uniform',    6, '#1d4ed8'),
--     ('bsit_female_uniform',  'BSIT Female Uniform',  7, '#3b82f6'),
--     ('agri_male_uniform',    'Agri Male Uniform',    8, '#dc2626'),
--     ('agri_female_uniform',  'Agri Female Uniform',  9, '#ef4444')
-- ON CONFLICT (name) DO NOTHING;
--
-- INSERT INTO course_uniforms (course, uniform_type_id)
-- SELECT 'COAGRI', id FROM uniform_types WHERE name = 'agri_male_uniform'
-- UNION ALL
-- SELECT 'COAGRI', id FROM uniform_types WHERE name = 'agri_female_uniform'
-- UNION ALL
-- SELECT 'BSIT', id FROM uniform_types WHERE name = 'bsit_male_uniform'
-- UNION ALL
-- SELECT 'BSIT', id FROM uniform_types WHERE name = 'bsit_female_uniform'
-- ON CONFLICT (course, uniform_type_id) DO NOTHING;
--
-- ⚠️ Then update the 'uniform_class_names' setting above with the
--    new class entries (ids 6-9) so the kiosk recognizes them.
-- ============================================================
