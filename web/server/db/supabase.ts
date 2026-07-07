// Server-side Supabase client. Uses the service_role key, so this module must
// only ever be imported from server code (controllers, services, db-services)
// — never from a "use client" component.
//
// The client is initialized lazily on first use (not at import): importing a
// module that happens to reach this file must not require env vars — that made
// every service untestable. The runtime guarantee is unchanged: any actual DB
// access without credentials still fails fast, now with a typed error.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../shared/errors";

let client: SupabaseClient | null = null;

function init(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new AppError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.", {
      publicMessage: "Server is misconfigured. Please try again later.",
    });
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

// Same `supabase.from(...)` surface as before; initialization is deferred to
// the first property access.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    const c = init();
    const value = (c as any)[prop];
    return typeof value === "function" ? value.bind(c) : value;
  },
});
