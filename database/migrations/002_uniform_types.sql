-- ============================================================
-- Migration 002: Uniform Types & Course-Uniform Mapping
-- ============================================================
-- This is a SEPARATE migration file, NOT modifying the main schema.
-- Run this AFTER database/schema.sql.
--
-- Instead of hardcoding uniforms in the code, this stores them
-- in the database so you can easily add/edit uniform types
-- per course without touching code.
-- ============================================================

-- ─── Uniform Types ───────────────────────────────────────────
-- Each row = one uniform style that the YOLO model can detect.
-- The `class_id` must match the YOLO model's class index.
CREATE TABLE IF NOT EXISTS uniform_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,                    -- e.g., "BSIT Blue Polo"
    description TEXT,                             -- e.g., "Blue polo shirt with school logo"
    class_id INTEGER NOT NULL UNIQUE,            -- YOLO class index (0, 1, 2, ...)
    color_hex TEXT,                              -- Optional: reference color for fallback detection
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uniform_types_class_id ON uniform_types(class_id);

-- ─── Course Uniform Assignments ──────────────────────────────
-- Links courses to all uniform types they're allowed to wear.
-- One course can have multiple uniform options.
CREATE TABLE IF NOT EXISTS course_uniforms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course TEXT NOT NULL,                         -- e.g., "BSIT", "CHM"
    uniform_type_id UUID NOT NULL REFERENCES uniform_types(id) ON DELETE CASCADE,
    is_required BOOLEAN NOT NULL DEFAULT TRUE,   -- TRUE = must wear, FALSE = optional
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(course, uniform_type_id)
);

CREATE INDEX IF NOT EXISTS idx_course_uniforms_course ON course_uniforms(course);

-- ─── Insert Default Data ────────────────────────────────────
-- Class IDs must match what your trained YOLO model outputs.
-- These are PLACEHOLDERS — update class_id after training.
INSERT INTO uniform_types (name, description, class_id, color_hex) VALUES
    ('BSIT Uniform', 'BSIT department uniform', 0, '#1d4ed8'),
    ('CHM Uniform', 'CHM department uniform', 1, '#16a34a'),
    ('COAGRI Uniform', 'COAGRI department uniform', 2, '#dc2626'),
    ('Education Uniform', 'Education department uniform', 3, '#ca8a04')
ON CONFLICT (name) DO NOTHING;

-- Link courses to uniforms
INSERT INTO course_uniforms (course, uniform_type_id)
SELECT 'BSIT', id FROM uniform_types WHERE name = 'BSIT Uniform'
UNION ALL
SELECT 'CHM', id FROM uniform_types WHERE name = 'CHM Uniform'
UNION ALL
SELECT 'COAGRI', id FROM uniform_types WHERE name = 'COAGRI Uniform'
UNION ALL
SELECT 'Education', id FROM uniform_types WHERE name = 'Education Uniform'
ON CONFLICT (course, uniform_type_id) DO NOTHING;

-- ─── RLS Policies ───────────────────────────────────────────
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
