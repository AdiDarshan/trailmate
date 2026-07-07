// "hiking-safety" skill — Israeli seasonal and safety know-how. The content
// block only routes; the substance lives in references pulled on demand
// (progressive disclosure keeps the base prompt lean).

import type { Skill } from "./index";

const content = `
Safety and seasons:
- Before finalizing any plan, sanity-check it against the season and forecast.
  For hazard rules (heat, flash floods, winter daylight, reserve restrictions)
  read_reference("hiking-safety/hazards"); for which regions shine in which
  months read_reference("hiking-safety/seasons").
- Surface any relevant warning in the day's weather_note (e.g. heat, flood
  risk, early sunset) — omit it only when the day is genuinely benign.
`;

const hazardsReference = `
Hazard rules for Israeli trails:

- Heat (roughly June–September): desert and exposed routes are dangerous at
  midday. Recommend starting at first light and finishing by ~11:00, roughly
  1 liter of water per person per hour of hiking (3–4L/day in summer), hats
  and shade breaks. In a heat wave (שרב/hamsin), steer the user to shaded
  water hikes in the north or shorten the day — do not plan long exposed
  desert trails.
- Flash floods (roughly October–April): desert wadis and canyons (Judean
  Desert, Negev, Arava) can flood violently from rain falling far upstream —
  local sunshine is NOT safety. If rain is in the forecast anywhere near the
  region, do not plan narrow canyon or wadi routes that day; choose ridge or
  northern trails instead, and say why.
- Winter daylight (December–January): sunset is around 16:45. Plan days that
  end by ~16:00 and keep total distance realistic for the short light.
- Nature reserves: many forbid dogs (check before recommending a trail to a
  dog owner), fires are banned in season, and popular water hikes have
  entrance hours and last-entry cutoffs — recommend arriving early.
- Emergencies: police 100, ambulance 101. Cell coverage is patchy in canyons
  and remote desert — worth a heads-up on such routes.
`;

const seasonsReference = `
What is good when (rough guide):

- Winter (Dec–Feb): the desert and the south at their best — Negev, Eilat
  mountains, Judean Desert (mind flash-flood days). The north is green but
  muddy; streams run high.
- Spring (Feb–Apr): peak season everywhere. Wildflower bloom — red anemones
  in the northwestern Negev (Darom Adom, ~February), lupines and poppies
  further north into March–April.
- Summer (Jun–Sep): head north — shaded stream and water hikes in the Golan
  and Galilee (arrive early, they fill up). The desert is dangerous in the
  heat; avoid it except at dawn.
- Autumn (Oct–Nov): mild everywhere and uncrowded. First rains bring
  flash-flood awareness back for desert canyons.
`;

export const hikingSafetySkill: Skill = {
  name: "hiking-safety",
  content,
  references: {
    hazards: hazardsReference,
    seasons: seasonsReference,
  },
};
