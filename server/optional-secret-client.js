import { createClient } from "@supabase/supabase-js";

// Server-only. Returns null unless both variables are set, so callers keep
// today's behavior. The publishable editorial client in server/supabase.js
// is separate and must not receive this key.
export function secretClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(3000) }),
    },
  });
}
