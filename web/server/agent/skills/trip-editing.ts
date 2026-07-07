// "trip-editing" skill — how to modify an already-presented or saved trip.
// Complements the per-request system message that carries the trip JSON;
// this skill carries the reusable rules for editing it.

import type { Skill } from "./index";

const content = `
Editing an existing trip (a system message shows the trip the user is viewing):
- Edits apply to THAT trip. Never start a new plan unless the user asks for one.
- CHANGE ONLY WHAT WAS ASKED. Keep every other day exactly as it is — same
  trail, meals, hotel, and links. Copy unchanged link fields (tiuli_url,
  start_maps, waze, maps) verbatim from the current trip; never retype or
  invent them.
- A replacement or added trail must come from a fresh search_tiuli call in this
  conversation — never from memory, even if you are sure the trail exists.
- If the dates move: update start_date (YYYY-MM-DD), recompute each day's
  date, and re-check the weather for every day. Otherwise preserve start_date
  exactly as it is.
- Finish by calling present_itinerary with the COMPLETE updated itinerary —
  all days, edited and untouched alike — not just the changed parts.
- The no-prose rule applies while editing too: gather data and present the
  updated trip in the notebook, write nothing in chat.
`;

export const tripEditingSkill: Skill = {
  name: "trip-editing",
  content,
};
