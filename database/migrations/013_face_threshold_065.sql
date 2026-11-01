-- 013: Raise the default face-match threshold 0.6 → 0.65.
--
-- The kiosk now also requires 3 consecutive matching reads plus a margin over
-- the runner-up profile before granting, so single-frame glitches can no
-- longer greet a stranger with the wrong student's name. The threshold bump
-- tightens the per-read gate to match.
--
-- Only touches the default row: if an operator deliberately tuned the value,
-- leave their setting alone.
UPDATE system_settings
SET value = '0.65',
    description = 'Minimum cosine similarity for face match (0-1)'
WHERE key = 'face_recognition_threshold'
  AND value = '0.6';
