"""Shell script runner and file reader tools."""

from __future__ import annotations

import subprocess
from pathlib import Path

# Absolute path to the project root — used to set the working directory
# and to constrain file access to the project tree.
_PROJECT_ROOT = Path(__file__).parent.parent.parent.parent


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
            return {"status": "error", "message": "Script timed out after 180s"}
        return {
            "status": "success" if proc.returncode == 0 else "error",
            "stdout": stdout,
            "stderr": stderr,
            "returncode": proc.returncode,
        }
    except Exception as e:
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
