// Telegram business logic — sending messages via the Bot API. No DB.

import { AppError } from "../../shared/errors";
import { createLogger, errInfo } from "../../shared/logger";

const API_BASE = "https://api.telegram.org";

const log = createLogger("telegram.service");

class TelegramService {
  private token(): string {
    const t = process.env.TELEGRAM_BOT_TOKEN;
    if (!t) {
      throw new AppError("TELEGRAM_BOT_TOKEN is not set", {
        publicMessage: "Telegram is not configured.",
      });
    }
    return t;
  }

  /**
   * Send a Markdown message to a chat. Returns true on success, false on ANY
   * failure (API rejection or network error) — callers treat delivery as
   * best-effort and must never crash on a notification.
   */
  async sendMessage(chatId: string, text: string): Promise<boolean> {
    const start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/bot${this.token()}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        // Telegram returns 4xx with a description; surface it for logs.
        const detail = await res.text().catch(() => "");
        log.error("send_message", {
          outcome: "rejected", chatId, status: res.status, detail: detail.slice(0, 300),
          ms: Date.now() - start, textLen: text.length,
        });
        return false;
      }
      log.info("send_message", { outcome: "ok", chatId, ms: Date.now() - start, textLen: text.length });
      return true;
    } catch (e) {
      // Network failure / missing token. A reminder or confirmation must
      // never take the caller down with it.
      log.error("send_message", { outcome: "error", chatId, ms: Date.now() - start, ...errInfo(e) });
      return false;
    }
  }
}

export const telegramService = new TelegramService();
