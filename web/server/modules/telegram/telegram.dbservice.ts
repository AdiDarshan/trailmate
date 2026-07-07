// Data access for Telegram account links + the reminder dedupe log.
// System-scoped (service-role client) — these run from webhooks and cron,
// where there is no user cookie session.

import { nanoid } from "nanoid";
import { supabase } from "../../db/supabase";
import { AppError } from "../../shared/errors";
import { createLogger } from "../../shared/logger";

const LINK_TOKEN_LENGTH = 16;
const PUBLIC_DB_ERROR = "Could not update Telegram settings. Please try again.";

const log = createLogger("telegram.dbservice");

export interface UserChat {
  user_id: string;
  chat_id: string;
}

/** Wrap a Supabase {data,error} result: typed throw on error. */
function unwrap<T>(op: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) {
    throw new AppError(`${op}: ${result.error.message}`, { publicMessage: PUBLIC_DB_ERROR });
  }
  return result.data;
}

class TelegramDbService {
  // ── Account linking ──────────────────────────────────────────────────────

  /** Create a single-use token that maps a /start payload back to the user. */
  async createLinkToken(userId: string): Promise<string> {
    return log.timed("create_link_token", { userId }, async () => {
      const token = nanoid(LINK_TOKEN_LENGTH);
      unwrap("create_link_token", await supabase.from("telegram_link_tokens").insert({ token, user_id: userId }));
      return token;
    });
  }

  /** Consume a link token, returning the user it belongs to (or null). */
  async consumeLinkToken(token: string): Promise<string | null> {
    return log.timed("consume_link_token", {}, async () => {
      const res = await supabase
        .from("telegram_link_tokens")
        .select("user_id")
        .eq("token", token)
        .maybeSingle();
      const row = unwrap("consume_link_token", res);
      if (!row) return null;
      // Best-effort single-use cleanup: a failed delete leaves a stale token
      // but must not block the link itself. Log so it's visible.
      const del = await supabase.from("telegram_link_tokens").delete().eq("token", token);
      if (del.error) log.warn("link_token_delete_failed", { error: del.error.message });
      return row.user_id as string;
    });
  }

  /** Link (or relink) a user's account to a Telegram chat. */
  async linkUser(userId: string, chatId: string): Promise<void> {
    return log.timed("link_user", { userId, chatId }, async () => {
      unwrap(
        "link_user",
        await supabase
          .from("user_telegram")
          .upsert({ user_id: userId, chat_id: chatId }, { onConflict: "user_id" }),
      );
    });
  }

  /** The Telegram chat for a user, or null if not connected. */
  async getChatId(userId: string): Promise<string | null> {
    return log.timed("get_chat_id", { userId }, async () => {
      const res = await supabase.from("user_telegram").select("chat_id").eq("user_id", userId).maybeSingle();
      const row = unwrap("get_chat_id", res);
      return row?.chat_id ?? null;
    });
  }

  /** Every linked account (used by the daily reminder cron). */
  async listLinks(): Promise<UserChat[]> {
    return log.timed("list_links", {}, async () => {
      const rows = unwrap("list_links", await supabase.from("user_telegram").select("user_id,chat_id"));
      return (rows ?? []) as UserChat[];
    });
  }

  // ── Reminder dedupe ──────────────────────────────────────────────────────

  async alreadySent(tripId: string, kind: string, dayNumber: number, chatId: string): Promise<boolean> {
    return log.timed("already_sent", { tripId, kind, dayNumber }, async () => {
      const res = await supabase
        .from("reminders_sent")
        .select("trip_id")
        .eq("trip_id", tripId)
        .eq("kind", kind)
        .eq("day_number", dayNumber)
        .eq("chat_id", chatId)
        .maybeSingle();
      return !!unwrap("already_sent", res);
    });
  }

  async markSent(tripId: string, kind: string, dayNumber: number, chatId: string): Promise<void> {
    return log.timed("mark_sent", { tripId, kind, dayNumber }, async () => {
      // A silent failure here means a duplicate reminder tomorrow — throw so
      // the caller knows the dedupe record is missing.
      unwrap(
        "mark_sent",
        await supabase.from("reminders_sent").insert({ trip_id: tripId, kind, day_number: dayNumber, chat_id: chatId }),
      );
    });
  }
}

export const telegramDbService = new TelegramDbService();
