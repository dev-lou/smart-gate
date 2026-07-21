import { createClient } from "@supabase/supabase-js";

/**
 * Supabase admin client for server-side operations (uses service role key).
 * Only import this in API routes and server components — never in client code.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
