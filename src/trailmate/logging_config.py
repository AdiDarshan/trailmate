"""Central logging configuration for TrailMate.

A single ``configure_logging`` call sets up a console (stderr) handler so
the agent loop, tool calls, and provider activity are visible in whatever
terminal is running the app. Call it once from each entry point
(``ui/app.py`` and ``run_repl``); repeat calls are no-ops.

Every module obtains its logger via ``get_logger(__name__)`` so log lines
are tagged with their origin (e.g. ``trailmate.ai.service``).
"""

from __future__ import annotations

import logging
import os
import sys

_CONFIGURED = False

_DEFAULT_FORMAT = "%(asctime)s %(levelname)-7s %(name)s | %(message)s"
_DATE_FORMAT = "%H:%M:%S"


def configure_logging(level: int | str | None = None) -> None:
    """Install a stderr handler on the ``trailmate`` logger exactly once.

    The level defaults to the ``TRAILMATE_LOG_LEVEL`` env var (e.g.
    ``DEBUG``), or ``INFO`` when unset. Subsequent calls are ignored so
    importing this from multiple entry points never duplicates handlers.
    """
    global _CONFIGURED
    if _CONFIGURED:
        return

    if level is None:
        level = os.getenv("TRAILMATE_LOG_LEVEL", "INFO").upper()

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter(_DEFAULT_FORMAT, datefmt=_DATE_FORMAT))

    root = logging.getLogger("trailmate")
    root.setLevel(level)
    root.addHandler(handler)
    # Don't bubble up to the (often noisy / unconfigured) root logger.
    root.propagate = False

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    """Return a logger under the ``trailmate`` namespace.

    Accepts a ``__name__`` like ``trailmate.ai.service`` and returns it
    as-is; bare names are prefixed so they still inherit the package
    handler/level configured by ``configure_logging``.
    """
    if name == "__main__" or not name.startswith("trailmate"):
        name = f"trailmate.{name}"
    return logging.getLogger(name)
