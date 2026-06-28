// Tool registry — the LLM-facing layer. Each tool is a thin adapter: an OpenAI
// function schema plus an `execute` that just delegates to a service method.
// All business logic lives in the services; this file only maps names → calls.

import type OpenAI from "openai";
import { trailService } from "../modules/trail/trail.service";
import { placeService } from "../modules/place/place.service";
import { weatherService } from "../modules/weather/weather.service";
import { tripService } from "../modules/trip/trip.service";

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
          "(from tiuli.com), each with a Hebrew description, Waze link, trailhead " +
          "coordinates, difficulty, and duration. Primary trail source. The catalog " +
          "is Hebrew — pass Hebrew place names when possible (e.g. 'גליל', 'עין גדי').",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Trail name, region, or keyword (Hebrew preferred)." },
            limit: { type: "integer", description: "Max trails to return (default 5)." },
          },
          required: ["query"],
        },
      },
    },
    execute: (a) => trailService.searchCatalog(String(a.query ?? ""), Number(a.limit ?? 5)),
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

  save_trip: {
    schema: {
      type: "function",
      function: {
        name: "save_trip",
        description:
          "Save the completed trip itinerary so it renders in the notebook and gets a " +
          "shareable link. Call ONCE at the very end, after presenting the full itinerary. " +
          "Always call it even if some fields are missing.",
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
    execute: (a) => tripService.save(a),
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
