-- ============================================================
-- 010: Guest enrollment (guard app)
-- ============================================================
-- The guard station enrolls VISITORS, not students: personal details
-- + face photos only, no course/uniform. person_type = 'guest'.
-- ============================================================

ALTER TABLE students ADD COLUMN IF NOT EXISTS purpose TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS contact TEXT;
