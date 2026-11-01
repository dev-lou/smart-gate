-- ============================================================
-- 011: Dedicated guests table (replaces 010's columns on students)
-- ============================================================
-- The guard station enrolls VISITORS, not students. Guests live in
-- their own table so the students table stays purely academic.
-- Requires 010 to have been applied OR not — both are handled.
-- Run this in the Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS guests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    purpose TEXT,
    contact TEXT,
    photo_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guests_updated_at ON guests(updated_at);
CREATE INDEX IF NOT EXISTS idx_guests_is_active ON guests(is_active);

-- Keep updated_at fresh (reuses the function from schema.sql)
DROP TRIGGER IF EXISTS update_guests_updated_at ON guests;
CREATE TRIGGER update_guests_updated_at
    BEFORE UPDATE ON guests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (mirrors the students table)
ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage guests" ON guests;
CREATE POLICY "Authenticated users can manage guests"
    ON guests FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Anon can read active guests" ON guests;
CREATE POLICY "Anon can read active guests"
    ON guests FOR SELECT USING (is_active = true);

-- 010 is superseded: guests no longer live on students
ALTER TABLE students DROP COLUMN IF EXISTS purpose;
ALTER TABLE students DROP COLUMN IF EXISTS contact;
