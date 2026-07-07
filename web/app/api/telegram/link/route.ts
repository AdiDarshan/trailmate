// HTTP entry point — issue a one-time Telegram connect deep-link for the user.

import { telegramController } from "@/server/modules/telegram/telegram.controller";
import { withRequestContext } from "@/server/shared/logger";

export const runtime = "nodejs";

export function GET() {
  return withRequestContext(() => telegramController.linkUrl());
}
