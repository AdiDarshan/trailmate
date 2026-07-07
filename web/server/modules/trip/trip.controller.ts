// Trip controller — HTTP adapter. Resolves the signed-in user and delegates to
// TripService. Every operation is scoped to that user. Internal errors are
// logged with context; clients only receive user-safe messages.

import { tripService } from "./trip.service";
import { chatDbService } from "../chat/chat.dbservice";
import { getAuthUser } from "../../db/supabase-auth";
import { toPublicMessage } from "../../shared/errors";
import { createLogger, errInfo } from "../../shared/logger";
import type { Itinerary } from "../../shared/types";

const log = createLogger("trip.controller");

class TripController {
  /** GET /api/trips — the user's saved trips. */
  async list(): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const trips = await tripService.list(user.id);
      return Response.json({ trips });
    } catch (e) {
      log.error("list_trips_failed", { userId: user.id, ...errInfo(e) });
      return Response.json({ error: toPublicMessage(e) }, { status: 500 });
    }
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

    let tripId: string;
    try {
      ({ trip_id: tripId } = await tripService.save(body.itinerary, user.id, body.id));
    } catch (e) {
      log.error("save_trip_failed", { userId: user.id, tripId: body.id, ...errInfo(e) });
      return Response.json({ error: toPublicMessage(e) }, { status: 500 });
    }

    // Attach the conversation that produced this trip, so opening the trip
    // later brings its chat back (RLS rejects sessions the user doesn't own).
    // Best-effort: the trip IS saved at this point — a linking failure must
    // not turn a successful save into a 500 (the client would retry and
    // duplicate the trip).
    if (typeof body.sessionId === "string" && body.sessionId) {
      try {
        const session = await chatDbService.getSession(body.sessionId, user.id);
        if (session) await chatDbService.linkTrip(session.id, tripId);
      } catch (e) {
        log.error("link_session_failed", { tripId, sessionId: body.sessionId, ...errInfo(e) });
      }
    }
    return Response.json({ trip_id: tripId });
  }

  /** GET /api/trip/[id] — load one owned trip. */
  async get(id: string): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const itinerary = await tripService.load(id, user.id);
      if (!itinerary) return Response.json({ error: "Trip not found" }, { status: 404 });
      return Response.json(itinerary);
    } catch (e) {
      log.error("get_trip_failed", { userId: user.id, tripId: id, ...errInfo(e) });
      return Response.json({ error: toPublicMessage(e) }, { status: 500 });
    }
  }
}

export const tripController = new TripController();
