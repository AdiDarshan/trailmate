// HTTP entry points — list the user's trips (GET) and save one (POST).

import { tripController } from "@/server/modules/trip/trip.controller";

export const runtime = "nodejs";
// Per-user data — never cache at the edge or in the router.
export const dynamic = "force-dynamic";

export function GET() {
  return tripController.list();
}

export function POST(req: Request) {
  return tripController.create(req);
}
