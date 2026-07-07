// Tool argument schemas — the single source of truth for what each tool
// accepts. Zod validates (and coerces) incoming tool-call args at runtime,
// and the SAME schemas generate the JSON Schema advertised to the model, so
// the contract we announce and the shape we enforce can never drift.
//
// Deliberately free of service imports (those pull in Supabase env checks)
// so this module is testable and usable anywhere.

import type OpenAI from "openai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { listReferences } from "./skills";

export const FEATURE_TAGS = [
  "water", "spring", "loop", "linear", "family", "kids", "stroller",
  "dog", "bike", "romantic", "urban", "serious_hikers", "viewpoint",
  "bloom", "beach", "picnic",
] as const;

const placeArgs = z.object({
  name: z.string().optional(),
  address: z.string().optional(),
  maps: z.string().optional(),
});

const trailArgs = z.object({
  name: z.string().optional(),
  distance_km: z.string().optional(),
  duration: z.string().optional(),
  difficulty: z.string().optional(),
  start_maps: z.string().optional(),
  waze: z.string().optional(),
  tiuli_url: z.string().optional(),
  description: z.string().optional(),
});

const dayArgs = z.object({
  day_number: z.coerce.number().int(),
  date: z.string().describe("e.g. 'Monday, June 23'"),
  weather: z.string().optional(),
  weather_note: z.string().optional().describe("Heat/rain/wind warning if any"),
  trail: trailArgs.nullish(),
  lunch: placeArgs.nullish(),
  dinner: placeArgs.nullish(),
  hotel: placeArgs.nullish(),
});

export const TOOL_SPECS = {
  search_tiuli: {
    description:
      "Search TrailMate's curated catalog of ~800 real Israeli hiking trails " +
      "(from tiuli.com and nakeb.co.il). PRIMARY trail source. Ranks by semantic " +
      "similarity to `query`, then narrows with optional hard filters. Put the " +
      "free-form intent (scenery, vibe, 'waterfall hike with shade') in `query`; put " +
      "measurable constraints in the filter params. `query` is matched semantically " +
      "in both Hebrew and English, but Hebrew place names still help (e.g. 'גליל'). " +
      "Each result includes region, difficulty_level (1-5), distance_km, and features. " +
      "If filters return nothing, relax them or use search_trails.",
    args: z.object({
      query: z.string().describe(
        "Free-form intent / scenery / trail name (Hebrew or English), e.g. " +
        "'שמורה עם מים ומפלים' or 'easy family loop near the Galilee'.",
      ),
      region: z.string().optional().describe(
        "Restrict to an area/region. Pass the MOST SPECIFIC place the user named " +
        "(e.g. 'Western Negev'/'נגב מערבי', not just 'Negev') — results are ranked " +
        "by how many of these words match, so specificity wins. English OR Hebrew " +
        "('Golan', 'North', 'גליל', 'הגולן'); the server resolves it. Omit to search everywhere.",
      ),
      max_km: z.coerce.number().optional().describe("Max trail length in km (e.g. 6 for a short hike)."),
      min_km: z.coerce.number().optional().describe("Min trail length in km."),
      difficulty_max: z.coerce.number().int().optional().describe(
        "Hardest acceptable level: 1=very easy, 2=easy, 3=moderate, 4=hard, 5=very hard.",
      ),
      features: z.array(z.enum(FEATURE_TAGS)).optional().describe(
        "Required features — a trail must have ALL of them (hard filter). Use for " +
        "firm must-haves; ALSO mention the feature in `query` so a matching-but-" +
        "untagged trail can still surface semantically.",
      ),
      limit: z.coerce.number().int().optional().describe("Max trails to return (default 5, cap 20)."),
    }),
  },

  search_trails: {
    description:
      "Secondary geographic trail search via the Israel Hiking Map / OpenStreetMap. " +
      "Use when the tiuli catalog has no good match for an area, or to get computed " +
      "distance, elevation, and difficulty for a named OSM trail. Results are " +
      "geographic CONTEXT only — they may not be presented as itinerary trails; " +
      "only search_tiuli results may.",
    args: z.object({
      query: z.string().describe("Trail or area name, e.g. 'Yehudiya', 'Arbel'."),
      max: z.coerce.number().int().optional().describe("Max trails (default 3, cap 5)."),
      language: z.enum(["en", "he"]).optional().describe("Search language. Default en."),
    }),
  },

  search_places: {
    description:
      "Find real restaurants, hotels, or attractions in an Israeli area via " +
      "OpenStreetMap. Returns names, addresses, and Google Maps links.",
    args: z.object({
      area: z.string().describe("Area or city in Israel, e.g. 'Tiberias'."),
      type: z.enum(["restaurant", "hotel", "attraction"]).describe("What to search for."),
      max: z.coerce.number().int().optional().describe("Max results (default 5)."),
    }),
  },

  get_weather: {
    description:
      "Fetch a weather forecast for any location and date in Israel. Within 16 days " +
      "returns a live forecast; further out returns a historical proxy (same calendar " +
      "period, previous year) flagged 'historical: true'.",
    args: z.object({
      location: z.string().describe("City or region in Israel."),
      date: z.string().optional().describe("Trip start date YYYY-MM-DD. Omit for today."),
      days: z.coerce.number().int().optional().describe("Days to forecast (1–16). Default 3."),
    }),
  },

  read_reference: {
    description:
      "Read a skill reference file for extra detail (feature-tag glossary, region " +
      "aliases, itinerary field layout). Fetch only when you actually need the " +
      `detail. Available references: ${listReferences().join(", ")}.`,
    args: z.object({
      path: z.string().describe('Reference path, e.g. "trail-search/features".'),
    }),
  },

  present_itinerary: {
    description:
      "Present the completed trip itinerary so it renders in the notebook for the " +
      "user to review and Save. Call ONCE at the very end, after describing the trip " +
      "in chat. This does NOT save it — the user saves from the notebook. Always call " +
      "it even if some fields are missing.",
    args: z.object({
      title: z.string().describe("e.g. '2-Day Trip: Galilee'"),
      dates: z.string().optional().describe("Human display range, e.g. 'June 23–24, 2026'"),
      start_date: z.string().optional().describe(
        "Machine date of day 1 as YYYY-MM-DD (e.g. '2026-06-27'). Required for reminders.",
      ),
      days: z.array(dayArgs).describe("One entry per day."),
    }),
  },
} as const;

export type ToolName = keyof typeof TOOL_SPECS;
export type ToolArgs<K extends ToolName> = z.infer<(typeof TOOL_SPECS)[K]["args"]>;

/** OpenAI function schema generated from a tool's Zod spec. */
function toToolSchema(name: ToolName): OpenAI.Chat.Completions.ChatCompletionTool {
  const spec = TOOL_SPECS[name];
  const parameters = zodToJsonSchema(spec.args, { $refStrategy: "none" }) as Record<string, unknown>;
  delete parameters.$schema;
  return { type: "function", function: { name, description: spec.description, parameters } };
}

export const TOOL_SCHEMAS: OpenAI.Chat.Completions.ChatCompletionTool[] =
  (Object.keys(TOOL_SPECS) as ToolName[]).map(toToolSchema);
