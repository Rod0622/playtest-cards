import { createClient } from "@supabase/supabase-js";

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Server-side Supabase client using the Service Role key.
 *
 * IMPORTANT:
 * - Only use this in Route Handlers (/app/api/...) or server-only modules.
 * - NEVER expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
export function createServiceSupabase() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: {
      // Helps some hosting providers.
      headers: { "X-Client-Info": "playtest-forge/scraper" },
    },
  });
}

/**
 * Server-side Supabase client using the public anon key (read-only with RLS).
 */
export function createAnonSupabase() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}
