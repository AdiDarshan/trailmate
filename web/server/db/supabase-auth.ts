// Cookie-based Supabase client for the server — reads the signed-in user's
// session from request cookies. Used by route handlers/controllers to know
// *who* is calling. Distinct from db/supabase.ts (service-role, system access).

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createLogger, errInfo } from "../shared/logger";

const log = createLogger("db.supabase-auth");

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

/** The authenticated user, or null. Verifies the JWT with Supabase.
 *
 * Auth-infrastructure failures (Supabase unreachable, cookie store errors)
 * are logged and treated as "not signed in" — callers answer 401 and the
 * user can retry, instead of a 500 with internal detail. */
export async function getAuthUser() {
  try {
    const supabase = await createAuthClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      // Expired/absent sessions land here routinely; only unusual failures
      // deserve log noise.
      if (error.status !== 400 && error.status !== 401 && error.status !== 403) {
        log.warn("get_user_failed", { status: error.status, ...errInfo(error) });
      }
      return null;
    }
    return data.user;
  } catch (e) {
    log.error("auth_client_failed", errInfo(e));
    return null;
  }
}
