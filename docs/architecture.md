# TrailMate — Architecture & Design Choices

## 1. Skills are instructions, not code

Skills live in `.agents/skills/<name>/SKILL.md` and are injected into the agent's system prompt at startup. They tell the LLM *what to do* and *how*, but they do not execute themselves. Execution happens through tools registered in `ToolRegistry`.

**Trade-off:** Keeping skills as markdown files makes them easy to read, edit, and add without touching Python. The downside is the LLM must correctly interpret and follow the instructions — there is no compile-time guarantee it will. More critical capabilities (see §3) are better served by registered tools.

---

## 2. `run_script` and `read_file` as the generic execution layer

Instead of registering one Python tool per skill, the agent has two generic tools:

- `run_script(command)` — runs any skill script via subprocess from the project root
- `read_file(path)` — reads any file in the project tree on demand

This means adding a new skill requires only a new directory + `SKILL.md` — no code change. The skill's `SKILL.md` includes the script path and CLI usage so the agent knows what to run.

**Trade-off:** The tool schema is loose (`command: string`). The LLM must construct the correct shell command from the SKILL.md instructions. This is less reliable than a typed tool schema. It also gives the agent broad script execution power, which is acceptable here because all scripts live in the controlled `.agents/skills/` tree.

---

## 3. `get_weather` is a registered tool (exception to §2)

`get_weather` is registered as a first-class tool in `ToolRegistry` rather than relying on `run_script`.

**Why:** Weather is a primitive the agent should check *proactively* — before recommending outdoor activities, when the user mentions a date, mid-conversation. Registered tools appear in the OpenAI tool list on every API call, making them hard to ignore. A SKILL.md is instruction the agent may or may not act on; a registered tool is a structured affordance the model was trained to use.

**Rule of thumb:** Use a registered tool when reliable, consistent triggering matters more than zero-code extensibility. Use `run_script` + SKILL.md when the capability is domain-specific and occasional.

---

## 4. Dynamic skill injection

`_load_skills_block()` in `agent_harness.py` scans `.agents/skills/*/SKILL.md` at startup and injects them into the system prompt as `<available_skills>`. Adding a skill is a file drop — no harness code change needed.

Each `<skill>` tag includes a `path=` attribute with the skill's relative path so the agent knows the exact argument to pass to `run_script`.

**Trade-off:** All skills are always in context. For a small number of skills this is fine; at scale it inflates the system prompt and wastes tokens. Future mitigation: load only skills relevant to the current conversation turn (requires a routing layer).

---

## 5. Weather: forecast vs. historical proxy

`get_weather.py` selects its data source based on how far the requested date is from today:

- **≤ 16 days** — Open-Meteo live forecast (accurate)
- **> 16 days** — Open-Meteo archive API, same calendar period last year (climate proxy)

The output includes `"historical": true` when the proxy is used. The agent is instructed to disclose this to the user.

**Trade-off:** A climate proxy is better than nothing for trip planning, but it is not a forecast. A future improvement would be to use a proper climate normals API (e.g. Open-Meteo's 30-year averages endpoint) instead of last year's actuals, which can be anomalous.

---

## 6. Context compaction

`ContextManager` enforces a token budget (currently 3 000 tokens — intentionally low for development visibility). Three compaction tiers apply in order:

1. Evict tool result payloads (replace with placeholder)
2. Keep only the last 4 conversation groups
3. Summarise the evicted middle via `gpt-4o-mini`

**For production:** raise `max_context_tokens` to ~32 000. The 3 000 ceiling exists only to make compaction observable during development.
