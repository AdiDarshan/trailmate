// Telegram webhook controller — receives bot updates. The only update we act on
// is "/start <tripId>", sent when a user taps the deep-link to connect a trip.

import { subscriptionDbService } from "./subscription.dbservice";
import { telegramService } from "./telegram.service";

class TelegramController {
  async webhook(req: Request): Promise<Response> {
    let update: any;
    try {
      update = await req.json();
    } catch {
      return new Response("ok"); // always 200 so Telegram doesn't retry forever
    }

    const message = update?.message;
    const chatId = message?.chat?.id;
    const text: string = message?.text ?? "";

    if (chatId && text.startsWith("/start")) {
      const tripId = text.split(/\s+/)[1]?.trim();
      if (tripId) {
        try {
          await subscriptionDbService.subscribe(tripId, String(chatId));
          await telegramService.sendMessage(
            String(chatId),
            "✅ You're connected! I'll send you a short summary the day before each day of your trip.",
          );
        } catch (e: any) {
          console.error("subscribe failed:", e?.message ?? e);
        }
      } else {
        await telegramService.sendMessage(
          String(chatId),
          "Hi! Open the *Get reminders on Telegram* link from your TrailMate trip to connect it.",
        );
      }
    }

    return new Response("ok");
  }
}

export const telegramController = new TelegramController();
