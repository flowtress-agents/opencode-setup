# Fork herdr and pi to add orchestration limits

The orchestration rules in ADRs 0002–0004 require new behavior
in both herdr and pi that the upstream projects do not implement:

- **herdr** must know which pane is the orchestrator pane, which
  panes are sub-agent panes, and which is the user's bash
  workspace. Upstream herdr treats all panes as user-controlled.
- **pi** must respect pane delegation rules (ADR 0004): it must
  spawn sub-agents via herdr's multiplexing API, not by
  backgrounding processes inside its own pane. It must also
  refuse to interact with the user's bash workspace (F6).
- **pi** must support being *spawned* by another pi (sub-orchestrator
  in F4). Upstream pi assumes a single user-driven instance per
  process.

**Decision:** maintain local forks of both projects under
`repos/herdr/` and `repos/pi-coding-agent/` (paths TBD in the
green phase). The forks add the orchestration layer; upstream
merges are evaluated case-by-case.

**Limits the forks must enforce:**
1. Max pane depth (default 3: orchestrator → sub-orchestrator → sub-agent).
2. Max sub-agents per orchestrator (default 8).
3. Pane ownership is immutable: an orchestrator cannot take over
   another orchestrator's pane, and no agent can take over the
   user's bash workspace.
4. Sub-agents cannot spawn sub-orchestrators unless explicitly
   promoted by their parent (default: leaf agents only).

**Avoid**: "patch", "shim" — these are full forks with our own
release cadence.

**Implications for the spec:**
- `install.steps[herdr]` and `install.steps[picode]` in
  `launch-sandbox.toml` must reference the fork URLs once chosen
  (green phase). The micro-spec TOML currently points at upstream;
  this is the first spec change for the green phase.
- Health checks must verify the fork versions, not upstream
  versions.
- The spec-map (tdad-tests) will pick up the new install steps
  in green phase.
