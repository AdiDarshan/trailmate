// Trip controller — HTTP adapter. Resolves the signed-in user and delegates to
// TripService. Every operation is scoped to that user.

import { tripService } from "./trip.service";
import { chatDbService } from "../chat/chat.dbservice";
import { getAuthUser } from "../../db/supabase-auth";
import type { Itinerary } from "../../shared/types";

class TripController {
  /** GET /api/trips — the user's saved trips. */
  async list(): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const trips = await tripService.list(user.id);
    return Response.json({ trips });
  }

  /** POST /api/trips — save (or update) an itinerary. Body: { itinerary, id?, sessionId? }. */
  async create(req: Request): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    let body: { itinerary?: Itinerary; id?: string; sessionId?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.itinerary?.title || !Array.isArray(body.itinerary.days)) {
      return Response.json({ error: "itinerary with title + days is required" }, { status: 400 });
    }
    const { trip_id } = await tripService.save(body.itinerary, user.id, body.id);
    // Attach the conversation that produced this trip, so opening the trip
    // later brings its chat back (RLS rejects sessions the user doesn't own).
    if (typeof body.sessionId === "string" && body.sessionId) {
      const session = await chatDbService.getSession(body.sessionId, user.id);
      if (session) await chatDbService.linkTrip(session.id, trip_id);
    }
    return Response.json({ trip_id });
  }

  /** GET /api/trip/[id] — load one owned trip. */
  async get(id: string): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const itinerary = await tripService.load(id, user.id);
    if (!itinerary) return Response.json({ error: "Trip not found" }, { status: 404 });
    return Response.json(itinerary);
  }
}

export const tripController = new TripController();
