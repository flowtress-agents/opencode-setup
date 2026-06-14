# Red Phase Report — 6 Features in @test

**Date:** 2026-06-14
**Branch:** `test`
**Commits:**
- `076bf5e` — `chore(test): bootstrap worktree with micro-test harness`
- `15fc7d4` — `test(sandbox): red phase for 6 features (container, orchestrator, multiplexing, sub-orchestrators, flat governance, user workspace)`

**Final test state:**

```
 Test Files  6 failed | 7 passed (13)
      Tests  58 failed | 94 passed (152)
```

- 7 pre-existing test files: **all 88 baseline tests still pass**
- 6 new red-phase test files: **58 assertions fail (all expected)**
- The 6 extra "passed" tests come from anchor assertions in the new files that already hold (e.g. `picode.npm` is correctly `@earendil-works/pi-coding-agent`).
- `npx tsc --noEmit` exits 0.
- Pushed to both `origin` (flowtress-agents) and `flowtress-docker`.

---

## F1 — 1 container per launch, data-driven from `launch-sandbox.toml`

**File:** `test/sandbox/fixtures/sandbox-spec/tests/feature-1-container-per-launch.spec.ts`

**Test names (12 assertions, all red):**

1. `F1: ... > spec declares single-container mode > has a top-level [launch] section`
2. `... > [launch].mode is 'single-container'`
3. `... > [launch].mode is NOT 'multi-container'`
4. `... > spec declares a container image (string, non-empty)`
5. `... > spec declares the agent user name (string)`
6. `... > spec declares the agent uid and gid (numbers)`
7. `... > spec declares the agent workdir (absolute path string)`
8. `... > launchFromSpec() runtime export reports exactly 1 container > is exported as a function from micro-impl/sandbox/impl/runtime/launch.js`
9. `... > returns a plan that reports exactly 1 container`
10. `... > does NOT report 0 containers`
11. `... > does NOT report more than 1 container (sub-agents are panes per ADR 0004)`

**Failure shape:** `TypeError: Cannot read properties of undefined (reading 'launch')` and module-not-found on `micro-impl/sandbox/impl/runtime/launch.js`.

**Real symbols the green phase must add:**

- TOML: new top-level `[launch]` section with `mode = "single-container"`.
- Runtime: new module `micro-impl/sandbox/impl/runtime/launch.js` exporting `launchFromSpec(spec)` returning a plan with `containers` (or `containerCount`, or array length) === 1.

**ADR basis:** ADR 0004 (pane delegation — sub-agents are panes, not new containers).

---

## F2 — herdr opens with pi (orchestrator) in pane 0

**File:** `test/sandbox/fixtures/sandbox-spec/tests/feature-2-orchestrator-pane.spec.ts`

**Test names (7 assertions, all red):**

1. `... > spec declares a [[pane]] array of pane configurations`
2. `... > pane[0].agent is 'pi' (the orchestrator, ADR 0002)`
3. `... > pane[0].role is 'orchestrator' (ADR 0002)`
4. `... > pane[0] is immutable — no other agent can claim pane 0 (ADR 0004, 0005)`
5. `... > spec declares herdr auto-allocates exactly 1 pane at startup`
6. `... > pane[0].agent is 'pi' and not bash, shell, host, or empty`
7. `... > spec install.steps picode uses @earendil-works/pi-coding-agent (NOT the bogus @earendil-works/pi)` — *anchor test, already passes; re-asserts the existing correct value to prevent regression.*

**Failure shape:** `TypeError: Cannot read properties of undefined (reading '0')` (s.pane is undefined) and `TypeError: Cannot read properties of undefined (reading 'pane_startup_count')`.

**Real symbols the green phase must add:**

- TOML: top-level `pane` array (array-of-tables), with index 0 declaring `agent = "pi"`, `role = "orchestrator"`, `immutable = true`.
- TOML: `pane_startup_count = 1`.

**ADR basis:** ADR 0002 (pi is the orchestrator), ADR 0003 (herdr is the single TTY), ADR 0004 (pane control rule), ADR 0005 (fork for orchestration limits).

---

## F3 — herdr multiplexing — sub-agents in new tabs/workspaces

**File:** `test/sandbox/fixtures/sandbox-spec/tests/feature-3-multiplexing.spec.ts`

**Test names (13 assertions, all red):**

Group "pane_delegation section in launch-sandbox.toml":
1. `... > declares pane_delegation.mode = 'spawn_new_tab'`
2. `... > declares pane_delegation.one_pane_per_agent = true`
3. `... > declares pane_delegation.parent_pane_required = true`
4. `... > declares pane_delegation.tab_per_agent_session = true`

Group "limits section extensions for orchestration":
5. `... > declares limits.max_sub_agents_per_orchestrator = 8`
6. `... > declares limits.max_pane_depth = 3`

Group "runtime multiplexing exports":
7. `... > exports PANE_DELEGATION_MODE constant equal to 'spawn_new_tab'`
8. `... > exports ONE_PANE_PER_AGENT = true`
9. `... > exports PARENT_PANE_REQUIRED = true`
10. `... > exports TAB_PER_AGENT_SESSION = true`
11. `... > exports MAX_SUB_AGENTS_PER_ORCHESTRATOR = 8`
12. `... > exports MAX_PANE_DEPTH = 3`
13. `... > exports a spawnSubAgent function callable by the orchestrator`
14. `... > spawnSubAgent returns a SubAgentHandle with paneId, tabId, parentPaneId`

**Failure shape:** `TypeError: Cannot read properties of undefined (reading 'pane_delegation')` and module-not-found on `../src/multiplexing.js`.

**Real symbols the green phase must add:**

- TOML: new top-level `[pane_delegation]` table with `mode`, `one_pane_per_agent`, `parent_pane_required`, `tab_per_agent_session`.
- TOML: extend `[limits]` with `max_sub_agents_per_orchestrator = 8`, `max_pane_depth = 3`.
- New module `test/sandbox/fixtures/sandbox-spec/src/multiplexing.ts` exporting:
  - `PANE_DELEGATION_MODE: "spawn_new_tab"`
  - `ONE_PANE_PER_AGENT: true`
  - `PARENT_PANE_REQUIRED: true`
  - `TAB_PER_AGENT_SESSION: true`
  - `MAX_SUB_AGENTS_PER_ORCHESTRATOR: number` (8)
  - `MAX_PANE_DEPTH: number` (3)
  - `spawnSubAgent(parentPaneId, agentConfig): SubAgentHandle` (returns `{ paneId, tabId, parentPaneId }`)

**ADR basis:** ADR 0004 (pane control rule), ADR 0005 (fork for orchestration limits — these constants are the limits the fork enforces).

---

## F4 — Sub-orchestrators spawn sub-agents in new tabs

**File:** `test/sandbox/fixtures/sandbox-spec/tests/feature-4-sub-orchestrators.spec.ts`

**Test names (10 assertions, all red):**

Group "Feature 4 spec":
1. `... > [sub_orchestrator] section exists in launch-sandbox.toml`
2. `... > sub_orchestrator.promotion_required is true (ADR 0005)`
3. `... > sub_orchestrator.max_depth is 3`

Group "Feature 4 orchestration.js constants":
4. `... > orchestration.js module is importable`
5. `... > SUB_ORCHESTRATOR_PROMOTION_REQUIRED is exported and true`
6. `... > SUB_ORCHESTRATOR_MAX_DEPTH is exported and equals 3`
7. `... > promoteToSubOrchestrator function is exported`
8. `... > SubOrchestratorHandle type/handle factory is exported`

Group "Feature 4 runtime":
9. `... > runtime orchestration module is importable from micro-impl`
10. `... > promoteToSubOrchestrator is exported from the runtime orchestration module`
11. `... > SubOrchestratorHandle is exported from the runtime orchestration module`
12. `... > promoteToSubOrchestrator returns null (or a falsy handle) when given a leaf sub-agent`
13. `... > SubOrchestratorHandle type has a parentSubOrchestratorId field (runtime types)`

**Failure shape:** `TypeError: Cannot read properties of undefined (reading 'sub_orchestrator')` and module-not-found on `../src/orchestration.js` and `micro-impl/sandbox/impl/orchestration/index.js`.

**Real symbols the green phase must add:**

- TOML: new top-level `[sub_orchestrator]` table with `promotion_required = true`, `max_depth = 3`.
- New module `test/sandbox/fixtures/sandbox-spec/src/orchestration.ts` exporting:
  - `SUB_ORCHESTRATOR_PROMOTION_REQUIRED: true`
  - `SUB_ORCHESTRATOR_MAX_DEPTH: 3`
  - `promoteToSubOrchestrator(handle): SubOrchestratorHandle | null` (returns null for non-promotable leaf agents)
  - `SubOrchestratorHandle` (factory or class) with `parentSubOrchestratorId: string`
- New module `micro-impl/sandbox/impl/orchestration/index.js` with the same exports as the spec module (mirrors the `runtime/` shape).

**ADR basis:** ADR 0004 (sub-orchestrators exist in their own pane), ADR 0005 (leaf agents cannot promote themselves; max depth is 3 by default).

---

## F5 — Flat chain of governance (peer-to-peer despite specialization)

**File:** `test/sandbox/fixtures/sandbox-spec/tests/feature-5-flat-governance.spec.ts`

**Test names (10 assertions, all red):**

Group "launch-sandbox.toml declares a [governance] section":
1. `... > spec has a [governance] section`
2. `... > [governance].model is 'flat'`
3. `... > [governance].peer_protocol is 'explicit_spawn_signal'`
4. `... > [governance] has no authority_level field (flat means no implicit levels)`

Group "runtime exports the flat governance model and canSignal":
5. `... > FLAT_GOVERNANCE_MODEL is exported and equals 'flat'`
6. `... > canSignal is exported as a function`
7. `... > canSignal returns true for parent->child spawn relationship`
8. `... > canSignal returns true for peer-to-peer signals (siblings share a parent)`
9. `... > canSignal returns false for arbitrary cross-tree signals (different parents)`
10. `... > canSignal returns false for grandchild->grandparent (no implicit authority)`

**Failure shape:** `TypeError: Cannot read properties of undefined (reading 'governance')` and module-not-found on `../src/governance.js`.

**Real symbols the green phase must add:**

- TOML: new top-level `[governance]` table with `model = "flat"`, `peer_protocol = "explicit_spawn_signal"`. **Must NOT contain `authority_level`** (the absence is asserted).
- New module `test/sandbox/fixtures/sandbox-spec/src/governance.ts` exporting:
  - `FLAT_GOVERNANCE_MODEL: "flat"`
  - `canSignal(fromAgent, toAgent, signal): boolean` — true for parent→child, true for siblings (same parent), false for cross-tree, false for grandchild→grandparent.

**ADR basis:** ADR 0004 (hierarchy is by spawn relationship), ADR 0005 (no implicit authority levels).

---

## F6 — User has separate workspace for bash (orchestrator cannot interact)

**File:** `test/sandbox/fixtures/sandbox-spec/tests/feature-6-user-workspace.spec.ts`

**Test names (9 assertions, all red):**

Group "spec (launch-sandbox.toml) declares the user workspace":
1. `... > spec has a [user_workspace] section`
2. `... > spec user_workspace.tab_id is 'user'`
3. `... > spec user_workspace.agent is 'bash'`
4. `... > spec user_workspace.orchestrator_can_interact is false (explicit)`
5. `... > spec user_workspace.user_can_inject_into_orchestrator is false (explicit)`

Group "runtime exports the user workspace identity and predicate":
6. `... > USER_WORKSPACE_TAB_ID is exported and equals 'user'`
7. `... > isUserWorkspace('user') returns true (user's bash tab)`
8. `... > isUserWorkspace('agent-0') returns false (sub-agent pane)`
9. `... > isUserWorkspace('orchestrator') returns false (orchestrator pane)`

**Failure shape:** `TypeError: Cannot read properties of undefined (reading 'user_workspace')` and module-not-found on `../src/user-workspace.js`.

**Real symbols the green phase must add:**

- TOML: new top-level `[user_workspace]` table with `tab_id = "user"`, `agent = "bash"`, `orchestrator_can_interact = false`, `user_can_inject_into_orchestrator = false`.
- New module `test/sandbox/fixtures/sandbox-spec/src/user-workspace.ts` exporting:
  - `USER_WORKSPACE_TAB_ID: "user"`
  - `isUserWorkspace(tabId: string): boolean` — true only for `"user"`, false for agent/orchestrator pane IDs.

**ADR basis:** ADR 0004 (user workspace separate; orchestrator cannot interact), ADR 0005 (immutability enforced by fork).

---

## Summary of TOML additions required for green phase

The single `launch-sandbox.toml` in micro-spec (and propagated to spec) must gain these new top-level sections:

```toml
[launch]
mode = "single-container"

[[pane]]
agent = "pi"
role = "orchestrator"
immutable = true
pane_startup_count = 1   # actually a top-level field, not under [[pane]]

[pane_delegation]
mode = "spawn_new_tab"
one_pane_per_agent = true
parent_pane_required = true
tab_per_agent_session = true

[limits]
# ... existing limits ...
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3

[sub_orchestrator]
promotion_required = true
max_depth = 3

[governance]
model = "flat"
peer_protocol = "explicit_spawn_signal"
# NO authority_level field (absence is asserted)

[user_workspace]
tab_id = "user"
agent = "bash"
orchestrator_can_interact = false
user_can_inject_into_orchestrator = false
```

## Summary of new modules required for green phase

| Path | Exports |
|------|---------|
| `test/sandbox/fixtures/sandbox-spec/src/multiplexing.ts` | `PANE_DELEGATION_MODE`, `ONE_PANE_PER_AGENT`, `PARENT_PANE_REQUIRED`, `TAB_PER_AGENT_SESSION`, `MAX_SUB_AGENTS_PER_ORCHESTRATOR`, `MAX_PANE_DEPTH`, `spawnSubAgent()` |
| `test/sandbox/fixtures/sandbox-spec/src/orchestration.ts` | `SUB_ORCHESTRATOR_PROMOTION_REQUIRED`, `SUB_ORCHESTRATOR_MAX_DEPTH`, `promoteToSubOrchestrator()`, `SubOrchestratorHandle` |
| `test/sandbox/fixtures/sandbox-spec/src/governance.ts` | `FLAT_GOVERNANCE_MODEL`, `canSignal()` |
| `test/sandbox/fixtures/sandbox-spec/src/user-workspace.ts` | `USER_WORKSPACE_TAB_ID`, `isUserWorkspace()` |
| `micro-impl/sandbox/impl/runtime/launch.js` | `launchFromSpec(spec)` returning a plan with exactly 1 container |
| `micro-impl/sandbox/impl/orchestration/index.js` | `promoteToSubOrchestrator()`, `SubOrchestratorHandle` |

## Out of scope

- Green phase (above additions)
- Yellow phase (warning assertions)
- Adversarial review of these red tests
- Caveman / cavecrew integration
- Forking herdr and pi (ADR 0005 — done as part of green phase)
