// Load .env.local the same way Next does, so the smoke run sees the exact
// credentials the dev server would. @next/env deliberately skips .env.local
// under NODE_ENV=test (vitest's default) — mask it for the load only: smoke
// explicitly WANTS the real dev credentials.
import { loadEnvConfig } from "@next/env";

const env = process.env as Record<string, string | undefined>;
const prevNodeEnv = env.NODE_ENV;
env.NODE_ENV = "development";
loadEnvConfig(process.cwd());
env.NODE_ENV = prevNodeEnv;

const required = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(
    `Smoke needs real credentials; missing from the environment: ${missing.join(", ")}`,
  );
}
