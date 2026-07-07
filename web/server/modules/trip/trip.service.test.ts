// extractSavedTrailRefs: the pure "what has this user already hiked" step.
// DB/telegram deps are mocked out — importing trip.service must not touch env.

import { describe, expect, it, vi } from "vitest";

vi.mock("./trip.dbservice", () => ({ tripDbService: {} }));
vi.mock("../telegram/telegram.dbservice", () => ({ telegramDbService: {} }));
vi.mock("../telegram/telegram.service", () => ({ telegramService: {} }));

import { extractSavedTrailRefs } from "./trip.service";
import type { Itinerary } from "../../shared/types";

const trip = (...trails: Array<{ name?: string; tiuli_url?: string } | null>): Itinerary =>
  ({
    title: "t",
    days: trails.map((trail, i) => ({ day_number: i + 1, trail })),
  }) as Itinerary;

describe("extractSavedTrailRefs", () => {
  it("collects unique names and tiuli urls across trips", () => {
    const refs = extractSavedTrailRefs([
      trip({ name: "Nahal Amud", tiuli_url: "https://tiuli.com/track/123" }, null),
      trip({ name: "nahal amud " }, { name: "Masada", tiuli_url: "https://tiuli.com/track/9" }),
    ]);
    expect(refs.names).toEqual(["Nahal Amud", "Masada"]); // deduped case/space-insensitively
    expect(refs.urls).toEqual(["https://tiuli.com/track/123", "https://tiuli.com/track/9"]);
  });

  it("handles empty input and days without trails", () => {
    expect(extractSavedTrailRefs([])).toEqual({ names: [], urls: [] });
    expect(extractSavedTrailRefs([trip(null, {})])).toEqual({ names: [], urls: [] });
  });
});
