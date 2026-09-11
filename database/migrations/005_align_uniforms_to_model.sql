-- ============================================================
-- Migration 005: Align uniform_types to the TRAINED YOLO model
-- ============================================================
-- ⚠️ Run AFTER database/schema.sql and migration 004.
--
-- WHY: The deployed ONNX model (services/kiosk/public/models/uniform_yolo11n.onnx)
-- was trained on 9 REAL classes (see uniform/data.yaml):
--   class 0: cbmsd_chef_male_uniform        class 5: coag_female_uniform
--   class 1: cbmsd_universal_male_uniform   class 6: coag_male_uniform
--   class 2: cici_blazer_uniform            class 7: education_female_uniform
--   class 3: cici_female_uniform            class 8: education_male_uniform
--   class 4: cici_male_uniform
--
-- Migration 004 still defined placeholder CHM/Education classes whose
-- class_ids (0-5) did NOT match the model. The kiosk worker reads class
-- scores BY INDEX, so detections were mislabeled and the education
-- classes (model index 7-8) were never read at all.
--
-- This migration:
--   1. Deletes the CHM placeholder uniform types + course links
--   2. Moves education_* classes to their real model indices (7, 8)
--   3. Inserts cbmsd_*, cici_*, coag_* at indices 0-6
--   4. Re-seeds course_uniforms for the real departments
--   5. Replaces the 'uniform_class_names' setting the kiosk reads
-- ============================================================

-- ─── 0. Create missing uniform tables (safe on older databases) ─
-- The resumed project already has students/settings, but not the tables
-- introduced by migration 004. Keep this migration self-contained.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS uniform_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    class_id INTEGER NOT NULL UNIQUE,
    color_hex TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS course_uniforms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course TEXT NOT NULL,
    uniform_type_id UUID NOT NULL REFERENCES uniform_types(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(course, uniform_type_id)
);

CREATE INDEX IF NOT EXISTS idx_uniform_types_class_id ON uniform_types(class_id);
CREATE INDEX IF NOT EXISTS idx_course_uniforms_course ON course_uniforms(course);

-- ─── Compatibility columns for the active application contract ──
-- The resumed project has an older access_logs table. Add every field
-- written by the kiosk and displayed by the dashboard before enabling sync.
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS person_type TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'entry';
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_operator_id TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_operator_name TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- Make server-side log deduplication available even when migration 003
-- was skipped on the resumed database.
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS sync_id TEXT;
CREATE INDEX IF NOT EXISTS idx_access_logs_sync_id ON access_logs(sync_id);

-- The kiosk writes logs with the publishable key. Keep the insert policy
-- explicit and let the authenticated dashboard manage all rows.
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can insert access_logs" ON access_logs;
DROP POLICY IF EXISTS "Authenticated users can manage access_logs" ON access_logs;
CREATE POLICY "Anon can insert access_logs"
    ON access_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Authenticated users can manage access_logs"
    ON access_logs FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

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

-- ─── 1. Remove CHM placeholders (safe no-op if already gone) ──
DELETE FROM course_uniforms
WHERE uniform_type_id IN (
    SELECT id FROM uniform_types WHERE name IN (
        'chm_chef_uniform', 'chm_fnb_uniform', 'chm_front_office_uniform',
        'chm_universal_uniform', 'BSIT Uniform', 'CHM Uniform',
        'COAGRI Uniform', 'Education Uniform'
    )
);

DELETE FROM uniform_types
WHERE name IN (
    'chm_chef_uniform', 'chm_fnb_uniform', 'chm_front_office_uniform',
    'chm_universal_uniform', 'BSIT Uniform', 'CHM Uniform',
    'COAGRI Uniform', 'Education Uniform'
);

-- ─── 2. Move education_* to their real model indices (7, 8) ───
-- Do this BEFORE inserting classes 0-6 to avoid UNIQUE conflicts on class_id.
UPDATE uniform_types SET class_id = 7 WHERE name = 'education_female_uniform';
UPDATE uniform_types SET class_id = 8 WHERE name = 'education_male_uniform';

-- ─── 3. Insert the real model classes at indices 0-6 ─────────
INSERT INTO uniform_types (name, description, class_id, color_hex) VALUES
    ('cbmsd_chef_male_uniform',      'CBMSD Chef Male Uniform',      0, '#1d4ed8'),
    ('cbmsd_universal_male_uniform', 'CBMSD Universal Male Uniform', 1, '#3b82f6'),
    ('cici_blazer_uniform',          'CICI Blazer Uniform',          2, '#16a34a'),
    ('cici_female_uniform',          'CICI Female Uniform',          3, '#22c55e'),
    ('cici_male_uniform',            'CICI Male Uniform',            4, '#15803d'),
    ('coag_female_uniform',          'COAG Female Uniform',          5, '#d97706'),
    ('coag_male_uniform',            'COAG Male Uniform',            6, '#ea580c'),
    ('education_female_uniform',     'Education Female Uniform',     7, '#f59e0b'),
    ('education_male_uniform',       'Education Male Uniform',       8, '#d9770b')
ON CONFLICT (name) DO NOTHING;

-- ─── 4. Re-seed course → uniform links (real departments) ─────
-- Courses MUST match the Guard Station COURSES list (CBMSD/CICI/COAG/Education).
DELETE FROM course_uniforms; -- rebuild cleanly (idempotent for re-runs)

INSERT INTO course_uniforms (course, uniform_type_id)
SELECT 'CBMSD', id FROM uniform_types WHERE name = 'cbmsd_chef_male_uniform'
UNION ALL
SELECT 'CBMSD', id FROM uniform_types WHERE name = 'cbmsd_universal_male_uniform'
UNION ALL
SELECT 'CICI', id FROM uniform_types WHERE name = 'cici_blazer_uniform'
UNION ALL
SELECT 'CICI', id FROM uniform_types WHERE name = 'cici_female_uniform'
UNION ALL
SELECT 'CICI', id FROM uniform_types WHERE name = 'cici_male_uniform'
UNION ALL
SELECT 'COAG', id FROM uniform_types WHERE name = 'coag_female_uniform'
UNION ALL
SELECT 'COAG', id FROM uniform_types WHERE name = 'coag_male_uniform'
UNION ALL
SELECT 'Education', id FROM uniform_types WHERE name = 'education_female_uniform'
UNION ALL
SELECT 'Education', id FROM uniform_types WHERE name = 'education_male_uniform'
ON CONFLICT (course, uniform_type_id) DO NOTHING;

-- ─── 5. Replace the kiosk class-name mapping setting ──────────
-- id MUST match the trained model class index (0-8).
INSERT INTO system_settings (key, value, description) VALUES
('uniform_class_names',
 '[{"id":0,"name":"cbmsd_chef_male_uniform","label":"CBMSD Chef Male Uniform"},{"id":1,"name":"cbmsd_universal_male_uniform","label":"CBMSD Universal Male Uniform"},{"id":2,"name":"cici_blazer_uniform","label":"CICI Blazer Uniform"},{"id":3,"name":"cici_female_uniform","label":"CICI Female Uniform"},{"id":4,"name":"cici_male_uniform","label":"CICI Male Uniform"},{"id":5,"name":"coag_female_uniform","label":"COAG Female Uniform"},{"id":6,"name":"coag_male_uniform","label":"COAG Male Uniform"},{"id":7,"name":"education_female_uniform","label":"Education Female Uniform"},{"id":8,"name":"education_male_uniform","label":"Education Male Uniform"}]',
 'JSON mapping of YOLO class_id → uniform name (EXACT order of the trained 9-class model)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, updated_at = NOW();

-- ─── 6. Existing students with obsolete CHM uniform types ─────
-- Students whose uniform_type is still 'chm_*' reference classes that no
-- longer exist. The kiosk's checkUniform() will treat their expected class
-- as unknown and ALLOW access (uniform check passes silently), so re-enroll
-- them from the Guard Station with one of the 9 real classes:
--
--   UPDATE students SET uniform_type = 'cici_female_uniform' WHERE name = '...';
--
-- The kiosk only downloads is_active = true students, and embeddings are
-- regenerated automatically after the next sync.

-- ============================================================
-- VERIFY AFTER RUNNING:
--   SELECT class_id, name FROM uniform_types ORDER BY class_id;
--   → 0..8 with the 9 class names above (education_* at 7 and 8)
--   SELECT course, uniform_type_id FROM course_uniforms ORDER BY course;
--   SELECT sync_id FROM access_logs LIMIT 1;
-- ============================================================