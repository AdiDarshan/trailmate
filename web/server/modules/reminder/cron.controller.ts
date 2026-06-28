// Cron controller — HTTP adapter for the daily scheduler. Verifies the request
// is from Vercel Cron (or an authorized caller) via CRON_SECRET, then runs the
// reminder rules.

import { reminderService } from "./reminder.service";

class CronController {
  private authorized(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    if (!secret) return true; // no secret configured (e.g. local dev) → allow
    const auth = req.headers.get("authorization");
    return auth === `Bearer ${secret}`;
  }

  async daily(req: Request): Promise<Response> {
    if (!this.authorized(req)) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const result = await reminderService.runDailySummaries();
      return Response.json({ ok: true, ...result });
    } catch (e: any) {
      console.error("cron daily failed:", e?.message ?? e);
      return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
    }
  }
}

export const cronController = new CronController();
