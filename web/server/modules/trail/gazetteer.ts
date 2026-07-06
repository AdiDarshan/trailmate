// Place gazetteer: an English/alias → Hebrew search-token map for trail geography.
//
// The value is deliberately a *substring* of the catalog's area_he / region_he /
// subregion_he values, so match_trails' `ILIKE '%token%'` resolves it to the right
// trails (e.g. "golan" → "גולן", which lives inside region_he
// "גליל עליון אצבע הגליל והגולן"). This keeps place knowledge in one deterministic
// table instead of relying on the LLM to recall exact Hebrew strings.
//
// Keys are matched case-insensitively after stripping a leading "the ". Unknown
// inputs (including Hebrew place names the user already typed) pass through
// unchanged — Hebrew matches the ILIKE directly.

export const PLACE_GAZETTEER: Record<string, string> = {
  // ── Areas (area_he) ──
  north: "צפון",
  south: "דרום",
  center: "מרכז",
  central: "מרכז",
  jerusalem: "ירושלים",

  // ── Galilee + Golan (region_he: גליל …/…והגולן) ──
  galilee: "גליל",
  "upper galilee": "גליל עליון",
  "lower galilee": "גליל תחתון",
  "western galilee": "גליל מערבי",
  golan: "גולן",
  "golan heights": "גולן",
  gilboa: "גלבוע",

  // ── Carmel / Haifa (region_he: חיפה והכרמל) ──
  carmel: "כרמל",
  haifa: "חיפה",

  // ── Dead Sea / Judean Desert (region_he: ים המלח ומדבר יהודה) ──
  "dead sea": "ים המלח",
  "judean desert": "מדבר יהודה",

  // ── Negev / Eilat / craters (region_he: …הנגב…/…והמכתשים/והרי אילת) ──
  negev: "נגב",
  eilat: "אילת",
  ramon: "מכתש",
  makhtesh: "מכתש",
  crater: "מכתש",

  // ── Jerusalem area / Shephelah / Sharon / coast / Samaria ──
  "jerusalem hills": "הרי ירושלים",
  "beit shemesh": "בית שמש",
  shephelah: "שפלה",
  lowlands: "שפלה",
  sharon: "שרון",
  "coastal plain": "מישור החוף",
  "gush dan": "גוש דן",
  "tel aviv": "גוש דן",
  samaria: "שומרון",
};

/**
 * Normalize a user/agent-supplied place into a Hebrew token match_trails can match.
 * English aliases map to their Hebrew token; anything unknown (e.g. a Hebrew place
 * name, or a specific city) is returned trimmed and unchanged so the ILIKE still runs.
 */
export function normalizeRegion(input?: string): string | undefined {
  if (!input) return undefined;
  const key = input.trim().toLowerCase().replace(/^the\s+/, "");
  if (!key) return undefined;
  return PLACE_GAZETTEER[key] ?? input.trim();
}
