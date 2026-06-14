# Pane delegation: orchestrators control spawned panes

Pane delegation defines the agent-to-pane ownership model:

- An **orchestrator** (a pi instance, per ADR 0002) may spawn
  **sub-agents** in new herdr tabs/workspaces.
- Each spawned sub-agent occupies exactly **one** pane in **one**
  tab/workspace. One pane per agent. One tab per agent's session.
- The user has a **separate workspace** for bash. The orchestrator
  (pi) cannot reach into the user's workspace to interact with
  it. Conversely, the user cannot inject into an orchestrator's
  sub-agent pane.

**Why this matters:**
- Prevents accidental cross-contamination: an agent working in its
  own pane cannot accidentally read the user's bash scrollback.
- Gives the orchestrator a clear "child set" it can manage,
  signal, and reap. A sub-agent death is a pane event, not a
  container event.
- Makes governance (ADR 0005) tractable: each pane is a node
  with a single parent orchestrator, forming a tree even when
  the governance model is flat.

**Sub-orchestrators (F4):** a sub-agent may itself be a
sub-orchestrator, meaning it can spawn its own sub-agents. The
pane delegation rule still holds: one pane per sub-orchestrator,
its sub-agents in further panes. The hierarchy is by spawn
relationship, not by pane topology.

**Avoid**: "worker", "child" (too generic), "session" (overloaded
with herdr session state).

**Implications for the spec:**
- The runtime must support launching one container per agent tree,
  NOT one container per agent. The container is the TTY surface
  (ADR 0003); the panes are the agent boundaries.
- The launch-sandbox spec must declare workspace topology (F1: one
  container per launch, F6: user workspace separate).
