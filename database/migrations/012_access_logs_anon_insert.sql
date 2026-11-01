-- ============================================================
-- 012: Ensure kiosk tablets can sync access logs (anon insert)
-- ============================================================
-- The kiosk uses the public anon key when it uploads queued access
-- logs. Without this policy every sync fails with:
--   42501: new row violates row-level security policy
-- and the admin Access Logs page stays empty forever.
-- Run this in the Supabase SQL Editor.
-- ============================================================

DROP POLICY IF EXISTS "Anon can insert access_logs" ON access_logs;
CREATE POLICY "Anon can insert access_logs"
    ON access_logs FOR INSERT TO anon
    WITH CHECK (true);

-- Sanity check (should list the policy):
-- SELECT policyname FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'access_logs';
