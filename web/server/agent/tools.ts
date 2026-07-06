// Tool registry — the LLM-facing layer. Each tool is a thin adapter: an OpenAI
// function schema plus an `execute` that just delegates to a service method.
// All business logic lives in the services; this file only maps names → calls.

import type OpenAI from "openai";
import { trailService } from "../modules/trail/trail.service";
import { placeService } from "../modules/place/place.service";
import { weatherService } from "../modules/weather/weather.service";

export interface ToolDef {
  schema: OpenAI.Chat.Completions.ChatCompletionTool;
  execute: (args: Record<string, any>) => Promise<unknown>;
}

const saveTripDayItem = {
  type: "object",
  properties: {
    day_number: { type: "integer" },
    date: { type: "string", description: "e.g. 'Monday, June 23'" },
    weather: { type: "string" },
    weather_note: { type: "string", description: "Heat/rain/wind warning if any" },
    trail: {
      type: "object",
      properties: {
        name: { type: "string" },
        distance_km: { type: "string" },
        duration: { type: "string" },
        difficulty: { type: "string" },
        start_maps: { type: "string" },
        waze: { type: "string" },
        tiuli_url: { type: "string" },
        description: { type: "string" },
      },
    },
    lunch: { type: "object", properties: { name: { type: "string" }, address: { type: "string" }, maps: { type: "string" } } },
    dinner: { type: "object", properties: { name: { type: "string" }, address: { type: "string" }, maps: { type: "string" } } },
    hotel: { type: "object", properties: { name: { type: "string" }, address: { type: "string" }, maps: { type: "string" } } },
  },
  required: ["day_number", "date"],
};

export const TOOLS: Record<string, ToolDef> = {
  search_tiuli: {
    schema: {
      type: "function",
      function: {
        name: "search_tiuli",
        description:
          "Search TrailMate's curated catalog of 348 real Israeli hiking trails " +
          "(from tiuli.com). PRIMARY trail source. Ranks by semantic similarity to " +
          "`query`, then narrows with optional hard filters. Put the free-form intent " +
          "(scenery, vibe, 'waterfall hike with shade') in `query`; put measurable " +
          "constraints in the filter params. `query` is matched semantically in both " +
          "Hebrew and English, but Hebrew place names still help (e.g. 'גליל', 'עין גדי'). " +
          "Each result includes region, difficulty_level (1-5), distance_km, and features. " +
          "If filters return nothing, relax them or use search_trails.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Free-form intent / scenery / trail name (Hebrew or English), e.g. " +
                "'שמורה עם מים ומפלים' or 'easy family loop near the Galilee'.",
            },
            region: {
              type: "string",
              description:
                "Restrict to an area/region. Pass the place the user named, in English " +
                "OR Hebrew — 'Golan', 'North', 'Western Galilee', 'Negev', 'גליל', 'הגולן'. " +
                "The server resolves it to the catalog's geography. Omit to search everywhere.",
            },
            max_km: { type: "number", description: "Max trail length in km (e.g. 6 for a short hike)." },
            min_km: { type: "number", description: "Min trail length in km." },
            difficulty_max: {
              type: "integer",
              description: "Hardest acceptable level: 1=very easy, 2=easy, 3=moderate, 4=hard, 5=very hard.",
            },
            features: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "water", "spring", "loop", "linear", "family", "kids", "stroller",
                  "dog", "bike", "romantic", "urban", "serious_hikers", "viewpoint",
                  "bloom", "beach", "picnic",
                ],
              },
              description: "Required features — a trail must have ALL of them.",
            },
            limit: { type: "integer", description: "Max trails to return (default 5, cap 20)." },
          },
          required: ["query"],
        },
      },
    },
    execute: (a) =>
      trailService.searchCatalog(String(a.query ?? ""), {
        region: a.region ? String(a.region) : undefined,
        maxKm: a.max_km != null ? Number(a.max_km) : undefined,
        minKm: a.min_km != null ? Number(a.min_km) : undefined,
        difficultyMax: a.difficulty_max != null ? Number(a.difficulty_max) : undefined,
        features: Array.isArray(a.features) ? a.features.map(String) : undefined,
        limit: a.limit != null ? Number(a.limit) : undefined,
      }),
  },

  search_trails: {
    schema: {
      type: "function",
      function: {
        name: "search_trails",
        description:
          "Secondary geographic trail search via the Israel Hiking Map / OpenStreetMap. " +
          "Use when the tiuli catalog has no good match for an area, or to get computed " +
          "distance, elevation, and difficulty for a named OSM trail.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Trail or area name, e.g. 'Yehudiya', 'Arbel'." },
            max: { type: "integer", description: "Max trails (default 3, cap 5)." },
            language: { type: "string", enum: ["en", "he"], description: "Search language. Default en." },
          },
          required: ["query"],
        },
      },
    },
    execute: (a) =>
      trailService.searchOSM(String(a.query ?? ""), Number(a.max ?? 3), a.language === "he" ? "he" : "en"),
  },

  search_places: {
    schema: {
      type: "function",
      function: {
        name: "search_places",
        description:
          "Find real restaurants, hotels, or attractions in an Israeli area via " +
          "OpenStreetMap. Returns names, addresses, and Google Maps links.",
        parameters: {
          type: "object",
          properties: {
            area: { type: "string", description: "Area or city in Israel, e.g. 'Tiberias'." },
            type: { type: "string", enum: ["restaurant", "hotel", "attraction"], description: "What to search for." },
            max: { type: "integer", description: "Max results (default 5)." },
          },
          required: ["area", "type"],
        },
      },
    },
    execute: (a) => placeService.search(String(a.area ?? ""), String(a.type ?? "restaurant"), Number(a.max ?? 5)),
  },

  get_weather: {
    schema: {
      type: "function",
      function: {
        name: "get_weather",
        description:
          "Fetch a weather forecast for any location and date in Israel. Within 16 days " +
          "returns a live forecast; further out returns a historical proxy (same calendar " +
          "period, previous year) flagged 'historical: true'.",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string", description: "City or region in Israel." },
            date: { type: "string", description: "Trip start date YYYY-MM-DD. Omit for today." },
            days: { type: "integer", description: "Days to forecast (1–16). Default 3." },
          },
          required: ["location"],
        },
      },
    },
    execute: (a) => weatherService.forecast(String(a.location ?? ""), a.date ? String(a.date) : undefined, Number(a.days ?? 3)),
  },

  present_itinerary: {
    schema: {
      type: "function",
      function: {
        name: "present_itinerary",
        description:
          "Present the completed trip itinerary so it renders in the notebook for the " +
          "user to review and Save. Call ONCE at the very end, after describing the trip " +
          "in chat. This does NOT save it — the user saves from the notebook. Always call " +
          "it even if some fields are missing.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "e.g. '2-Day Trip: Galilee'" },
            dates: { type: "string", description: "Human display range, e.g. 'June 23–24, 2026'" },
            start_date: {
              type: "string",
              description: "Machine date of day 1 as YYYY-MM-DD (e.g. '2026-06-27'). Required for reminders.",
            },
            days: { type: "array", description: "One entry per day.", items: saveTripDayItem },
          },
          required: ["title", "days"],
        },
      },
    },
    // No persistence — just echo the structured itinerary back to the loop,
    // which streams it to the browser for preview.
    execute: async (a) => ({
      itinerary: {
        title: String(a.title ?? "Your Trip"),
        dates: a.dates ? String(a.dates) : undefined,
        start_date: a.start_date ?? undefined,
        days: Array.isArray(a.days) ? a.days : [],
      },
    }),
  },
};

export const TOOL_SCHEMAS = Object.values(TOOLS).map((t) => t.schema);

// Planning tools — used by the chat service to decide whether to force a
// save_trip the model forgot to call.
export const PLANNING_TOOLS = new Set(["search_tiuli", "search_trails", "search_places"]);

export async function executeTool(name: string, args: Record<string, any>): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) return { status: "error", message: `Unknown tool: ${name}` };
  try {
    return await tool.execute(args);
  } catch (e: any) {
    return { status: "error", message: String(e?.message ?? e) };
  }
}
