// HTTP entry point for Telegram bot updates (set as the bot webhook URL).

import { telegramController } from "@/server/modules/telegram/telegram.controller";
import { withRequestContext } from "@/server/shared/logger";

export const runtime = "nodejs";

export function POST(req: Request) {
  return withRequestContext(() => telegramController.webhook(req));
}
