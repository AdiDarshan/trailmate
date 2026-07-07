// Structured standing preferences — the "one tap" model from the redesign.
// Picks serialize into the single user_prefs.preferences text field the agent
// already consumes (readable English, stable labels), and parse back for the
// UI. Legacy free text saved by the old textarea round-trips into `extra`.

export interface PrefPicks {
  difficulty: string | null;
  length: string | null;
  diet: string | null;
  stay: string | null;
  extra: string;
}

export const EMPTY_PICKS: PrefPicks = {
  difficulty: null,
  length: null,
  diet: null,
  stay: null,
  extra: "",
};

// value = what's stored/shown to the agent; label = the chip text.
export const PREF_OPTIONS = {
  difficulty: [
    { value: "easy", label: "Easy" },
    { value: "moderate", label: "Moderate" },
    { value: "challenging", label: "Challenging" },
  ],
  length: [
    { value: "under 5 km", label: "Under 5 km" },
    { value: "5-10 km", label: "5–10 km" },
    { value: "over 10 km", label: "10 km +" },
  ],
  diet: [
    { value: "kosher", label: "Kosher" },
    { value: "vegetarian", label: "Vegetarian" },
    { value: "vegan", label: "Vegan" },
    { value: "anything", label: "Anything" },
  ],
  stay: [
    { value: "hotel", label: "Hotel" },
    { value: "guesthouse", label: "Guesthouse" },
    { value: "camping", label: "Camping" },
  ],
} as const;

export type PrefKey = keyof typeof PREF_OPTIONS;

// Serialization labels — also the parse anchors, so they must stay stable.
const LABELS: Array<[PrefKey, string]> = [
  ["difficulty", "Trail difficulty"],
  ["length", "Trail length"],
  ["diet", "Diet"],
  ["stay", "Stay"],
];

/** Compose picks + free text into the agent-facing preferences string. */
export function serializePrefs(p: PrefPicks): string {
  const parts: string[] = [];
  for (const [key, label] of LABELS) {
    if (p[key]) parts.push(`${label}: ${p[key]}`);
  }
  if (p.extra.trim()) parts.push(`Also: ${p.extra.trim()}`);
  return parts.join(". ");
}

/**
 * Parse a stored preferences string back into picks. Unknown option values are
 * dropped (they can't render as a chip); text with none of our labels — e.g.
 * saved by the old free-text panel — lands wholesale in `extra`.
 */
export function parsePrefs(text: string): PrefPicks {
  const picks: PrefPicks = { ...EMPTY_PICKS };
  const trimmed = text.trim();
  if (!trimmed) return picks;

  let matchedAny = false;
  let rest = trimmed;

  // "Also:" runs to the end of the string (free text may contain periods).
  const also = rest.match(/(?:^|\.\s*)Also:\s*([\s\S]+)$/);
  if (also) {
    picks.extra = also[1].trim();
    rest = rest.slice(0, also.index).trim();
    matchedAny = true;
  }

  for (const [key, label] of LABELS) {
    const m = rest.match(new RegExp(`${label}: ([^.]+)`));
    if (!m) continue;
    const value = m[1].trim();
    if (PREF_OPTIONS[key].some((o) => o.value === value)) {
      picks[key] = value;
      matchedAny = true;
    }
  }

  if (!matchedAny) picks.extra = trimmed;
  return picks;
}

/** How many preferences are set — drives the sidebar "N SET" badge. */
export function countSetPrefs(p: PrefPicks): number {
  return LABELS.filter(([key]) => p[key]).length + (p.extra.trim() ? 1 : 0);
}
