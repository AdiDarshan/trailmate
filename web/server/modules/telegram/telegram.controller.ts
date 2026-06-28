// Telegram controller — webhook (account linking) + connect-URL issuer.

import { telegramDbService } from "./telegram.dbservice";
import { telegramService } from "./telegram.service";
import { getAuthUser } from "../../db/supabase-auth";

class TelegramController {
  /** GET /api/telegram/link — issue a one-time deep link for the signed-in user. */
  async linkUrl(): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
    if (!bot) return Response.json({ error: "Telegram bot not configured" }, { status: 500 });
    const token = await telegramDbService.createLinkToken(user.id);
    return Response.json({ url: `https://t.me/${bot}?start=${token}` });
  }

  /** POST /api/telegram/webhook — Telegram bot updates. */
  async webhook(req: Request): Promise<Response> {
    let update: any;
    try {
      update = await req.json();
    } catch {
      return new Response("ok");
    }

    const message = update?.message;
    const chatId = message?.chat?.id;
    const text: string = message?.text ?? "";

    if (chatId && text.startsWith("/start")) {
      const token = text.split(/\s+/)[1]?.trim();
      const userId = token ? await telegramDbService.consumeLinkToken(token) : null;
      if (userId) {
        try {
          await telegramDbService.linkUser(userId, String(chatId));
          await telegramService.sendMessage(
            String(chatId),
            "✅ Connected! You'll get a confirmation when you save a trip, and a summary the day before each trip day.",
          );
        } catch (e: any) {
          console.error("telegram link failed:", e?.message ?? e);
        }
      } else {
        await telegramService.sendMessage(
          String(chatId),
          "Hi! Open *Connect Telegram* from the TrailMate sidebar to link your account.",
        );
      }
    }

    return new Response("ok");
  }
}

export const telegramController = new TelegramController();
