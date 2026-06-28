// Data access for trip ↔ Telegram chat links and the reminder dedupe log.

import { supabase } from "../../db/supabase";

export interface Subscription {
  trip_id: string;
  chat_id: string;
}

class SubscriptionDbService {
  /** Link a trip to a Telegram chat (idempotent). */
  async subscribe(tripId: string, chatId: string): Promise<void> {
    const { error } = await supabase
      .from("subscriptions")
      .upsert({ trip_id: tripId, chat_id: chatId }, { onConflict: "trip_id,chat_id" });
    if (error) throw new Error(error.message);
  }

  /** All subscriptions (used by the daily cron to know who to notify). */
  async listAll(): Promise<Subscription[]> {
    const { data, error } = await supabase.from("subscriptions").select("trip_id,chat_id");
    if (error) throw new Error(error.message);
    return (data ?? []) as Subscription[];
  }

  /** Has this exact reminder already been sent? */
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

export const subscriptionDbService = new SubscriptionDbService();
