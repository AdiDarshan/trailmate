// Telegram business logic — sending messages via the Bot API. No DB.

const API_BASE = "https://api.telegram.org";

class TelegramService {
  private token(): string {
    const t = process.env.TELEGRAM_BOT_TOKEN;
    if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
    return t;
  }

  /** Send a Markdown message to a chat. Returns true on success. */
  async sendMessage(chatId: string, text: string): Promise<boolean> {
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
      console.error("telegram sendMessage failed:", res.status, detail);
      return false;
    }
    return true;
  }
}

export const telegramService = new TelegramService();
