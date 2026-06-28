// OAuth callback — exchanges the auth code for a session cookie, then sends the
// user back to the app.

import { NextResponse } from "next/server";
import { createAuthClient } from "@/server/db/supabase-auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  if (code) {
    const supabase = await createAuthClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(origin);
}
