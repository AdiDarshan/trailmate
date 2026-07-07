// Seed the `trails` table with the Nakeb dataset (additive — Tiuli rows untouched).
//
// Usage (from web/):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
//     node scripts/seed-nakeb.mjs
//
// Reads ../.agents/data/nakeb_seed.json, embeds each trail (same model as Tiuli),
// and upserts with source='nakeb' and offset integer ids (100000 + hike id) so it
// never collides with Tiuli's ids (1–348). Requires trails-nakeb.sql to be applied.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const EMBED_MODEL = "text-embedding-3-small";
const ID_OFFSET = 100000; // nakeb-357 → 100357

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = join(__dirname, "..", "..", ".agents", "data", "nakeb_seed.json");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

// Same embedding recipe as Tiuli (Hebrew + English slugs), plus recommended seasons.
function embedText(r) {
  const parts = [
    r.name_he,
    r.region_he ? `אזור: ${r.region_he}` : r.area_he ? `אזור: ${r.area_he}` : "",
    r.difficulty ? `דרגת קושי: ${r.difficulty}` : "",
    r.distance_km != null ? `אורך: ${r.distance_km} ק"מ` : "",
    (r.seasons || []).length ? `עונה: ${r.seasons.join(", ")}` : "",
    (r.features_he || []).length ? `מאפיינים: ${r.features_he.join(", ")}` : "",
    (r.features || []).join(", "),
    r.description_he || "",
  ];
  return parts.filter(Boolean).join(". ");
}

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
const clean = raw.filter((r) => !r._error && r.name_he);
const embeddings = await embedAll(clean);

const rows = clean.map((r, i) => ({
  id: ID_OFFSET + parseInt(String(r.id).split("-").pop(), 10),
  source: "nakeb",
  name_he: r.name_he,
  subtitle: null,
  slug: null,
  url: r.url || null,
  description_he: r.description_he || null,
  waze_link: r.waze_link || null,
  lat: r.lat ?? null,
  lng: r.lng ?? null,
  difficulty: r.difficulty || null,
  difficulty_level: r.difficulty_level ?? null,
  distance_km: r.distance_km ?? null,
  duration: null,
  trail_map_image: r.trail_map_image || null,
  area_he: r.area_he || null,
  area_en: r.area_en || null,
  region_he: r.region_he || null,
  subregion_he: null,
  city_he: null,
  features: r.features?.length ? r.features : null,
  features_he: r.features_he?.length ? r.features_he : null,
  author: null,
  date_modified: null,
  embedding: embeddings.get(i) ?? null,
}));

console.log(`Seeding ${rows.length} Nakeb trails…`);
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
