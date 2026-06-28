// Server-side Supabase client. Uses the service_role key, so this module must
// only ever be imported from server code (controllers, services, db-services)
// — never from a "use client" component.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment.",
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
