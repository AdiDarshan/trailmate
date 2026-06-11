---
name: project-bootstrap
description: >
  Scaffold a new feature, module, or subpackage for TrailMate with the
  correct src-layout, Python 3.10+ stack, and house conventions
  (type-hinted public APIs, dataclasses, pytest mirroring, dotenv-only
  secrets). Use whenever the user starts a new piece of work in this
  repo, adds a module/service/feature/tool/agent capability, or asks to
  "set up", "scaffold", "bootstrap", "stub", "wire up", or "add a new"
  anything under `src/trailmate/` or `tests/` — even if they don't say
  "skill" and even if the request sounds small. If in doubt, fire.
---

# Project Bootstrap

## When to use

Trigger this skill on any of these (non-exhaustive):

- "Add a new module to TrailMate" — e.g. an LLM client, a planner, an
  itinerary store, a CLI subcommand, a tool the agent can call.
- "Scaffold tests for X" or "stub out X" — anything that creates new
  files under `src/trailmate/` or `tests/`.
- "Wire up <provider>" (OpenAI, Anthropic, a search API, …) — these
  always involve secrets + a new module + tests, so the contract
  below applies.

If the user is only editing a single existing function inside an
existing file, this skill does **not** apply.

## Canonical stack (the source of truth — do not deviate without flagging)

- Language / runtime:   Python `>=3.10` (per `pyproject.toml`
  `requires-python` and `tool.ruff.target-version = "py310"`). Do not
  use 3.9-only fallbacks (e.g. `typing.List`); prefer PEP 604 unions
  (`X | None`) and built-in generics (`list[str]`).
- Framework:            None. TrailMate is a plain Python package
  exposed via `python -m trailmate` (see `src/trailmate/__main__.py`
  and the `[project.scripts] trailmate = "trailmate.__main__:main"`
  entry point). Do not introduce a web framework, CLI framework
  (Click/Typer), or async runtime without surfacing the choice for
  review.
- LLM provider:         Not yet committed. `.env.example` documents
  `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` as the expected shape. When
  adding a client, add the dependency to `requirements.txt` and the
  env var to `.env.example` in the same change.
- Storage:              None. There is no DB, no on-disk cache, no
  ORM. If a feature needs persistence, stop and ask — do not silently
  add SQLite/Postgres/Redis/JSON files.
- Config:               `python-dotenv` (the only runtime dep).
  Pattern: call `dotenv.load_dotenv()` once at process entry, then
  read with `os.getenv("KEY")`. Never read env vars at module import
  time inside library code.
- Test runner:           `pytest` (configured in `pyproject.toml`:
  `testpaths = ["tests"]`, `pythonpath = ["src"]`). The `pythonpath`
  setting is why tests can `from trailmate.agent_harness import ...`
  without installing the package.
- Lint:                  `ruff`, line-length 100, `target-version =
  "py310"`. Run `ruff check` before declaring done.

## Directory contract

Every new feature must follow this exact tree. Do not create
`utils/`, `helpers/`, `common/`, `core/`, or any subpackage without
explicit user approval — TrailMate is currently flat on purpose.

```
TrailMate/
├── src/
│   └── trailmate/
│       ├── __init__.py        # package marker; holds __version__ only
│       ├── __main__.py        # `def main() -> None`; the ONLY place
│       │                       # `print()` is allowed
│       ├── agent_harness.py   # existing: AgentHarness (OpenAI loop)
│       └── <feature>.py       # NEW work goes here, one module per
│                               # feature, snake_case filename
├── tests/
│   └── test_<feature>.py      # mirrors the module name 1:1
├── pyproject.toml              # single source of project metadata
├── requirements.txt            # runtime deps, unpinned (matches
│                               # current style: `python-dotenv`)
├── requirements-dev.txt        # dev deps; first line is
│                               # `-r requirements.txt`
├── .env.example                # every new env var documented here
└── README.md
```

Why src-layout: the package is only importable via
`pythonpath = ["src"]` (set in `pyproject.toml`), which forces tests
to import the package the same way an installed user would, and stops
accidental shadowing from the repo root. Don't move modules to the
top level.

Why one test file per module: `test_<feature>.py` mirrors
`<feature>.py` (see `tests/test_agent_harness.py` ↔
`src/trailmate/agent_harness.py`). This is how the codebase locates
tests; preserve it.

## House rules (taste & style — be opinionated)

- **Naming**
  - Module files:  `snake_case.py` (e.g. `agent_harness.py`).
  - Classes:       `PascalCase` (e.g. `AgentHarness`).
  - Functions / vars: `snake_case` (e.g. `run`, `main`, `run_repl`).
  - Tests:         file `test_<module>.py`, functions `test_<behavior>`
    written as a sentence (see
    `test_compile_context_prepends_system_prompt_when_set`).
- **Type hints — required** on every public function, method, and
  dataclass field. Existing precedent: `def run(self, user_prompt:
  str) -> str`, `def main() -> None`. A new public function without
  type hints is a regression.
- **Data containers — prefer `@dataclass`** over dicts or untyped
  classes when you need a structured record. A dataclass should be a
  frozen-by-convention bag of typed fields with no methods. Reach for
  `pydantic` only if validation is genuinely needed, and surface that
  choice for review (it is not currently a dependency).
- **Docstrings** — every module starts with a `"""one-line purpose."""`
  module docstring; every public class has at least a one-line
  docstring (e.g. `"""Bounded chat loop around an OpenAI model."""`
  on `AgentHarness`). Do not add docstrings that just restate the
  signature.
- **Error handling** — *no pattern is established yet.* When you are
  the first to introduce one for a feature: raise specific exceptions
  (subclass `Exception` in the same module if needed), never return
  `None` / empty strings as sentinels, and call this out explicitly in
  your summary so it can become the convention.
- **Logging** — *no pattern is established yet.* `print()` is
  reserved for interactive CLI surfaces — i.e. `__main__.py` and the
  `run_repl()` entry point in `agent_harness.py`. For library code
  (classes, helpers, anything callable from non-REPL code paths),
  introduce `logger = logging.getLogger(__name__)` at module top and
  use it; do not add `print()`. Flag the introduction of `logging`
  in your summary — it is the project's first logger.
- **Secrets — env-only, dotenv-loaded.** Read with `os.getenv("KEY")`
  after `dotenv.load_dotenv()` has run at entry. Document every new
  key in `.env.example` (with a commented-out example, matching the
  existing style). Never hardcode keys, defaults, or fallback values.
  `.gitignore` already excludes `.env` and `.env.*` (with
  `!.env.example`); do not weaken those rules.
- **Line length** — 100 columns (`tool.ruff.line-length`). Run
  `ruff check src tests` before declaring done.

## Procedure

1. Confirm the target module name and where it lives. State it back
   to the user as `src/trailmate/<name>.py` + `tests/test_<name>.py`
   before creating anything. If the request implies a subpackage,
   stop and ask — flat is the current convention.
2. Create only the files in the directory contract above. DO NOT
   invent extra files (no `types.py`, `constants.py`, `utils.py`,
   `__init__.py` inside subdirs you didn't get approval for).
3. Stub one passing test per public function/method using the
   `tests/test_agent_harness.py` shape: import from
   `trailmate.<feature>`, use plain `assert`, monkeypatch env vars
   instead of hitting external services, no fixtures unless required.
4. If the change adds a dependency, update `requirements.txt` (or
   `requirements-dev.txt` for test-only deps) in the same change. If
   it adds an env var, update `.env.example` in the same change.
5. Run `pytest` and `ruff check src tests`. Both must pass.
6. Print a summary listing every file created or modified, every
   dependency added, every env var added, and any deviation flagged
   (error-handling pattern introduced, first logger introduced,
   subpackage requested, etc.). Then STOP for review — do not
   continue into the next feature.
