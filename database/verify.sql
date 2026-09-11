-- ============================================================
-- verify.sql — "is every migration applied?" in ONE paste
-- ============================================================
-- Supabase Dashboard → SQL Editor → paste this whole file → Run.
--
-- Read-only: it only SELECTs from catalogs (information_schema,
-- pg_index, pg_policies, storage.buckets). Nothing is written.
--
-- You get one table with a PASS/FAIL row per migration, so you can
-- see at a glance which migration is missing. The last row is the
-- overall verdict.
--
-- WHY THIS EXISTS: `pnpm preflight` proves everything reachable with
-- the anon key (columns, seed data, RLS-visible rows). Three things
-- are invisible to the anon key and can ONLY be checked here:
--   * the UNIQUE index on access_logs(sync_id)  (migration 006)
--     without it the kiosk's `on_conflict=sync_id` upsert fails
--     with 42P10 "no unique or exclusion constraint matching"
--   * the RLS policies on students / access_logs / system_settings
--   * the Storage policies on storage.objects (migration 008)
--
-- Expected result on a healthy demo database: every row PASS,
-- verdict "ALL CHECKS PASS".
-- ============================================================

WITH checks (check_no, migration, check_name, status, detail) AS (

    -- ─── Base schema (database/schema.sql) ──────────────────
    SELECT 1, 'schema', 'Core tables exist (students, access_logs, audit_logs, system_settings)',
        CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/4 tables'
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('students', 'access_logs', 'audit_logs', 'system_settings')

    UNION ALL
    SELECT 2, 'schema', 'students has all 11 columns the apps read/write',
        CASE WHEN count(*) = 11 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/11 columns'
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students'
      AND column_name IN ('id', 'name', 'student_id', 'department', 'grade', 'section',
                          'uniform_type', 'photo_url', 'person_type', 'is_active', 'updated_at')

    UNION ALL
    SELECT 3, 'schema', 'access_logs has its base columns',
        CASE WHEN count(*) = 7 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/7 columns'
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_logs'
      AND column_name IN ('person_name', 'method', 'success', 'confidence',
                          'uniform_ok', 'device_timestamp', 'created_at')

    UNION ALL
    SELECT 4, 'schema', 'Base settings seeded',
        CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/5 keys'
    FROM system_settings
    WHERE key IN ('school_name', 'face_recognition_threshold', 'uniform_detection_enabled',
                  'gate_open_duration', 'sync_interval_minutes')

    -- ─── 003 — log idempotency ──────────────────────────────
    UNION ALL
    SELECT 5, '003', 'access_logs.sync_id column',
        CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
        CASE WHEN count(*) = 1 THEN 'present' ELSE 'MISSING — run 003_add_sync_id.sql' END
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_logs' AND column_name = 'sync_id'

    UNION ALL
    SELECT 6, '003', 'Index on access_logs(sync_id)',
        CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
        coalesce(string_agg(indexname, ', '), 'MISSING')
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'access_logs' AND indexname = 'idx_access_logs_sync_id'

    -- ─── 005 — uniform classes aligned to the trained model ──
    UNION ALL
    SELECT 7, '005', 'uniform_types + course_uniforms tables exist',
        CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/2 tables'
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('uniform_types', 'course_uniforms')

    UNION ALL
    SELECT 8, '005', 'uniform_types = the trained 9-class model (exact names at class_id 0..8)',
        CASE WHEN count(*) = 9 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/9 correct (class_id, name) pairs'
    FROM uniform_types
    WHERE (class_id, name) IN (
        (0, 'cbmsd_chef_male_uniform'),
        (1, 'cbmsd_universal_male_uniform'),
        (2, 'cici_blazer_uniform'),
        (3, 'cici_female_uniform'),
        (4, 'cici_male_uniform'),
        (5, 'coag_female_uniform'),
        (6, 'coag_male_uniform'),
        (7, 'education_female_uniform'),
        (8, 'education_male_uniform')
    )

    UNION ALL
    SELECT 9, '005', 'course_uniforms maps the 4 course families',
        CASE WHEN count(DISTINCT course) >= 4 THEN 'PASS' ELSE 'FAIL' END,
        count(DISTINCT course)::text || ' courses: ' || coalesce(string_agg(DISTINCT course, ', '), 'none')
    FROM course_uniforms

    UNION ALL
    SELECT 10, '005', 'system_settings.uniform_class_names matches the model',
        CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
        coalesce(max(left(value, 70)), 'MISSING — run 005_align_uniforms_to_model.sql')
    FROM system_settings
    WHERE key = 'uniform_class_names'
      AND value LIKE '%cbmsd_chef_male_uniform%'
      AND value LIKE '%cici_blazer_uniform%'
      AND value LIKE '%coag_male_uniform%'
      AND value LIKE '%education_male_uniform%'

    UNION ALL
    SELECT 11, '005/006', 'access_logs compatibility columns (person_type, direction, override_*)',
        CASE WHEN count(*) = 5 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/5 columns'
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_logs'
      AND column_name IN ('person_type', 'direction', 'override_operator_id',
                          'override_operator_name', 'override_reason')

    -- ─── 006 — idempotent sync + security ───────────────────
    UNION ALL
    SELECT 12, '006', 'UNIQUE index on access_logs(sync_id) — kiosk upsert REQUIRES it',
        CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
        CASE WHEN count(*) = 1
             THEN 'present (unique, non-partial)'
             ELSE 'MISSING — run 006_compatibility_security.sql (kiosk log sync fails with 42P10 without it)'
        END
    FROM pg_index i
    JOIN pg_class t  ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class ic ON ic.oid = i.indexrelid
    WHERE n.nspname = 'public' AND t.relname = 'access_logs'
      AND ic.relname = 'idx_access_logs_sync_id_unique'
      AND i.indisunique AND i.indpred IS NULL

    UNION ALL
    SELECT 13, '006', 'RLS enabled on access_logs / students / system_settings',
        CASE WHEN count(*) = 3 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/3 tables with row security'
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('access_logs', 'students', 'system_settings')
      AND c.relrowsecurity

    UNION ALL
    SELECT 14, '006', 'RLS policies for kiosk (anon) + Guard/Dashboard (authenticated)',
        CASE WHEN count(*) = 6 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/6 policies' ||
            CASE WHEN count(*) < 6 THEN ' — re-run 006_compatibility_security.sql' ELSE '' END
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('access_logs', 'students', 'system_settings')
      AND policyname IN (
          'Anon can insert access_logs',
          'Authenticated users can manage access_logs',
          'Anon can read active students',
          'Authenticated users can manage students',
          'Anon can read settings',
          'Authenticated users can manage system_settings'
      )

    -- ─── 007 — gate feedback + kiosk health ─────────────────
    UNION ALL
    SELECT 15, '007', 'access_logs.gate_state column + its index',
        CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/1 index (idx_access_logs_gate_state)'
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'access_logs' AND indexname = 'idx_access_logs_gate_state'

    UNION ALL
    SELECT 16, '007', 'access_logs.gate_state column exists',
        CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
        CASE WHEN count(*) = 1 THEN 'present' ELSE 'MISSING — run 007_gate_health.sql' END
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'access_logs' AND column_name = 'gate_state'

    UNION ALL
    SELECT 17, '007', 'kiosk_heartbeats has all 11 columns',
        CASE WHEN count(*) = 11 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/11 columns'
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kiosk_heartbeats'
      AND column_name IN ('kiosk_id', 'kiosk_name', 'camera_ok', 'gate_connected', 'gate_state',
                          'students_count', 'unsynced_logs', 'last_sync', 'fps', 'last_error', 'updated_at')

    UNION ALL
    SELECT 18, '007', 'kiosk_heartbeats RLS + 2 policies',
        CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/2 policies'
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'kiosk_heartbeats'
      AND policyname IN ('Kiosk can upsert heartbeats', 'Authenticated users can read heartbeats')

    -- ─── 008 — Guard photo upload storage policies ───────────
    UNION ALL
    SELECT 19, '006/008', 'student-photos bucket exists and is public',
        CASE WHEN count(*) = 1 AND bool_or(b."public") THEN 'PASS' ELSE 'FAIL' END,
        CASE WHEN count(*) = 0 THEN 'no student-photos bucket'
             WHEN bool_or(b."public") THEN 'public (kiosk can download photos anonymously)'
             ELSE 'exists but PRIVATE — kiosk photo downloads will fail'
        END
    FROM storage.buckets b
    WHERE b.id = 'student-photos'

    UNION ALL
    SELECT 20, '008', 'Storage policies on storage.objects (upload/update/delete/public read)',
        CASE WHEN count(*) = 4 THEN 'PASS' ELSE 'FAIL' END,
        count(*)::text || '/4 policies' ||
            CASE WHEN count(*) < 4 THEN ' — run 008_guard_storage_policies.sql (Guard enrollment photo upload fails without these)' ELSE '' END
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN (
          'Authenticated users can upload student photos',
          'Authenticated users can update student photos',
          'Authenticated users can delete student photos',
          'Public can read student photos'
      )

    -- ─── 009 — school branding + voice ──────────────────────
    UNION ALL
    SELECT 21, '009', 'school_initials setting (logo badge)',
        CASE WHEN count(*) = 1 AND max(value) <> '' THEN 'PASS' ELSE 'FAIL' END,
        coalesce(max(value), 'MISSING — run 009_school_branding.sql')
    FROM system_settings WHERE key = 'school_initials'

    UNION ALL
    SELECT 22, '009', 'voice_enabled setting (kiosk announcements)',
        CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
        coalesce(max(value), 'MISSING — run 009_school_branding.sql')
    FROM system_settings WHERE key = 'voice_enabled'
)

SELECT check_no, migration, check_name, status, detail
FROM checks

UNION ALL

SELECT 99, 'SUMMARY', 'Overall verdict',
    CASE WHEN count(*) FILTER (WHERE status = 'FAIL') = 0 THEN 'PASS' ELSE 'FAIL' END,
    count(*)::text || ' checks, ' || count(*) FILTER (WHERE status = 'FAIL')::text || ' failing' ||
        CASE WHEN count(*) FILTER (WHERE status = 'FAIL') = 0
             THEN ' — every migration is applied, demo database is complete'
             ELSE ' — see the FAIL rows above'
        END
FROM checks

ORDER BY check_no;
