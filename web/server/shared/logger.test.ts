import { afterEach, describe, expect, it, vi } from "vitest";
import { bindRequestContext, createLogger, errInfo, withRequestContext } from "./logger";
import { AppError, GENERIC_USER_ERROR, toPublicMessage } from "./errors";

afterEach(() => vi.restoreAllMocks());

describe("createLogger", () => {
  it("emits one JSON line with module/event/level and custom fields", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    createLogger("test.module").info("thing_happened", { count: 3 });
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ level: "info", module: "test.module", event: "thing_happened", count: 3 });
    expect(typeof parsed.ts).toBe("string");
  });

  it("never throws on unserializable fields", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const circular: any = {};
    circular.self = circular;
    expect(() => createLogger("t").warn("evt", { circular })).not.toThrow();
    expect(JSON.parse(spy.mock.calls[0][0] as string).logError).toBe("unserializable fields");
  });

  it("timed() logs latency + ok outcome and returns the result", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const out = await createLogger("t").timed("call", { url: "x" }, async () => 42);
    expect(out).toBe(42);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(parsed).toMatchObject({ event: "call", outcome: "ok", url: "x" });
    expect(typeof parsed.ms).toBe("number");
  });

  it("timed() logs the failure with context and rethrows", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      createLogger("t").timed("call", { id: 7 }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(JSON.parse(spy.mock.calls[0][0] as string)).toMatchObject({
      outcome: "error",
      error: "boom",
      id: 7,
    });
  });
});

describe("request correlation", () => {
  it("stamps the same requestId on every line inside one context, none outside", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = createLogger("t");

    await withRequestContext(async () => {
      log.info("first");
      await Promise.resolve(); // survives async continuations
      log.info("second");
    });
    log.info("outside");

    const lines = spy.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(typeof lines[0].requestId).toBe("string");
    expect(lines[1].requestId).toBe(lines[0].requestId);
    expect(lines[2].requestId).toBeUndefined();
  });

  it("two contexts get distinct ids", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = createLogger("t");
    withRequestContext(() => log.info("a"));
    withRequestContext(() => log.info("b"));
    const [a, b] = spy.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(a.requestId).not.toBe(b.requestId);
  });

  it("bindRequestContext carries the id into a callback run outside the context", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = createLogger("t");

    let bound: () => void = () => {};
    withRequestContext(() => {
      log.info("inside");
      bound = bindRequestContext(() => log.info("later"));
    });
    bound(); // simulates the framework pulling a stream after the handler returned

    const [inside, later] = spy.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(later.requestId).toBe(inside.requestId);
  });
});

describe("errors", () => {
  it("errInfo handles Error and non-Error throws", () => {
    expect(errInfo(new TypeError("bad"))).toEqual({ error: "bad", errorName: "TypeError" });
    expect(errInfo("plain string")).toEqual({ error: "plain string" });
  });

  it("toPublicMessage exposes AppError messages but hides everything else", () => {
    expect(toPublicMessage(new AppError("db timeout", { publicMessage: "Try again shortly" }))).toBe(
      "Try again shortly",
    );
    expect(toPublicMessage(new Error("stack leak with secrets"))).toBe(GENERIC_USER_ERROR);
  });
});
