// Reminder business logic — proactive Telegram rules, run once a day via cron.
// For every linked account's future trips, three independent rules:
//
//   hotel_booking  — first run where the trip is ≤30 days out: book your stays.
//   daily_summary  — the evening before each trip day: LLM summary of the day.
//   weather_alert  — ≤3 days out: forecast each day at its trailhead; on a
//                    problem (rain/snow/wind/heat), send an LLM-composed alert
//                    with catalog alternatives.
//
// Every rule is deduped via reminders_sent (kind + trip + chat) and isolated:
// one bad trip or rule must never abort the run for other users — failures are
// logged, counted, and reported in the run totals.

import OpenAI from "openai";
import { telegramDbService, type UserChat } from "../telegram/telegram.dbservice";
import { telegramService } from "../telegram/telegram.service";
import { tripDbService } from "../trip/trip.dbservice";
import { trailService } from "../trail/trail.service";
import { weatherService } from "../weather/weather.service";
import { createLogger, errInfo, type LogFields } from "../../shared/logger";
import {
  addDaysISO,
  coordsFromMapsLink,
  dayDate,
  dayOnDate,
  daysUntil,
  israelToday,
  tripHotelLines,
  weatherProblems,
  type ForecastDay,
  type WeatherProblem,
} from "./reminder.helpers";
import type { Day, Itinerary } from "../../shared/types";

const SUMMARY_MODEL = "gpt-4o";
const FALLBACK_SUMMARY = "Reminder: your trip day is tomorrow!";

const HOTEL_WINDOW_DAYS = 30; // fire once, the first run the trip is this close
const HOTEL_MIN_DAYS = 3; //    ...but not when it's about to start anyway
const WEATHER_WINDOW_DAYS = 3; // check the forecast once the trip is this close
const MAX_ALTERNATIVES = 3;

const log = createLogger("reminder.service");

type TripWithMeta = { id: string; start_date: string | null; data: Itinerary };
type DayProblem = WeatherProblem & { dayNumber: number; trail: string };

interface RuleCounts {
  sent: number;
  failed: number;
}

export interface DailyRunResult {
  links: number;
  summary: RuleCounts;
  hotel: RuleCounts;
  weather: RuleCounts;
}

async function llmText(client: OpenAI, event: string, prompt: string): Promise<string | null> {
  try {
    const res = await log.timed(event, { model: SUMMARY_MODEL }, () =>
      client.chat.completions.create({
        model: SUMMARY_MODEL,
        messages: [{ role: "user", content: prompt }],
      }),
    );
    return res.choices[0]?.message?.content?.trim() || null;
  } catch {
    return null; // already logged by timed(); callers fall back to a plain message
  }
}

class ReminderService {
  /** Run all reminder rules for every linked account. */
  async runDaily(): Promise<DailyRunResult> {
    const result: DailyRunResult = {
      links: 0,
      summary: { sent: 0, failed: 0 },
      hotel: { sent: 0, failed: 0 },
      weather: { sent: 0, failed: 0 },
    };
    const links = await telegramDbService.listLinks();
    result.links = links.length;
    if (links.length === 0) {
      log.info("daily_run_done", { ...result } as unknown as LogFields);
      return result;
    }

    const today = israelToday();
    const client = new OpenAI();
    log.info("daily_run_start", { links: links.length, today });

    for (const link of links) {
      let trips: TripWithMeta[];
      try {
        trips = await tripDbService.listByUserWithMeta(link.user_id);
      } catch (e) {
        result.summary.failed++;
        log.error("daily_user_failed", { userId: link.user_id, ...errInfo(e) });
        continue;
      }

      for (const trip of trips) {
        if (!trip.start_date) continue;
        const ctx = { tripId: trip.id, userId: link.user_id };
        await this.applyRule(result.hotel, "hotel_rule_failed", ctx, () =>
          this.hotelReminder(link, trip, today),
        );
        await this.applyRule(result.summary, "summary_rule_failed", ctx, () =>
          this.dailySummary(client, link, trip, today),
        );
        await this.applyRule(result.weather, "weather_rule_failed", ctx, () =>
          this.weatherAlert(client, link, trip, today),
        );
      }
    }

    log.info("daily_run_done", { ...result } as unknown as LogFields);
    return result;
  }

  /** Run one rule for one trip; count the outcome, never let it throw. */
  private async applyRule(
    counts: RuleCounts,
    failEvent: string,
    ctx: LogFields,
    rule: () => Promise<boolean>,
  ): Promise<void> {
    try {
      if (await rule()) counts.sent++;
    } catch (e) {
      counts.failed++;
      log.error(failEvent, { ...ctx, ...errInfo(e) });
    }
  }

  /** Deliver + dedupe: throws on send failure so the rule counts as failed;
   *  marks sent only after Telegram accepted (risking a duplicate beats
   *  recording "sent" for a message nobody got). */
  private async deliver(link: UserChat, trip: TripWithMeta, kind: string, dayNumber: number, text: string): Promise<true> {
    const ok = await telegramService.sendMessage(link.chat_id, text);
    if (!ok) throw new Error(`telegram send failed (${kind})`);
    await telegramDbService.markSent(trip.id, kind, dayNumber, link.chat_id);
    log.info("reminder_sent", { tripId: trip.id, kind, dayNumber });
    return true;
  }

  // ── Rule: book your hotels, ≤30 days out ─────────────────────────────────
  private async hotelReminder(link: UserChat, trip: TripWithMeta, today: string): Promise<boolean> {
    const du = daysUntil(today, trip.start_date!);
    if (du < HOTEL_MIN_DAYS || du > HOTEL_WINDOW_DAYS) return false;
    if (await telegramDbService.alreadySent(trip.id, "hotel_booking", 0, link.chat_id)) return false;

    const days = trip.data.days ?? [];
    const hotels = tripHotelLines(days);
    // A one-day trip with no saved hotel has nothing to book.
    if (hotels.length === 0 && days.length <= 1) return false;

    const stays =
      hotels.length > 0
        ? `Your planned stays:\n${hotels.map((h) => `• ${h}`).join("\n")}`
        : "No places to sleep saved on this trip yet — open it in TrailMate and ask me for suggestions.";
    const text =
      `🏨 *Time to book your stays*\n\n` +
      `*${trip.data.title}* starts on ${trip.start_date} — ${du} days away. ` +
      `Hotels fill up; booking now gets the good ones.\n\n${stays}`;
    return this.deliver(link, trip, "hotel_booking", 0, text);
  }

  // ── Rule: day-before summary of tomorrow's trip day ──────────────────────
  private async dailySummary(client: OpenAI, link: UserChat, trip: TripWithMeta, today: string): Promise<boolean> {
    const tomorrow = addDaysISO(today, 1);
    const day = dayOnDate(trip.data.days ?? [], trip.start_date!, tomorrow);
    if (!day) return false;
    if (await telegramDbService.alreadySent(trip.id, "daily_summary", day.day_number, link.chat_id)) return false;

    const prompt =
      "Write a short, friendly Telegram reminder (Markdown) for tomorrow's day of a " +
      "hiking trip in Israel. Use exactly three bold sections: *Where to start*, " +
      "*What to bring*, *What to know*. Keep it under 90 words. Base it ONLY on this " +
      "data; don't invent facts. Include the trail's maps link if present.\n\n" +
      `Trip: ${trip.data.title}\nDay data: ${JSON.stringify(day)}`;
    const text = (await llmText(client, "openai_summarize", prompt)) ?? FALLBACK_SUMMARY;
    const header = `🥾 *Tomorrow — Day ${day.day_number}* (${day.date ?? tomorrow})\n\n`;
    return this.deliver(link, trip, "daily_summary", day.day_number, header + text);
  }

  // ── Rule: weather check ≤3 days out, with alternatives on problems ───────
  private async weatherAlert(client: OpenAI, link: UserChat, trip: TripWithMeta, today: string): Promise<boolean> {
    const du = daysUntil(today, trip.start_date!);
    if (du < 1 || du > WEATHER_WINDOW_DAYS) return false;
    if (await telegramDbService.alreadySent(trip.id, "weather_alert", 0, link.chat_id)) return false;

    const problems = await this.collectProblems(trip);
    // All clear → no message, and no dedupe mark: the forecast is re-checked
    // on every remaining run in the window in case it turns bad.
    if (problems.length === 0) return false;

    const alternatives = await this.weatherAlternatives(problems);
    const text = await this.composeWeatherAlert(client, trip.data, trip.start_date!, problems, alternatives);
    return this.deliver(link, trip, "weather_alert", 0, `⛅️ *Weather check — ${trip.data.title}*\n\n${text}`);
  }

  /** Forecast each trip day at its own trailhead; collect flagged days. */
  private async collectProblems(trip: TripWithMeta): Promise<DayProblem[]> {
    const problems: DayProblem[] = [];
    for (const day of trip.data.days ?? []) {
      const trail = day?.trail;
      if (!trail?.name && !trail?.start_maps) continue;
      const dateIso = dayDate(trip.start_date!, day.day_number);
      try {
        const coords = coordsFromMapsLink(trail.start_maps);
        const fc = coords
          ? await weatherService.forecastAt(coords.lat, coords.lng, trail.name ?? "trailhead", dateIso, 1)
          : await weatherService.forecast(trail.name!, dateIso, 1);
        for (const p of weatherProblems((fc.forecast ?? []) as ForecastDay[])) {
          problems.push({ ...p, dayNumber: day.day_number, trail: trail.name ?? "your trail" });
        }
      } catch (e) {
        // A day we can't forecast is skipped, not fatal — better a partial
        // alert than none.
        log.warn("weather_day_skipped", { tripId: trip.id, dayNumber: day.day_number, ...errInfo(e) });
      }
    }
    return problems;
  }

  /** Catalog alternatives suited to the dominant problem (best-effort). */
  private async weatherAlternatives(problems: DayProblem[]) {
    const heat = problems.some((p) => p.issues.some((i) => i.toLowerCase().includes("hot")));
    // Heat → shaded water hikes; rain/snow/wind → short, easy, sheltered.
    const query = heat ? "מסלול מים קצר בצל" : "מסלול קצר וקל";
    try {
      const res = await trailService.searchCatalog(query, { limit: MAX_ALTERNATIVES });
      return (res.trails ?? []).map((t: Record<string, unknown>) => ({
        name: t.name,
        difficulty: t.difficulty,
        distance_km: t.distance_km,
        duration: t.duration,
        tiuli_url: t.tiuli_url,
      }));
    } catch (e) {
      log.warn("weather_alternatives_failed", errInfo(e));
      return [];
    }
  }

  private async composeWeatherAlert(
    client: OpenAI,
    trip: Itinerary,
    startDate: string,
    problems: DayProblem[],
    alternatives: unknown[],
  ): Promise<string> {
    const prompt =
      "Write a short, friendly Telegram message (Markdown, under 130 words) warning a " +
      "hiker about weather problems on their upcoming trip in Israel. State each problem " +
      "day plainly (date, trail, what's wrong), then advise whether to keep the plan or " +
      "adjust. If alternative trails are provided, recommend 1-2 of them by name with " +
      "their links. Base it ONLY on this data — never invent trails, links, or numbers.\n\n" +
      `Trip: ${trip.title} (starts ${startDate})\n` +
      `Problems: ${JSON.stringify(problems)}\n` +
      `Alternative trails: ${JSON.stringify(alternatives)}`;
    const text = await llmText(client, "openai_weather_alert", prompt);
    if (text) return text;
    // LLM down → plain factual fallback beats silence.
    return (
      "Heads up — the forecast flags problems for your trip:\n" +
      problems.map((p) => `• ${p.date} (Day ${p.dayNumber}, ${p.trail}): ${p.issues.join("; ")}`).join("\n") +
      "\n\nConsider adjusting your plan in TrailMate."
    );
  }
}

export const reminderService = new ReminderService();
