// Telegram controller — webhook (account linking) + connect-URL issuer.
//
// The webhook ALWAYS answers 200 "ok": any other status makes Telegram retry
// the same update in a loop. Failures are logged, never surfaced to Telegram.

import { telegramDbService } from "./telegram.dbservice";
import { telegramService } from "./telegram.service";
import { getAuthUser } from "../../db/supabase-auth";
import { toPublicMessage } from "../../shared/errors";
import { createLogger, errInfo } from "../../shared/logger";

const log = createLogger("telegram.controller");

const MSG_LINKED =
  "✅ Connected! You'll get a confirmation when you save a trip, and a summary the day before each trip day.";
const MSG_UNKNOWN_START =
  "Hi! Open *Connect Telegram* from the TrailMate sidebar to link your account.";

class TelegramController {
  /** GET /api/telegram/link — issue a one-time deep link for the signed-in user. */
  async linkUrl(): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
    if (!bot) {
      log.error("link_url_unconfigured", {});
      return Response.json({ error: "Telegram bot not configured" }, { status: 500 });
    }
    try {
      const token = await telegramDbService.createLinkToken(user.id);
      return Response.json({ url: `https://t.me/${bot}?start=${token}` });
    } catch (e) {
      log.error("link_url_failed", { userId: user.id, ...errInfo(e) });
      return Response.json({ error: toPublicMessage(e) }, { status: 500 });
    }
  }

  /** POST /api/telegram/webhook — Telegram bot updates. */
  async webhook(req: Request): Promise<Response> {
    let update: any;
    try {
      update = await req.json();
    } catch {
      log.warn("webhook_bad_json", {});
      return new Response("ok");
    }

    const message = update?.message;
    const chatId = message?.chat?.id;
    const text: string = message?.text ?? "";

    if (chatId && text.startsWith("/start")) {
      const token = text.split(/\s+/)[1]?.trim();
      try {
        const userId = token ? await telegramDbService.consumeLinkToken(token) : null;
        if (userId) {
          await telegramDbService.linkUser(userId, String(chatId));
          log.info("account_linked", { userId, chatId: String(chatId) });
          await telegramService.sendMessage(String(chatId), MSG_LINKED);
        } else {
          log.info("start_without_valid_token", { chatId: String(chatId), hadToken: !!token });
          await telegramService.sendMessage(String(chatId), MSG_UNKNOWN_START);
        }
      } catch (e) {
        log.error("webhook_link_failed", { chatId: String(chatId), ...errInfo(e) });
      }
    }

    return new Response("ok");
  }
}

export const telegramController = new TelegramController();
