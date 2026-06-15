# Sub-orchestrators live in tabs, never in panes

> **Status:** Accepted (spec-2). Drives the `tabPlacement: "tab"` requirement
> in `fixtures/sandbox-spec/src/multiplexing.ts:SubAgentConfig`, the
> `canSpawnSubAgent` rejection rule in
> `fixtures/sandbox-spec/src/multiplexing-session.ts`, and the per-tab
> `spawnPaneInNewTab` path in `impl/pty/herdr-session.ts`.

A sub-orchestrator is always spawned into a **fresh tab** of the
orchestrator's workspace, never into a pane of the orchestrator's tab or
into a pane of another sub-orchestrator's tab. The trade-off this picks:
sub-orchestrators get full herdr-level isolation (own tab id, own buffer,
own focus, own pane-id namespace) at the cost of one extra `herdr tab
create` per workstream. The user already sees this layout on the TUI
(one tab per workstream), and the spec keeps that property end-to-end.
OpenHands' per-session event log and opencode's per-session permission
ruleset both confirm that the session/tab is the right isolation unit
between cooperating agents. Maximum nesting is 3:
**workspace → tab → pane**, matching `MAX_PANE_DEPTH = 3` and
`SUB_ORCHESTRATOR_MAX_DEPTH = 3`.
