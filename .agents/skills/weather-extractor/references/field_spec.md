# Weather Field Specification

Normalization rules for every field in `assets/weather.schema.json`. The
extractor (`scripts/extract.py`) MUST conform to these rules. Anything not
covered here that cannot be confirmed from the source becomes `null` —
never guessed, never fabricated.

## Field rules

- **`location`** — Free-form string (e.g. `"Lisbon, Portugal"`). `null` if
  the source does not name a place.
- **`temperature`** — Always **numeric** (`int` or `float`). Never a
  descriptive string like `"warm"` or `"hot"`. `null` if not present.
- **`feels_like`** — Always **numeric**. Same rules as `temperature`.
  `null` if not present.
- **`humidity`** — **Integer 0—100** (percent). Strip the `%`. `null`
  if not present.
- **`wind_speed`** — **Numeric, in km/h.** If the source reports mph, m/s,
  or knots, convert to km/h. If no unit is given and it cannot be inferred
  safely, set to `null`.
- **`condition`** — **Lowercase**, **one word** if possible (e.g.
  `"sunny"`, `"cloudy"`, `"rain"`, `"snow"`, `"thunderstorm"`). Collapse
  phrases like `"Partly Cloudy"` to a single canonical token (`"cloudy"`).
- **`forecast`** — **Max one sentence** summarizing the next ~24 hours.
  Trim whitespace, no trailing newline. `null` if not present.
- **`unit`** — The temperature unit used by `temperature` / `feels_like`
  (`"celsius"` or `"fahrenheit"`). `null` if it cannot be determined.
- **`source_url`** — **Required, never null.** The URL or local file path
  that the data was loaded from. Pass through verbatim.

## Hard rules

- Any field not found in the source -> `null`. **Never** guess or fabricate.
- Never substitute a string for a number (no `"warm"` in `temperature`).
- Never invent a `forecast` from current conditions alone.
- `source_url` is the only required field; the extractor fails loudly if it
  is missing.
