// "trail-search" skill — how to find trails with search_tiuli / search_trails.
// The `content` block is always in the system prompt; `references` are pulled
// on demand via the read_reference tool (progressive disclosure).

import { PLACE_GAZETTEER } from "../../modules/trail/gazetteer";
import type { Skill } from "./index";

const content = `
Finding trails:
- search_tiuli: your PRIMARY trail source — a curated catalog of ~800 real
  Israeli trails (Tiuli + Nakeb), ranked by semantic match with optional filters.
  Put the user's INTENT/scenery in \`query\` (Hebrew or English both work), and
  put measurable constraints in the filters: region (English or Hebrew — pass the
  MOST SPECIFIC place said, e.g. 'נגב מערבי' not just 'נגב'; the server resolves it),
  max_km/min_km for length, difficulty_max (1=very easy … 5=very hard), and features
  (water, loop, family, dog, bike, stroller, viewpoint, romantic, …). For a firm
  must-have, set it in \`features\` AND mention it in \`query\` (so an untagged-but-
  matching trail still surfaces). E.g. 'short easy family hike with water in the
  Galilee' → query:'משפחתי עם מים', region:'גליל', max_km:6, difficulty_max:2,
  features:['family','water']. If a filtered search returns nothing, loosen the
  filters before falling back to search_trails.
- search_trails: secondary geographic search (OpenStreetMap) for trails by
  area when the catalog has no good match, or to get distance/elevation.
- For the full feature-tag glossary read_reference("trail-search/features");
  for the region names the server resolves read_reference("trail-search/regions").
`;

const featuresReference = `
Feature tags accepted by search_tiuli's \`features\` filter (a trail must have
ALL listed tags — it's a hard filter):

- water: the trail has water on route — a stream, pools, or wading sections.
- spring: passes a natural spring (עין); often swimmable in season.
- loop: circular route — ends where it starts (no car shuttle needed).
- linear: point-to-point route — plan a pickup or two cars.
- family: suitable for families with children.
- kids: easy enough for young children specifically.
- stroller: passable with a stroller / wheelchair-friendly surface.
- dog: dogs allowed (many nature reserves forbid them — check when unsure).
- bike: rideable by bicycle.
- romantic: scenic, quiet, couple-friendly.
- urban: in or at the edge of a city.
- serious_hikers: demanding — length, climb, or scrambling; not for beginners.
- viewpoint: notable lookout(s) on route.
- bloom: seasonal wildflower bloom (typically Feb–Apr).
- beach: on or reaching the coast.
- picnic: picnic areas at or along the trail.

Remember: also state the must-have in \`query\` so semantically-matching but
untagged trails can still surface.
`;

// Rendered straight from the gazetteer so this reference can never drift from
// what the server actually resolves.
const regionsReference =
  `English region aliases search_tiuli resolves server-side (case-insensitive,\n` +
  `a leading "the" is ignored). Hebrew input and unlisted places pass through\n` +
  `to a substring match, so specific Hebrew names also work:\n\n` +
  Object.entries(PLACE_GAZETTEER)
    .map(([en, he]) => `- ${en} → ${he}`)
    .join("\n");

export const trailSearchSkill: Skill = {
  name: "trail-search",
  content,
  references: {
    features: featuresReference,
    regions: regionsReference,
  },
};
