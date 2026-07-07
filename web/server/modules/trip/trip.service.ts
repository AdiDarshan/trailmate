// Trip business logic: save (insert/update) an owned itinerary, load it back,
// and list a user's trips.

import { nanoid } from "nanoid";
import { tripDbService } from "./trip.dbservice";
import { telegramDbService } from "../telegram/telegram.dbservice";
import { telegramService } from "../telegram/telegram.service";
import { createLogger, errInfo } from "../../shared/logger";
import type { Itinerary, SavedTrailRefs, TripSummary } from "../../shared/types";

const TRIP_ID_LENGTH = 10;
const START_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const log = createLogger("trip.service");

class TripService {
  /**
   * Persist an itinerary for a user. If `id` is given (editing an existing
   * trip) it updates in place; otherwise it creates a new trip. Returns the id.
   */
  async save(itinerary: Itinerary, userId: string, id?: string): Promise<{ trip_id: string }> {
    const tripId = id ?? nanoid(TRIP_ID_LENGTH);
    const startDate =
      typeof itinerary.start_date === "string" && START_DATE_RE.test(itinerary.start_date)
        ? itinerary.start_date
        : null;
    log.info("save_trip", { tripId, userId, isUpdate: !!id, days: itinerary.days?.length ?? 0 });
    await tripDbService.upsert({
      id: tripId,
      user_id: userId,
      title: itinerary.title || "Your Trip",
      dates: itinerary.dates ?? null,
      start_date: startDate,
      data: { ...itinerary, id: tripId },
    });

    // Fire-and-forget Telegram confirmation if the user linked their account.
    // Never let a notification failure break the save.
    try {
      const chatId = await telegramDbService.getChatId(userId);
      if (chatId) {
        const when = itinerary.dates ? ` (${itinerary.dates})` : "";
        await telegramService.sendMessage(
          chatId,
          `✅ Saved *${itinerary.title || "your trip"}*${when} to your trips. ` +
            "I'll remind you the day before each day.",
        );
      }
    } catch (e) {
      log.warn("save_confirmation_failed", { tripId, userId, ...errInfo(e) });
    }

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

  /** Trails across all the user's saved trips — the agent's "don't recommend again" list. */
  async savedTrailRefs(userId: string): Promise<SavedTrailRefs> {
    return extractSavedTrailRefs(await tripDbService.listItinerariesByUser(userId));
  }
}

/**
 * Collect unique trail names and tiuli URLs from saved itineraries. Names are
 * deduped case/whitespace-insensitively but returned as saved (they surface in
 * the system prompt); URLs are the stable match key where present.
 */
export function extractSavedTrailRefs(itineraries: Itinerary[]): SavedTrailRefs {
  const names = new Map<string, string>();
  const urls = new Set<string>();
  for (const it of itineraries) {
    for (const day of it?.days ?? []) {
      const trail = day?.trail;
      if (!trail) continue;
      const name = trail.name?.trim();
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
      if (trail.tiuli_url) urls.add(trail.tiuli_url);
    }
  }
  return { names: [...names.values()], urls: [...urls] };
}

export const tripService = new TripService();
