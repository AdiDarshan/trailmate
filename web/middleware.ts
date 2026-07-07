// Auth gate + session refresh. Login is required upfront: unauthenticated
// requests are redirected to /login (pages) or 401'd (API), except the public
// machine endpoints (Telegram webhook, cron) and the auth pages themselves.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PUBLIC_PREFIXES = ["/login", "/auth", "/api/telegram", "/api/cron"];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(toSet) {
          toSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: req });
          toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        },
      },
    },
  );

  // An auth-infrastructure failure must not 500 every route — treat it as
  // signed-out (the user lands on /login and can retry).
  let user = null;
  try {
    ({
      data: { user },
    } = await supabase.auth.getUser());
  } catch (e) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(), level: "error", module: "middleware",
        event: "auth_check_failed", error: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  const path = req.nextUrl.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    if (path.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // Run on everything except Next static assets + favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
