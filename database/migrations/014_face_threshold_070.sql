-- 014: Raise the default face-match threshold 0.65 → 0.70.
--
-- Field report: strangers were still matching enrolled students on single
-- motion-blurred frames. The kiosk now requires 5 consecutive matching reads
-- (~2.5s of holding still) plus a 0.08 margin over the runner-up profile, and
-- the per-read gate tightens to match. Only UNKNOWN faces result — never a
-- wrong name.
--
-- Only touches the default row: if an operator deliberately tuned the value,
-- leave their setting alone.
UPDATE system_settings
SET value = '0.7',
    description = 'Minimum cosine similarity for face match (0-1)'
WHERE key = 'face_recognition_threshold'
  AND value IN ('0.6', '0.65');
