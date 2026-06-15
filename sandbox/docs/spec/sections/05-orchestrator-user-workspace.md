# Spec-2 §5 — Orchestrator & user-workspace

> **Section status:** Accepted (spec-2). Anchors the runtime in
> `test/sandbox/impl/orchestration/{orchestrator-session,team-spawner}.ts`
> and the `spawnPane` hook in `test/sandbox/impl/pty/herdr-session.ts`.
> Glossary entries live in `sandbox/CONTEXT.md` §1; the lifecycle
> decisions are pinned in `docs/adr/0003-orchestrator-lifecycle.md`.

This section is the spec-side counterpart to the glossary. The
glossary defines who each entity is; this section defines what each
entity does over time, in prose precise enough that the runtime
behavior is unambiguous.

---

## 5.1 Orchestrator lifecycle

The orchestrator is a `pi` process in pane 0 of the orchestrator tab.
It is created by `openOrchestratorSession()` in
`impl/orchestration/orchestrator-session.ts` and torn down by
`closeOrchestratorSession()`. While the session is open, the
orchestrator is in exactly one of five states:

| State        | Entered when                                              | Left when                                                                  | Allowed actions |
|--------------|-----------------------------------------------------------|----------------------------------------------------------------------------|-----------------|
| `booting`    | `HerdrSession.open` returns and the orchestrator pane 0 exists | `pi` answers `pi --version` and the system prompt is acknowledged         | Run boot commands: `export AGENT_CAPABILITY=read`, send the system prompt, look up the pi PID. |
| `idle`       | Boot finished, no in-flight work                          | A user prompt arrives, an adversarial produces a `block` challenge, or the orchestrator decides to dispatch | Read any pane via `herdr pane read`; reply via the orchestrator pane; emit a plan. |
| `busy`       | Orchestrator is handling a user prompt or coordinating a dispatch | All spawned sub-orchestrators are `idle` and no `block` challenges are open | Spawn sub-orchestrators (one per workstream); dispatch surgical fixers via `spawnFixer()`; read the challenge log; re-plan. |
| `idle-again` | All in-flight work settled, no open challenges            | New user prompt or new `block` challenge arrives                            | Same as `idle`. |
| `terminated` | `closeOrchestratorSession()` is called, or the herdr daemon dies | (terminal)                                                                  | None. The session object is dead. |

**Polling, not push.** Transitions out of `idle` and `idle-again` are
driven by the orchestrator polling the herdr daemon: it calls
`herdr pane list`, `herdr pane read <pane>`, and `herdr pane get
<pane>` on a schedule, and it reads `/tmp/adversarial.log` for
challenge events. The runtime does not push events to the
orchestrator; the orchestrator decides when to act. This mirrors
opencode's `Effect = "allow" | "deny" | "ask"` model
(`repos/opencode/packages/core/src/permission/schema.ts`): the agent
is the poll-driven decision maker, the runtime is the enforcer.

**No `MUST`, no `MUST NOT`, no policy script.** The orchestrator
system prompt (in `ORCHESTRATOR_SYSTEM_PROMPT` in
`impl/orchestration/orchestrator-session.ts`) lists the available
sub-orchestrator templates, the adversarial protocol, and the
`spawnFixer` lookup, but it does not prescribe *when* to use them. The
orchestrator is autonomous within the read-only constraint.

---

## 5.2 Sub-orchestrator lifecycle

A sub-orchestrator is a `pi` process in pane 0 of a sub-orchestrator
tab. It is created by `spawnSubOrchestrator()` (phase B of
`spawnOrchestrationTeam`) and runs `pi --version` as a smoke test;
the orchestrator then promotes it to a real sub-orchestrator by
sending it the sub-orchestrator system prompt.

| State              | Entered when                                                                | Left when                                                              | Allowed actions |
|--------------------|-----------------------------------------------------------------------------|------------------------------------------------------------------------|-----------------|
| `spawned`          | `spawnPaneInNewTab` returns a `paneId` + `tabId` for the workstream         | Orchestrator sends the sub-orchestrator its system prompt              | Nothing user-visible (smoke test only). |
| `busy`             | Orchestrator sends the sub-orchestrator a delegated task                    | Sub-orchestrator's pane shows no in-flight work, no `block` challenges against it | Spawn sub-agents in its own tab (`tabPlacement: "pane"`); run read-only commands; emit output to its buffer. |
| `idle`             | Sub-orchestrator's pane is alive, no in-flight work, no `block` challenges  | Orchestrator dispatches a new task, or an adversarial produces a `block` challenge | Same as `busy`, just waiting. |
| `spawned-fixer`    | Orchestrator called `spawnFixer(workstream)` in response to a `block` challenge; fixer pane created in the sub-orchestrator's tab | Fixer applies the patch and reports back                              | Read + write (`capability: "readwrite"`); the patch is logged to the challenge log. |
| `idle` (post-fixer)| Fixer reported back; verifier (per-workstream adversarial or `adv-global`) accepts the patch | New task or new challenge                                              | Same as `idle`. |
| `terminated`       | The orchestrator is closed, or the herdr daemon is stopped                  | (terminal)                                                              | None. |

**Sub-orchestrators are leaf-coordinators.** A sub-orchestrator
cannot spawn a sub-sub-orchestrator. Sub-agents under a
sub-orchestrator are panes (not tabs), and the
`tabPlacement` for those children is always `"pane"`. The
spec-2 invariant is exactly one sub-orchestrator per tab.

**Sub-orchestrators are siblings, not children-of-children.** Each
sub-orchestrator tab is a sibling of the orchestrator's tab in the
same workspace. There is no parent–child relationship between
sub-orchestrators; they are peers that the orchestrator coordinates.

---

## 5.3 User-tab behavior

The user tab is a single bash REPL in pane 0 of the `user`-labeled
tab. It is created in phase A of `spawnOrchestrationTeam()`, before
any sub-orchestrator is spawned. The behaviors below are the spec-2
contract:

1. **Always present.** Every orchestrator workspace has exactly one
   user tab. The spec's `[[workspace]]` array MUST declare exactly
   one block with `role = "user"`, and that block's first tab MUST
   have `label = "user"`. The validator in
   `src/launch-sandbox.ts:parseLaunchSandboxSpec` enforces both
   (see §5.5).
2. **Bash interactive.** The user tab's root pane is `bash`. The
   user types commands; bash executes them; output goes to the user
   tab's buffer.
3. **Isolated from sub-orchestrators.** No sub-orchestrator pane is
   ever in the user tab. The runtime hook in
   `impl/pty/herdr-session.ts:spawnPane` (see §5.4) rejects any
   `targetTabId` whose tab label starts with `user-`. The
   orchestrator system prompt carries the same rule in plain
   English.
4. **Isolated from the orchestrator's output.** The orchestrator
   *reads* the user tab via `herdr pane read <user-pane>` to see
   what the user typed. The orchestrator does **not** `send-text`
   into the user tab. The user owns that tab; the orchestrator is
   a guest observer.
5. **Filtered out of sub-orchestrator pane lists.** When the
   orchestrator hands a sub-orchestrator the list of panes it
   should coordinate with, the user tab's pane id is **filtered
   out**. A sub-orchestrator that asks `herdr pane list` itself
   *will* see the user pane (it is in the same workspace), but the
   orchestrator does not pass it in the dispatch envelope.

**Fresh per call, not persistent.** A fresh user tab is created on
every `spawnOrchestrationTeam` invocation. The `userWorkspace.paneId`
differs across calls; only the `workspaceId` is shared. This is what
the F7 test `user tab is preserved across multiple
spawnOrchestrationTeam calls` asserts in
`test/sandbox/impl/__tests__/live/orchestration.spec.ts`. The
rationale: reusing a user tab across orchestrator sessions would
leak bash state (history, environment, working-directory changes)
between unrelated user interactions. ADR 0003 pins this.

---

## 5.4 The runtime hook in `spawnPane`

`impl/pty/herdr-session.ts:HerdrSession.spawnPane` has a label-based
guard at the top of the method. The guard is the only mechanical
guarantee that a sub-agent calling `spawnPane` cannot land in the
user tab from inside the runtime hook layer.

```ts
if (typeof opts.targetTabId === "string" && opts.targetTabId.length > 0) {
  const tabLabel = readTabLabel(this.containerId, opts.targetTabId);
  if (tabLabel !== null && (tabLabel === "user" || tabLabel.startsWith("user-"))) {
    throw new Error(
      `spawnPane: refused — target tab is reserved (user-*) (tabId="${opts.targetTabId}", label="${tabLabel}")`,
    );
  }
}
```

The guard reads the **label** of the target tab, not the id. Labels
are human-readable and pinned to `"user"` by `launch-sandbox.toml`.
The guard fires when:

- `targetTabId` is set (otherwise the spawn goes to a default tab
  and the guard is irrelevant), AND
- the resolved label is `"user"` or starts with `"user-"`.

The guard does **not** fire for `tabLabel = "orch-scaffold_2"` or
any other non-user label. F7 in
`test/sandbox/impl/__tests__/live/orchestration.spec.ts` pins this
behavior: `spawnPane(["bash"], { targetTabId: <user-tab> })` is
expected to reject with an error matching `/refused/i`.

> **Stage C fix (Challenge 3) — opt-in semantics:** the guard is
> **opt-in via `targetTabId`**. If a caller invokes
> `spawnPane(cmd)` (no `targetTabId`), the guard is silently
> bypassed: the call goes through herdr's default tab, and herdr's
> default may be the user tab on some versions. The orchestrator
> itself never uses that overload — every spawn it issues either
> passes `targetTabId` (when targeting a specific tab) or goes
> through `spawnPaneInNewTab` (which creates a fresh tab and does
> not reuse the user tab). The "mechanical guarantee against
> landing in the user tab" therefore only holds for callers that
> pass `targetTabId` explicitly. Callers that omit `targetTabId`
> are responsible for routing via `spawnPaneInNewTab` or for
> ensuring the daemon's default tab is not `user-*`. F7 in
> `orchestration.spec.ts` is the test that documents the
> opt-in shape: the guard fires with `targetTabId` and does
> **not** fire without it.

**Limitation.** A misbehaving sub-agent that calls
`docker exec herdr ...` directly (bypassing the runtime's
`spawnPane`) skips this guard. Spec-3's OS-UID separation is the
proper mitigation; ADR 0002 documents this.

**Read access is unconstrained.** The guard only blocks writes
(`spawnPane`); reads via `herdr pane read <user-pane>` are allowed
for any pane, including the orchestrator. The orchestrator uses
reads to observe what the user typed; sub-orchestrators that happen
to read the user pane see only the user's bash history, not the
orchestrator's state.

---

## 5.5 TOML spec format for declaring a user workspace

The spec-2 `launch-sandbox.toml` (at `src/launch-sandbox.toml`)
declares the user workspace as a `[[workspace]]` block with
`role = "user"`. The validator in
`src/launch-sandbox.ts:parseLaunchSandboxSpec` requires:

```toml
[[workspace]]
label = "user"
role = "user"
tab = [{ label = "user", cmd = ["bash"] }]
```

The validator enforces three constraints:

1. **Role is one of `"orchestrator"` or `"user"`.** A missing
   `role` defaults to `"orchestrator"`. Any other value throws
   `LaunchSandboxSpecError` with
   `field = "workspace[<i>].role"` and
   `reason = "unknown role <value>; allowed: 'orchestrator', 'user'"`.
2. **Exactly one `[[workspace]]` block has `role = "user"`.** Zero
   is rejected with
   `field = "workspace"` and
   `reason = "no [[workspace]] has role = 'user'; every orchestrator workspace must be paired with a user workspace (see ADR 0002)"`.
   More than one is rejected with
   `field = "workspace"` and
   `reason = "more than one [[workspace]] has role = 'user' (found N); exactly one user workspace is allowed (see ADR 0002)"`.
3. **The user block's first tab's `label` is exactly `"user"`.**
   The runtime hook keys off this string. A different label is
   rejected with
   `field = "workspace[<i>].tab[0].label"` and
   `reason = "user workspace's first tab label must be 'user' (the runtime hook keys off the 'user-' prefix), got <value>"`.

If the TOML is valid, `reserveUserWorkspaceFromSpec()` returns a
`UserWorkspaceHandle` with synthesized (but deterministic) workspace
/ tab / pane ids. The runtime overwrites those ids with real ones
from the herdr daemon in phase A of `spawnOrchestrationTeam` (see
`impl/orchestration/team-spawner.ts:spawnUserTab`).

---

## 5.6 How the user drives the orchestrator (the input channel)

The user tab is a regular bash REPL owned by the human. The
orchestrator does not auto-receive whatever the user types there.
The chosen input channel is **bash REPL via `herdr pane read`**:
the user types into the user tab as they would in any shell, and
the orchestrator's polling loop reads the user tab's pane via
`herdr pane read <user-pane>` to learn what the user typed. The
user does not need any TUI keybind or external CLI to drive the
orchestrator — the bash buffer is the channel.

> **Stage C fix (Challenge 2):** an earlier draft of this section
> also listed a TUI-keybind alternative (a keybind that pipes the
> current user-tab line into pane 0) and a CLI alternative (a
> `herdr pane send-text <orchestrator-pane>` wrapper). The chosen
> model is bash-REPL-via-`herdr pane read` only. The TUI and CLI
> alternatives are removed: the bash REPL is the only sanctioned
> user→orchestrator input channel, and the orchestrator is the
> only thing that reads the user tab. The TUI/CLI alternatives
> were not implemented in the runtime and documenting them as
> "in spec" was a wrong-branch claim. ADR 0003 Q4 records the
> pinning.

The orchestrator's reading of the user tab is the same mechanism
it uses to read sub-orchestrator panes (`herdr pane read`). The
runtime exposes `herdr pane read` to any pane; the orchestrator
uses it to observe both workstream progress and user input. A
sub-orchestrator that happens to read the user tab sees only the
user's bash history, not the orchestrator's state.

**The orchestrator never writes to the user tab.** ADR 0003 pins
this: the user owns the user tab, the orchestrator is a guest
observer. The orchestrator's replies to the user go into the
orchestrator's own pane (or into a per-workstream sub-orchestrator
pane, depending on context); they are not piped into the user tab.

---

## 5.7 How the orchestrator delegates to sub-orchestrators (fan-out)

When the orchestrator decides to dispatch work, it calls
`spawnOrchestrationTeam()` (or, for incremental dispatch,
`spawnFixer()` for a single workstream). The runtime spawns one
sub-orchestrator per workstream and returns immediately; the
orchestrator does not block.

The spawn loop in `impl/orchestration/team-spawner.ts:spawnOrchestrationTeam`
is:

```ts
for (const ws of workstreams) {
  let handle = await withRetry(
    () => spawnSubOrchestrator(session, ws, workspaceId),
    ...
  );
  ...
  subOrchestrators.push({ workstream: ws.name, paneId: handle.paneId, tabId: handle.tabId });
}
```

The `await` on each `spawnSubOrchestrator` is sequential at the
herdr-cli level (herdr spawns one tab at a time), but the resulting
sub-orchestrator panes are independent processes and run in
parallel. The orchestrator does not hold a continuation across a
sub-orchestrator's lifetime; it returns to `idle` as soon as
`spawnOrchestrationTeam` returns and from there polls the
per-sub-orchestrator panes via `herdr pane read`.

**Why not true parallel CLI spawns?** herdr's CLI does not
parallelize tab creation safely in our testing; sequential spawns
with linear-backoff retry (`withRetry` in
`impl/orchestration/team-spawner.ts`) is the lowest-risk option.
The orchestrator's wall-clock cost is dominated by the sub-orch's
work, not the spawn latency.

---

## 5.8 What happens when the orchestrator dies (same-daemon teardown)

The orchestrator's `pi` process in pane 0 is one of several
processes that share a single herdr daemon (created by
`HerdrSession.open` in `impl/pty/herdr-session.ts`; the daemon
holds the orchestrator pane, every sub-orchestrator pane, every
adversarial pane, every fixer pane, and the user tab pane).
"Orchestrator death" therefore has two distinct meanings that the
spec keeps separate:

1. **`pi` process death (panicked, killed, OOM).** The sub-orchestrators,
   adversarials, fixers, and the user tab **keep running** because
   the herdr daemon is still up. The orchestrator's polling loop is
   gone, so any `block` challenges emitted after the death are
   recorded in `/tmp/adversarial.log` with no consumer. The user
   can observe the gap and either (a) `closeOrchestratorSession()`
   to take the whole daemon down, or (b) call the new
   `OrchestratorSession.tearDownTree()` lifecycle phase (see below)
   to bring the sub-orchestrators down gracefully.
2. **Session close (whole-daemon teardown).** The user calls
   `closeOrchestratorSession()`, which sends `herdr server stop`
   via the runtime; that kills every pane in the daemon
   (orchestrator, sub-orchestrators, adversarials, fixers, and
   the user tab) in a single atomic step. There is no
   intermediate "orphan" period — the daemon is the lifecycle
   boundary.

**New `tearDownTree()` lifecycle phase (Stage C fix for Challenge 1).**
The orchestrator session now exposes an explicit phase that brings
the sub-tree down without taking the daemon out. It walks
`TeamSpawnResult.subOrchestrators` and sends `shutdown` (a
documented herdr signal) to each sub-orchestrator pane, then
transitions the orchestrator to `terminated`. The user tab is left
intact so the user can inspect output after the tree comes down.
The phase is opt-in; `closeOrchestratorSession()` is still the
default and is the right choice when the user wants a clean
session.

**No auto-respawn.** The runtime does not re-launch the
orchestrator's `pi` process if it dies. Recovery is the user's
responsibility: the user must close the session
(`closeOrchestratorSession()`) or call `tearDownTree()` and open a
new one. ADR 0003 pins this.

**Why not reparenting:** reparenting a sub-orchestrator to a new
orchestrator would require state transfer (the new orchestrator
would need to know the in-flight plans, the challenge log, the
surgical-fixer registry, the per-workstream adversarial states).
Spec-2 does not specify that transfer protocol. ADR 0003 records
this as a deliberate choice: the orchestrator is a coordinator,
not a controller; if it dies, the work it was coordinating is
lost, and the user starts over — *unless* the user calls
`tearDownTree()` first, in which case the sub-orchestrators
finish gracefully before the orchestrator hands over.
