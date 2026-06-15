# Spec-2 §6 — Sub-orchestrator tabs & sub-agent freedom

> **Section status:** Accepted (spec-2). Anchors the runtime hook in
> `test/sandbox/impl/pty/herdr-session.ts:isCommandAllowed` and the
> `spawnSubAgent` decision in
> `test/sandbox/impl/orchestration/multiplexing-session.ts:canSpawnSubAgent`.
> Glossary entries live in `sandbox/CONTEXT.md` §1.7–1.10; the nesting
> summary lives in `sandbox/CONTEXT.md` §7. The two pinned decisions
> are `docs/adr/0004-sub-orchestrator-tabs.md` and
> `docs/adr/0005-readwrite-sub-agents.md`.

This section is the detailed spec prose for the two rules Team B owns
in the plan: **(a) sub-orchestrators live in tabs, never in panes**,
and **(b) read-write sub-agents are unconstrained by the runtime
command allowlist**. Section 6.1 pins the nesting model. Sections
6.2 and 6.3 walk the two rules. Section 6.4 enumerates the test
scenarios the spec requires (the spec authors, not test authors —
this section does not write tests, it documents the contracts that
tests must pin). Section 6.5 lists the resolved open questions.

---

## 6.1 Nesting model (workspace → tab → pane)

The spec-2 nesting is **three levels deep**, shaped as **workspace →
tab → pane → process**:

```
Level 1 — workspace        (one per orchestrator; per ADR 0001)
  Level 2 — tab            (sub-orchestrator; per ADR 0004)
    Level 3 — pane         (sub-agent, adversarial, or fixer; per ADR 0005)
      Level 3.5 — process  (the agent's actual binary: pi, bash, node)
```

Maximum depth is **3**, matching the two existing constants:
`MAX_PANE_DEPTH = 3` in `fixtures/sandbox-spec/src/multiplexing.ts`
and `SUB_ORCHESTRATOR_MAX_DEPTH = 3` in
`fixtures/sandbox-spec/src/orchestration.ts`. A fourth level is
forbidden by the spec; the runtime hook `canSpawnSubAgent` rejects
attempts to add one (see §6.4.1).

The orchestrator is a special case at level 3: it is pane 0 of the
**first tab** of the orchestrator's workspace, with the immutability
flag `pane[0].immutable = true` in `launch-sandbox.toml` and the
constant `ONE_PANE_PER_AGENT: true` in
`fixtures/sandbox-spec/src/multiplexing.ts`. No other agent can claim
pane 0. Sub-orchestrators and sub-agents start at pane 1 of their
respective tabs (or wherever herdr allocates next — the pane id is
sequential within the tab).

### 6.1.1 Pane-id namespaces

A sub-orchestrator's tab has its own pane-id namespace. herdr
allocates pane ids sequentially within a tab (or within a workspace,
depending on the herdr version; the spec-2 layout is robust to
either). Concretely:

- The sub-orchestrator's pane 0 (the `pi` process) is the **only**
  pane in its tab at creation time.
- A sub-agent spawned with `tabPlacement: "pane"` creates a fresh
  pane in the same tab. Its pane id is distinct from the
  sub-orchestrator's pane 0. The two are siblings in the same tab;
  neither collides with the other.
- A second sub-orchestrator in a *different* tab has its own pane 0
  with a different id. The two sub-orchestrators do not share a
  pane-id namespace; their sub-agents are unambiguous even if the
  numerical ids happen to match.
- The user tab (per ADR 0002) is a separate tab in the same
  workspace. Its pane id is filtered out of the dispatch envelope
  the orchestrator hands to sub-orchestrators. A sub-orchestrator
  that asks `herdr pane list` itself *will* see the user pane id,
  but the orchestrator does not pass it.

### 6.1.2 Why this model

Tabs give herdr-level isolation: each sub-orchestrator's buffer,
focus, and pane-id namespace are independent. OpenHands' per-session
event log (`repos/OpenHands/openhands/app_server/sandbox/`) and
opencode's per-session permission ruleset
(`repos/opencode/packages/core/src/permission/schema.ts`) both confirm
that the session/tab is the right isolation unit. Pinning
sub-orchestrators to tabs means the same isolation property the user
already sees on the TUI (one tab per workstream) carries through to
the orchestrator's internal structure.

---

## 6.2 Rule 1 — Sub-orchestrators = tabs only, never panes

A sub-orchestrator is always spawned into a **fresh tab** of the
orchestrator's workspace. It is never a pane in the orchestrator's
tab, never a pane in another sub-orchestrator's tab, and never a
pane in the user tab.

### 6.2.1 The `tabPlacement` discriminator

`SubAgentConfig.tabPlacement` (in
`fixtures/sandbox-spec/src/multiplexing.ts`) is the spec-level
discriminator that tells the runtime which kind of slot the
sub-agent needs:

| Value      | Used for                                          | Runtime path in `herdr-session.ts`  |
|------------|---------------------------------------------------|--------------------------------------|
| `"tab"`    | Sub-orchestrators only.                          | `spawnPaneInNewTab`                  |
| `"pane"`   | Sub-agents, adversarials, surgical fixers (default) | `spawnPane(cmd, { targetTabId })`  |

The default is `"pane"` (constant
`DEFAULT_TAB_PLACEMENT: "pane"` in
`fixtures/sandbox-spec/src/multiplexing.ts`). The orchestrator's
system prompt in
`impl/orchestration/orchestrator-session.ts:ORCHESTRATOR_SYSTEM_PROMPT`
is explicit: sub-orchestrators must pass `tabPlacement: "tab"`; any
other value is logged as a YELLOW `liberty-tab-placement` warning.

### 6.2.2 Runtime enforcement

The runtime enforces the rule in three places:

1. **`MultiplexingSession.canSpawnSubAgent(subOrchId, agentConfig)`**
   checks the parent of `subOrchId`. If the parent is itself a
   sub-orchestrator (depth ≥ 2) AND
   `agentConfig.tabPlacement === "tab"`, the call is **rejected**:
   a sub-orchestrator inside another sub-orchestrator's tab is
   exactly the depth-4 nesting the spec forbids. The error is a
   clear `Error("sub-orchestrator cannot be spawned inside another
   sub-orchestrator's tab")`, not a silent fallback. A
   `tabPlacement: "pane"` request against the same parent
   **succeeds** and creates a new pane in the existing
   sub-orchestrator's tab.
2. **YELLOW `liberty-tab-placement`** warning at runtime when
   `tabPlacement` does not match the type-implied default. Soft
   signal; the call still proceeds.
3. **`spawnPane` label-prefix guard** (per ADR 0002) rejects any
   `targetTabId` whose tab label starts with `user-`. This is the
   same guard for both `"tab"` and `"pane"` paths.

### 6.2.3 What if a sub-orchestrator needs its own multi-pane setup?

A sub-orchestrator that wants a left+right split (e.g. code-review
pane next to file-editor pane) is itself a level-2 entity. The two
panes it wants to split are **level-3 sub-agent panes inside its
own tab**, not new tabs. The spec's answer is:

- A sub-orchestrator's tab is a single tab. The sub-orchestrator
  spawns sub-agent panes inside it via `tabPlacement: "pane"`.
- A sub-orchestrator that wants a true second tab of its own would
  be a sub-sub-orchestrator — that is depth 4 and is forbidden.
- If a sub-orchestrator genuinely needs more working surface, the
  spec-2 answer is to give it a wider terminal buffer (herdr
  supports tab resizing), not a new tab. The spec does not
  prescribe the terminal dimensions.

The visual layout the user already sees on the TUI (one tab per
workstream, panes inside a tab) is the spec-2 model. We do not add
"sub-tabs" or "panes-of-panes" as a concept; herdr's tab/pane split
is the only nesting primitive.

---

## 6.3 Rule 2 — Read-write sub-agents are unconstrained

A sub-agent with `capability: "readwrite"` may run **any** command.
The `READ_ONLY_COMMAND_RE` allowlist in
`impl/pty/herdr-session.ts` is consulted only when
`agentCapability === "read"`. When the capability is `"readwrite"`,
`isCommandAllowed` returns `true` immediately and the command is
forwarded to the pane without an allowlist check.

### 6.3.1 The runtime bypass

The relevant code in `impl/pty/herdr-session.ts`:

```ts
function isCommandAllowed(cmd: string, capability: Capability): boolean {
  if (capability === "readwrite") return true;
  return READ_ONLY_COMMAND_RE.test(cmd);
}
```

The first branch returns `true` without consulting the regex. This
is intentional. A sub-agent that the orchestrator dispatched to
apply a surgical patch needs to run `git commit`, `npm install`, or
`rm` — and gating those would break the surgical-fixer contract.

The current `runInPane` signature
`runInPane(paneId, command, agentCapability, agentId)` already
supports this. The `auditLog` function still records the command
with `capability = "readwrite"`, so the bypass is **observable in
the audit log** but not enforced.

### 6.3.2 What the orchestrator is told

The orchestrator's `ORCHESTRATOR_SYSTEM_PROMPT` (in
`impl/orchestration/orchestrator-session.ts`) carries the rule in
plain English:

> Sub-agents with `capability = "readwrite"` are unconstrained by
> the runtime allowlist. They can run `git commit`, `npm install`,
> `rm -rf` — anything. The protection against malicious or buggy
> write-priv sub-agents is the user's responsibility, deferred to
> spec-3 (OS-UID separation).

The orchestrator is responsible for:

1. **Choosing the capability** for each sub-agent it spawns. A
   sub-agent that only needs to read should be `read`; a sub-agent
   that needs to write should be `readwrite`.
2. **Trusting the readwrite sub-agent** to do the right thing. The
   orchestrator cannot enforce what the sub-agent does at the OS
   level — that is spec-3.
3. **Verifying** the sub-agent's output via the adversarial swarm.
   A readwrite sub-agent that goes off the rails is detected
   post-hoc by the verifier, not prevented pre-hoc by the runtime.

### 6.3.3 The audit log and the adversarial protocol

Two existing mechanisms give the readwrite bypass the observability
the spec needs:

- **The per-agent audit log** (`/tmp/agent-<id>.audit` in
  `impl/pty/herdr-session.ts:auditLog`) records every command with
  the resolved capability. A readwrite sub-agent's commands are
  visible in the log; an orchestrator or auditor can replay them
  post-hoc.
- **The adversarial swarm** challenges the workstream's output. A
  readwrite sub-agent that deletes a critical file by mistake is
  flagged by the adversarial with `severity: "block"`, and the
  orchestrator dispatches a surgical fixer (or re-plans). The
  spec-2 contract is: bypass the runtime, do not bypass the
  verifier.

### 6.3.4 What about confirmation prompts?

The spec does **not** require a confirmation step before write
commands. A readwrite sub-agent's first `git commit` runs without
prompting. The orchestrator is the confirmation: it chose to spawn
a readwrite sub-agent, knowing the bypass. The user, in turn,
delegated to the orchestrator, knowing it would dispatch readwrite
sub-agents.

The runtime hook layer (which is the natural place to add a
confirmation prompt) is intentionally silent on readwrite
sub-agents. If a future spec needs a confirmation step, it would
go in the orchestrator's protocol (the orchestrator sends the
sub-agent an explicit "write X" signal; the sub-agent waits for
the orchestrator's "go" signal). The runtime does not add this
for spec-2.

### 6.3.5 Accidental writes to /etc or other dangerous locations

A readwrite sub-agent that runs `rm -etc-passwd` (or anything else
the spec does not constrain) is **not caught by the spec-2
runtime**. The spec-2 runtime's enforcement is at three layers:

1. The `READ_ONLY_COMMAND_RE` allowlist — bypassed for readwrite.
2. The `user-` tab-label guard in `spawnPane` — does not apply
   to commands run *inside* a pane.
3. The audit log — records but does not prevent.

The detection and response chain is:

- **Detection**: the orchestrator's adversarial swarm challenges
  the workstream's output. An accidental deletion is visible in
  the file system, which the next `cat` or `git status` reveals.
- **Response**: the orchestrator sees the challenge, dispatches a
  surgical fixer (a *second* readwrite sub-agent) with a
  `Challenge` payload that asks for the file to be restored. The
  fixer writes the file back. The orchestrator re-verifies.
- **Worst case**: if the workstream is unrecoverable, the
  orchestrator marks the workstream as failed, re-plans, and
  reports the failure to the user. The session is not crashed; the
  orchestrator continues with the surviving workstreams.

This is **defense-in-depth, not airtight**. The spec-2 runtime
catches read-only sub-orchestrators that try to write; it does not
catch readwrite sub-agents that write the wrong thing. The proper
mitigation is **spec-3** (OS-UID separation, separate containers
per capability tier, seccomp/AppArmor profiles). The spec-2 ADR
0005 records this trade-off explicitly.

### 6.3.6 What sub-orchestrators do

Sub-orchestrators (their own `capability: "read"`) **remain
constrained** by the allowlist. A sub-orchestrator cannot bypass
the gate; if it tries, `isCommandAllowed` returns `false` and
`runInPane` returns exit code 1 with the error
`"read-only agent attempted write command: <cmd>"`.

A sub-orchestrator that needs a write delegates to a readwrite
sub-agent. The sub-orchestrator is the dispatcher; the sub-agent is
the executor. This matches the orchestrator's pattern (the
orchestrator is read-only, the surgical fixers are readwrite).

---

## 6.4 Test scenarios the spec requires

The spec does not write tests, but it documents the contracts that
tests must pin. The four scenarios below are the canonical
"this is what the spec says" cases. Tests live in the
`test/sandbox/impl/__tests__/live/` tree; the spec references the
test IDs the red-phase team will choose.

### 6.4.1 Reject: sub-orchestrator inside another sub-orchestrator's tab

**Call:**
```ts
MultiplexingSession.canSpawnSubAgent(subOrchId, {
  name: "sub-orch-2",
  tabPlacement: "tab",
});
```

**Requirement:** `canSpawnSubAgent` returns `false` (or throws
`Error("sub-orchestrator cannot be spawned inside another
sub-orchestrator's tab")`). No tab is created, no pane is created.

**Why this matters:** the depth-4 nesting is the spec violation.
The discriminator is `tabPlacement: "tab"` AND parent is a
sub-orchestrator. Either alone is fine; the conjunction is the
spec violation.

### 6.4.2 Accept: sub-agent pane inside a sub-orchestrator's tab

**Call:**
```ts
MultiplexingSession.canSpawnSubAgent(subOrchId, {
  name: "npm-installer-1",
  tabPlacement: "pane",
});
```

**Requirement:** `canSpawnSubAgent` returns `true`. The runtime
calls `spawnPane(cmd, { targetTabId: subOrchTabId })`. The new
pane's id is distinct from the sub-orchestrator's pane 0; both
panes are siblings in the same tab.

**Why this matters:** the common case. Sub-orchestrators spawn
sub-agents constantly. The discriminator is `tabPlacement: "pane"`.

### 6.4.3 Read-only sub-orchestrator: `runtime-readonly.spec.ts` still passes

**Requirement:** the existing `runtime-readonly.spec.ts` test
continues to pass. The `READ_ONLY_COMMAND_RE` allowlist is
unchanged. A sub-orchestrator (`capability = "read"`) running
`git commit` is rejected with the same error string as before.

**Why this matters:** the bypass applies only to `readwrite`. A
regression in the gate would let sub-orchestrators write. This
test is the regression check for the bypass scope.

### 6.4.4 Read-write sub-agent: `git commit` is allowed

**Call:**
```ts
HerdrSession.runInPane(
  readwritePaneId,
  "git commit -m 'fix: foo'",
  "readwrite",
  "fixer-scaffold_2",
);
```

**Requirement:** the call succeeds. `isCommandAllowed` returns
`true` immediately; the allowlist is not consulted. The exit code
is 0. The command is recorded in `/tmp/agent-fixer-scaffold_2.audit`
with `capability=readwrite`.

**Why this matters:** the new test for the new capability class.
The bypass is the spec-2 rule; a regression that re-enables the
allowlist for readwrite would break the surgical-fixer contract.

### 6.4.5 Pane-id uniqueness across tabs

**Requirement:** the runtime hook guarantees that two sub-agent
panes in the same sub-orchestrator tab have distinct pane ids, and
that the sub-orchestrator's own pane 0 is distinct from all of
them. The orchestrator's pane 0 is also distinct from the
sub-orchestrator's pane 0 (they're in different tabs).

**Why this matters:** the orchestrator's dispatch envelope
references panes by id; a collision would silently route the
wrong sub-agent's output to the wrong workstream. The spec-2
contract is that herdr's per-tab pane-id allocation gives this
property for free; a test pins it.

---

## 6.5 Resolved open questions

The spec-resolved open questions (per the plan §2.1 Stage A prompt
and the grill-with-docs analysis):

### Q1. Within a sub-orchestrator's tab, where do sub-agents live?

**Answer:** sub-agents live in **panes** inside the sub-orchestrator's
tab. The nesting is **workspace → tab → pane**, not
**workspace → tab → tab → pane**. A sub-orchestrator's tab can
hold multiple panes (one per sub-agent), and the sub-orchestrator
is pane 0 of the tab. A sub-agent is pane N (N ≥ 1) of the same
tab. The discriminator is `tabPlacement: "pane"`.

### Q2. Does a write-priv sub-agent require confirmation before write commands?

**Answer:** **no**. A readwrite sub-agent runs any command without
prompting. The orchestrator is the confirmation: it chose to spawn
a readwrite sub-agent, knowing the bypass. The user, in turn,
delegated to the orchestrator, knowing it would dispatch readwrite
sub-agents. If a future spec needs a confirmation step, it would
go in the orchestrator's protocol (an explicit "go" signal), not
in the runtime hook layer.

### Q3. A write-priv sub-agent accidentally writes to /etc. Caught by whom?

**Answer:** **not caught by the spec-2 runtime**. The
`READ_ONLY_COMMAND_RE` gate is bypassed; the `user-` tab-label
guard does not apply to commands run *inside* a pane; the audit
log records but does not prevent. The detection chain is:

1. The orchestrator's adversarial swarm reads the workstream's
   output and flags the accidental write with
   `Challenge { kind: "unsafe_command", severity: "block" }`.
2. The orchestrator dispatches a *second* readwrite sub-agent
   (a surgical fixer) with the challenge payload asking for the
   file to be restored.
3. The fixer writes the file back. The orchestrator re-verifies.
4. If unrecoverable, the orchestrator marks the workstream as
   failed and re-plans.

The proper mitigation for accidental writes is **spec-3** (OS-UID
separation, separate containers per capability tier). Spec-2
documents the gap; it does not close it.

### Q4. Sub-agent pane vs sub-orchestrator pane — id collision?

**Answer:** no collision. The sub-orchestrator's pane 0 is in its
own tab. Sub-agent panes (siblings of pane 0) are in the same tab
but with different pane ids. herdr allocates pane ids
sequentially within a tab, so the sub-orchestrator's pane 0 is
always pane 0, and sub-agent panes are pane 1, pane 2, etc. The
spec-2 contract is that the orchestrator never has to disambiguate
"is pane-X the sub-orchestrator or a sub-agent?" because the
orchestrator's dispatch envelope records the parent of each pane
id. The runtime hook in `spawnPane` returns a `SpawnPaneResult`
with both `paneId` and `tabId`, so the orchestrator can look up
the parent by `tabId`.

### Q5. A sub-orchestrator needs a left+right split (code review + file editor). New tab or pane?

**Answer:** **panes inside the existing tab**. The sub-orchestrator
spawns the code-review pane and the file-editor pane via
`tabPlacement: "pane"`. Both panes live in the sub-orchestrator's
tab. A "sub-tab" concept does not exist in spec-2; herdr's tab/pane
split is the only nesting primitive. If the sub-orchestrator
genuinely needs a separate top-level workstream, it spawns a
sub-agent (or sub-orchestrator) — but that is the depth-2→depth-3
case, not a "sub-tab".

---

## 6.6 What this section does NOT change

To keep the scope explicit, this section does not change:

- **The orchestrator's read-only behavior.** The orchestrator is
  still `capability = "read"` and still gated by the
  `READ_ONLY_COMMAND_RE` allowlist. The bypass applies to
  sub-agents with `capability = "readwrite"`, not to the
  orchestrator or to sub-orchestrators.
- **The user-workspace reservation.** The `user-` tab-label guard
  in `spawnPane` is unchanged. A readwrite sub-agent still cannot
  land in the user tab.
- **The flat governance model.** `governance.ts:canSignal` still
  rejects `read`-capability agents from sending write signals; the
  capability bypass is at the *command* layer, not the *signal*
  layer. A readwrite sub-agent can still be denied a `share_state`
  signal if the parent is not in its signal graph.
- **The max depth invariant.** `MAX_PANE_DEPTH = 3` and
  `SUB_ORCHESTRATOR_MAX_DEPTH = 3` are unchanged. The new
  `canSpawnSubAgent` rule is a *spawn-time* check on
  `tabPlacement`, not a relaxation of the depth limit.
- **OS-level isolation.** Spec-3 owns it. Spec-2 does not introduce
  UID separation, container separation, or seccomp profiles.

---

## 6.7 Cross-references

- OpenHands' per-session event log:
  `repos/OpenHands/openhands/app_server/sandbox/`
- Opencode's per-session permission ruleset:
  `repos/opencode/packages/core/src/permission.ts` (the
  `Effect = "allow" | "deny" | "ask"` model)
- Plan: `~/.cursor/plans/spec-2_orchestrator_v2_+_user_workspace_7cb68ec4.plan.md`
- ADRs: `docs/adr/0001-orchestrator-per-workspace.md`,
  `docs/adr/0002-user-workspace.md`,
  `docs/adr/0003-orchestrator-lifecycle.md` (planned),
  `docs/adr/0004-sub-orchestrator-tabs.md` (this section),
  `docs/adr/0005-readwrite-sub-agents.md` (this section)
- Spec glossary: `sandbox/CONTEXT.md` §1.7–1.10
- Spec summary: `sandbox/CONTEXT.md` §7
- Runtime: `impl/pty/herdr-session.ts:isCommandAllowed` (the
  bypass), `impl/pty/herdr-session.ts:runInPane` (the gate),
  `impl/orchestration/multiplexing-session.ts:canSpawnSubAgent`
  (the tabPlacement check)
- Spec types: `fixtures/sandbox-spec/src/multiplexing.ts:SubAgentConfig.tabPlacement`,
  `fixtures/sandbox-spec/src/governance.ts:Capability`,
  `fixtures/sandbox-spec/src/orchestration.ts:SubOrchestratorHandle.capability`
