// HTTP entry point for the daily reminder scheduler (hit by Vercel Cron).

import { cronController } from "@/server/modules/reminder/cron.controller";

export const runtime = "nodejs";
export const maxDuration = 60;

export function GET(req: Request) {
  return cronController.daily(req);
}
