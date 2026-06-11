"""Tests for ContextManager.

No network calls. The compaction tests exercise step 1 (tool-payload
eviction) and step 2 (last-N-groups) directly. Step 3 (LLM summary) is
covered by monkeypatching `_summarize` so we don't make a real
gpt-4o-mini call.
"""

import json
from types import SimpleNamespace

from trailmate.context_manager import ContextManager, _keep_last_n_groups


def test_init_metrics_start_at_zero():
    cm = ContextManager(max_context_tokens=1000)

    assert cm.metrics == {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    assert cm.max_context_tokens == 1000


def test_track_burn_accumulates_and_prints(capsys):
    cm = ContextManager(max_context_tokens=1000)

    cm.track_burn(SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15))
    cm.track_burn(SimpleNamespace(prompt_tokens=20, completion_tokens=8, total_tokens=28))

    assert cm.metrics == {"input_tokens": 30, "output_tokens": 13, "total_tokens": 43}
    captured = capsys.readouterr().out
    # Both calls should have printed; cumulative totals appear on the last line.
    assert "in: 30" in captured and "out: 13" in captured and "total: 43" in captured


def test_estimate_tokens_returns_positive_int_for_real_messages():
    cm = ContextManager(max_context_tokens=1000)

    history = [
        {"role": "system", "content": "You are TrailMate."},
        {"role": "user", "content": "Hello"},
    ]

    n = cm._estimate_tokens(history)

    assert isinstance(n, int)
    assert n > 0


def test_enforce_compaction_returns_history_unchanged_when_under_budget():
    cm = ContextManager(max_context_tokens=10_000)

    history = [
        {"role": "system", "content": "You are TrailMate."},
        {"role": "user", "content": "Plan a trip."},
        {"role": "assistant", "content": "Sure, where to?"},
    ]

    result = cm.enforce_compaction(history, tool_use=None)

    assert result == history


def test_enforce_compaction_step1_evicts_tool_payloads_when_over_budget():
    # Tiny budget forces compaction; tool result is the only large message
    # so step 1 alone should bring the total under the limit.
    cm = ContextManager(max_context_tokens=80)

    big_payload = json.dumps({"status": "success", "blob": "x" * 4000})
    history = [
        {"role": "system", "content": "You are TrailMate."},
        {"role": "user", "content": "Make a PDF."},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "export_pdf", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call_1", "content": big_payload},
        {"role": "assistant", "content": "Done."},
    ]

    result = cm.enforce_compaction(history, tool_use=None)

    tool_msgs = [m for m in result if m.get("role") == "tool"]
    assert tool_msgs and tool_msgs[0]["content"] == "[tool result evicted]"
    assert tool_msgs[0]["tool_call_id"] == "call_1"
    assert len(result) == len(history)


def test_enforce_compaction_falls_through_to_step2_when_step1_insufficient():
    # Many turns of plain text. There are no tool messages so step 1 is a
    # no-op; step 2 must kick in. Budget is sized so step 2 alone fits
    # (system + 4 trimmed messages) without falling through to step 3.
    cm = ContextManager(max_context_tokens=200)

    history = [{"role": "system", "content": "S"}]
    for i in range(8):
        history.append({"role": "user", "content": f"u{i} " + "x" * 50})
        history.append({"role": "assistant", "content": f"a{i} " + "y" * 50})

    result = cm.enforce_compaction(history, tool_use=None)

    # System preserved at index 0.
    assert result[0]["role"] == "system"
    # Body trimmed to last 4 groups (each plain user/assistant message is
    # its own group → exactly 4 messages here).
    body = result[1:]
    assert len(body) == 4


def test_enforce_compaction_step3_summarizes_when_steps_1_and_2_insufficient(monkeypatch):
    cm = ContextManager(max_context_tokens=20)

    # Stub the LLM call so the test doesn't need network/keys.
    monkeypatch.setattr(cm, "_summarize", lambda hist: "STUBBED SUMMARY")

    history = [{"role": "system", "content": "S"}]
    for i in range(10):
        # Each message is itself larger than the budget, so even after
        # trimming to 4 messages we'll still be over → step 3 fires.
        history.append({"role": "user", "content": "u" + "x" * 200})
        history.append({"role": "assistant", "content": "a" + "y" * 200})

    result = cm.enforce_compaction(history, tool_use=None)

    # Layout: [system, summary_msg, ...last 4 groups]
    assert result[0]["role"] == "system"
    assert result[1]["role"] == "system"
    assert "STUBBED SUMMARY" in result[1]["content"]
    assert len(result[2:]) == 4


def test_keep_last_n_groups_keeps_tool_call_and_result_together():
    # Group definition test: an assistant tool_call message attached to
    # its tool result must travel as a single unit.
    messages = [
        {"role": "user", "content": "u1"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "c1"}]},
        {"role": "tool", "tool_call_id": "c1", "content": "r1"},
        {"role": "assistant", "content": "a1"},
        {"role": "user", "content": "u2"},
    ]

    # Keep only the last 2 groups: [{user u2}] and the assistant-text "a1".
    # The assistant+tool group must NOT be split.
    result = _keep_last_n_groups(messages, n=2)

    # last 2 groups are: ["a1"] and ["u2"]
    assert [m.get("content") for m in result] == ["a1", "u2"]


def test_keep_last_n_groups_treats_tool_call_with_results_as_single_unit():
    messages = [
        {"role": "user", "content": "u1"},
        {"role": "user", "content": "u2"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "c1"}]},
        {"role": "tool", "tool_call_id": "c1", "content": "r1"},
    ]

    # Last 2 groups = [u2] and [assistant tool_call + tool result].
    result = _keep_last_n_groups(messages, n=2)
    roles = [m["role"] for m in result]

    assert roles == ["user", "assistant", "tool"]
    # And the tool message is preserved (no orphaning).
    assert result[-1]["tool_call_id"] == "c1"
