// Reminder business logic — the daily-summary rule.
//
// Runs once a day (via cron). For every trip↔chat subscription, it finds the
// day whose real date is *tomorrow* in Israel time, generates a short summary
// with gpt-4o, sends it via Telegram, and records it so it's never re-sent.

import OpenAI from "openai";
import { telegramDbService } from "../telegram/telegram.dbservice";
import { telegramService } from "../telegram/telegram.service";
import { tripDbService } from "../trip/trip.dbservice";
import type { Day, Itinerary } from "../../shared/types";

const KIND = "daily_summary";

// Today's date in Israel as YYYY-MM-DD (cron runs in UTC).
function israelToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Real date of a given day in the trip = start_date + (day_number - 1).
function dayDate(startDate: string, dayNumber: number): string {
  return addDaysISO(startDate, Math.max(0, dayNumber - 1));
}

async function summarize(client: OpenAI, trip: Itinerary, day: Day): Promise<string> {
  const prompt =
    "Write a short, friendly Telegram reminder (Markdown) for tomorrow's day of a " +
    "hiking trip in Israel. Use exactly three bold sections: *Where to start*, " +
    "*What to bring*, *What to know*. Keep it under 90 words. Base it ONLY on this " +
    "data; don't invent facts. Include the trail's maps link if present.\n\n" +
    `Trip: ${trip.title}\nDay data: ${JSON.stringify(day)}`;
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
  });
  return res.choices[0]?.message?.content?.trim() || "Reminder: your trip day is tomorrow!";
}

class ReminderService {
  /** Daily-summary rule: for each linked account, send the day-before summary
   *  of any of their trips that starts a day tomorrow. */
  async runDailySummaries(): Promise<{ sent: number; checked: number }> {
    const links = await telegramDbService.listLinks();
    if (links.length === 0) return { sent: 0, checked: 0 };

    const tomorrow = addDaysISO(israelToday(), 1);
    const client = new OpenAI();
    let sent = 0;

    for (const link of links) {
      const trips = await tripDbService.listByUserWithMeta(link.user_id);
      for (const trip of trips) {
        if (!trip.start_date) continue;
        const days: Day[] = trip.data.days ?? [];
        const day = days.find((d) => dayDate(trip.start_date!, d.day_number) === tomorrow);
        if (!day) continue;
        if (await telegramDbService.alreadySent(trip.id, KIND, day.day_number, link.chat_id)) continue;

        const text = await summarize(client, trip.data, day);
        const header = `🥾 *Tomorrow — Day ${day.day_number}* (${day.date ?? tomorrow})\n\n`;
        const ok = await telegramService.sendMessage(link.chat_id, header + text);
        if (ok) {
          await telegramDbService.markSent(trip.id, KIND, day.day_number, link.chat_id);
          sent++;
        }
      }
    }

    return { sent, checked: links.length };
  }
}

export const reminderService = new ReminderService();
