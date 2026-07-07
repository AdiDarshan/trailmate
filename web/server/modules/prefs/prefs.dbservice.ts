// Data access for `user_prefs` — one free-text preferences field per user.
// All access goes through the request's RLS-bound client, so Postgres enforces
// ownership; failures throw AppError with a user-safe message.

import { createAuthClient } from "../../db/supabase-auth";
import { AppError } from "../../shared/errors";
import { createLogger } from "../../shared/logger";

const PUBLIC_DB_ERROR = "Could not access your preferences. Please try again.";

const log = createLogger("prefs.dbservice");

class PrefsDbService {
  /** The user's standing preferences text ("" if never set). */
  async get(userId: string): Promise<string> {
    return log.timed("get_prefs", { userId }, async () => {
      const db = await createAuthClient();
      const res = await db
        .from("user_prefs")
        .select("preferences")
        .eq("user_id", userId)
        .maybeSingle();
      if (res.error) {
        throw new AppError(`get_prefs: ${res.error.message}`, { publicMessage: PUBLIC_DB_ERROR });
      }
      return res.data?.preferences ?? "";
    });
  }

  /** Replace the user's preferences text. */
  async upsert(userId: string, preferences: string): Promise<void> {
    return log.timed("upsert_prefs", { userId, len: preferences.length }, async () => {
      const db = await createAuthClient();
      const res = await db
        .from("user_prefs")
        .upsert({ user_id: userId, preferences, updated_at: new Date().toISOString() });
      if (res.error) {
        throw new AppError(`upsert_prefs: ${res.error.message}`, { publicMessage: PUBLIC_DB_ERROR });
      }
    });
  }
}

export const prefsDbService = new PrefsDbService();
