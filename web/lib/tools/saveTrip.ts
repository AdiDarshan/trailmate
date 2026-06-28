// saveTrip — persist the finished itinerary to Supabase and return a
// shareable tripId. Replaces the Python save_itinerary tool, which wrote a
// single local JSON file (single-user). Here each trip gets its own row.

import { nanoid } from "nanoid";
import { supabase } from "../supabase";
import type { ToolDef } from "./types";
import type { Itinerary } from "../types";

// The day schema mirrors the Python save_itinerary tool so the agent's
// output shape and the notebook UI stay aligned.
const dayItem = {
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

export const saveTrip: ToolDef = {
  schema: {
    type: "function",
    function: {
      name: "save_trip",
      description:
        "Save the completed trip itinerary so it renders in the notebook and " +
        "gets a shareable link. Call ONCE at the very end, after presenting the " +
        "full itinerary. Always call it even if some fields are missing — omit " +
        "unavailable fields rather than skipping the call.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "e.g. '2-Day Trip: Galilee'" },
          dates: { type: "string", description: "e.g. 'June 23–24, 2026'" },
          days: { type: "array", description: "One entry per day.", items: dayItem },
        },
        required: ["title", "days"],
      },
    },
  },
  async execute(args: Record<string, any>) {
    const itinerary: Itinerary = {
      title: String(args.title ?? "Your Trip"),
      dates: args.dates ? String(args.dates) : undefined,
      days: Array.isArray(args.days) ? args.days : [],
    };
    const id = nanoid(10);
    const { error } = await supabase.from("trips").insert({
      id,
      title: itinerary.title,
      dates: itinerary.dates ?? null,
      data: itinerary,
    });
    if (error) return { status: "error", message: error.message };
    return { status: "success", trip_id: id };
  },
};
