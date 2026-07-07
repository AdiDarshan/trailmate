// Preferences controller — HTTP adapter for the sidebar's "My preferences"
// panel. GET returns the text; PUT replaces it. Scoped to the signed-in user.

import { prefsDbService } from "./prefs.dbservice";
import { getAuthUser } from "../../db/supabase-auth";
import { toPublicMessage } from "../../shared/errors";
import { createLogger, errInfo } from "../../shared/logger";

// Injected verbatim into every agent turn's system context — cap it so a huge
// paste can't crowd out the conversation's token budget.
export const MAX_PREFS_LENGTH = 1000;

const log = createLogger("prefs.controller");

class PrefsController {
  /** GET /api/prefs — the user's standing preferences. */
  async get(): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      const preferences = await prefsDbService.get(user.id);
      return Response.json({ preferences });
    } catch (e) {
      log.error("get_prefs_failed", { userId: user.id, ...errInfo(e) });
      return Response.json({ error: toPublicMessage(e) }, { status: 500 });
    }
  }

  /** PUT /api/prefs — body { preferences: string }. Empty string clears them. */
  async put(req: Request): Promise<Response> {
    const user = await getAuthUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    let preferences: string;
    try {
      const body = await req.json();
      if (typeof body?.preferences !== "string") {
        return Response.json({ error: "preferences (string) is required" }, { status: 400 });
      }
      preferences = body.preferences.trim();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (preferences.length > MAX_PREFS_LENGTH) {
      return Response.json(
        { error: `preferences must be at most ${MAX_PREFS_LENGTH} characters` },
        { status: 400 },
      );
    }
    try {
      await prefsDbService.upsert(user.id, preferences);
      return Response.json({ ok: true });
    } catch (e) {
      log.error("save_prefs_failed", { userId: user.id, ...errInfo(e) });
      return Response.json({ error: toPublicMessage(e) }, { status: 500 });
    }
  }
}

export const prefsController = new PrefsController();
