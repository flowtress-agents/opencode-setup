# Orchestrator lifecycle, user-tab persistence, and sub-orchestrator orphan policy

> **Status:** Accepted (spec-2). Drives the prose in
> `sandbox/CONTEXT.md` §5–§7 and the spec section at
> `docs/spec/sections/05-orchestrator-user-workspace.md`.
>
> **2026-06-15 (Stage C fix for Challenge 1):** Q3 was previously
> worded as "orphaned on orchestrator death, only auto-shut-down at
> session close." That framing was misleading: the orchestrator and
> every sub-orchestrator, adversarial, fixer, and user tab share a
> **single herdr daemon** (created in `HerdrSession.open`). The
> process-level independence between `pi` processes is real, but the
> user-visible "session" is the daemon. Closing the session closes
> everything — there is no separate "orchestrator death" event that
> leaves sub-orchestrators running. Q3 below is rewritten to reflect
> this. The orchestrator now exposes a distinct `tearDownTree()`
> lifecycle phase (§5.8 of the spec) so callers can choose to bring
> down the sub-tree without taking the daemon down.

Spec-1 left four lifecycle questions open: (Q1) whether the orchestrator
blocks on sub-orchestrators or fans them out; (Q2) whether the user tab
persists across `spawnOrchestrationTeam` calls; (Q3) what happens to
sub-orchestrators when the orchestrator dies; (Q4) how the user actually
drives the orchestrator through the user tab. We pin them here against
the runtime that already exists in
`impl/orchestration/{orchestrator-session,team-spawner}.ts` and
`impl/pty/herdr-session.ts:spawnPane`. **Q1 — Sequential spawn, parallel execute (Stage C rename for Challenge 6):**
the orchestrator spawns one sub-orchestrator per workstream and
returns to `idle` as soon as the spawn phase returns; the
sub-orchestrators themselves run in parallel in their own tabs and
the orchestrator polls their panes via `herdr pane read` rather
than awaiting a completion handle. The spawn loop in
`spawnOrchestrationTeam` is sequential at the herdr-cli level
(each `spawnSubOrchestrator` is awaited) but the resulting sub-orch
panes are independent. The earlier "Fan-out, non-blocking" framing
was misleading: herdr CLI spawns are sequential even though the
sub-orchestrators run in parallel afterwards. The new framing
matches the runtime in
`test/sandbox/impl/orchestration/team-spawner.ts:339-359` and the
spec's own §5.7 hedge ("the spawn calls themselves are sequential
(await each), but the resulting sub-orchestrator panes are
independent and run in parallel"). The orchestrator never holds a
continuation across a sub-orchestrator's lifetime. **Q2 — Fresh user tab per call:**
each `spawnOrchestrationTeam` call creates a brand-new user tab in the
orchestrator's workspace, so the `userWorkspace.paneId` differs across
calls even though the `workspaceId` is shared; this is what F7
(`orchestration.spec.ts > F7: ... > user tab is preserved across
multiple spawnOrchestrationTeam calls`) asserts. **Q3 — Same-daemon
teardown, explicit `tearDownTree` phase:** the orchestrator and every
sub-orchestrator, adversarial, fixer, and user tab run as separate
`pi`/`bash` processes inside the **same herdr daemon** (the daemon is
started by `HerdrSession.open` in `impl/pty/herdr-session.ts`). When
the orchestrator's `pi` process in pane 0 dies unexpectedly (segfault,
explicit `kill`, OOM), the sub-orchestrators' `pi` processes are
**not** notified — they keep running, and the user tab keeps running,
because herdr is still up. The orchestrator's polling loop, however,
is gone; any subsequent `block` challenges are recorded in
`/tmp/adversarial.log` with no consumer. **There is no automatic
recovery** — auto-respawn of the orchestrator is explicitly out of
scope (see the spec's §5.8). What brings the tree down is one of two
explicit actions: (a) call `closeOrchestratorSession()`, which sends
`herdr server stop` and kills every pane in the daemon, or (b) the
new `OrchestratorSession.tearDownTree()` lifecycle phase that sends a
`shutdown` signal to each sub-orchestrator pane individually (so the
sub-orchestrators can flush state to disk before exiting), then
transitions the orchestrator to `terminated`. The old "orphan
period" framing is gone: in spec-2 the orchestrator is not an
independent process tree, it is the coordinator role inside one
shared daemon. The trade-off the ADR makes explicit: **the herdr
daemon is the lifecycle boundary, not the orchestrator's `pi`.**
**Q4 — User types in the user tab, orchestrator observes via
`herdr pane read`:** the user tab is a regular bash REPL owned by the
human; the orchestrator never `send-text`s into it; the user signals
"this prompt is for the orchestrator" by some out-of-band channel
(TUI keybind, external CLI) that pipes the line into pane 0. The
orchestrator learns about user input by polling the user tab's pane
via `herdr pane read <user-pane>`, not via any in-pane signal.
