// HTTP entry point — load one owned trip.

import { tripController } from "@/server/modules/trip/trip.controller";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return tripController.get(id);
}
