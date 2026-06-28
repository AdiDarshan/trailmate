// Cookie-based Supabase client for the server — reads the signed-in user's
// session from request cookies. Used by route handlers/controllers to know
// *who* is calling. Distinct from db/supabase.ts (service-role, system access).

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          // In a pure route handler this can throw; ignore — session refresh
          // is handled in middleware.
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            /* noop */
          }
        },
      },
    },
  );
}

/** The authenticated user, or null. Verifies the JWT with Supabase. */
export async function getAuthUser() {
  const supabase = await createAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
