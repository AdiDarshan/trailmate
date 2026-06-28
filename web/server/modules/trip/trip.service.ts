// Trip business logic: save (insert/update) an owned itinerary, load it back,
// and list a user's trips.

import { nanoid } from "nanoid";
import { tripDbService } from "./trip.dbservice";
import type { Itinerary, TripSummary } from "../../shared/types";

class TripService {
  /**
   * Persist an itinerary for a user. If `id` is given (editing an existing
   * trip) it updates in place; otherwise it creates a new trip. Returns the id.
   */
  async save(itinerary: Itinerary, userId: string, id?: string): Promise<{ trip_id: string }> {
    const tripId = id ?? nanoid(10);
    const startDate =
      typeof itinerary.start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(itinerary.start_date)
        ? itinerary.start_date
        : null;
    await tripDbService.upsert({
      id: tripId,
      user_id: userId,
      title: itinerary.title || "Your Trip",
      dates: itinerary.dates ?? null,
      start_date: startDate,
      data: { ...itinerary, id: tripId },
    });
    return { trip_id: tripId };
  }

  /** Load a saved itinerary the user owns. */
  async load(id: string, userId: string): Promise<Itinerary | null> {
    return tripDbService.getByIdForUser(id, userId);
  }

  /** The user's saved trips for the sidebar. */
  async list(userId: string): Promise<TripSummary[]> {
    return tripDbService.listByUser(userId);
  }
}

export const tripService = new TripService();
