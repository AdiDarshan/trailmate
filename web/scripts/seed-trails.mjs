// Seed the `trails` table from the enriched tiuli dataset.
//
// Usage (from web/):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/seed-trails.mjs
//
// Reads ../.agents/data/trails_seed.json and upserts all rows in batches.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "..", "..", ".agents", "data", "trails_seed.json");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const raw = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
// Drop any records that failed to enrich and keep only schema columns.
const rows = raw
  .filter((r) => !r._error)
  .map((r) => ({
    id: r.id,
    name_he: r.name_he,
    subtitle: r.subtitle || null,
    slug: r.slug || null,
    url: r.url || null,
    description_he: r.description_he || null,
    waze_link: r.waze_link || null,
    lat: r.lat ?? null,
    lng: r.lng ?? null,
    difficulty: r.difficulty || null,
    duration: r.duration || null,
    trail_map_image: r.trail_map_image || null,
  }));

console.log(`Seeding ${rows.length} trails…`);
const BATCH = 100;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const { error } = await supabase.from("trails").upsert(batch, { onConflict: "id" });
  if (error) {
    console.error(`Batch ${i}–${i + batch.length} failed:`, error.message);
    process.exit(1);
  }
  console.log(`  upserted ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
}
console.log("Done.");
