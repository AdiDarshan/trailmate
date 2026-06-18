"""Tests for AgentHarness.

These tests deliberately avoid hitting the OpenAI API. They monkeypatch
OPENAI_API_KEY so the client constructs (it reads the env at __init__),
and exercise only the local message-assembly logic.
"""

from trailmate.agent_harness import TRAILMATE_SYSTEM_PROMPT, AgentHarness


def test_harness_seeds_chat_history_with_system_prompt(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-used")
    harness = AgentHarness()

    system_msg = harness.chat_history[0]
    assert system_msg["role"] == "system"
    # The full system prompt is the base string extended with a dynamically-
    # scanned <available_skills> block; verify both pieces are present.
    assert system_msg["content"].startswith(TRAILMATE_SYSTEM_PROMPT)
    assert "<available_skills>" in system_msg["content"]


def test_compile_context_returns_chat_history_copy(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-used")
    harness = AgentHarness()
    harness.chat_history.append({"role": "user", "content": "hi"})

    messages = harness._compile_context()

    assert messages[0]["role"] == "system"
    assert messages[-1] == {"role": "user", "content": "hi"}
    # Mutating the returned list must not affect chat_history (and vv).
    messages.append({"role": "assistant", "content": "stray"})
    assert harness.chat_history[-1] == {"role": "user", "content": "hi"}


def test_harness_initializes_with_expected_defaults(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key-not-used")
    harness = AgentHarness()

    assert harness.model == "gpt-4o"
    assert len(harness.chat_history) == 1
    assert harness.chat_history[0]["role"] == "system"
    assert harness.trajectory_log == []
    assert harness.max_iterations == 10
    assert harness.tool_use == []
    assert harness.context_manager.max_context_tokens == 32000
