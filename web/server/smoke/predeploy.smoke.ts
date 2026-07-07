// Pre-deploy smoke: exercises the paths unit tests deliberately leave to real
// integrations — the Supabase connection and a full agent turn through the
// OpenAI streaming loop (which also drives tool dispatch and catalog search).
//
// Run with `npm run smoke`. Read-only: no rows are written.

import { describe, expect, it } from "vitest";
import { supabase } from "../db/supabase";
import { chatService, type AgentEvent } from "../modules/chat/chat.service";

describe("pre-deploy smoke (real dependencies)", () => {
  it("reaches Supabase and the trails catalog is non-empty", async () => {
    const { data, error } = await supabase.from("trails").select("id").limit(1);
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it("completes a real agent turn and produces a usable answer", async () => {
    const events: AgentEvent[] = [];
    for await (const event of chatService.run(
      [{ role: "user", content: "Suggest one easy day hike near Jerusalem. Keep it brief." }],
      null,
    )) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain("done");
    expect(types).not.toContain("error");

    // A usable answer is either streamed prose or a presented itinerary.
    const text = events
      .filter((e): e is Extract<AgentEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.v)
      .join("");
    const hasItinerary = types.includes("itinerary");
    expect(text.length > 20 || hasItinerary).toBe(true);
  });
});
