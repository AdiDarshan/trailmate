"use client";

// Browser Supabase client (anon key). Safe to ship to the browser — it only
// grants what Row-Level Security allows. Used for sign-in / sign-out.

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
