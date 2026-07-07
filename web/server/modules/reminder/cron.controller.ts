// Cron controller — HTTP adapter for the daily scheduler. Verifies the request
// is from Vercel Cron (or an authorized caller) via CRON_SECRET, then runs the
// reminder rules.

import { reminderService } from "./reminder.service";
import { toPublicMessage } from "../../shared/errors";
import { createLogger, errInfo } from "../../shared/logger";

const log = createLogger("reminder.cron");

class CronController {
  private authorized(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return true; // no secret configured (e.g. local dev) → allow
    const auth = req.headers.get("authorization");
    return auth === `Bearer ${secret}`;
  }

  async daily(req: Request): Promise<Response> {
    if (!this.authorized(req)) {
      log.warn("cron_unauthorized", {});
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const result = await log.timed("daily_summaries", {}, () => reminderService.runDailySummaries());
      return Response.json({ ok: true, ...result });
    } catch (e) {
      log.error("cron_daily_failed", errInfo(e));
      return Response.json({ ok: false, error: toPublicMessage(e) }, { status: 500 });
    }
  }
}

export const cronController = new CronController();
