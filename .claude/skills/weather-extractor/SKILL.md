---
name: weather-extractor
description: >
  Extract normalized weather data (temperature, humidity, wind, condition,
  forecast) from a raw source — URL or pasted text — and validate it
  against the schema. Use whenever the agent encounters raw weather text, is
  asked to "get/parse/extract the weather", or needs structured weather data
  for any downstream task.
---

# Weather Extractor

## When to use
- User pastes raw weather text or a weather page URL
- User asks "what's the weather in X" and provides a source
- Agent needs structured weather fields for a report or decision

## Procedure
1. Run `scripts/extract.py <source>` to get structured fields.
   Do NOT re-implement parsing inline — the script is the source of truth.
2. Validate the result against `assets/weather.schema.json`.
3. If any field is missing/ambiguous, read `references/field_spec.md`
   for normalization rules — do not guess.
4. Return the validated object. Never fabricate a missing field; mark it null.

---

## Audit tests — verify these before finishing:
should-trigger:    "Here's a weather page — pull out the temperature and humidity."
should-NOT-trigger: "Explain how meteorology works." (shares keywords, wrong intent)

## Verify:
1. Does the agent run scripts/extract.py or write its own parsing?
2. Are null fields returned as null and not fabricated?
