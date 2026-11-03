-- 018 — School-ID QR as the second factor
-- =========================================
-- 1. Raise the face threshold back to the value the pipeline was designed for.
--    It was left at 0.6 (Settings allowed values down to 0.3), which is what
--    produced wrong-name reads at the gate.
-- 2. Seed the QR FALLBACK. A recognised face opens the gate on its own; the
--    school-ID QR exists so a student whose face cannot be read still gets in.
--    Guests are unaffected (they have no school ID).
--
-- Reversible from the dashboard: Settings → Face Match Threshold /
-- Require School-ID QR. No data is dropped here.

UPDATE system_settings
SET value = '0.68',
    description = 'Minimum cosine similarity (0-1) the kiosk needs before it accepts a face. The kiosk also requires 5 consecutive reads plus a margin over the next-closest profile. Do not go below 0.65.'
WHERE key = 'face_recognition_threshold';

INSERT INTO system_settings (key, value, description)
VALUES (
  'allow_qr_entry',
  'true',
  'Fallback entry: when a face cannot be recognised, the kiosk opens for the school-ID QR that belongs to that student. A recognised face opens on its own.'
)
ON CONFLICT (key) DO NOTHING;

-- Note: the unused AI briefing table (migration 017) is intentionally left in
-- place. Removing the feature does not require dropping stored rows, and a
-- drop here would be irreversible.
