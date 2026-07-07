// HTTP entry points — list the user's trips (GET) and save one (POST).

import { tripController } from "@/server/modules/trip/trip.controller";
import { withRequestContext } from "@/server/shared/logger";

export const runtime = "nodejs";
// Per-user data — never cache at the edge or in the router.
export const dynamic = "force-dynamic";

export function GET() {
  return withRequestContext(() => tripController.list());
}

export function POST(req: Request) {
  return withRequestContext(() => tripController.create(req));
}
