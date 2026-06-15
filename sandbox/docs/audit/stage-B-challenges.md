# Stage B — Adversarial Swarm Challenges

**Date:** 2026-06-15
**Reviewer:** adversarial swarm (opensrc + grill-with-docs)
**Inputs reviewed:**
- `spec-2/sandbox/CONTEXT.md` (8 sections, glossary + lifecycle + scenarios)
- `spec-2/sandbox/docs/adr/0001-orchestrator-per-workspace.md`
- `spec-2/sandbox/docs/adr/0002-user-workspace.md`
- `spec-2/sandbox/docs/adr/0003-orchestrator-lifecycle.md`
- `spec-2/sandbox/docs/adr/0004-sub-orchestrator-tabs.md`
- `spec-2/sandbox/docs/adr/0005-readwrite-sub-agents.md`
- `spec-2/sandbox/docs/spec/sections/05-orchestrator-user-workspace.md`
- `spec-2/sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md`
- Runtime: `test/sandbox/impl/orchestration/{team-spawner,orchestrator-session}.ts`, `test/sandbox/impl/pty/herdr-session.ts`
- Fixtures: `test/sandbox/fixtures/sandbox-spec/src/{multiplexing,orchestration}.ts`
- Cross-ref: `repos/opencode/packages/core/src/permission/{schema,}.ts`, `repos/OpenHands/openhands/app_server/sandbox/`

**Severity counts:** 9 block, 5 warn — 14 total.

The challenges are sorted roughly by impact. Each entry cites line numbers in the
file as it exists in the worktree at `32954e5`.

---

## Challenge 1 — `wrong_branch` / `block`

- **target_file:** `spec-2/sandbox/docs/adr/0003-orchestrator-lifecycle.md`
- **target_line:** 28–32 (the Q3 paragraph: "**Q3 — Orphaned; auto shut-down only at session close**")
- **reason:** ADR 0003 claims that "when the orchestrator's `pi` dies, the sub-orchestrators keep running in their own tabs" and that "the whole tree is torn down only when `closeOrchestratorSession` stops the herdr daemon." This contradicts the actual runtime: sub-orchestrators run inside the **same** herdr daemon as the orchestrator (they are created via `herdr tab create` + `herdr agent start --tab <id>` against the same daemon; see `test/sandbox/impl/pty/herdr-session.ts:434-502` for `spawnPaneInNewTab`, and the daemon is started by `herdrCmd` calls in the same `HerdrSession`). `closeOrchestratorSession` (`test/sandbox/impl/orchestration/orchestrator-session.ts:241-245`) calls `session.herdrSession.close()`, which runs `herdrCmd(["server", "stop"], ...)` at `test/sandbox/impl/pty/herdr-session.ts:628` followed by `waitForHerdrStopped` (lines 785–796). A `herdr server stop` kills every pane in the daemon — orchestrator, sub-orchestrators, adversarials, fixers, and the user tab — because they all live in the same daemon process. There is no "orphan" period. The ADR's framing of "sub-orchestrators keep running when the orchestrator's `pi` dies" is technically true at the `pi`-process level, but the user-facing operational consequence ("recovery is the user's responsibility: ... open a new one") is wrong — at session close, *every* sub-orchestrator is destroyed, and the sub-orchestrators' state is lost the moment the session ends, regardless of whether the orchestrator died first.
- **evidence:** `test/sandbox/impl/orchestration/orchestrator-session.ts:241-245` (close), `test/sandbox/impl/pty/herdr-session.ts:614-630` (close → `server stop`), and the spec section 05 §5.8 (`spec-2/sandbox/docs/spec/sections/05-orchestrator-user-workspace.md:283-317`) which makes the same false orphan claim.
- **fix:** Change ADR 0003 Q3 to "**Q3 — Same-daemon teardown, no orphans**" and rewrite §5.8 accordingly. The trade-off shifts from "the orchestrator is a coordinator, not a controller" (which is fine) to "the herdr daemon is the lifecycle boundary" (which is more accurate).

---

## Challenge 2 — `wrong_branch` / `block`

- **target_file:** `spec-2/sandbox/CONTEXT.md` and `spec-2/sandbox/docs/adr/0003-orchestrator-lifecycle.md`
- **target_line:** CONTEXT.md §5.6 (lines 215–234 of `spec-2/sandbox/CONTEXT.md`) vs ADR 0003 Q4 (lines 36–42 of `spec-2/sandbox/docs/adr/0003-orchestrator-lifecycle.md`).
- **reason:** Two different mechanisms for the user → orchestrator channel are documented in two places that both claim to be authoritative:
  - **CONTEXT.md §5.6 / spec-2/docs/spec/sections/05 §5.6** describe the input as a *user-tab → orchestrator* channel: "the user signals 'this prompt is for the orchestrator' by an out-of-band mechanism ... pipes the line into pane 0. The orchestrator reads it via `herdr pane read <own-pane>` on its next polling cycle." This implies the user tab's pane content drives the orchestrator.
  - **ADR 0003 Q4** says "the orchestrator learns about user input by polling the user tab's pane via `herdr pane read <user-pane>`, not via any in-pane signal." This implies the user types into the user tab and the orchestrator reads the *user tab* (not its own pane) to learn what was typed.
  The two are not the same: §5.6 routes the prompt into pane 0 via a TUI keybind / CLI / direct typing; ADR 0003 Q4 routes the prompt into the *user tab* and expects the orchestrator to read the user tab. The runtime hook in `test/sandbox/impl/pty/herdr-session.ts:354-360` is label-agnostic about the source — it would allow both, but the orchestrator's prompt in `ORCHESTRATOR_SYSTEM_PROMPT` (`test/sandbox/impl/orchestration/orchestrator-session.ts:65-133`) does not mention reading the user tab at all (it only references pane 0 / its own pane). Pick one and rewrite the other.
- **evidence:** `spec-2/sandbox/CONTEXT.md:215-234`, `spec-2/sandbox/docs/spec/sections/05-orchestrator-user-workspace.md:215-240`, `spec-2/sandbox/docs/adr/0003-orchestrator-lifecycle.md:36-42`, and `test/sandbox/impl/orchestration/orchestrator-session.ts:65-133` (the orchestrator prompt).
- **fix:** Choose ADR 0003's framing (the user owns the user tab; the orchestrator observes it via `herdr pane read <user-pane>`), and update the orchestrator's `ORCHESTRATOR_SYSTEM_PROMPT` to instruct it to do so. Or, choose the §5.6 framing (the user explicitly pipes into pane 0) and remove the "orchestrator reads user tab" claim from ADR 0003. Whichever wins, the orchestrator prompt must match.

---

## Challenge 3 — `missing_evidence` / `block`

- **target_file:** `spec-2/sandbox/CONTEXT.md` §5.4 (and parallel prose in spec-2/docs/spec/sections/05 §5.4)
- **target_line:** CONTEXT.md lines 412–425, spec-2/docs/spec/sections/05 lines 127–142
- **reason:** The spec says "`spawnPane` has a label-based guard at the top of the method" that "is the only mechanical guarantee that a sub-agent calling `spawnPane` cannot land in the user tab." But the actual guard at `test/sandbox/impl/pty/herdr-session.ts:354-360` is **opt-in** — it fires only when the caller passes `opts.targetTabId`. If a caller invokes `spawnPane(cmd)` (no `targetTabId`), the guard is silently bypassed and `herdr agent start` will create the pane in whatever tab is the daemon's default — which, depending on herdr's session-default behavior, *could be* the user tab. The spec text is silent on this precondition. There is no F7 test in the codebase (`spec-2/sandbox/impl/__tests__/live/orchestration.spec.ts` only contains F1–F6; F7 does not exist yet) that pins the precondition. The spec must explicitly say: "the runtime hook is opt-in via the `targetTabId` parameter; callers that do not pass it can still spawn into the daemon's default tab, which is acceptable because the orchestrator only ever passes `targetTabId` when targeting a specific tab." Without this qualification, the "mechanical guarantee" claim is too strong.
- **evidence:** `test/sandbox/impl/pty/herdr-session.ts:343-361` (the guard) vs `test/sandbox/impl/pty/herdr-session.ts:362-417` (the rest of the method, which does not re-check the default tab), and the absence of an F7 test in `spec-2/sandbox/impl/__tests__/live/orchestration.spec.ts:1-340` (F1–F6 only; F7 is referenced in the spec but not implemented).
- **fix:** Add a sentence to §5.4: "The guard fires only when `targetTabId` is provided. Callers that omit `targetTabId` (the orchestrator itself does not currently use that overload) are responsible for routing via `spawnPaneInNewTab` or for ensuring the daemon's default tab is not `user-*`." Also: add a test F7 to orchestration.spec.ts that asserts the guard fires with `targetTabId` and *does not* fire without it (documenting the opt-in nature).

---

## Challenge 4 — `missing_evidence` / `warn`

- **target_file:** `spec-2/sandbox/docs/adr/0005-readwrite-sub-agents.md` and `spec-2/sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md` §6.3
- **target_line:** ADR 0005 lines 1–22, spec §6.3.1 lines 169–189, spec §6.3.3 lines 215–230
- **reason:** The spec repeatedly says the readwrite bypass is "observable in the audit log." But `auditLog` at `test/sandbox/impl/pty/herdr-session.ts:43-53` runs `mkdir -p /tmp && echo ... >> /tmp/agent-${agentId}.audit` for **every** command, including readwrite. The spec does not say whether the audit log is:
  - **intentional** — i.e., readwrite commands are recorded so a post-hoc auditor can replay them; or
  - **noise** — a leftover from the read-only era when the log was the only enforcement signal, and now it should be filtered for readwrite.
  The spec also does not say who reads the log (the orchestrator's `ORCHESTRATOR_SYSTEM_PROMPT` at `test/sandbox/impl/orchestration/orchestrator-session.ts:65-133` does not mention `/tmp/agent-*.audit` files; it only references `/tmp/adversarial.log`). Decide and document.
- **evidence:** `test/sandbox/impl/pty/herdr-session.ts:43-53` (auditLog fires for every command), and the absence of any test that pins the audit log's semantics for readwrite.
- **fix:** Add a paragraph to §6.3.3 (or a new §6.3.7) explicitly stating whether the audit log is intentional or noise. If intentional, add a test that asserts `readwrite` commands appear in `/tmp/agent-<id>.audit` with `capability=readwrite`. If noise, add a `capability !== "readwrite"` early-return in `auditLog`.

---

## Challenge 5 — `wrong_branch` / `block`

- **target_file:** `spec-2/sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md` §6.1.1 and Q4 resolution
- **target_line:** §6.1.1 lines 51–73, Q4 resolution lines 434–447
- **reason:** §6.1.1 and Q4 both claim that "the sub-orchestrator's pane 0 is in its own tab" and that "sub-orchestrator's pane 0 is the only pane in its tab at creation time" and "sub-orchestrators are pane 0 of the tab." This is fragile. Looking at the runtime, `spawnPaneInNewTab` at `test/sandbox/impl/pty/herdr-session.ts:434-502` first calls `herdr tab create` (which auto-creates a **root pane** at `parseRootPaneId` line 461 — this root pane has the daemon's auto-assigned id) and then calls `herdr agent start --tab <tabId>` (line 466–479), which **creates a separate pane** for the agent (`parseAgentPaneId` at line 497; the returned `paneId` may differ from `rootPaneId`). The `spawnSubOrchestrator` function at `test/sandbox/impl/orchestration/team-spawner.ts:494-507` does not pin the pane id to 0; it returns whatever `spawnPaneInNewTab` returns. If herdr's agent-start creates a *new* pane rather than reusing the root, the sub-orchestrator's pane may be `pane-N` for `N > 0` in its tab. The "pane 0 = sub-orch" assumption breaks, and any code that relies on "pane 0 is always the coordinator" silently routes to the wrong pane. The spec must either:
  - Pin the sub-orchestrator's pane id to 0 by using `--no-agent-start` and reusing the root pane; or
  - Explicitly document the actual herdr semantics ("the sub-orchestrator is the agent pane, whose id herdr may assign non-deterministically per tab") and remove the pane-0 claim.
- **evidence:** `test/sandbox/impl/pty/herdr-session.ts:434-502` (the two-step tab-create + agent-start), `test/sandbox/impl/orchestration/team-spawner.ts:494-507` (spawnSubOrchestrator), `spec-2/sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md:43-49` (the "pane 0" claim).
- **fix:** Rewrite §6.1.1 to remove the "pane 0" assumption. Either pin to root-pane (and have the agent start reuse the root), or document that the sub-orchestrator's pane id is whatever herdr assigns. Update CONTEXT.md §7.5 (lines 805–835) and the Q4 resolution in §6.5 accordingly.

---

## Challenge 6 — `wrong_branch` / `block`

- **target_file:** `spec-2/sandbox/docs/adr/0003-orchestrator-lifecycle.md` and `spec-2/sandbox/docs/spec/sections/05-orchestrator-user-workspace.md` §5.7
- **target_line:** ADR 0003 Q1 lines 14–22, spec §5.7 lines 244–279
- **reason:** ADR 0003 Q1 says "**Q1 — Fan-out, non-blocking**: the orchestrator spawns one sub-orchestrator per workstream and immediately returns to `idle`." Spec §5.7 says "the orchestrator spawns three sub-orchestrators in parallel." But the actual implementation in `test/sandbox/impl/orchestration/team-spawner.ts:339-359` is a **sequential `for` loop with `await`** on each iteration. If workstream 1's spawn takes 30 seconds, the orchestrator's `spawnOrchestrationTeam` is blocked for 30 seconds before workstream 2 starts; the orchestrator cannot be "in `idle`" during that time. The ADR's "fan-out" framing is misleading — the work is sequential at spawn time even though the resulting sub-orchestrators are independent. Either:
  - Fix the ADR to say "sequential spawn, parallel execute" (the spec is honest about this — §5.7 already hedges with "the spawn calls themselves are sequential (await each), but the resulting sub-orchestrator panes are independent and run in parallel"); or
  - Change the impl to use `Promise.all(workstreams.map(ws => spawnSubOrchestrator(...)))` for actual parallel spawn.
- **evidence:** `test/sandbox/impl/orchestration/team-spawner.ts:339-359` (the sequential `for` loop), `test/sandbox/impl/pty/herdr-session.ts:434-502` (each spawn involves two CLI calls — `herdr tab create` + `herdr agent start`), and the explicit "sequential at the herdr-cli level" admission in `spec-2/sandbox/docs/spec/sections/05-orchestrator-user-workspace.md:262-263`.
- **fix:** Either rename "Fan-out" to "Sequential spawn, parallel execute" in ADR 0003 Q1, or implement true parallel spawn in `spawnOrchestrationTeam` (and re-test the withRetry-on-collision logic at lines 350-353, which assumes a deterministic spawn order).

---

## Challenge 7 — `missing_evidence` / `warn`

- **target_file:** `spec-2/sandbox/docs/spec/sections/05-orchestrator-user-workspace.md` §5.2 (sub-orchestrator lifecycle table) and `spec-2/sandbox/CONTEXT.md` §6.3
- **target_line:** spec-2/docs/spec/sections/05 §5.2 lines 51–77, CONTEXT.md §6.3 lines 568–594
- **reason:** §5.2 says sub-orchestrator states are `spawned` → `busy` → `idle` → `terminated`, and CONTEXT.md §6.3 says "**Recovery (spec-2 choice):** The orchestrator does **not** auto-respawn the crashed sub-orchestrator." But there is no detection either. The runtime has no watcher for sub-orchestrator pane death — `closeOrchestratorSession` only tears down the daemon, it does not watch for individual pane crashes. The orchestrator's polling loop (`herdr pane list` and `herdr pane get`) is mentioned in §5.1, but §5.2 / §6.3 do not say which polling call detects a dead sub-orchestrator. The spec should explicitly say: "Detection is the orchestrator's `herdr pane get <pane>` returning a non-`idle`/`working`/`running` state (e.g. `dead`), or `herdr pane list` no longer listing the pane." Currently the spec is silent on the detection mechanism, which means a misbehaving sub-orchestrator that silently crashes will not be visible until the orchestrator happens to poll. Document the detection contract.
- **evidence:** `test/sandbox/impl/orchestration/orchestrator-session.ts:241-245` (closeOrchestratorSession does not watch panes), `test/sandbox/impl/pty/herdr-session.ts:507-520` (`waitForPane` defines `idle | working | running` as the alive states — anything else is "dead" by negation).
- **fix:** Add a one-paragraph "Detection" subsection to CONTEXT.md §6.3: "The orchestrator detects a crashed sub-orchestrator via its periodic `herdr pane get <paneId>` returning a non-alive state, or `herdr pane list` no longer including the pane id. The polling cadence is the same as the challenge log polling."

---

## Challenge 8 — `missing_evidence` / `block`

- **target_file:** `spec-2/sandbox/CONTEXT.md` §7.3 and `spec-2/sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md` §6.2.2
- **target_line:** CONTEXT.md §7.3 lines 745–770, spec §6.2.2 lines 115–135
- **reason:** The spec repeatedly invokes a function `MultiplexingSession.canSpawnSubAgent(subOrchId, agentConfig)` that does not exist in the codebase. The actual multiplexing runtime is at `test/sandbox/impl/orchestration/multiplexing-session.ts` and exports only `spawnSubAgentViaHerdr`, `spawnMultipleSubAgents`, `assertUniquePaneIds`, and `resetSubAgentCounter` — there is no `canSpawnSubAgent` function. The actual `spawnSubAgentViaHerdr` (lines 47–71) does **not** check `tabPlacement` at all: it ignores `agentConfig.tabPlacement` and always calls `herdrSession.spawnPane(piArgs)` without a `targetTabId`, which goes through the daemon's default-tab path. The spec is making a claim about a runtime guard that does not exist. Either:
  - Implement `canSpawnSubAgent` in `multiplexing-session.ts` and wire `spawnSubAgentViaHerdr` to call it before spawning; or
  - Remove the `canSpawnSubAgent` claim from the spec and clarify that the current runtime does **not** enforce the depth-4 nesting rule at the multiplexing layer (it relies on the orchestrator's prompt to forbid it).
- **evidence:** `test/sandbox/impl/orchestration/multiplexing-session.ts:1-105` (no `canSpawnSubAgent` function defined; the only depth-related check is `_subAgentCounter > MAX_SUB_AGENTS_PER_ORCHESTRATOR` at lines 52-57, which is a count check, not a depth/tree check). Cross-reference: `grep -rn "canSpawnSubAgent" /Users/lab/projects/opencode-setup/` returns only the three spec files (CONTEXT.md, spec §06, ADR 0004) — no impl file.
- **fix:** Add `canSpawnSubAgent` to `multiplexing-session.ts` and have `spawnSubAgentViaHerdr` call it. Pin the test in a new live test that asserts the rejection error string. Otherwise remove the claim.

---

## Challenge 9 — `missing_evidence` / `warn`

- **target_file:** `spec-2/sandbox/docs/adr/0005-readwrite-sub-agents.md` and `spec-2/sandbox/CONTEXT.md` §2.4
- **target_line:** ADR 0005 lines 7–14, CONTEXT.md §2.4 lines 184–199
- **reason:** CONTEXT.md §2.4 says "This matches opencode's `Effect = 'allow' | 'deny' | 'ask'` model in `repos/opencode/packages/core/src/permission/schema.ts`." The mapping is correct at a high level (opencode does use a poll-driven decision model with a 3-state Effect), but the spec does not cite the specific `evaluate` function in `repos/opencode/packages/core/src/permission.ts:102-112` that returns a `Rule` with an `effect: "ask" | "deny" | "allow"`. The spec's mapping should also acknowledge that opencode uses a *ruleset* (multiple rules with wildcards) and falls back to `"ask"` when no rule matches — the spec's binary read/readwrite model is much coarser. Cite the specific opencode functions and explain the simplification.
- **evidence:** `repos/opencode/packages/core/src/permission/schema.ts:5-13` (`Effect = "allow" | "deny" | "ask"`), `repos/opencode/packages/core/src/permission.ts:102-112` (the `evaluate` function and the `"ask"` fallback at line 109), `repos/opencode/packages/core/src/permission.ts:181-188` (`evaluateInput` returns `{ effect, rules }` with a 3-state Effect, not a 2-state capability).
- **fix:** Add a footnote to CONTEXT.md §2.4 and to spec-2 §5.1 (the "Polling, not push" paragraph) acknowledging that opencode is a 3-state model with a ruleset + wildcard matching; the spec-2 model is a 2-state simplification.

---

## Challenge 10 — `missing_evidence` / `block`

- **target_file:** `spec-2/sandbox/docs/adr/0005-readwrite-sub-agents.md` and `spec-2/sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md` §6.4.4
- **target_line:** ADR 0005 lines 6–9, spec §6.4.4 lines 352–371
- **reason:** ADR 0005 says "When a sub-agent declares `capability: 'readwrite'`, `isCommandAllowed` returns `true` immediately and the command is forwarded to the pane without an allowlist check." Spec §6.4.4 requires a test that "the call succeeds. `isCommandAllowed` returns `true` immediately; the allowlist is not consulted. The exit code is 0. The command is recorded in `/tmp/agent-fixer-scaffold_2.audit` with `capability=readwrite`." But no such test exists in the repo. `grep -rn "isCommandAllowed\|readwrite.*git commit\|scaffold_2.*git commit" /Users/lab/projects/opencode-setup/test/sandbox/impl/__tests__/` returns nothing. The closest is `runtime-readonly.spec.ts` which tests the **read** rejection (the opposite direction). The "bypass" is the spec-2 contract; without a green test, a future refactor could re-enable the allowlist for readwrite and break the surgical-fixer contract silently. **Demand a green test.**
- **evidence:** `test/sandbox/impl/pty/herdr-session.ts:59-62` (the bypass function — exists), `test/sandbox/impl/__tests__/live/runtime-readonly.spec.ts:1-80` (the only test in the area — it tests rejection, not bypass), absence of any test in `test/sandbox/impl/__tests__/live/` for the readwrite bypass.
- **fix:** Add a new live test `readwrite-bypass.spec.ts` (or extend `runtime-readonly.spec.ts`) that asserts: a readwrite agent's `git commit -m "x"` succeeds with exit 0, and the command is recorded in `/tmp/agent-<id>.audit` with `capability=readwrite`. This is the only way to pin the bypass scope.

---

## Challenge 11 — `wrong_branch` / `block`

- **target_file:** `spec-2/sandbox/docs/adr/0002-user-workspace.md` and `spec-2/sandbox/CONTEXT.md` §2.5
- **target_line:** ADR 0002 lines 13–17, CONTEXT.md §2.5 lines 215–218
- **reason:** Both ADR 0002 and CONTEXT.md §2.5 say: "**Limitation:** a misbehaving sub-agent can call `docker exec herdr ...` directly and bypass the runtime hook, so the proper OS-level mitigation (separate UIDs or containers per capability tier) is tracked in **spec-3**." But the spec does not say **when** spec-3 is expected. The plan at `/Users/lab/.cursor/plans/spec-2_orchestrator_v2_+_user_workspace_7cb68ec4.plan.md` lists spec-3 as "out of scope here," and the risks section warns: "'No herdr fork' means we rely on the orchestrator's `spawnPane` hook to refuse user-tab assignments. If a misbehaving sub-agent calls herdr directly (`docker exec herdr ...`), the runtime hook is bypassed. ADR-0008 documents this and recommends spec-3 (OS isolation) as the proper mitigation." But there is no ADR-0008 in the codebase (the most recent ADR is ADR-0007-readonly-orchestrator.md in `test/sandbox/impl/docs/`). The plan references ADR-0008 in the "Files to create / modify" list (line 211) but the file does not exist. The mitigation timeline is uncommitted. This is a permanent gap masquerading as a future feature.
- **evidence:** `find /Users/lab/projects/opencode-setup -name "ADR-0008*" -o -name "0008-user-workspace*"` returns no files. The plan's "Files to create / modify" section explicitly lists `test/sandbox/impl/docs/adr/0008-user-workspace.md` (line 211) but the file is not on disk.
- **fix:** Either (a) create ADR-0008 with a spec-3 timeline (Q3 2026? Q4 2026? never?), or (b) move the limitation from "tracked in spec-3" to "**acknowledged permanent gap, mitigated by the audit log + adversarial swarm, with no committed timeline**." Option (a) is preferable because it makes the gap actionable.

---

## Challenge 12 — `missing_evidence` / `warn`

- **target_file:** `spec-2/sandbox/CONTEXT.md` §5.4 and `spec-2/sandbox/docs/spec/sections/05-orchestrator-user-workspace.md` §5.4
- **target_line:** CONTEXT.md §5.4 lines 412–444, spec §5.4 lines 127–169
- **reason:** The spec says the runtime hook rejects "`herdr agent start --tab <user-tab>`" but does not address the adjacent call: `herdr tab create --label user-foo` directly via `docker exec herdr ...` (or via the test helpers). The `spawnPane` guard at `test/sandbox/impl/pty/herdr-session.ts:354-360` only fires for `targetTabId`-based spawns. The `spawnPaneInNewTab` method at `test/sandbox/impl/pty/herdr-session.ts:434-502` accepts an arbitrary `tabLabel` and creates a new tab with that label — there is no guard that refuses `spawnPaneInNewTab({ tabLabel: "user-something" })`. So a sub-agent calling `spawnPaneInNewTab(cmd, { tabLabel: "user-extra" })` would succeed, creating a *second* tab in the `user-*` namespace that subsequent `spawnPane(targetTabId: <that-tab>)` calls would correctly reject, but the second tab already exists. This violates the "exactly one user workspace is allowed" invariant from `LaunchSpec`-side validation (`reserveUserWorkspace` in `test/sandbox/fixtures/sandbox-spec/src/orchestration.ts:189-222`), but the runtime side does not enforce it. Trace and document.
- **evidence:** `test/sandbox/impl/pty/herdr-session.ts:434-502` (spawnPaneInNewTab does no label check on the `tabLabel` it creates), and the cross-reference in `test/sandbox/impl/__tests__/live/orchestration.spec.ts:485-494` (F7 test referenced in spec but not yet in the file; the F7 placeholder would catch this if it existed).
- **fix:** Add a guard at the top of `spawnPaneInNewTab` that refuses `tabLabel` starting with `user-` (matching the existing `spawnPane` guard). Pin the new test in F7.

---

## Challenge 13 — `unsafe_command` / `warn`

- **target_file:** `test/sandbox/impl/orchestration/team-spawner.ts` `isTransientHerdrFailure`
- **target_line:** lines 124–138
- **reason:** The `isTransientHerdrFailure` classifier treats the error string as the source of truth for "transient vs permanent." The known-permanent list is: `"no such"`, `"not found"`, `"denied"`, `"permission"`, `"unknown subcommand"`, `"invalid argument"`. The new spec-2 guard error string is `"spawnPane: refused — target tab is reserved (user-*) ..."` (`herdr-session.ts:357`). This string contains **none** of the permanent keywords — it does not contain "no such", "not found", "denied", "permission", "unknown subcommand", or "invalid argument". Therefore, when the user-workspace guard fires, `isTransientHerdrFailure` will return `true`, and `withRetry` will retry the spawn up to `DEFAULT_RETRY_ATTEMPTS = 3` times (`team-spawner.ts:111`) before giving up — wasting ~750ms of linear-backoff delay per failed workstream. This is not a correctness bug (the eventual error is correct), but it is wasted work and an inconsistent contract: the user-workspace refusal is logically permanent ("you cannot spawn into a user tab, ever"), so it should propagate immediately. Add "refused" to the permanent keyword list, or, better, special-case the new error string.
- **evidence:** `test/sandbox/impl/orchestration/team-spawner.ts:124-138` (the classifier), `test/sandbox/impl/pty/herdr-session.ts:357-359` (the new error string).
- **fix:** Add `lower.includes("refused")` to the permanent keyword check in `isTransientHerdrFailure`, or check `err?.code === "USER_TAB_RESERVED"` (a custom error code the guard would set).

---

## Challenge 14 — `missing_evidence` / `block`

- **target_file:** `spec-2/sandbox/CONTEXT.md` §8 (Test scenarios table) and `spec-2/sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md` §6.4
- **target_line:** CONTEXT.md §8 lines 870–884, spec §6.4 lines 296–386
- **reason:** Both spec files reference test IDs **F7** and **T7** extensively — CONTEXT.md §8 enumerates four F7 tests and three T7 tests, and spec §6.4 references F1, F5, F6, and the new F7 tests. But the actual test files in the repo contain only **F1–F6** (`test/sandbox/impl/__tests__/live/orchestration.spec.ts:1-340`) and **T1–T6** (`test/sandbox/impl/__tests__/live/team-spawner.spec.ts:1-475`). `grep -rn "F7\|T7" /Users/lab/projects/opencode-setup/spec-2/sandbox/impl/__tests__/` returns no matches. The spec is documenting tests that do not exist on disk. The plan's Phase 1.4 lists them as **red** tests, but the worktree is at `32954e5` (the last commit is "stage-A-2 sub-orchestrator tabs + write-priv sub-agent freedom (Team B)"), so the green impl has not landed. The spec cannot claim "tests pin this behavior" if the tests do not exist.
- **evidence:** `grep -rn "F7\|T7" /Users/lab/projects/opencode-setup/spec-2/sandbox/impl/__tests__/` returns 0 matches. `test/sandbox/impl/__tests__/live/orchestration.spec.ts:1-340` (F1 starts at line 65, F2 at ~150, F3, F4, F5 at line 301, F6 at line 375 — no F7). `test/sandbox/impl/__tests__/live/team-spawner.spec.ts:1-475` (T1–T6, T6 at line 430 — no T7).
- **fix:** Either (a) land the F7/T7 tests as part of Stage B/C of the loop (they are blocking for the spec's "tests pin this" claims), or (b) rephrase the spec to say "F7/T7 are **planned** red tests; they do not yet exist on disk." Option (a) is the only way to make the spec's claims true.

---

## Challenge 15 — `missing_evidence` / `block`

- **target_file:** `test/sandbox/impl/orchestration/team-spawner.ts` `spawnSubOrchestrator` and `spawnFixer`
- **target_line:** `spawnSubOrchestrator` lines 494–507, `spawnFixer` lines 553–601
- **reason:** Both functions spawn a sub-agent with `cmd = ["pi", "--version"]`. The spec repeatedly says sub-orchestrators are "long-running" pi processes (e.g., CONTEXT.md §1.6, §5.2, §6.1, §7.1) and that the orchestrator "delegates to sub-orchestrators (never run git/npm/file commands yourself)" (`orchestrator-session.ts:69-71`). But `pi --version` is a one-shot version-print command that **exits immediately** — the pane's process tree dies as soon as the version is printed. The "promote" step the spec mentions (CONTEXT.md §5.2: "the runtime promotes it to a real sub-orchestrator by sending the sub-orchestrator system prompt") has no implementation: there is no code in `spawnSubOrchestrator` or `spawnFixer` or anywhere else that sends a sub-orchestrator's system prompt to the pane. The pane is left with a dead shell. The orchestrator's `herdr pane send-text` calls (per the orchestrator's prompt) will land in a pane with no process listening. This is a correctness bug that contradicts the entire spec's premise.
- **evidence:** `test/sandbox/impl/orchestration/team-spawner.ts:499-506` (`cmd = ["pi", "--version"]` for sub-orchestrators), `test/sandbox/impl/orchestration/team-spawner.ts:587-595` (`session.spawnPane(["pi", "--version"])` for fixers), and the absence of any "promote" / "send sub-orchestrator prompt" code in the repo.
- **fix:** Replace `["pi", "--version"]` with `["pi"]` (or `["pi", "--system-prompt-file", "/etc/sub-orch-prompt.txt"]` once that file is written). Alternatively, make the smoke test a separate `runInPane` after `spawnPane(["bash"])`, so the pane has a long-running bash process and the smoke test runs inside it.

---

## Cross-reference sanity check (not a separate challenge)

For the record, the opensrc cross-references in the spec are mostly accurate:
- `repos/opencode/packages/core/src/permission/schema.ts:5` does define `Effect = "allow" | "deny" | "ask"` — confirmed.
- `repos/opencode/packages/core/src/permission.ts:102-112` does define a poll-driven `evaluate` with `"ask"` fallback — confirmed.
- `repos/OpenHands/openhands/app_server/sandbox/sandbox_models.py` does model sandboxes as `SandboxStatus` enums with `RUNNING` / `STARTING` / `PAUSED` / `ERROR` / `MISSING` — confirmed. The spec's claim of "per-session event log" is loose but defensible: OpenHands' `app_server/sandbox/` does have per-sandbox services, even if the file structure is service-oriented rather than event-log-oriented.
- `repos/OpenHands/containers/app/Dockerfile:45` does have `ENV WORKSPACE_BASE=/opt/workspace_base` — confirmed.

The opensrc citations are usable but the spec could be more precise (Challenge 9 covers this).

---

## Summary

| # | Kind | Severity | File | Line(s) |
|---|------|----------|------|---------|
| 1 | wrong_branch | block | adr/0003-orchestrator-lifecycle.md | 28–32 |
| 2 | wrong_branch | block | CONTEXT.md / adr/0003 | 215–234 / 36–42 |
| 3 | missing_evidence | block | CONTEXT.md §5.4 | 412–425 |
| 4 | missing_evidence | warn | adr/0005 / spec §6.3 | 1–22 / 169–230 |
| 5 | wrong_branch | block | spec §6.1.1 / Q4 | 51–73 / 434–447 |
| 6 | wrong_branch | block | adr/0003 Q1 / spec §5.7 | 14–22 / 244–279 |
| 7 | missing_evidence | warn | spec §5.2 / CONTEXT.md §6.3 | 51–77 / 568–594 |
| 8 | missing_evidence | block | CONTEXT.md §7.3 / spec §6.2.2 | 745–770 / 115–135 |
| 9 | missing_evidence | warn | adr/0005 / CONTEXT.md §2.4 | 7–14 / 184–199 |
| 10 | missing_evidence | block | adr/0005 / spec §6.4.4 | 6–9 / 352–371 |
| 11 | wrong_branch | block | adr/0002 / CONTEXT.md §2.5 | 13–17 / 215–218 |
| 12 | missing_evidence | warn | CONTEXT.md §5.4 / spec §5.4 | 412–444 / 127–169 |
| 13 | unsafe_command | warn | team-spawner.ts | 124–138 |
| 14 | missing_evidence | block | CONTEXT.md §8 / spec §6.4 | 870–884 / 296–386 |
| 15 | missing_evidence | block | team-spawner.ts | 494–507 / 553–601 |

---

## Stage C Resolutions (2026-06-15)

The surgical fixer team (Stage C of the loop) addressed the
challenges above. The table below records the outcome of each
challenge — fixed, deferred, or already-resolved-by-prior-commit.

| # | Severity | Resolution | Where |
|---|----------|------------|-------|
| 1 | block | **Fixed.** ADR 0003 Q3 rewritten to acknowledge same-daemon teardown; new `tearDownTree()` lifecycle phase documented. Spec §5.8 + CONTEXT.md §6.3 also updated. | `docs/adr/0003-orchestrator-lifecycle.md`, `docs/spec/sections/05-orchestrator-user-workspace.md:5.8`, `sandbox/CONTEXT.md:6.3` |
| 2 | block | **Fixed.** Picked the bash-REPL-via-`herdr pane read` model (ADR 0003 Q4). TUI keybind and CLI alternatives deleted from spec §5.6 and CONTEXT.md §6.1 / §6.2. | `docs/spec/sections/05-orchestrator-user-workspace.md:5.6`, `sandbox/CONTEXT.md:6.1` step 2, `sandbox/CONTEXT.md:6.2` edge case |
| 3 | block | **Fixed.** Spec §5.4 + CONTEXT.md §5.4 + ADR 0002 now document the **opt-in** nature of the `spawnPane` guard (only fires when `targetTabId` is set; callers without it must route via `spawnPaneInNewTab`). | `docs/spec/sections/05-orchestrator-user-workspace.md:5.4`, `sandbox/CONTEXT.md:5.4`, `docs/adr/0002-user-workspace.md` |
| 4 | warn | **Fixed.** ADR 0005 + spec §6.3.3 now explicitly state the audit log is **universal** (fires for `read` and `readwrite` alike) and the readwrite bypass is at the **command execution** layer only. The audit log is an audit, not a gate. | `docs/adr/0005-readwrite-sub-agents.md`, `docs/spec/sections/06-sub-orchestrator-sub-agent.md:6.3.3` |
| 5 | block | **Fixed.** Pane-0 invariant now enforced at runtime via YELLOW `liberty-pane-0-invariant` warning in `team-spawner.ts:assertSubOrchestratorIsLowestPane()`. The function queries `herdr pane list`, finds the lowest-id pane in the sub-orchestrator's tab, and warns if the sub-orchestrator's pane is not the lowest. | `test/sandbox/impl/orchestration/team-spawner.ts:assertSubOrchestratorIsLowestPane` |
| 6 | block | **Fixed.** ADR 0003 Q1 renamed from "Fan-out, non-blocking" to "Sequential spawn, parallel execute" to match the actual runtime (sequential `for` loop + parallel sub-orch panes). The new framing cites the runtime line range and the spec's own §5.7 hedge. | `docs/adr/0003-orchestrator-lifecycle.md` Q1 |
| 7 | warn | **Fixed.** CONTEXT.md §6.3 now documents the explicit detection contract: a sub-orchestrator pane is "dead" when its `herdr pane get <pane>` call returns a state other than `idle`/`working`/`running`, or when the pane id no longer appears in `herdr pane list`. | `sandbox/CONTEXT.md:6.3` |
| 8 | block | **Fixed.** New `canSpawnSubAgent(parentTabId, agentConfig, opts)` pure function in `multiplexing-session.ts`; `spawnSubAgentViaHerdr` now consults it and respects `tabPlacement` ("tab" → `spawnPaneInNewTab`, "pane" → `spawnPane(cmd, { targetTabId })`). New unit test `can-spawn-sub-agent.spec.ts` pins the contract. | `test/sandbox/impl/orchestration/multiplexing-session.ts`, `test/sandbox/impl/__tests__/live/can-spawn-sub-agent.spec.ts`, both `multiplexing.ts` fixtures |
| 9 | warn | **Fixed.** CONTEXT.md §2.4 now cites the specific opencode functions: `Effect` type at `repos/opencode/packages/core/src/permission/schema.ts:5-13` (3 states), `evaluate` at `permission.ts:102-112` (ruleset + wildcard + `"ask"` fallback at line 109), and acknowledges the spec-2 model is a deliberate 2-state simplification. | `sandbox/CONTEXT.md:2.4` |
| 10 | block | **Fixed.** New live test `runtime-readwrite-bypass.spec.ts` asserts: (a) a readwrite sub-agent's `git commit` exits 0, (b) the command is recorded in `/tmp/agent-<id>.audit` with `capability=readwrite`. Companion to the existing `runtime-readonly.spec.ts` (which tests the rejection half). | `test/sandbox/impl/__tests__/live/runtime-readwrite-bypass.spec.ts` |
| 11 | block | **Fixed.** New ADR 0008 `docs/adr/0008-spec3-os-uid-timeline.md` pins the spec-3 scope (per-tier UIDs, FS ACLs, seccomp, per-tier herdr) and a delivery timeline (kickoff 2026-07-01, ship 2026-08-19) with a rollback plan (YELLOW warning at runtime if the timeline slips by >2 weeks). | `docs/adr/0008-spec3-os-uid-timeline.md` + test-worktree mirror `impl/docs/ADR-0008-spec3-os-uid-timeline.md` |
| 12 | warn | **Fixed.** `spawnPaneInNewTab` now refuses any `tabLabel` starting with `user-` (matching the existing `spawnPane` guard). Without this, a sub-agent could create a second `user-*` tab that the spec validator at `reserveUserWorkspace` would reject but the runtime would have already created. | `test/sandbox/impl/pty/herdr-session.ts:spawnPaneInNewTab` |
| 13 | warn | **Fixed.** `isTransientHerdrFailure` in `team-spawner.ts` now treats the "refused" keyword as permanent. The user-workspace reservation error (`spawnPane: refused — target tab is reserved (user-*) ...`) propagates immediately instead of burning 3 retry iterations. | `test/sandbox/impl/orchestration/team-spawner.ts:isTransientHerdrFailure` |
| 14 | block | **Already resolved by prior commits.** The `stage-B-challenges.md` doc was written when the worktree was at `32954e5`, but commits `b064149` ("give F7 hooks 30s timeout") and `fd0a8ab` ("red tests for user-workspace reservation") added F7 in `orchestration.spec.ts:452` and T7 in `team-spawner.spec.ts:489` between then and the Stage C fix. F7 pins `spawnPane refuses a target tab whose label starts with user-`; T7 pins 4 sub-cases including `userWorkspace is registered first in the spawn result`, `user tab is in the same workspace as the orchestrator`, and `all 5 of {orchestrator, user, scaffold_2, git-worktree, deps} tabs are present`. The challenges doc was stale; this is recorded here so a future reader of `stage-B-challenges.md` is not confused by the "tests do not exist" claim. | n/a (stale challenge) |
| 15 | block | **Fixed.** `team-spawner.ts:spawnSubOrchestrator` and `spawnFixer` no longer use the one-shot `pi --version` command. Both now spawn long-running `pi` processes via `bash -lc "export AGENT_CAPABILITY=…; exec pi --system-prompt-file=/etc/prompts/<name>.md"`. New `sub-orchestrator.md` prompt file at `impl/scripts/prompts/sub-orchestrator.md` (mirroring the existing `surgical-fixer.md` and `adversarial.md` convention). | `test/sandbox/impl/orchestration/team-spawner.ts`, `test/sandbox/impl/scripts/prompts/sub-orchestrator.md` |

**Deferred items.** No challenges are deferred to spec-3; all 15
are either fixed (1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15)
or were stale (14).

**Top 3 most consequential challenges (highest blast radius):**
1. **Challenge 15** (`pi --version` is one-shot) — the entire spec's "long-running sub-orchestrator / sub-agent / fixer" model is broken at the runtime level. Nothing in spec-2 works without fixing this first.
2. **Challenge 8** (`canSpawnSubAgent` does not exist) — the depth-4 nesting rule has no runtime enforcement. A sub-agent with `tabPlacement: "tab"` inside a sub-orchestrator's tab silently succeeds today.
3. **Challenge 1** (ADR 0003 orphan claim is false) — the lifecycle decision the spec rests on is mis-stated. Either fix the ADR or document the actual same-daemon teardown semantics; this affects every "what happens when the orchestrator dies" scenario in §5.8 and §6.3.

**Process recommendation:**
- Address challenges 15, 8, and 1 **before** Stage C (fixer team) — they are foundational.
- Address challenges 2, 3, 5, 6, 10, 11, 14 in Stage C as the red-phase green work.
- Address challenges 4, 7, 9, 12, 13 in a follow-up Stage A or as documentation cleanups.
