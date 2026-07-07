// End-to-end proof of the anti-hallucination cycle, with a scripted model:
// the "model" presents an invented trail → the catalog gate rejects it with a
// structured error → the model retries with a real trail → the user receives
// ONLY the valid itinerary. OpenAI and the tool layer are mocked; the loop,
// gates, and event stream are the real production code.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

vi.mock("../../agent/tools", () => ({
  TOOL_SCHEMAS: [],
  executeTool: vi.fn(),
}));

import { chatService } from "./chat.service";
import { executeTool } from "../../agent/tools";

// One streamed model turn that makes a single tool call.
function modelTurn(name: string, args: unknown) {
  return (async function* () {
    yield {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: `call-${name}-${Math.random()}`, function: { name, arguments: JSON.stringify(args) } },
            ],
          },
        },
      ],
    };
  })();
}

const FAKE_DAYS = [{ day_number: 1, trail: { name: "Metula Scenic Trail" } }];
const REAL_DAYS = [{ day_number: 1, trail: { name: "Real Trail", tiuli_url: "https://tiuli.com/track/1" } }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("agent loop — hallucination gate cycle", () => {
  it("rejects an invented trail, feeds the error back, and only the corrected itinerary reaches the user", async () => {
    // Scripted conversation: search → present a FAKE trail → present the real one.
    const turns = [
      modelTurn("search_tiuli", { query: "galilee" }),
      modelTurn("present_itinerary", { title: "Trip", start_date: "2099-01-02", days: FAKE_DAYS }),
      modelTurn("present_itinerary", { title: "Trip", start_date: "2099-01-02", days: REAL_DAYS }),
    ];
    createMock.mockImplementation(async () => turns.shift());

    vi.mocked(executeTool).mockImplementation(async (name, args) =>
      name === "search_tiuli"
        ? { trails: [{ name: "Real Trail", tiuli_url: "https://tiuli.com/track/1" }] }
        : { itinerary: args },
    );

    const events: any[] = [];
    for await (const e of chatService.run([{ role: "user", content: "plan a day in the galilee" }])) {
      events.push(e);
    }

    // The user got exactly one itinerary — the corrected one. The fake trail
    // never surfaced in any event.
    const itineraries = events.filter((e) => e.type === "itinerary");
    expect(itineraries).toHaveLength(1);
    expect(itineraries[0].data.days[0].trail.name).toBe("Real Trail");
    expect(JSON.stringify(events)).not.toContain("Metula");

    // The rejection round-tripped through the model: the third model call saw
    // a structured error naming the invented trail and demanding a re-search.
    expect(createMock).toHaveBeenCalledTimes(3);
    const thirdCallMessages = createMock.mock.calls[2][0].messages;
    const rejection = thirdCallMessages.find(
      (m: any) => m.role === "tool" && String(m.content).includes("Rejected"),
    );
    expect(rejection).toBeDefined();
    expect(String(rejection.content)).toContain("Metula Scenic Trail");

    // And the cycle is observable: the gate logged the rejection.
    const warnLines = vi.mocked(console.warn).mock.calls.flat().join("\n");
    expect(warnLines).toContain("uncataloged_trails_rejected");
  });
});
