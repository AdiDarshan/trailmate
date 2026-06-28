// HTTP entry point for Telegram bot updates (set as the bot webhook URL).

import { telegramController } from "@/server/modules/telegram/telegram.controller";

export const runtime = "nodejs";

export function POST(req: Request) {
  return telegramController.webhook(req);
}
