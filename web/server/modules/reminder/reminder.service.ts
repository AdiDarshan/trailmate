// Reminder business logic — the daily-summary rule.
//
// Runs once a day (via cron). For every linked account, it finds the trip day
// whose real date is *tomorrow* in Israel time, generates a short summary with
// the LLM, sends it via Telegram, and records it so it's never re-sent.
//
// Failure isolation: one bad trip (LLM error, Telegram rejection, dedupe
// failure) must never abort the run for every other user — each trip is
// wrapped, failures are logged and counted, and the run reports totals.

import OpenAI from "openai";
import { telegramDbService } from "../telegram/telegram.dbservice";
import { telegramService } from "../telegram/telegram.service";
import { tripDbService } from "../trip/trip.dbservice";
import { createLogger, errInfo } from "../../shared/logger";
import { addDaysISO, dayOnDate, israelToday } from "./reminder.helpers";
import type { Day, Itinerary } from "../../shared/types";

const KIND = "daily_summary";
const SUMMARY_MODEL = "gpt-4o";
const FALLBACK_SUMMARY = "Reminder: your trip day is tomorrow!";

const log = createLogger("reminder.service");

async function summarize(client: OpenAI, trip: Itinerary, day: Day): Promise<string> {
  const prompt =
    "Write a short, friendly Telegram reminder (Markdown) for tomorrow's day of a " +
    "hiking trip in Israel. Use exactly three bold sections: *Where to start*, " +
    "*What to bring*, *What to know*. Keep it under 90 words. Base it ONLY on this " +
    "data; don't invent facts. Include the trail's maps link if present.\n\n" +
    `Trip: ${trip.title}\nDay data: ${JSON.stringify(day)}`;
  try {
    const res = await log.timed("openai_summarize", { model: SUMMARY_MODEL }, () =>
      client.chat.completions.create({
        model: SUMMARY_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    );
    return res.choices[0]?.message?.content?.trim() || FALLBACK_SUMMARY;
  } catch {
    // Already logged by timed(); a plain reminder beats no reminder.
    return FALLBACK_SUMMARY;
  }
}

export interface DailySummaryResult {
  sent: number;
  checked: number;
  failed: number;
}

class ReminderService {
  /** Daily-summary rule: for each linked account, send the day-before summary
   *  of any of their trips that starts a day tomorrow. */
  async runDailySummaries(): Promise<DailySummaryResult> {
    const links = await telegramDbService.listLinks();
    if (links.length === 0) {
      log.info("daily_run_done", { sent: 0, checked: 0, failed: 0 });
      return { sent: 0, checked: 0, failed: 0 };
    }

    const tomorrow = addDaysISO(israelToday(), 1);
    const client = new OpenAI();
    let sent = 0;
    let failed = 0;

    log.info("daily_run_start", { links: links.length, tomorrow });

    for (const link of links) {
      let trips: Array<{ id: string; start_date: string | null; data: Itinerary }>;
      try {
        trips = await tripDbService.listByUserWithMeta(link.user_id);
      } catch (e) {
        failed++;
        log.error("daily_user_failed", { userId: link.user_id, ...errInfo(e) });
        continue;
      }

      for (const trip of trips) {
        if (!trip.start_date) continue;
        try {
          const day = dayOnDate(trip.data.days ?? [], trip.start_date, tomorrow);
          if (!day) continue;
          if (await telegramDbService.alreadySent(trip.id, KIND, day.day_number, link.chat_id)) continue;

          const text = await summarize(client, trip.data, day);
          const header = `🥾 *Tomorrow — Day ${day.day_number}* (${day.date ?? tomorrow})\n\n`;
          const ok = await telegramService.sendMessage(link.chat_id, header + text);
          if (ok) {
            // markSent throws on failure: better to risk one duplicate
            // tomorrow than to record "sent" for a message we can't verify.
            await telegramDbService.markSent(trip.id, KIND, day.day_number, link.chat_id);
            sent++;
            log.info("reminder_sent", { tripId: trip.id, dayNumber: day.day_number });
          } else {
            failed++;
          }
        } catch (e) {
          failed++;
          log.error("daily_trip_failed", { tripId: trip.id, userId: link.user_id, ...errInfo(e) });
        }
      }
    }

    const result = { sent, checked: links.length, failed };
    log.info("daily_run_done", result);
    return result;
  }
}

export const reminderService = new ReminderService();
