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
pip install -r requirements.txt
```

### Run

```bash
python -m trailmate
```

### Run Tests

```bash
pytest
```

## Project Structure

```
TrailMate/
├── src/
│   └── trailmate/        # Main package
│       ├── __init__.py
│       ├── __main__.py   # Entry point: python -m trailmate
│       └── agent.py      # AI agent core
├── tests/                # Test suite
├── requirements.txt      # Runtime dependencies
├── requirements-dev.txt  # Development dependencies
├── pyproject.toml        # Project configuration
└── README.md
```

## License

TBD
