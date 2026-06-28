// Data access for Telegram account links + the reminder dedupe log.

import { nanoid } from "nanoid";
import { supabase } from "../../db/supabase";

export interface UserChat {
  user_id: string;
  chat_id: string;
}

class TelegramDbService {
  // ── Account linking ──────────────────────────────────────────────────────

  /** Create a single-use token that maps a /start payload back to the user. */
  async createLinkToken(userId: string): Promise<string> {
    const token = nanoid(16);
    const { error } = await supabase.from("telegram_link_tokens").insert({ token, user_id: userId });
    if (error) throw new Error(error.message);
    return token;
  }

  /** Consume a link token, returning the user it belongs to (or null). */
  async consumeLinkToken(token: string): Promise<string | null> {
    const { data } = await supabase
      .from("telegram_link_tokens")
      .select("user_id")
      .eq("token", token)
      .maybeSingle();
    if (!data) return null;
    await supabase.from("telegram_link_tokens").delete().eq("token", token);
    return data.user_id as string;
  }

  /** Link (or relink) a user's account to a Telegram chat. */
  async linkUser(userId: string, chatId: string): Promise<void> {
    const { error } = await supabase
      .from("user_telegram")
      .upsert({ user_id: userId, chat_id: chatId }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
  }

  /** The Telegram chat for a user, or null if not connected. */
  async getChatId(userId: string): Promise<string | null> {
    const { data } = await supabase
      .from("user_telegram")
      .select("chat_id")
      .eq("user_id", userId)
      .maybeSingle();
    return data?.chat_id ?? null;
  }

  /** Every linked account (used by the daily reminder cron). */
  async listLinks(): Promise<UserChat[]> {
    const { data, error } = await supabase.from("user_telegram").select("user_id,chat_id");
    if (error) throw new Error(error.message);
    return (data ?? []) as UserChat[];
  }

  // ── Reminder dedupe ──────────────────────────────────────────────────────

  async alreadySent(tripId: string, kind: string, dayNumber: number, chatId: string): Promise<boolean> {
    const { data } = await supabase
      .from("reminders_sent")
      .select("trip_id")
      .eq("trip_id", tripId)
      .eq("kind", kind)
      .eq("day_number", dayNumber)
      .eq("chat_id", chatId)
      .maybeSingle();
    return !!data;
  }

  async markSent(tripId: string, kind: string, dayNumber: number, chatId: string): Promise<void> {
    await supabase
      .from("reminders_sent")
      .insert({ trip_id: tripId, kind, day_number: dayNumber, chat_id: chatId });
  }
}

export const telegramDbService = new TelegramDbService();
