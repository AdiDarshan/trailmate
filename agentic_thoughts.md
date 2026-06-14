# Thoughts on Accelerating Agentic AI and Making It More Robust

*June 2026*

---

## The core problem: agents are still basically sequential

The obvious gap in most agentic systems today isn't model intelligence — it's execution architecture. The default pattern is: think, act, observe, repeat. One step at a time, usually in a single context window, usually with one model doing everything. This is like building a company where every task routes through a single person who can only hold one thought at a time.

The unlock isn't making the single agent smarter. It's decomposing work so that independent subtasks run in parallel. When an agent needs to research three competitors, it shouldn't do them serially. When it's building a feature that touches the frontend and the backend, those can often be parallelized. The planning step — figuring out what's independent from what — is where the real leverage is. Most frameworks either skip this entirely or do it crudely.

The hard part of parallelism isn't spawning workers. It's managing the merge: how do you reconcile outputs from parallel branches that made conflicting assumptions? How do you detect when branch B's results invalidate what branch A already did? This is a mostly unsolved coordination problem, and it's where multi-agent systems currently fall apart.

---

## Tool design is the bottleneck nobody talks about

Agents are only as capable as the tools available to them. But most tools are designed for humans, not agents, and that mismatch is expensive.

Human-facing tools are stateful, non-idempotent, and hard to inspect. They return HTML instead of structured data. They have undocumented side effects. They require multi-step authentication flows mid-task. An agent hitting these tools mid-task has to spend enormous reasoning budget on "did that actually work?" and "what state am I in now?"

Agent-native tools should be:

- **Idempotent** — calling the same tool twice with the same args should be safe.
- **Reversible** — or at least, reversibility should be documented clearly. Agents need to know whether a mistake can be undone.
- **Self-describing** — schemas that include not just parameters but preconditions, postconditions, and error semantics.
- **Composable** — designed so the output of one tool is easy to pass as input to another without manual reformatting.

A lot of what currently limits agents isn't model capability — it's that tools designed for humans impose massive hidden costs when agents use them. Investing in tool quality is one of the highest-leverage things teams building agentic systems can do.

---

## The trust calibration problem

The binary ask/act decision is wrong. Most agent frameworks either interrupt constantly ("should I do X?") or barrel forward until something breaks. Neither is right.

Real trust calibration means the agent has an accurate model of: (a) how reversible this action is, (b) how confident it is in the current interpretation of the goal, (c) how much information it would gain by pausing vs. how much it would lose in latency. These three together determine when to act autonomously vs. when to surface a decision.

The pathology of under-interrupting is obvious — agents taking irreversible actions based on wrong assumptions. The pathology of over-interrupting is underrated. An agent that asks every five steps trains users to disengage. They start rubber-stamping confirmations, which is worse than no confirmation at all. You want agents that build a track record of autonomy on low-stakes decisions so that when they do interrupt, humans know it actually matters.

Getting this right probably requires domain-specific calibration, not just general-purpose caution. A coding agent should have different interrupt thresholds than a financial agent.

---

## Robustness is about graceful degradation, not perfection

Current agents fail badly. They hit an unexpected error mid-task and either crash, spiral into retry loops, or silently produce wrong output. The problem is that most agentic frameworks have no concept of partial success. A task either completes or it doesn't.

The right mental model is closer to distributed systems: design for partial failure from the start. This means:

**Checkpointing.** Save meaningful state at each step so that a failure mid-task doesn't require starting over. This is especially important for long-horizon tasks.

**Graceful degradation.** If a subtask fails, the agent should understand whether the overall goal is still achievable with reduced scope, or whether the failure is fatal. Most agents don't make this distinction.

**Rollback semantics.** For actions with side effects, agents need to know whether they can undo what they've done. This requires tool-level support (see above) but also agent-level awareness of what's been committed.

**Explicit uncertainty propagation.** If an agent is 60% confident about a factual assumption it made in step 2, that uncertainty should propagate forward. By step 8, the agent should know that its output depends on something it wasn't sure about, and surface that.

None of this is technically exotic — distributed systems engineers solved versions of these problems decades ago. The gap is bringing that thinking into agent design.

---

## Memory is the most underbuilt component

Most current agents have no persistent memory beyond what fits in context. This is a massive limitation for any task that extends across sessions, requires building on prior work, or involves learning from mistakes.

The architecture people have converged on — episodic memory, semantic memory, procedural memory — is probably right, but implementation is mostly immature. What's needed:

**Episodic**: a compressed record of what the agent has done and what happened. Useful for avoiding repetition, explaining decisions, and auditing.

**Semantic**: facts about the domain, the user, the codebase, or the world that persist beyond the current task. The agent that helped you refactor a service last month should still know how that service works.

**Procedural**: patterns that worked (and patterns that didn't). The closest analogue is few-shot examples, but it should be dynamic — the agent should be building a personalized playbook over time.

The hard problems here are retrieval (how does the agent know which memory is relevant right now?) and maintenance (how do you keep memory from accumulating stale or contradictory facts?). These aren't solved.

---

## Evaluation is the critical bottleneck

You can't accelerate what you can't measure. The eval gap for agentic tasks is worse than anywhere else in ML.

For most capabilities, you can write an automated test: generate an output, check it against a gold standard. For agentic tasks, the output is a trajectory of actions taken over time, often with external side effects, often ending in a state that's hard to observe. Writing evals for this is hard. Running them is expensive. Getting signal is slow.

This is why agentic AI progress feels slower than it should, given how capable the underlying models are. The limiting factor isn't model intelligence — it's that we can't iterate fast because we can't evaluate fast.

Some approaches that help: behavioral replay testing (record a successful trajectory, then test whether the agent can reproduce it after changes), simulation environments (sandboxed tools that behave like real tools but are cheap to reset), and LLM-as-judge at the trajectory level. None of these are great. Better eval methodology is one of the highest-leverage investments in this space right now.

---

## Multi-agent coordination needs protocols, not just APIs

Spinning up multiple agents and having them call each other through function calls is not multi-agent coordination. It's just more complex single-agent computation.

Real multi-agent coordination requires:

**Shared state management.** Agents working in parallel on related tasks need a consistent view of what's been decided and what's still open. Without this, you get conflicting assumptions and redundant work.

**Role specialization.** Not just "agent A calls agent B" but clear boundaries on what each agent owns, what it can change, and what requires negotiation.

**Conflict resolution.** When two agents reach contradictory conclusions, there needs to be a defined mechanism for resolution — not just "whoever writes last wins."

**Failure isolation.** One agent failing shouldn't cascade. The orchestrating layer needs circuit breakers.

Right now most multi-agent frameworks are built on hope — hope that agents won't conflict, hope that their outputs will compose cleanly. Making multi-agent systems robust requires treating coordination as a first-class design problem.

---

## The human-in-the-loop spectrum is huge and mostly unexplored

There's a vast design space between "fully autonomous" and "ask before every step" that almost nobody is building in deliberately. The interesting points on this spectrum include:

- **Async review**: the agent acts, then surfaces a summary for human review with flagged uncertainties before committing irreversible changes.
- **Confidence-gated autonomy**: the agent acts autonomously when confidence is above a threshold, interrupts when below.
- **Scope declaration**: before starting, the agent declares what it plans to do and what it won't touch — the human approves the scope, not each step.
- **Exception-only reporting**: the agent runs fully autonomous but reports exceptions in real-time, allowing the human to intervene if they're watching.

Most deployed systems just pick a spot on this spectrum by accident and stick with it. Designing it intentionally — calibrated to task type, user preference, and stakes — is one of the biggest UX opportunities in agentic AI.

---

## What would actually move the needle

If I had to bet on where the biggest near-term gains are:

1. **Better planning**: explicit task decomposition with dependency graphs, not just "think step by step."
2. **Agent-native tool ecosystems**: tooling built for agents from the start, not retrofitted from human UIs.
3. **Fast, cheap eval infrastructure**: the teams that crack agent evaluation will iterate faster than everyone else.
4. **Memory that actually works**: persistent, retrievable, maintainable context across tasks and sessions.
5. **Principled interruption**: trust calibration that's adaptive rather than just conservative.

The model capabilities are already ahead of the infrastructure. The constraint is engineering, not intelligence.
