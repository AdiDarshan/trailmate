"""Shell script runner and file reader tools."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from trailmate.logging_config import get_logger

logger = get_logger(__name__)

# Absolute path to the project root — used to set the working directory
# and to constrain file access to the project tree.
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent

# Skill docs (SKILL.md) tell the model to invoke scripts as ``python ...``,
# but many systems only ship ``python3`` (or the app runs inside a venv whose
# interpreter isn't on PATH as ``python``). Rewrite a leading ``python``/
# ``python3`` token to the interpreter actually running this app, so scripts
# inherit the same environment and installed dependencies.
_PYTHON_PREFIX = re.compile(r"^(python3?)(?=\s)")


def _normalize_interpreter(command: str) -> str:
    return _PYTHON_PREFIX.sub(lambda _: f'"{sys.executable}"', command, count=1)


def run_script(args: dict) -> dict:
    """Run a shell command from the project root and return stdout/stderr/returncode.

    ``shell=True`` is intentional — skill scripts are invoked exactly as
    written in their SKILL.md. ``cwd`` is pinned to the project root so
    relative paths in commands resolve correctly. A 180-second timeout
    prevents runaway scripts from blocking the agent loop. Uses Popen
    instead of ``subprocess.run`` to avoid the post-kill communicate() hang.
    """
    command = args.get("command", "").strip()
    if not command:
        return {"status": "error", "message": "command is required"}

    command = _normalize_interpreter(command)
    logger.info("run_script → %s", command)
    try:
        proc = subprocess.Popen(
            command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd=str(_PROJECT_ROOT),
        )
        try:
            stdout, stderr = proc.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
            logger.error("run_script timed out: %s", command)
            return {"status": "error", "message": "Script timed out after 180s"}

        logger.debug("stdout: %s", stdout[:1000] if stdout else "(empty)")
        if stderr:
            logger.warning("stderr: %s", stderr[:500])
        if proc.returncode != 0:
            logger.error("returncode %d for: %s", proc.returncode, command)
        else:
            logger.info("returncode 0 — OK")

        return {
            "status": "success" if proc.returncode == 0 else "error",
            "stdout": stdout,
            "stderr": stderr,
            "returncode": proc.returncode,
        }
    except Exception as e:
        logger.exception("run_script exception for: %s", command)
        return {"status": "error", "message": str(e)}


def read_file(args: dict) -> dict:
    """Read a file from the project tree and return its text content.

    Resolves ``path`` relative to the project root and checks that the
    resolved absolute path still lives inside the project root before
    reading, preventing directory-traversal attacks.
    """
    path = args.get("path", "").strip()
    if not path:
        return {"status": "error", "message": "path is required"}
    try:
        full_path = (_PROJECT_ROOT / path).resolve()
        if not str(full_path).startswith(str(_PROJECT_ROOT.resolve())):
            return {"status": "error", "message": "Access denied: path outside project root"}
        content = full_path.read_text(encoding="utf-8")
        return {"status": "success", "content": content}
    except FileNotFoundError:
        return {"status": "error", "message": f"File not found: {path}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
