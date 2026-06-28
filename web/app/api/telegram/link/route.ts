// HTTP entry point — issue a one-time Telegram connect deep-link for the user.

import { telegramController } from "@/server/modules/telegram/telegram.controller";

export const runtime = "nodejs";

export function GET() {
  return telegramController.linkUrl();
}
