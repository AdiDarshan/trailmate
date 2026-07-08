// "trip-planning" skill — the end-to-end workflow for building a day-by-day
// trip: region first, weather, places, and the present_itinerary contract.

import type { Skill } from "./index";

const content = `
Trip planning workflow:
- search_places: restaurants, hotels, attractions for the eat/sleep parts.
  Pass the user's standing preferences as filters — diet (kosher/vegetarian/
  vegan) for restaurants, stay_type for accommodation, cuisine when they named
  one. A filter_note in the result means nothing matched the filters: tell the
  user, and judge the unfiltered places by name/cuisine/description instead.
- get_weather: check proactively before recommending outdoor activity. If
  the result has historical:true, tell the user it's a climate proxy, not a
  forecast.
- present_itinerary: call ONCE at the very end to render the plan in the
  notebook for review. It does NOT save — the user saves from the notebook.
  Always include start_date (YYYY-MM-DD, the real calendar date of day 1).
  For the expected day-by-day field layout read_reference("trip-planning/itinerary-fields").

Rules:
- REGION FIRST: settle WHERE before recommending trails — every search_tiuli
  call should carry a \`region\`. If the user named or implied a place ('the Golan',
  'North', 'near Eilat', 'somewhere green'), use it. If it's unclear, ask ONE
  short question to pin the area down and stay in the conversation until you have
  it — do NOT plan a trip with no region yet.
- BUT don't nag: if the user says they don't mind / are flexible / 'you choose',
  pick a fitting region yourself from their other cues (season & weather,
  difficulty, water/shade/family, vibe), briefly tell them which you chose and
  why, then plan there. An invented region is fine when the user is indifferent.
- DATES: every trip must have a real start date — reminders depend on it. Settle
  it alongside the region: if the user gave no date, ask for one in the same
  short question. If they don't know or are flexible, use TOMORROW (you know
  today's date), tell them you assumed it, and remind them it's editable. Always
  pass start_date to present_itinerary.
- Once the region and basics are set, produce a concrete, day-by-day itinerary:
  trail, meals, weather per day — plus accommodation per the rule below.
- ACCOMMODATION: only for nights actually slept away. A single-day trip has NO
  hotel — the user sleeps at home, so skip the hotel search and omit the hotel
  field entirely; that is intentional, not missing data. On multi-day trips
  include a hotel for each night.
- MEAL VARIETY: never suggest the same restaurant twice in a trip — not for
  lunch and dinner on one day, not across days. Ask search_places for enough
  results to cover every meal (max = number of meals or more) and spread the
  picks. Only repeat a place when the search results genuinely offer no
  alternative in the area.
- WHILE BUILDING THE PLAN, WRITE NOTHING IN CHAT. Once you start gathering data
  and composing the trip, output no prose at all — no lead-in, no narration, no
  day-by-day text, no closing summary. The user sees a live checklist while you
  work and the finished trip in the notebook. Put the ENTIRE plan into the
  present_itinerary call and nothing into chat.
- Present every location as a Google Maps link: [📍 Name](https://www.google.com/maps?q=LAT,LNG).
  Never show raw coordinates.
- MANDATORY: whenever you present a day-by-day plan, you MUST call
  present_itinerary with the structured data as your final action. The plan
  does not appear in the user's notebook until you do. Never end a planning
  turn without it.
`;

const itineraryFieldsReference = `
present_itinerary day-item layout (per entry in \`days\`):

- day_number (integer, required): 1-based position in the trip.
- date (string, required): human-readable, e.g. 'Monday, June 23'.
- weather (string): short summary, e.g. 'Partly cloudy, 28°C'.
- weather_note (string): heat/rain/wind warning if any — omit when benign.
- trail (object): name, distance_km, duration, difficulty, start_maps
  (Google Maps URL of the trailhead), waze, tiuli_url, description.
  Copy link fields verbatim from the search results — never invent URLs.
- lunch / dinner / hotel (objects): name, address, maps (Google Maps URL).
  hotel only on multi-day trips — single-day trips omit it (user sleeps at home).

Top level: title (e.g. '2-Day Trip: Galilee'), dates (display range, e.g.
'June 23–24, 2026'), start_date (machine date of day 1, YYYY-MM-DD — required
for reminders), days (one entry per day).
`;

export const tripPlanningSkill: Skill = {
  name: "trip-planning",
  content,
  references: {
    "itinerary-fields": itineraryFieldsReference,
  },
};
