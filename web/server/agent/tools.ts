// Tool executors — binds each tool's validated arguments to a service call.
// Argument shapes and the schemas advertised to the model both come from
// ./tools.schemas (one Zod source of truth); this file only maps names → calls.
// All business logic lives in the services.

import { trailService } from "../modules/trail/trail.service";
import { placeService } from "../modules/place/place.service";
import { weatherService } from "../modules/weather/weather.service";
import { createLogger, errInfo } from "../shared/logger";
import { getReference, listReferences } from "./skills";
import { TOOL_SPECS, type ToolArgs, type ToolName } from "./tools.schemas";

export { TOOL_SCHEMAS } from "./tools.schemas";

const log = createLogger("agent.tools");

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

  search_places: (a) =>
    placeService.search(a.area, a.type, a.max ?? 5, {
      diet: a.diet,
      cuisine: a.cuisine,
      stayType: a.stay_type,
      minStars: a.min_stars,
    }),

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

// Every failure is BOTH logged (for ops) and returned as a structured
// `{status:"error"}` result (an observation the model can react to) — a tool
// call must never throw into the agent loop.
export async function executeTool(name: string, args: Record<string, any>): Promise<unknown> {
  if (!(name in TOOL_SPECS)) {
    log.warn("unknown_tool", { tool: name });
    return { status: "error", message: `Unknown tool: ${name}` };
  }
  const key = name as ToolName;

  // Validate + coerce through the same schema the model was shown. A failed
  // parse becomes a structured error the model can observe and retry on.
  const parsed = TOOL_SPECS[key].args.safeParse(args);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    log.warn("tool_args_invalid", { tool: name, issues });
    return { status: "error", message: `Invalid arguments for ${name}`, issues };
  }

  try {
    return await EXECUTORS[key](parsed.data as never);
  } catch (e) {
    // Args are model-generated and non-sensitive — logging them makes the
    // failure reproducible.
    log.error("tool_failed", { tool: name, args: parsed.data, ...errInfo(e) });
    return { status: "error", message: errInfo(e).error };
  }
}
