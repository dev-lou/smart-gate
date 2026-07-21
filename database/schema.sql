-- ============================================================
-- Smart School Gate System - Supabase Database Schema
-- ============================================================
-- Run this in the Supabase SQL Editor to set up all tables.
-- The kiosk tablet syncs data from these tables.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Students Table
-- ============================================================
-- Stores enrolled students. The tablet downloads active students
-- and generates face embeddings locally from their photos.
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    student_id TEXT UNIQUE,
    person_type TEXT NOT NULL DEFAULT 'student',
    uniform_type TEXT NOT NULL DEFAULT 'default',
    photo_url TEXT,
    department TEXT,
    grade TEXT,
    section TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_students_updated_at ON students(updated_at);
CREATE INDEX IF NOT EXISTS idx_students_student_id ON students(student_id);
CREATE INDEX IF NOT EXISTS idx_students_is_active ON students(is_active);

-- ============================================================
-- 2. Access Logs
-- ============================================================
-- Logs synced from the kiosk tablet. Each entry records an
-- access attempt (face recognition or manual override).
-- ============================================================
CREATE TABLE IF NOT EXISTS access_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    person_id UUID,
    person_name TEXT,
    person_type TEXT,
    direction TEXT NOT NULL DEFAULT 'entry',
    method TEXT NOT NULL,
    success BOOLEAN NOT NULL DEFAULT FALSE,
    confidence REAL,
    uniform_ok BOOLEAN,
    photo_url TEXT,
    gate_id TEXT DEFAULT 'GATE-01',
    failure_reason TEXT,
    override_operator_id TEXT,
    override_operator_name TEXT,
    override_reason TEXT,
    device_timestamp TIMESTAMPTZ NOT NULL,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_access_logs_person_id ON access_logs(person_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_device_timestamp ON access_logs(device_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_success ON access_logs(success);
CREATE INDEX IF NOT EXISTS idx_access_logs_method ON access_logs(method);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at DESC);

-- ============================================================
-- 3. Audit Logs (dashboard/guard accountability)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id TEXT,
    actor_name TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- ============================================================
-- 4. System Settings
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value, description) VALUES
    ('school_name', 'Smart Academy', 'School name displayed in welcome messages'),
    ('face_recognition_threshold', '0.6', 'Minimum cosine similarity for face match (0-1)'),
    ('uniform_detection_enabled', 'true', 'Whether to enforce uniform detection'),
    ('gate_open_duration', '5', 'How long gate stays open (seconds)'),
    ('sync_interval_minutes', '60', 'How often tablet syncs with cloud (minutes)')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. Updated-at Triggers
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_students_updated_at ON students;
CREATE TRIGGER update_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_settings_updated_at ON system_settings;
CREATE TRIGGER update_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 6. Row Level Security
-- ============================================================
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Drop old policies first (safe to run multiple times)
DROP POLICY IF EXISTS "Authenticated users can manage students" ON students;
DROP POLICY IF EXISTS "Authenticated users can manage access_logs" ON access_logs;
DROP POLICY IF EXISTS "Authenticated users can manage system_settings" ON system_settings;
DROP POLICY IF EXISTS "Anon can read active students" ON students;
DROP POLICY IF EXISTS "Anon can insert access_logs" ON access_logs;
DROP POLICY IF EXISTS "Anon can read settings" ON system_settings;

-- Allow authenticated users full access
CREATE POLICY "Authenticated users can manage students"
    ON students FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage access_logs"
    ON access_logs FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage system_settings"
    ON system_settings FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Allow anon key to read students (for kiosk tablet sync)
CREATE POLICY "Anon can read active students"
    ON students FOR SELECT USING (is_active = true);

-- Allow anon key to insert access_logs (for kiosk tablet)
CREATE POLICY "Anon can insert access_logs"
    ON access_logs FOR INSERT WITH CHECK (true);

-- Allow anon key to read settings
CREATE POLICY "Anon can read settings"
    ON system_settings FOR SELECT USING (true);

-- ============================================================
-- 7. Storage Bucket for Student Photos
-- ============================================================
-- Create bucket via the Supabase UI or API:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('student-photos', 'student-photos', true);
