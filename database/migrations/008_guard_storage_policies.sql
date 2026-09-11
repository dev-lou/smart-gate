-- 008_guard_storage_policies.sql
-- Fixes "new row violates row-level security policy" when Guard Station uploads
-- student photos to the 'student-photos' bucket.
--
-- ⚠️ REQUIRED: run this in Supabase → SQL Editor. If migration 006 was run
-- before its storage section was added, these policies are missing and every
-- Guard enrollment fails at the photo-upload step.

-- NOTE: do NOT add `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;` here.
-- storage.objects is owned by supabase_storage_admin, so that line fails with
-- `42501: must be owner of table objects` in the SQL editor. RLS on storage
-- objects is already enabled by default in every Supabase project.

-- Allow authenticated Guard users to upload new student photos
DROP POLICY IF EXISTS "Authenticated users can upload student photos" ON storage.objects;
CREATE POLICY "Authenticated users can upload student photos"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'student-photos');

-- Allow authenticated Guard users to replace photos (retake / replace)
DROP POLICY IF EXISTS "Authenticated users can update student photos" ON storage.objects;
CREATE POLICY "Authenticated users can update student photos"
    ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'student-photos')
    WITH CHECK (bucket_id = 'student-photos');

-- Allow authenticated Guard users to delete photos (remove)
DROP POLICY IF EXISTS "Authenticated users can delete student photos" ON storage.objects;
CREATE POLICY "Authenticated users can delete student photos"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'student-photos');

-- Public read access to student photos (kiosk tablet downloads them for
-- offline embedding computation) — bucket is public, this mirrors the
-- default public-bucket read policy.
DROP POLICY IF EXISTS "Public can read student photos" ON storage.objects;
CREATE POLICY "Public can read student photos"
    ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'student-photos');

-- Sanity check (should return 4 rows):
-- SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';