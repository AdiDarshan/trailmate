// HTTP entry points — read (GET) and replace (PUT) the user's standing preferences.

import { prefsController } from "@/server/modules/prefs/prefs.controller";
import { withRequestContext } from "@/server/shared/logger";

export const runtime = "nodejs";
// Per-user data — never cache at the edge or in the router.
export const dynamic = "force-dynamic";

export function GET() {
  return withRequestContext(() => prefsController.get());
}

export function PUT(req: Request) {
  return withRequestContext(() => prefsController.put(req));
}
