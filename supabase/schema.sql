-- ============================================================
-- Smart School Gate System - Supabase Database Schema
-- ============================================================
-- Run this in the Supabase SQL Editor to set up all tables.
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. Students Table
-- ============================================================
CREATE TABLE IF NOT EXISTS students (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    student_id TEXT UNIQUE,                          -- School student ID (e.g., "2024-001")
    person_type TEXT NOT NULL DEFAULT 'student',     -- 'student' or 'faculty'
    face_embedding BYTEA,                            -- Face embedding stored as binary blob
    fingerprint_id TEXT,                              -- R307 fingerprint template ID
    uniform_type TEXT NOT NULL DEFAULT 'default',     -- Uniform type (e.g., "blue_vest", "red_badge")
    photo_url TEXT,                                   -- URL to photo in Supabase Storage
    department TEXT,                                  -- Student department (e.g., BSIT, CHM, COED)
    grade TEXT,                                       -- Grade/Year level
    section TEXT,                                     -- Section/Class
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE students ADD COLUMN IF NOT EXISTS person_type TEXT NOT NULL DEFAULT 'student';
ALTER TABLE students ADD COLUMN IF NOT EXISTS department TEXT;

CREATE INDEX idx_students_updated_at ON students(updated_at);
CREATE INDEX idx_students_student_id ON students(student_id);
CREATE INDEX idx_students_is_active ON students(is_active);

-- ============================================================
-- 2. Guest Cards Table (RFID)
-- ============================================================
CREATE TABLE IF NOT EXISTS guest_cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    card_uid TEXT NOT NULL UNIQUE,                    -- RFID card UID
    holder_name TEXT NOT NULL,                        -- Name of the card holder
    purpose TEXT,                                     -- Purpose of visit
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ,                          -- NULL = no expiry
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guest_cards_card_uid ON guest_cards(card_uid);
CREATE INDEX idx_guest_cards_updated_at ON guest_cards(updated_at);
CREATE INDEX idx_guest_cards_is_active ON guest_cards(is_active);

-- ============================================================
-- 3. Guest Visits Table (QR visitor workflow)
-- ============================================================
CREATE TABLE IF NOT EXISTS guest_visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visitor_name TEXT,
    purpose TEXT,
    host_person_id UUID,
    host_name TEXT,
    department TEXT,
    contact_number TEXT,
    photo_url TEXT,
    qr_token_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending_approval',
    checked_in_at TIMESTAMPTZ,
    checked_out_at TIMESTAMPTZ,
    entry_gate_id TEXT DEFAULT 'GATE-01',
    exit_gate_id TEXT,
    guard_in_id TEXT,
    guard_in_name TEXT,
    guard_out_id TEXT,
    guard_out_name TEXT,
    remarks TEXT,
    valid_from TIMESTAMPTZ DEFAULT NOW(),
    valid_until TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_visits_qr_token_hash ON guest_visits(qr_token_hash);
CREATE INDEX IF NOT EXISTS idx_guest_visits_updated_at ON guest_visits(updated_at);
CREATE INDEX IF NOT EXISTS idx_guest_visits_status ON guest_visits(status);
CREATE INDEX IF NOT EXISTS idx_guest_visits_is_active ON guest_visits(is_active);

-- ============================================================
-- 4. Access Logs Table
-- ============================================================
CREATE TABLE IF NOT EXISTS access_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    person_id UUID,                                   -- FK to students (NULL for unknown/guests)
    person_name TEXT,                                  -- Denormalized for quick display
    person_type TEXT,                                  -- 'student', 'faculty', 'staff', 'guest', 'manual'
    guest_visit_id UUID,                               -- FK to guest_visits for QR guest events
    direction TEXT NOT NULL DEFAULT 'entry',           -- 'entry' or 'exit'
    method TEXT NOT NULL,                              -- 'face', 'fingerprint', 'rfid', 'qr', 'manual'
    success BOOLEAN NOT NULL DEFAULT FALSE,
    confidence REAL,                                   -- Match confidence score (0-1)
    uniform_ok BOOLEAN,                               -- Whether uniform check passed
    photo_url TEXT,                                    -- Snapshot URL (optional)
    gate_id TEXT DEFAULT 'GATE-01',                    -- Gate identifier
    failure_reason TEXT,                               -- Reason if access denied
    override_operator_id TEXT,                         -- Guard/admin ID for manual overrides
    override_operator_name TEXT,                       -- Guard/admin name for manual overrides
    override_reason TEXT,                              -- Manual override reason
    override_source TEXT,                              -- dashboard/kiosk/hardware_button/brain_api
    device_timestamp TIMESTAMPTZ NOT NULL,             -- Timestamp from the Pi
    synced_at TIMESTAMPTZ DEFAULT NOW(),               -- When this log was synced to cloud
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_access_logs_person_id ON access_logs(person_id);
CREATE INDEX idx_access_logs_device_timestamp ON access_logs(device_timestamp DESC);
CREATE INDEX idx_access_logs_success ON access_logs(success);
CREATE INDEX idx_access_logs_method ON access_logs(method);
CREATE INDEX IF NOT EXISTS idx_access_logs_direction ON access_logs(direction);
CREATE INDEX IF NOT EXISTS idx_access_logs_person_type ON access_logs(person_type);
CREATE INDEX IF NOT EXISTS idx_access_logs_guest_visit_id ON access_logs(guest_visit_id);

ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS person_type TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS guest_visit_id UUID;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'entry';
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_operator_id TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_operator_name TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_reason TEXT;
ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS override_source TEXT;

-- ============================================================
-- 5. Audit Logs Table
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
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- ============================================================
-- 6. System Settings Table
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default settings
INSERT INTO system_settings (key, value, description) VALUES
    ('school_name', 'Smart Academy', 'School name displayed in welcome messages'),
    ('face_recognition_threshold', '0.6', 'Minimum cosine similarity for face match (0-1)'),
    ('uniform_detection_enabled', 'true', 'Whether to enforce uniform detection'),
    ('uniform_ref_default', '', 'URL for the Default (Type A) uniform reference image'),
    ('uniform_ref_pe', '', 'URL for the P.E. (Type B) uniform reference image'),
    ('uniform_color_lower', '100,50,50', 'HSV lower bound for uniform color detection (H,S,V)'),
    ('uniform_color_upper', '130,255,255', 'HSV upper bound for uniform color detection (H,S,V)'),
    ('uniform_min_area_ratio', '0.15', 'Minimum ratio of uniform color area to body area'),
    ('fingerprint_requires_uniform', 'false', 'Whether fingerprint fallback requires uniform check'),
    ('sync_interval_minutes', '60', 'How often Pi syncs with cloud (minutes)'),
    ('sync_required', 'false', 'Flag set by admin to trigger immediate sync'),
    ('department_uniform_policies', '[]', 'JSON list mapping departments to prescribed uniform types'),
    ('gate_open_duration', '5', 'How long gate stays open (seconds)'),
    ('yolo_model_path', 'yolov8n.pt', 'Path to YOLO model for uniform detection')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 5. Auto-update updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_guest_cards_updated_at
    BEFORE UPDATE ON guest_cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_guest_visits_updated_at ON guest_visits;
CREATE TRIGGER update_guest_visits_updated_at
    BEFORE UPDATE ON guest_visits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 7. Row Level Security (RLS) Policies
-- ============================================================
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (admin dashboard)
CREATE POLICY "Authenticated users can manage students"
    ON students FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage guest_cards"
    ON guest_cards FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage access_logs"
    ON access_logs FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage guest_visits"
    ON guest_visits FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage audit_logs"
    ON audit_logs FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage system_settings"
    ON system_settings FOR ALL
    USING (auth.role() = 'authenticated')
    WITH CHECK (auth.role() = 'authenticated');

-- Allow service role (API routes) full access
CREATE POLICY "Service role can manage students"
    ON students FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage guest_cards"
    ON guest_cards FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage access_logs"
    ON access_logs FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage guest_visits"
    ON guest_visits FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage audit_logs"
    ON audit_logs FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role can manage system_settings"
    ON system_settings FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================
-- 7. Storage Bucket for Student Photos
-- ============================================================
-- Run this in the Supabase Dashboard > Storage or via the API:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('student-photos', 'student-photos', true);
