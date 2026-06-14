"""WorkflowEngine — deterministic orchestration for TrailMate trip planning.

Prevents the LLM from losing track of its objective during long runtimes.
Every external action is logged. Irreversible steps require human OK or dry_run.
"""

from __future__ import annotations

import json
import sys
import time
import uuid
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any


# ── Status machine ─────────────────────────────────────────────────────────────

class WorkflowStatus(Enum):
    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    AWAITING_VERIFICATION = "awaiting_verification"


# ── Context (shared state across all steps) ────────────────────────────────────

@dataclass
class ContextState:
    """The central state object passed through the orchestration pipeline."""
    session_id: str
    global_context: dict[str, Any] = field(default_factory=dict)
    execution_history: list[dict[str, Any]] = field(default_factory=list)
    status: WorkflowStatus = WorkflowStatus.IDLE

    def set(self, key: str, value: Any) -> None:
        self.global_context[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        return self.global_context.get(key, default)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        return d


# ── Base skill interface ───────────────────────────────────────────────────────

class BaseAgentSkill(ABC):
    name: str = ""
    irreversible: bool = False  # if True, requires human OK or dry_run

    @abstractmethod
    def execute(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """Run the skill. Return a dict with at least {"ok": bool, "data": ...}."""
        ...

    def verify(self, result: dict[str, Any]) -> tuple[bool, str]:
        """Validate the result. Return (passed, reason)."""
        if not result.get("ok"):
            return False, result.get("error", "Unknown error")
        if result.get("data") is None:
            return False, "No data returned"
        return True, "ok"


# ── Workflow engine ────────────────────────────────────────────────────────────

class WorkflowEngine:
    """Manages the deterministic execution graph of agent skills."""

    def __init__(self, initial_state: ContextState, log_path: Path | None = None, dry_run: bool = False):
        self.state = initial_state
        self.skills_registry: dict[str, BaseAgentSkill] = {}
        # Maps current step → next possible steps (execution graph)
        self.execution_graph: dict[str, list[str]] = {}
        self.log_path = log_path
        self.dry_run = dry_run

    def register_skill(self, name: str, skill: BaseAgentSkill) -> None:
        self.skills_registry[name] = skill

    def set_execution_graph(self, graph: dict[str, list[str]]) -> None:
        self.execution_graph = graph

    def _log(self, event: dict) -> None:
        event["timestamp"] = datetime.utcnow().isoformat()
        event["session_id"] = self.state.session_id
        self.state.execution_history.append(event)
        if self.log_path:
            with open(self.log_path, "a") as f:
                f.write(json.dumps(event) + "\n")
        # Always print to stderr so nothing is hidden
        print(f"[{event['timestamp']}] {event.get('event')} — {event.get('detail', '')}", file=sys.stderr)

    def run_step(self, skill_name: str, raw_inputs: dict[str, Any]) -> ContextState:
        """Execute a single node in the workflow graph and update global context."""
        skill = self.skills_registry.get(skill_name)
        if not skill:
            self._log({"event": "SKILL_NOT_FOUND", "detail": skill_name})
            self.state.status = WorkflowStatus.FAILED
            return self.state

        # Guard: irreversible actions need human OK or dry_run flag
        if skill.irreversible and not self.dry_run:
            self._log({"event": "AWAITING_VERIFICATION", "detail": f"{skill_name} is irreversible — human OK required"})
            self.state.status = WorkflowStatus.AWAITING_VERIFICATION
            return self.state

        self.state.status = WorkflowStatus.RUNNING
        self._log({"event": "STEP_START", "detail": skill_name, "inputs": raw_inputs})

        start = time.time()
        try:
            result = skill.execute(raw_inputs)
        except Exception as e:
            result = {"ok": False, "error": str(e), "data": None}

        elapsed = round(time.time() - start, 2)

        # Verify output
        passed, reason = skill.verify(result)
        self._log({
            "event": "STEP_END",
            "detail": skill_name,
            "ok": passed,
            "reason": reason,
            "elapsed_s": elapsed,
        })

        if not passed:
            self.state.status = WorkflowStatus.FAILED
            self.state.set(f"{skill_name}_error", reason)
            return self.state

        # Store result in shared context under the skill name
        self.state.set(skill_name, result["data"])
        return self.state

    def run_pipeline(self, steps: list[tuple[str, dict[str, Any]]]) -> ContextState:
        """Run a sequence of steps. Stops on first failure."""
        for skill_name, inputs in steps:
            self.run_step(skill_name, inputs)
            if self.state.status == WorkflowStatus.FAILED:
                self._log({"event": "PIPELINE_ABORTED", "detail": f"failed at {skill_name}"})
                return self.state
            if self.state.status == WorkflowStatus.AWAITING_VERIFICATION:
                return self.state

        self.state.status = WorkflowStatus.COMPLETED
        self._log({"event": "PIPELINE_COMPLETED", "detail": f"{len(steps)} steps"})
        return self.state
