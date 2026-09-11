-- ============================================================
-- 009 — School Branding + Voice Settings
-- Run from Supabase → SQL Editor (idempotent, safe to run twice)
-- ============================================================

-- New keys: initials badge + kiosk voice toggle
INSERT INTO system_settings (key, value, description) VALUES
    ('school_initials', 'ISUFST', 'Short initials shown in the logo badge across all apps'),
    ('voice_enabled', 'true', 'Voice announcements at the kiosk (welcome chime + speech)')
ON CONFLICT (key) DO NOTHING;

-- Replace the placeholder school name with the real institution
-- (only if it was never changed from the old placeholder)
UPDATE system_settings
SET value = 'Iloilo State University of Fisheries Science and Technology'
WHERE key = 'school_name' AND value = 'Smart Academy';

-- Keep descriptions accurate
UPDATE system_settings
SET description = 'Institution branding shown in navbars & titles across all apps (dashboard, guard, kiosk)'
WHERE key = 'school_name';