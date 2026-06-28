// Trip business logic: assemble + persist an itinerary, and load it back.

import { nanoid } from "nanoid";
import { tripDbService } from "./trip.dbservice";
import type { Itinerary } from "../../shared/types";

class TripService {
  /** Persist a planned itinerary; returns the shareable trip id. */
  async save(args: Record<string, any>): Promise<{ trip_id: string }> {
    const itinerary: Itinerary = {
      title: String(args.title ?? "Your Trip"),
      dates: args.dates ? String(args.dates) : undefined,
      days: Array.isArray(args.days) ? args.days : [],
    };
    const id = nanoid(10);
    await tripDbService.insert({
      id,
      title: itinerary.title,
      dates: itinerary.dates ?? null,
      data: itinerary,
    });
    return { trip_id: id };
  }

  /** Load a saved itinerary for the notebook. */
  async load(id: string): Promise<Itinerary | null> {
    return tripDbService.getById(id);
  }
}

export const tripService = new TripService();
