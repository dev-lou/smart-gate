-- ============================================================
-- Migration 006: Compatibility + secure cross-app flow
-- ============================================================
-- Run this AFTER migration 005.
--
-- The resumed Supabase project had an older access_logs table and
-- Storage policies. This migration adds the fields used by the current
-- kiosk/dashboard code and allows authenticated Guard enrollment.
-- It is safe to run more than once.
-- ============================================================

-- ─── 1. Access-log compatibility columns ────────────────────
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS person_type TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'entry';
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_operator_id TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_operator_name TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS sync_id TEXT;

-- One sync_id may be retried, but it must represent only one server row.
-- Remove duplicate non-null legacy values before creating the unique index.
-- NULL remains allowed for legacy rows.
WITH duplicate_sync_ids AS (
    SELECT sync_id, MIN(ctid) AS kept_ctid
    FROM access_logs
    WHERE sync_id IS NOT NULL
    GROUP BY sync_id
    HAVING COUNT(*) > 1
)
UPDATE access_logs AS logs
SET sync_id = NULL
FROM duplicate_sync_ids AS duplicates
WHERE logs.sync_id = duplicates.sync_id
  AND logs.ctid <> duplicates.kept_ctid;

-- A normal unique index is compatible with PostgREST's
-- `onConflict: "sync_id"` upsert syntax. PostgreSQL permits multiple NULLs,
-- so legacy rows without a sync_id remain valid.
DROP INDEX IF EXISTS idx_access_logs_sync_id_unique;
CREATE UNIQUE INDEX idx_access_logs_sync_id_unique
    ON access_logs(sync_id);

CREATE INDEX IF NOT EXISTS idx_access_logs_sync_id ON access_logs(sync_id);

-- ─── 2. Access-log RLS ───────────────────────────────────────
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon can insert access_logs" ON access_logs;
DROP POLICY IF EXISTS "Authenticated users can manage access_logs" ON access_logs;
DROP POLICY IF EXISTS "Authenticated users can read access_logs" ON access_logs;

-- Kiosk runs with the publishable key and only needs INSERT.
CREATE POLICY "Anon can insert access_logs"
    ON access_logs FOR INSERT TO anon
    WITH CHECK (true);

-- Dashboard/admin users can view and manage logs.
CREATE POLICY "Authenticated users can manage access_logs"
    ON access_logs FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- ─── 3. Student + uniform read/write policies ────────────────
-- Kiosk needs anonymous read access to active students and settings.
-- Guard and Dashboard use authenticated sessions for all student writes.
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can read active students" ON students;
DROP POLICY IF EXISTS "Authenticated users can manage students" ON students;
CREATE POLICY "Anon can read active students"
    ON students FOR SELECT TO anon
    USING (is_active = true);
CREATE POLICY "Authenticated users can manage students"
    ON students FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anon can read settings" ON system_settings;
DROP POLICY IF EXISTS "Authenticated users can manage system_settings" ON system_settings;
CREATE POLICY "Anon can read settings"
    ON system_settings FOR SELECT TO anon
    USING (true);
CREATE POLICY "Authenticated users can manage system_settings"
    ON system_settings FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- ─── 4. Student photo Storage policies ───────────────────────
-- Keep the bucket public for kiosk image downloads, but restrict writes
-- to authenticated Guard/admin users.
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-photos', 'student-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Authenticated users can upload student photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update student photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete student photos" ON storage.objects;

CREATE POLICY "Authenticated users can upload student photos"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'student-photos');

CREATE POLICY "Authenticated users can update student photos"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'student-photos')
    WITH CHECK (bucket_id = 'student-photos');

CREATE POLICY "Authenticated users can delete student photos"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'student-photos');

-- ─── 5. Verification ─────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'access_logs' ORDER BY ordinal_position;
-- SELECT indexname FROM pg_indexes WHERE tablename = 'access_logs';
-- SELECT class_id, name FROM uniform_types ORDER BY class_id;
-- SELECT course, uniform_type_id FROM course_uniforms ORDER BY course;
-- ============================================================