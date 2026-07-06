// Seed the `trails` table from the enriched tiuli dataset.
//
// Usage (from web/):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
//     node scripts/seed-trails.mjs
//
// Reads ../.agents/data/trails_seed.json, computes a semantic embedding per trail
// (OpenAI text-embedding-3-small), and upserts all rows in batches. Requires the
// trails-enrich.sql migration to have been applied first. If OPENAI_API_KEY is
// absent it seeds the columns without embeddings (semantic search then returns
// nothing until you re-run with a key).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const EMBED_MODEL = "text-embedding-3-small";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "..", "..", ".agents", "data", "trails_seed.json");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// The text we embed for semantic matching. Mixes Hebrew (name, region, features,
// editorial description) with English feature slugs so both languages retrieve well.
function embedText(r) {
  const parts = [
    r.name_he,
    r.subtitle && r.subtitle !== r.name_he ? r.subtitle : "",
    r.region_he ? `אזור: ${r.region_he}` : r.area_he ? `אזור: ${r.area_he}` : "",
    r.difficulty ? `דרגת קושי: ${r.difficulty}` : "",
    r.distance_km != null ? `אורך: ${r.distance_km} ק"מ` : "",
    (r.features_he || []).length ? `מאפיינים: ${r.features_he.join(", ")}` : "",
    (r.features || []).join(", "),
    r.description_he || "",
  ];
  return parts.filter(Boolean).join(". ");
}

// Batch-embed all trail texts. Returns Map<index, number[]>. Empty if no API key.
async function embedAll(records) {
  const byIndex = new Map();
  if (!process.env.OPENAI_API_KEY) {
    console.warn("⚠  OPENAI_API_KEY not set — seeding without embeddings.");
    return byIndex;
  }
  const openai = new OpenAI();
  const texts = records.map(embedText);
  const CHUNK = 256;
  for (let i = 0; i < texts.length; i += CHUNK) {
    const input = texts.slice(i, i + CHUNK);
    const res = await openai.embeddings.create({ model: EMBED_MODEL, input });
    res.data.forEach((e, j) => byIndex.set(i + j, e.embedding));
    console.log(`  embedded ${Math.min(i + CHUNK, texts.length)}/${texts.length}`);
  }
  return byIndex;
}

const raw = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
// Drop any records that failed to enrich.
const clean = raw.filter((r) => !r._error);
const embeddings = await embedAll(clean);

const rows = clean.map((r, i) => ({
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
  difficulty_level: r.difficulty_level ?? null,
  distance_km: r.distance_km ?? null,
  duration: r.duration || null,
  trail_map_image: r.trail_map_image || null,
  area_he: r.area_he || null,
  area_en: r.area_en || null,
  region_he: r.region_he || null,
  subregion_he: r.subregion_he || null,
  city_he: r.city_he || null,
  features: r.features?.length ? r.features : null,
  features_he: r.features_he?.length ? r.features_he : null,
  author: r.author || null,
  date_modified: r.date_modified || null,
  embedding: embeddings.get(i) ?? null,
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
