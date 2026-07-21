import { createClient } from "@supabase/supabase-js";

/**
 * Supabase client for browser-side operations (uses anon key).
 * Used in components for auth, realtime, and public data access.
 */
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
