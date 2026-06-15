# Orchestrator lifecycle, user-tab persistence, and sub-orchestrator orphan policy

> **Status:** Accepted (spec-2). Drives the prose in
> `sandbox/CONTEXT.md` §5–§7 and the spec section at
> `docs/spec/sections/05-orchestrator-user-workspace.md`.

Spec-1 left four lifecycle questions open: (Q1) whether the orchestrator
blocks on sub-orchestrators or fans them out; (Q2) whether the user tab
persists across `spawnOrchestrationTeam` calls; (Q3) what happens to
sub-orchestrators when the orchestrator dies; (Q4) how the user actually
drives the orchestrator through the user tab. We pin them here against
the runtime that already exists in
`impl/orchestration/{orchestrator-session,team-spawner}.ts` and
`impl/pty/herdr-session.ts:spawnPane`. **Q1 — Fan-out, non-blocking:**
the orchestrator spawns one sub-orchestrator per workstream and
immediately returns to `idle`; sub-orchestrators run in parallel in
their own tabs and the orchestrator polls their panes via
`herdr pane read` rather than awaiting a completion handle. The spawn
loop in `spawnOrchestrationTeam` is sequential at the herdr-cli level
(each `spawnSubOrchestrator` is awaited) but the resulting sub-orch
panes are independent; the orchestrator never holds a continuation
across a sub-orchestrator's lifetime. **Q2 — Fresh user tab per call:**
each `spawnOrchestrationTeam` call creates a brand-new user tab in the
orchestrator's workspace, so the `userWorkspace.paneId` differs across
calls even though the `workspaceId` is shared; this is what F7
(`orchestration.spec.ts > F7: ... > user tab is preserved across
multiple spawnOrchestrationTeam calls`) asserts. **Q3 — Orphaned; auto
shut-down only at session close:** when the orchestrator's `pi` dies,
the sub-orchestrators keep running in their own tabs because they are
independent processes; there is no parent-death signal and no
auto-respawn. The whole tree is torn down only when
`closeOrchestratorSession` stops the herdr daemon, which kills every
pane in the workspace. Auto-respawn of a crashed sub-orchestrator is
explicitly out of scope — a partial state must be handled by the
orchestrator explicitly, not hidden by an implicit retry. **Q4 — User
types in the user tab, orchestrator observes via `herdr pane read`:**
the user tab is a regular bash REPL owned by the human; the
orchestrator never `send-text`s into it; the user signals "this prompt
is for the orchestrator" by some out-of-band channel (TUI keybind,
external CLI) that pipes the line into pane 0. The orchestrator learns
about user input by polling the user tab's pane via
`herdr pane read <user-pane>`, not via any in-pane signal.
