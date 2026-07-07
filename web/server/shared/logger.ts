// Structured logger for the server. One JSON object per line so Vercel's log
// drain (and grep) can filter on fields instead of parsing prose. Zero deps —
// deliberately not pino/winston to keep the serverless bundle lean.
//
// Usage:
//   const log = createLogger("chat.service");
//   log.info("turn_start", { historyLen: 12 });
//   const res = await log.timed("openai_chat", { model }, () => client.chat...);
//   // → {"level":"info","module":"chat.service","event":"openai_chat","outcome":"ok","ms":812,...}

import { AsyncLocalStorage } from "node:async_hooks";

type Level = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

// Correlation: one id per HTTP request, stamped on every log line emitted
// within it, so a single turn's logs (controller → service → tools) can be
// stitched together under concurrent traffic. All API routes run on the Node
// runtime, so async_hooks is safe here.
const requestStore = new AsyncLocalStorage<{ requestId: string }>();

/** Wrap a route handler so every log line it (transitively) emits carries one requestId. */
export function withRequestContext<T>(fn: () => T): T {
  return requestStore.run({ requestId: crypto.randomUUID().slice(0, 8) }, fn);
}

/**
 * Capture the current request context onto a callback that will run after the
 * handler returns (e.g. a ReadableStream pulled by the framework) — ALS does
 * not reliably propagate into those on its own.
 */
export function bindRequestContext<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const store = requestStore.getStore();
  return store ? (...args: A) => requestStore.run(store, fn, ...args) : fn;
}

function emit(level: Level, module: string, event: string, fields?: LogFields): void {
  const requestId = requestStore.getStore()?.requestId;
  const record: LogFields = {
    ts: new Date().toISOString(),
    level,
    module,
    event,
    ...(requestId !== undefined && { requestId }),
    ...fields,
  };
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    // Circular/unserializable field — never let logging throw.
    line = JSON.stringify({ ts: record.ts, level, module, event, logError: "unserializable fields" });
  }
  // Resolved at call time (not bound at import) so log-capture tooling and
  // test spies that patch console still see these lines.
  console[level](line);
}

/** Message + name of any thrown value, without assuming it's an Error. */
export function errInfo(e: unknown): { error: string; errorName?: string } {
  if (e instanceof Error) return { error: e.message, errorName: e.name };
  return { error: String(e) };
}

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /**
   * Run `fn`, logging one structured record with latency and outcome —
   * the standard wrapper for every external call (API, DB, network).
   * Rethrows the original error after logging it with context.
   */
  timed<T>(event: string, fields: LogFields, fn: () => Promise<T>): Promise<T>;
}

export function createLogger(module: string): Logger {
  return {
    debug: (event, fields) => emit("debug", module, event, fields),
    info: (event, fields) => emit("info", module, event, fields),
    warn: (event, fields) => emit("warn", module, event, fields),
    error: (event, fields) => emit("error", module, event, fields),
    async timed<T>(event: string, fields: LogFields, fn: () => Promise<T>): Promise<T> {
      const start = Date.now();
      try {
        const result = await fn();
        emit("info", module, event, { ...fields, outcome: "ok", ms: Date.now() - start });
        return result;
      } catch (e) {
        emit("error", module, event, { ...fields, outcome: "error", ms: Date.now() - start, ...errInfo(e) });
        throw e;
      }
    },
  };
}
