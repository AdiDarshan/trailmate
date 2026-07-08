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
- EVERY DAY GETS A DIFFERENT TRAIL. When adding a day, never reuse a trail
  that is already on the trip — search for a new one in the same area
  (trails already on the trip are filtered out of search results, so pick
  from what the search returns). Itineraries repeating a trail are rejected.
- MEALS FOLLOW THE SAME RULE: when adding a day or changing a meal, never
  reuse a restaurant that is already on the trip for another meal — search
  and pick a different one, unless the area genuinely has no alternative.
- If the dates move: update start_date (YYYY-MM-DD), recompute each day's
  date, and re-check the weather for every day. Otherwise preserve start_date
  exactly as it is.
- REFINE REQUESTS APPLY DIRECTLY: when the user asks to refine or change a
  section (the hike, where to eat, where to sleep), search, PICK the best
  match yourself, and present the updated trip. NEVER list candidates in chat
  and ask the user to choose — the refined result belongs in the notebook,
  where the user can hit Refine again if your pick misses. Only if the search
  returns nothing usable may you answer in chat, saying briefly what you tried.
- Finish by calling present_itinerary with the COMPLETE updated itinerary —
  all days, edited and untouched alike — not just the changed parts. A refine
  turn that changed anything MUST end with this call, or the user sees nothing.
- The no-prose rule applies while editing too: gather data and present the
  updated trip in the notebook, write nothing in chat.
`;

export const tripEditingSkill: Skill = {
  name: "trip-editing",
  content,
};
