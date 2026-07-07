// HTTP entry point — load one owned trip.

import { tripController } from "@/server/modules/trip/trip.controller";
import { withRequestContext } from "@/server/shared/logger";

export const runtime = "nodejs";
// Per-user data — never cache.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withRequestContext(() => tripController.get(id));
}
