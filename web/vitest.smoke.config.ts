// Pre-deploy smoke config — runs *.smoke.ts against REAL dependencies
// (OpenAI, Supabase) using .env.local. Deliberately separate from the default
// config so `npm test` stays fast, hermetic, and key-free.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.smoke.ts"],
    setupFiles: ["server/smoke/smoke.setup.ts"],
    // A real agent turn makes several LLM + tool calls.
    testTimeout: 120_000,
    // External calls from parallel workers would race rate limits.
    fileParallelism: false,
  },
});
