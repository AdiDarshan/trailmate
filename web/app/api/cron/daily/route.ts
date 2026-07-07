// HTTP entry point for the daily reminder scheduler (hit by Vercel Cron).

import { cronController } from "@/server/modules/reminder/cron.controller";
import { withRequestContext } from "@/server/shared/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(req: Request) {
  return withRequestContext(() => cronController.daily(req));
}
