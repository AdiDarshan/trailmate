// OAuth callback — exchanges the auth code for a session cookie, then sends the
// user back to the app.

import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/db/supabase-auth";
import { createLogger, errInfo } from "@/server/shared/logger";

export const runtime = "nodejs";

const log = createLogger("auth.callback");

export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  if (code) {
    // A failed exchange leaves the user signed out; the middleware then
    // bounces them to /login where they can retry. Log the WHY — a silent
    // failure here looks like "login randomly doesn't work".
    try {
      const supabase = await createAuthClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) log.error("code_exchange_rejected", { error: error.message });
    } catch (e) {
      log.error("code_exchange_failed", errInfo(e));
    }
  } else {
    log.warn("callback_without_code", {});
  }
  return NextResponse.redirect(origin);
}
