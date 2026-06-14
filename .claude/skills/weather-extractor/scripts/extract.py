"""Weather extractor.

Usage:
    python extract.py <source>

Where <source> is either an http(s) URL or a path to a local file containing
raw weather text or HTML. The script fetches the raw content, asks an LLM to
extract a fixed set of weather fields, and prints the structured result as
JSON matching ``assets/weather.schema.json``.

Missing fields are emitted as ``null`` — never guessed, never fabricated.
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

import requests
from dotenv import load_dotenv
from openai import OpenAI

# Load OPENAI_API_KEY (and anything else) from a .env file in the project root.
# Safe to call even if no .env exists — it's a no-op in that case.
load_dotenv()

# Resolve the sibling assets/ directory relative to this script so the schema
# can be embedded into the LLM prompt verbatim. This keeps the schema file as
# the single source of truth for the field shape.
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "assets" / "weather.schema.json"
SCHEMA_TEXT = SCHEMA_PATH.read_text(encoding="utf-8")

# Strict system prompt — the model is told exactly which fields to return
# and that unknown fields must be null. We pass the schema text inline so the
# model has the contract right next to the instruction.
SYSTEM_PROMPT = (
    "Extract weather data from the text. "
    "Return ONLY valid JSON matching this schema: "
    f"{SCHEMA_TEXT} "
    "If a field is not present, set it to null. Never guess."
)


@dataclass
class Weather:
    """Structured weather record. Mirrors ``assets/weather.schema.json``."""

    location: str | None
    temperature: float | None
    feels_like: float | None
    humidity: int | None
    wind_speed: float | None
    condition: str | None
    forecast: str | None
    unit: str | None
    source_url: str


def fetch_raw(source: str) -> str:
    """Load raw weather text/HTML from a URL or file path."""
    # HTTP(S) source: fetch over the network and return the response body.
    if source.startswith(("http://", "https://")):
        response = requests.get(source, timeout=30)
        response.raise_for_status()
        return response.text

    # Otherwise treat the argument as a local file path and read its contents.
    return Path(source).read_text(encoding="utf-8")


def parse(raw: str, source_url: str) -> Weather:
    """Best-effort structured extraction. Unknown fields -> None, never guessed."""
    # Lazily construct the OpenAI client so importing this module never hits
    # the network (helpful for tests). The client picks up OPENAI_API_KEY from
    # the environment, which python-dotenv populated above.
    client = OpenAI()

    # Ask the model for a JSON object. response_format=json_object guarantees
    # the response body is parseable JSON — we still validate the shape
    # after.
    response = client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": raw},
        ],
    )

    # Pull the raw JSON string out of the choice and decode it into a dict.
    content = response.choices[0].message.content or "{}"
    data = json.loads(content)

    # Coerce types defensively. The model is instructed to return numbers for
    # numeric fields, but if it returns a numeric string we still want a
    # number; if it returns anything truly non-numeric we fall back to None
    # rather than corrupting the schema.
    def _num(value: object) -> float | None:
        if value is None:
            return None
        try:
            return float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None

    def _int(value: object) -> int | None:
        n = _num(value)
        return int(n) if n is not None else None

    def _str(value: object) -> str | None:
        if value is None:
            return None
        return str(value)

    # Build the dataclass. source_url is always the caller-supplied value —
    # we never let the model overwrite where the data actually came from.
    return Weather(
        location=_str(data.get("location")),
        temperature=_num(data.get("temperature")),
        feels_like=_num(data.get("feels_like")),
        humidity=_int(data.get("humidity")),
        wind_speed=_num(data.get("wind_speed")),
        condition=_str(data.get("condition")),
        forecast=_str(data.get("forecast")),
        unit=_str(data.get("unit")),
        source_url=source_url,
    )


def to_json(weather: Weather) -> str:
    """Serialize to match assets/weather.schema.json exactly."""
    # asdict() preserves field order from the dataclass definition, which we
    # deliberately laid out to match the schema. indent=2 for human readers.
    return json.dumps(asdict(weather), indent=2, ensure_ascii=False)


def main(argv: list[str]) -> int:
    # Expect exactly one positional argument: the source URL or file path.
    if len(argv) < 2:
        print("usage: extract.py <url-or-path>", file=sys.stderr)
        return 2

    source = argv[1]

    # 1. Fetch raw text/HTML from the source.
    raw = fetch_raw(source)

    # 2. Ask the model to extract structured fields.
    weather = parse(raw, source_url=source)

    # 3. Print the JSON result on stdout — this is the script's contract.
    print(to_json(weather))

    # 4. Warn (on stderr, so stdout stays clean JSON) about any null fields.
    #    source_url is required by the schema and must never be null; every
    #    other field is allowed to be null when absent from the source.
    null_fields = [
        name
        for name, value in asdict(weather).items()
        if value is None and name != "source_url"
    ]
    if null_fields:
        print(
            f"warning: missing fields in source — {', '.join(null_fields)}",
            file=sys.stderr,
        )
    if not weather.source_url:
        print("warning: source_url is required but was empty", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
