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

> **Iteration 2 addendum (Stage C, Group 1 fix) — `spawnPaneInNewTab`
> is the spec-mandated call, not the `spawnPane` (no `--tab`) fallback.**
> Every sub-orchestrator is created via `spawnPaneInNewTab` in
> `impl/pty/herdr-session.ts:spawnPaneInNewTab`, which under the hood
> runs `herdr tab create` followed by `herdr agent start --tab <id>`.
> The `spawnPane(cmd)` (no `--tab`) path is **not** the spec-mandated
> way to create a sub-orchestrator and is reserved for **emergency
> use only** (e.g. when `herdr agent start --tab` is not supported on
> the running herdr version and the `spawnPaneInNewTab` fallback
> triggers).
>
> When the fallback fires, a YELLOW `liberty-pane-placement-mismatch`
> warning is logged so the orchestrator's adversarial swarm has
> observable signal. The fallback returns a `SpawnPaneResult` so the
> caller still gets a handle, but the team-spawner treats a YELLOW
> warning here as a **block** challenge for the next adversarial pass.
> See ADR 0009 for the pane-id reconciliation pattern that runs
> after the fallback (the same reconciliation runs on the
> `spawnPaneInNewTab` path; it is universally required because herdr
> v0.6.10's `agent start` response is unreliable).
>
> The fallback's purpose is to keep the suite green across herdr
> versions, not to relax the spec. The spec still says
> **sub-orchestrators = tabs**, and the team-spawner always prefers
> `spawnPaneInNewTab`. The fallback is a backstop, not a first
> choice.
