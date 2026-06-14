# Pi is the orchestrator

The first pane (pane 0 / tab 0 / workspace 0) of every launched
sandbox container runs **pi** (`@earendil-works/pi-coding-agent`) as
the user-facing orchestrator. No other agent — including the host
shell — takes pane 0.

The orchestrator role is what the user interacts with directly. It
sees the user's prompt, plans work, and decides which sub-agents
(F3, F4) to delegate to. The user does not interact with
sub-agents, sub-orchestrators, or container bash directly while
pi is running.

**Avoid**: "primary agent", "root agent", "main agent" — these
overload other concepts in the agent hierarchy.

**Implications for the spec:**
- The launch-sandbox contract must guarantee pi is alive in pane 0
  before any user prompt can reach the container.
- Sub-agents spawned by pi (F3/F4) are NOT reachable from the user
  through pane 0 — they live in their own panes/tabs.
- The user's bash workspace (F6) is reachable only when the user
  explicitly leaves pi (e.g. detaches, or pi exits).
