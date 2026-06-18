# TrailMate

An AI agent that helps you plan your trips.

## Overview

TrailMate is your intelligent travel companion. Give it your preferences, dates,
and destination ideas — it will help you design itineraries, surface recommendations,
and keep your plans organized.

## Project Status

This project is in its initial scaffolding stage.

## Getting Started

### Prerequisites

- Python 3.10+
- `pip` (or `uv` / `pipx`)

### Setup

Create and activate a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -e ".[dev]"
```

### Run (CLI)

```bash
python -m trailmate
```

### Run (UI)

```bash
streamlit run src/trailmate/ui/app.py
```

### Run Tests

```bash
pytest
```

## Project Structure

```
TrailMate/
├── src/
│   └── trailmate/
│       ├── ui/
│       │   └── app.py          # Streamlit chat UI
│       ├── __init__.py
│       ├── __main__.py         # Entry point: python -m trailmate
│       ├── agent_harness.py    # Bounded OpenAI chat loop
│       ├── context_manager.py  # Token accounting + compaction
│       └── tool_registry.py    # Tool definitions + dispatch
├── tests/
├── docs/
├── pyproject.toml              # Dependencies + project config
└── README.md
```

## License

TBD
