// Cron controller — HTTP adapter for the daily scheduler. Verifies the request
// is from Vercel Cron (or an authorized caller) via CRON_SECRET, then runs the
// reminder rules.

import { reminderService } from "./reminder.service";
import { toPublicMessage } from "../../shared/errors";
import { createLogger, errInfo } from "../../shared/logger";

const log = createLogger("reminder.cron");

/**
 * No secret configured: allow in dev (local convenience), DENY in production —
 * a dropped env var must not silently make the endpoint public.
 */
export function isAuthorizedCron(
  authHeader: string | null,
  secret: string | undefined,
  isProduction: boolean,
): boolean {
  if (!secret) return !isProduction;
  return authHeader === `Bearer ${secret}`;
}

class CronController {
  private authorized(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    const isProduction = process.env.NODE_ENV === "production";
    if (!secret && isProduction) log.error("cron_secret_missing", {});
    return isAuthorizedCron(req.headers.get("authorization"), secret, isProduction);
  }

  async daily(req: Request): Promise<Response> {
    if (!this.authorized(req)) {
      log.warn("cron_unauthorized", {});
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const result = await log.timed("daily_rules", {}, () => reminderService.runDaily());
      return Response.json({ ok: true, ...result });
    } catch (e) {
      log.error("cron_daily_failed", errInfo(e));
      return Response.json({ ok: false, error: toPublicMessage(e) }, { status: 500 });
    }
  }
}

export const cronController = new CronController();
