-- ============================================================
-- 017: AI briefing cache (chat assistant + daily summary)
-- One row per date. The dashboard reads the cached text (zero API
-- calls per page view); regeneration is one call per day on demand.
-- Safe to run more than once. Run in Supabase SQL Editor.
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_briefings (
  briefing_date DATE PRIMARY KEY,
  content TEXT NOT NULL,
  stats JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allow the dashboard anon/service clients to read + write briefings
-- (same open pattern the kiosk uses for heartbeats/logs).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'briefings_read_all'
  ) THEN
    CREATE POLICY briefings_read_all ON daily_briefings FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'briefings_write_all'
  ) THEN
    CREATE POLICY briefings_write_all ON daily_briefings FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'briefings_update_all'
  ) THEN
    CREATE POLICY briefings_update_all ON daily_briefings FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
END $$;

ALTER TABLE daily_briefings ENABLE ROW LEVEL SECURITY;
