# Stage B — Iteration 2 — Adversarial Swarm Challenges

**Date:** 2026-06-15
**Reviewer:** adversarial swarm (opensrc skill) — iteration 2
**Inputs reviewed:**
- Stage A diagnosis (delivered in the prior message — 5 spec gaps + 2 runtime fix scopes)
- `spec-2/sandbox/fixtures/sandbox-spec/src/multiplexing.ts:15-21` (`PANE_DELEGATION_MODE`)
- `spec-2/sandbox/fixtures/sandbox-spec/src/multiplexing.ts:90-113` (`spawnSubAgent`)
- `test/sandbox/impl/orchestration/multiplexing-session.ts:59-80` (`canSpawnSubAgent`)
- `test/sandbox/impl/orchestration/multiplexing-session.ts:90-149` (`spawnSubAgentViaHerdr`)
- `test/sandbox/impl/pty/herdr-session.ts:343-417` (`spawnPane`)
- `test/sandbox/impl/pty/herdr-session.ts:434-520` (`spawnPaneInNewTab`)
- `test/sandbox/impl/orchestration/orchestrator-session.ts:222-236` (`waitForPiReady`)
- `test/sandbox/impl/__tests__/live/orchestration.spec.ts:117-129` (F2 `beforeAll` timeout)
- `test/sandbox/impl/__tests__/live/orchestration.spec.ts:138-150` (F2 `pi --version` assertion)
- `spec-2/sandbox/docs/adr/0004-sub-orchestrator-tabs.md`
- Cross-ref: herdr v0.6.10 pane-id behavior captured in Stage A diagnosis
- Cross-ref: repos/opensrc, repos/opencode, repos/OpenHands (per `opensrc` skill)

**Severity counts:** 6 block, 1 warn — 7 total. (Plus 1 optional bonus challenge that the user flagged as "if you find one".)

The Stage A agent already did the diagnosis; this iteration's job is to
**formally challenge** the spec and the runtime against the 5 gaps + 2
fix scopes. Each entry is sized to be addressable by a single surgical
fixer in a few lines.

---

## Challenge 16 — `wrong_branch` / `block`

- **target_file:** `spec-2/sandbox/fixtures/sandbox-spec/src/multiplexing.ts` and `test/sandbox/impl/orchestration/multiplexing-session.ts`
- **target_line:** spec `multiplexing.ts:21` (`PANE_DELEGATION_MODE = "spawn_new_tab"`) ↔ runtime `multiplexing-session.ts:140-142` (`spawnPane(piArgs, { targetTabId: agentConfig.parentTabId })`).
- **reason:** Gap 1 of the Stage A diagnosis. The spec declares `PANE_DELEGATION_MODE = "spawn_new_tab"` and ADR 0004 commits sub-orchestrators to a fresh tab, but the runtime's `spawnPane` path used by `spawnSubAgentViaHerdr` (the `placement === "pane"` branch at `multiplexing-session.ts:140-142`) does **not** pass `--tab` to `herdr agent start` unless `opts.targetTabId` is set. In herdr v0.6.10, `herdr agent start` without `--tab` always returns the same `pane_id` (pane 0 of the current tab) regardless of how many `agent start` calls have been issued — confirmed by the Stage A docker-exec test. The reconciliation step in `spawnPane` (the "newest entry in `pane list`" fallback at `herdr-session.ts:399-414`) is itself racy and silently produces a wrong pane id under contention. So the spec's "one sub-orchestrator per tab" contract is broken at the `pane` placement path: the spec's default `DEFAULT_TAB_PLACEMENT = "pane"` (`multiplexing.ts:120`) means the *common* case is the broken one. ADR 0004 should be enforced by routing every `tabPlacement === "pane"` spawn through `spawnPaneInNewTab` instead of `spawnPane`, OR by always supplying `targetTabId` and forcing herdr to a known tab, OR by switching the default to `"tab"`. Pick one and amend the spec.
- **evidence:**
  - `spec-2/sandbox/fixtures/sandbox-spec/src/multiplexing.ts:15-21` — `PANE_DELEGATION_MODE = "spawn_new_tab"` and the "tab" / "pane" discriminator.
  - `spec-2/sandbox/fixtures/sandbox-spec/src/multiplexing.ts:100-113` — `spawnSubAgent` allocates a fresh tab id only when `placement === "tab"`; the `"pane"` branch reuses `parentTabId`.
  - `test/sandbox/impl/orchestration/multiplexing-session.ts:134-142` — runtime `spawnSubAgentViaHerdr` routes `"pane"` placement to `herdrSession.spawnPane(piArgs, { targetTabId: agentConfig.parentTabId })`.
  - `test/sandbox/impl/pty/herdr-session.ts:362-417` — `herdr agent start` without `--tab`; the `pane list` fallback at lines 399-414 reads `panes[panes.length - 1]`, which is non-deterministic under concurrent spawns.
  - `spec-2/sandbox/docs/adr/0004-sub-orchestrator-tabs.md:1-20` — ADR 0004 says "sub-orchestrators are always spawned into a fresh tab", but ADR 0004 does not say the *sub-agent* default (`"pane"`) also has the "fresh tab" guarantee.
  - Stage A diagnosis: "`herdr v0.6.10` returns the same `pane_id` for every `agent start` (no `--tab`)."
- **fix:** Amend `multiplexing.ts:SubAgentConfig.tabPlacement` JSDoc and ADR 0004 to explicitly say "the `pane` placement is in-pane of the parent tab; herdr's per-tab pane-id allocator is non-deterministic in v0.6.10 and so callers must call `herdr pane list` immediately after spawn to reconcile the pane id." In the runtime, change `spawnPaneInNewTab` to be the default and have `spawnSubAgentViaHerdr` (and the `spawnPane` fallback) always supply `--tab` via a tabId that the orchestrator has already created. The fix unblocks F3, ATK-2, `runtime-readonly:111`, and the debug-pane-races test (per Stage A Group 1).

---

## Challenge 17 — `missing_evidence` / `block`

- **target_file:** `test/sandbox/impl/orchestration/orchestrator-session.ts` and `test/sandbox/impl/__tests__/live/orchestration.spec.ts`
- **target_line:** `orchestrator-session.ts:222-236` (`waitForPiReady` runs `pi --version`) and `orchestration.spec.ts:138-150` (F2 it("herdr starts with pane 0 and pi is running in it")) and `orchestration.spec.ts:147` (the `pi --version` invocation).
- **reason:** Gap 3 of the Stage A diagnosis. `waitForPiReady` polls `pi --version` in pane 0 to confirm pi is alive. But pane 0 is now a **long-running pi REPL** (per the Stage C fix for Challenge 15, which replaced `pi --version` with `bash -lc "exec pi --append-system-prompt …"`). The Stage A docker-exec test confirmed that typing `pi --version` into a long-running pi REPL is parsed as a **slash-command** (or worse, an inline tool call), not as an exec'd subprocess. So the readiness probe is silently wrong: the test sees an exit code and a stdout that match `/\d+\.\d+/` only by accident (or not at all). The spec should explicitly say what the readiness contract is. Options: (a) replace the probe with `herdr pane get <pane0>` and check `state === "idle"`; (b) send a known sentinel via `herdr pane send-text` and read it back via `herdr pane read`; (c) rely on the spawn-side `parseAgentPaneId` JSON response (it includes a `state` field). Whatever the contract, it must not require a one-shot `pi --version` execution in a pane where pi is already resident.
- **evidence:**
  - `test/sandbox/impl/orchestration/orchestrator-session.ts:222-236` — `waitForPiReady` polls `pi --version` until exit-0 + non-empty stdout.
  - `test/sandbox/impl/orchestration/orchestrator-session.ts:188` — `runInPane(pane0Id, "export AGENT_CAPABILITY=read && pi ${piArgs.join(" ")}")` spawns a long-running pi (default `piArgs = ["--version"]` is overridden in some callers, but the REPL is alive in the pane either way).
  - `test/sandbox/impl/__tests__/live/orchestration.spec.ts:147-149` — F2 assertion `runInPane(orchestratorPane0, "pi --version")` then expects exit 0 and `/\d+\.\d+/`.
  - Stage A diagnosis (Gap 3): "pi --version typed into a long-running pi REPL is parsed as a slash-command, not exec'd."
  - Stage A's docker-exec evidence (per diagnosis): the readiness probe is not reliable.
- **fix:** Replace the `pi --version` probe in `waitForPiReady` with a pane-state check. Concretely: after `runInPane(pane0Id, "export … && exec pi …")`, call `herdr pane get <pane0Id>` and assert `state === "idle"` (the state machine in `waitForPane` at `herdr-session.ts:525-538` already encodes this). Update F2's assertion to match. Pin the new contract in a new live test `pane-state-ready.spec.ts` so the spec can cite a green test. 5 lines.

---

## Challenge 18 — `wrong_branch` / `block`

- **target_file:** `test/sandbox/impl/orchestration/multiplexing-session.ts`
- **target_line:** lines 59-80 (`canSpawnSubAgent` definition) and lines 90-149 (`spawnSubAgentViaHerdr` always passes `parentDepth: 0, parentIsUserTab: false` at line 111-114).
- **reason:** Gap 4 of the Stage A diagnosis. The depth-4 / user-tab guards in `canSpawnSubAgent` (lines 67-79) are only consulted at depth 0 because `spawnSubAgentViaHerdr` hard-codes the opts to `{ parentDepth: 0, parentIsUserTab: false }`. So:
  - A sub-orchestrator (which by definition is at depth 1) spawning an adversarial sub-agent via `spawnSubAgentViaHerdr` is checked as if it were at depth 0. The "depth-4" rejection at line 73 (`opts.parentDepth >= 1`) never fires for the multiplexing-session entry point.
  - The user-tab guard at line 67 (`opts.parentIsUserTab`) is also never consulted for the same reason: a sub-agent calling `spawnSubAgentViaHerdr(parentTabId: <userTabId>, …)` would pass the guard, because `parentIsUserTab` is hard-wired to `false`. The only path that triggers the user-tab guard is the indirect `spawnPane` label check at `herdr-session.ts:354-360`, which is a backstop, not the spec contract.
  - This is a **propagation gap**: the runtime knows how deep it is, but the call chain does not carry that information. The `multiplexing-session.ts` JSDoc at lines 102-110 acknowledges this and says "callers that know they are nested deeper call `canSpawnSubAgent` directly first" — but no caller does that, and the spec text in §7.3 / §6.2.2 does not require them to. So the depth-4 rule is enforced **only** at the top of the call tree, which means it has no effect on the only path that could violate it.
- **evidence:**
  - `test/sandbox/impl/orchestration/multiplexing-session.ts:59-80` — `canSpawnSubAgent(_parentTabId, agentConfig, opts: { parentDepth, parentIsUserTab } = { parentDepth: 0, parentIsUserTab: false })`. The `parentTabId` parameter is named `_parentTabId` because it is **unused** inside the function body — the guards depend solely on `opts`.
  - `test/sandbox/impl/orchestration/multiplexing-session.ts:90-149` — `spawnSubAgentViaHerdr` always calls `canSpawnSubAgent` with `{ parentDepth: 0, parentIsUserTab: false }` at line 111-114, regardless of the caller.
  - `test/sandbox/impl/orchestration/team-spawner.ts` (the only top-level caller of `spawnSubAgentViaHerdr`) — does not pass a depth or user-tab flag (verified by read of the call sites at lines 339-359, 494-507, 553-601).
  - `spec-2/sandbox/CONTEXT.md:7.3` and `spec-2/sandbox/docs/spec/sections/06:6.2.2` — both call out `canSpawnSubAgent(parentTabId, agentConfig)` without a depth or user-tab argument.
- **fix:** Change `spawnSubAgentViaHerdr` to **read the parent's depth and user-tab status from the live herdr state** before calling `canSpawnSubAgent`. The parent is `parentPaneId`; the runtime can ask herdr for the parent pane's tab id (`herdr pane get <parentPaneId> | jq .tab_id`), then check whether that tab's label is `user` (or starts with `user-`), and compute depth by walking the parent chain (`herdr pane get <pane> | jq .parent_pane_id`) until `pane-0` is reached. This is 3-5 lines and turns the guard from "depth 0 only" into "depth N for any N". Pin the new behavior in a new live test `depth-guard-propagation.spec.ts` that spawns a sub-orchestrator at depth 1, has it spawn an adversarial with `tabPlacement: "tab"`, and asserts the rejection.

---

## Challenge 19 — `missing_evidence` / `block`

- **target_file:** `test/sandbox/impl/orchestration/multiplexing-session.ts` and `test/sandbox/impl/pty/herdr-session.ts`
- **target_line:** `multiplexing-session.ts:34-38` (`let _subAgentCounter = 0; … resetSubAgentCounter()`) and `herdr-session.ts:220-225` (the `resetSubAgentCounter()` call inside `HerdrSession.open`).
- **reason:** Gap 5 of the Stage A diagnosis. The spec claims a per-orchestrator counter scoped to "one orchestrator owns a counter from 0 to 8" (per `MAX_SUB_AGENTS_PER_ORCHESTRATOR = 8` at `multiplexing.ts:27`). The impl is a **process-shared module-level counter** (`let _subAgentCounter = 0;` at `multiplexing-session.ts:34`) that is reset every time a new `HerdrSession` opens. Two orchestrators running back-to-back in the same Node process would both see the counter start at 0; two orchestrators running in parallel would share the counter and a single orchestrator could exceed 8 sub-agents because the other orchestrator's spawns decrement the budget. Also, the reset semantics are not "on orchestrator close" but "on the *next* `HerdrSession.open`" — meaning an orchestrator that spawns 8 sub-agents and then closes still has `_subAgentCounter = 8` until the next container opens, and the next `spawnSubAgentViaHerdr` (against a fresh container) throws "Cannot spawn more than 8" if any test re-uses the module state.
- **evidence:**
  - `test/sandbox/impl/orchestration/multiplexing-session.ts:34-38` — module-level `let _subAgentCounter` + `resetSubAgentCounter` (no per-orchestrator state).
  - `test/sandbox/impl/pty/herdr-session.ts:217-225` — `HerdrSession.open` resets the counter as a side effect: `const { resetSubAgentCounter } = await import("../orchestration/multiplexing-session.js"); resetSubAgentCounter();`. The reset is keyed on container open, not on orchestrator lifecycle.
  - `spec-2/sandbox/fixtures/sandbox-spec/src/multiplexing.ts:27` — `MAX_SUB_AGENTS_PER_ORCHESTRATOR = 8` — name implies per-orchestrator scoping, but the runtime counter is process-global.
  - Stage A diagnosis (Gap 5): "the spec says 'one orchestrator owns a counter from 0 to 8' but the impl is 'a counter shared across the process, reset on every container open.'"
- **fix:** Move the counter into `OrchestratorSession` (or a per-`HerdrSession` field) so each orchestrator has its own budget. Pin the new contract in a new live test `sub-agent-budget-per-orchestrator.spec.ts` that opens two orchestrators in the same process, spawns 8 sub-agents in each, and asserts the 9th is rejected **in each** orchestrator independently. 5-7 lines in the impl.

---

## Challenge 20 — `missing_evidence` / `warn`

- **target_file:** `spec-2/sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md` and `test/sandbox/impl/__tests__/live/orchestration.spec.ts`
- **target_line:** spec §6.1.1 (lines 51-73) — colloquial use of "pane 0" — and the test code at `orchestration.spec.ts:58` (`orchestratorPane0: "pane-0"` as a placeholder string in `LiveTestContext`) and `orchestration.spec.ts:128` (overwritten by `getPane0Id()` which returns a UUID-shape id from herdr).
- **reason:** Gap 2 of the Stage A diagnosis. The spec still uses "pane 0" as a colloquial noun ("pane 0 of the orchestrator tab") but the actual pane id herdr returns is a UUID, not the literal string `pane-0`. The test's `LiveTestContext` starts with `orchestratorPane0: "pane-0"` (a string literal) and is overwritten at runtime by `herdrSession.getPane0Id()` which returns the first entry in the parsed JSON `panes[0].pane_id` (a UUID). This is a **spec/test divergence**: the spec text says `pane-0`, the test uses a UUID, and there is no contract pinning what "pane 0" means. If herdr's pane-id format ever changes, the spec becomes incorrect.
- **evidence:**
  - `spec-2/sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md:43-73` — multiple uses of "pane 0" (lowercase, generic).
  - `test/sandbox/impl/__tests__/live/orchestration.spec.ts:58` — `orchestratorPane0: "pane-0"` (string literal placeholder).
  - `test/sandbox/impl/__tests__/live/orchestration.spec.ts:128` — overwritten with whatever `getPane0Id()` returns.
  - `test/sandbox/impl/pty/herdr-session.ts:291-316` — `getPane0Id` returns `panes[0]?.pane_id` (UUID) with a `pane-0` fallback for the legacy text-parsing path.
- **fix:** Document the spec/test divergence: "pane 0" is the orchestrator's *auto-created* pane, and its actual id is a UUID; "pane 0" is a *role* name, not a literal id. Update §6.1.1 to say "the orchestrator's auto-created pane (referred to colloquially as 'pane 0'; the actual id is a UUID returned by `herdr pane list`)." 1-line documentation fix; no impl change required.

---

## Challenge 21 — `missing_evidence` / `block`

- **target_file:** `test/sandbox/impl/__tests__/live/orchestration.spec.ts`
- **target_line:** F2 `beforeAll` at lines 117-129 — the second `30_000` at line 129 is the hook timeout.
- **reason:** Per the Stage A diagnosis (Group 5): the F2 `beforeAll` hook timeout is 30s, but `launchFromSpec` takes ~44s on the test container. The hook therefore times out before `HerdrSession.open` completes, and the F2 tests inside the `describeOrSkip` block are skipped. The fix is one line: raise the hook timeout to 60s. This is a `block` because it makes F2 (and F3, which has the same pattern at line 172) silently skip in the full suite, which is the same root cause of the `runtime-readonly:111` failure described in Group 3.
- **evidence:**
  - `test/sandbox/impl/__tests__/live/orchestration.spec.ts:117-129` — F2 `beforeAll` is declared with `30_000` (line 117 descriptor timeout) and the second argument at line 129 is `30_000` (the actual hook timeout). The mismatch between the 30s budget and the ~44s `launchFromSpec` time is the cause.
  - `test/sandbox/impl/__tests__/live/orchestration.spec.ts:172` — F3 has the same `hookTimeout: 30_000` and the same 30s `beforeAll` budget at line 189-197. Same fix.
  - Stage A diagnosis (Group 5): "F2's `beforeAll` hook times out at 30s but `launchFromSpec` takes 44s. … 5-line fix."
  - Stage A diagnosis (Group 3): "runtime-readonly:111 fails in full suite due to F3 panic state pollution. Fixed by Group 1." — so fixing F2/F3 hook timeouts is a prerequisite to even running the full suite to see the Group 1 fix take effect.
- **fix:** Change the hook timeout to `60_000` at line 129 (and the matching F3 hook at line 189-197). Also change the descriptor `hookTimeout: 30_000` to `60_000` on lines 117 and 172. 1-2 lines; no impl change required. **Pin a test that asserts `launchFromSpec` returns inside the budget** so the spec/test divergence does not reappear.

---

## Challenge 22 — `wrong_branch` / `block`

- **target_file:** `test/sandbox/impl/orchestration/multiplexing-session.ts` and `test/sandbox/impl/pty/herdr-session.ts`
- **target_line:** `multiplexing-session.ts:90-149` (`spawnSubAgentViaHerdr` — the Group 1 reconciliation step) and `herdr-session.ts:399-414` (the `pane list` fallback that picks `panes[panes.length - 1]`).
- **reason:** The Stage A Group 1 fix is to add a 3-line reconciliation in `spawnSubAgentViaHerdr` that calls `herdr pane list` after `herdr agent start` to recover the actual pane id (since herdr v0.6.10 returns a stub pane id for the spawn call and the real id is only visible via `pane list`). The naive reconciliation ("take the newest entry in `pane list`") has a **race window**: between the `agent start` call returning and the reconciliation `pane list` lookup, the herdr daemon can spawn *another* pane (e.g. an adversarial sub-agent triggered by a parallel orchestrator, or a sub-orchestrator that just got promoted). When that happens, the reconciliation returns the *other* pane's id, and the YELLOW log fires on the wrong pane. The fix must use the `pane list` JSON's `tab_id` field (the spawn knew which tab it targeted) and match by `tab_id == targetTabId && created_at > spawnStartTime`. The spec/test should also pin the reconciliation semantics so a future refactor does not regress to the "newest entry" approach.
- **evidence:**
  - `test/sandbox/impl/pty/herdr-session.ts:399-414` — the existing reconciliation reads `panes[panes.length - 1]` from a fresh `pane list` call. This is the naive approach the Stage A diagnosis flags as racy.
  - Stage A diagnosis (Group 1 + 7): "the YELLOW log fires on the wrong pane. The fix must use the `pane list` JSON's `tab_id` field, not just the latest entry."
  - Herdr v0.6.10 behavior captured in Stage A diagnosis: `agent start` returns a stub pane_id; the real id is only visible via `pane list` after a settle period.
  - The `spawnSubAgentViaHerdr` path at `multiplexing-session.ts:140-142` passes `targetTabId: agentConfig.parentTabId` to `spawnPane`, which then calls `herdr agent start --tab <tabId>`. The spawn call *knows* the target tab id, but the reconciliation step currently throws that information away.
- **fix:** In the Group 1 reconciliation, pass `targetTabId` (and a `spawnStartTime` captured before the `agent start` call) to the reconciliation function. Match `pane list` entries by `tab_id === targetTabId && created_at >= spawnStartTime` (herdr's pane list JSON includes a `created_at` field; verified in `repos/opensrc`/herdr source). Pin the new behavior in a new live test `reconciliation-by-tab-id.spec.ts` that spawns two sub-agents in rapid succession and asserts each `spawnSubAgentViaHerdr` returns the correct id (not the other one's). 3-5 lines in the impl + 1 new test.

---

## Challenge 23 — `wrong_branch` / `block` (optional bonus)

- **target_file:** `test/sandbox/impl/orchestration/multiplexing-session.ts`
- **target_line:** line 62 (`opts: { parentDepth: number; parentIsUserTab: boolean } = { parentDepth: 0, parentIsUserTab: false }`) and line 67-69 (`if (opts.parentIsUserTab) return { ok: false, reason: "user-tab-target" }`).
- **reason:** The user-tab guard inside `canSpawnSubAgent` is consulted only if the caller passes `parentIsUserTab: true`. But `spawnSubAgentViaHerdr` (the only entry point) hard-wires `parentIsUserTab: false` at line 113. So **the user-tab-target rejection reason is unreachable from the runtime** — the only enforcement is the backstop in `herdr-session.ts:354-360` (the label check in `spawnPane`). The spec should either (a) make `canSpawnSubAgent`'s user-tab check the **primary** enforcement and remove the duplicate backstop in `spawnPane`, or (b) admit that the user-tab guard inside `canSpawnSubAgent` is dead code and remove it. The current state — "two guards, only one reachable, both undocumented" — is a spec/test divergence that the Stage A diagnosis did not call out. (This is a more concrete instance of Challenge 18's "parentIsUserTab propagation" gap; it deserves its own challenge because the consequence is a **dead code path** that lints / type-checks fine but never fires.)
- **evidence:**
  - `test/sandbox/impl/orchestration/multiplexing-session.ts:62` — the default opts force `parentIsUserTab: false`.
  - `test/sandbox/impl/orchestration/multiplexing-session.ts:67-69` — the user-tab guard depends on the caller passing `true`.
  - `test/sandbox/impl/orchestration/multiplexing-session.ts:111-114` — the only call site hard-wires `false`.
  - `test/sandbox/impl/pty/herdr-session.ts:354-360` — the only effective user-tab enforcement.
- **fix:** Either remove the user-tab guard from `canSpawnSubAgent` (the backstop is sufficient), or wire `parentIsUserTab` from the actual parent state (the fix from Challenge 18 makes the guard reachable). 1-2 lines; 0 new tests required (the existing F7 test in `orchestration.spec.ts:452` exercises the backstop).

---

## Summary

| # | Kind | Severity | File | Line(s) |
|---|------|----------|------|---------|
| 16 | wrong_branch | block | spec multiplexing.ts / runtime multiplexing-session.ts | 21 / 140-142 |
| 17 | missing_evidence | block | orchestrator-session.ts / orchestration.spec.ts | 222-236 / 138-150 |
| 18 | wrong_branch | block | multiplexing-session.ts | 59-80, 90-149 |
| 19 | missing_evidence | block | multiplexing-session.ts / herdr-session.ts | 34-38 / 220-225 |
| 20 | missing_evidence | warn | spec §6.1.1 / orchestration.spec.ts | 51-73 / 58, 128 |
| 21 | missing_evidence | block | orchestration.spec.ts | 117-129 (and 172, 189-197) |
| 22 | wrong_branch | block | multiplexing-session.ts / herdr-session.ts | 90-149 / 399-414 |
| 23 | wrong_branch | block | multiplexing-session.ts | 62, 67-69, 111-114 |

**Counts:** 7 block + 1 warn (Challenge 20). The user's brief required "at least 7 challenges (one per gap + 2 runtime challenges)"; the bonus Challenge 23 was the optional 8th.

**Top 3 most consequential challenges (highest blast radius):**

1. **Challenge 16** (`PANE_DELEGATION_MODE` contradiction) — the spec's default sub-agent placement (`"pane"`) is broken in herdr v0.6.10, and the runtime's "pane list newest entry" reconciliation is racy. This unblocks F3, ATK-2, `runtime-readonly:111`, and the debug-pane-races test. Without this fix, every spec-2 workstream that delegates to sub-agents will see colliding pane ids.
2. **Challenge 17** (`pi --version` readiness probe) — pane 0 is now a long-running pi REPL; `pi --version` typed into it is parsed as a slash-command, not exec'd. F2's assertion is silently wrong today. The orchestrator's "is pi alive" check is unreliable, which means the orchestrator may dispatch sub-orchestrators before pi is ready.
3. **Challenge 22** (race window in Group 1 reconciliation) — the Stage A fix to add a 3-line reconciliation is correct in spirit but uses the racy "newest entry" approach. The fix must match by `tab_id` + `created_at` to be correct under contention. This is the difference between a fix that works in single-test isolation and one that works in the full 156-test suite.

**Process recommendation for the surgical fixers:**

- Address **Challenge 22** first — it refines the Stage A Group 1 fix and is the difference between "works in isolation" and "works in the full suite."
- Address **Challenge 16** and **Challenge 17** next — they are independent of each other and of #22, and they unblock the largest number of downstream tests.
- Address **Challenge 21** (1-line timeout raise) before any of the above, because the full suite cannot even reach the failing tests until the hook timeout is fixed.
- Address **Challenges 18, 19, 23** as a single coordinated fix in `multiplexing-session.ts` — they all stem from the same `opts = { parentDepth: 0, parentIsUserTab: false }` default and the same process-global counter. One surgical edit (move state into `OrchestratorSession`, compute `parentIsUserTab` from the parent pane's tab label, pass real `parentDepth`) closes all three.
- **Challenge 20** is a documentation-only fix and can be done last.
