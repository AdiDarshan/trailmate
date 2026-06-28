// Tool registry — name → ToolDef. The agent loop advertises every schema to
// OpenAI and dispatches calls by name.

import type { ToolDef } from "./types";
import { getWeather } from "./getWeather";
import { searchTiuli } from "./searchTiuli";
import { searchPlaces } from "./searchPlaces";
import { saveTrip } from "./saveTrip";
import { searchTrails } from "./searchTrails";

export const TOOLS: Record<string, ToolDef> = {
  search_tiuli: searchTiuli,
  search_trails: searchTrails,
  search_places: searchPlaces,
  get_weather: getWeather,
  save_trip: saveTrip,
};

export const TOOL_SCHEMAS = Object.values(TOOLS).map((t) => t.schema);

export async function executeTool(name: string, args: Record<string, any>): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) return { status: "error", message: `Unknown tool: ${name}` };
  try {
    return await tool.execute(args);
  } catch (e: any) {
    return { status: "error", message: String(e?.message ?? e) };
  }
}
