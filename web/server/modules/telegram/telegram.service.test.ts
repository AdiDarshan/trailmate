import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { telegramService } from "./telegram.service";

const okResponse = { ok: true } as Response;
const rejectedResponse = {
  ok: false,
  status: 400,
  text: async () => '{"description":"Bad Request: chat not found"}',
} as unknown as Response;

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-token");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("telegramService.sendMessage", () => {
  it("returns true and posts Markdown to the Bot API on success", async () => {
    const fetchMock = vi.fn(async () => okResponse);
    vi.stubGlobal("fetch", fetchMock);

    expect(await telegramService.sendMessage("123", "hello")).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("bottest-token/sendMessage");
    expect(JSON.parse(init.body as string)).toMatchObject({
      chat_id: "123",
      text: "hello",
      parse_mode: "Markdown",
    });
  });

  it("returns false (never throws) when Telegram rejects the message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rejectedResponse));
    expect(await telegramService.sendMessage("123", "hello")).toBe(false);
  });

  it("returns false (never throws) on a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed");
    }));
    expect(await telegramService.sendMessage("123", "hello")).toBe(false);
  });

  it("returns false when the bot token is not configured", async () => {
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());
    expect(await telegramService.sendMessage("123", "hello")).toBe(false);
  });
});
