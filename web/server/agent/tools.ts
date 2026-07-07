// Tool executors — binds each tool's validated arguments to a service call.
// Argument shapes and the schemas advertised to the model both come from
// ./tools.schemas (one Zod source of truth); this file only maps names → calls.
// All business logic lives in the services.

import { trailService } from "../modules/trail/trail.service";
import { placeService } from "../modules/place/place.service";
import { weatherService } from "../modules/weather/weather.service";
import { getReference, listReferences } from "./skills";
import { TOOL_SPECS, type ToolArgs, type ToolName } from "./tools.schemas";

export { TOOL_SCHEMAS } from "./tools.schemas";

const EXECUTORS: { [K in ToolName]: (args: ToolArgs<K>) => Promise<unknown> } = {
  search_tiuli: (a) =>
    trailService.searchCatalog(a.query, {
      region: a.region,
      maxKm: a.max_km,
      minKm: a.min_km,
      difficultyMax: a.difficulty_max,
      features: a.features ? [...a.features] : undefined,
      limit: a.limit,
    }),

  search_trails: (a) => trailService.searchOSM(a.query, a.max ?? 3, a.language ?? "en"),

  search_places: (a) => placeService.search(a.area, a.type, a.max ?? 5),

  get_weather: (a) => weatherService.forecast(a.location, a.date, a.days ?? 3),

  read_reference: async (a) => {
    const content = getReference(a.path);
    if (content) return { path: a.path, content };
    return {
      status: "error",
      message: `Unknown reference: ${a.path}. Available: ${listReferences().join(", ")}`,
    };
  },

  // No persistence — just echo the structured itinerary back to the loop,
  // which streams it to the browser for preview.
  present_itinerary: async (a) => ({
    itinerary: {
      title: a.title,
      dates: a.dates,
      start_date: a.start_date,
      days: a.days,
    },
  }),
};

// Planning tools — used by the chat service to decide whether to force a
// save_trip the model forgot to call.
export const PLANNING_TOOLS = new Set(["search_tiuli", "search_trails", "search_places"]);

export async function executeTool(name: string, args: Record<string, any>): Promise<unknown> {
  if (!(name in TOOL_SPECS)) return { status: "error", message: `Unknown tool: ${name}` };
  const key = name as ToolName;

  // Validate + coerce through the same schema the model was shown. A failed
  // parse becomes a structured error the model can observe and retry on.
  const parsed = TOOL_SPECS[key].args.safeParse(args);
  if (!parsed.success) {
    return {
      status: "error",
      message: `Invalid arguments for ${name}`,
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }

  try {
    return await EXECUTORS[key](parsed.data as never);
  } catch (e: any) {
    return { status: "error", message: String(e?.message ?? e) };
  }
}
