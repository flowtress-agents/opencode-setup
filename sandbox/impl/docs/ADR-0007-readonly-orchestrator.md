# ADR-0007: Read-only Orchestrator Contract

**Date:** 2026-06-14
**Status:** Accepted
**Deciders:** flowstress-agents

---

## Context

The orchestrator (pi in pane 0) must be read-only — it plans work and delegates to sub-orchestrators but cannot mutate the repository. Sub-orchestrators are also read-only. Sub-agents may be read or readwrite depending on their task. Adversarial sub-agents verify completed work and produce challenge verdicts.

This ADR documents what IS and IS NOT enforced by the current implementation.

---

## What IS Enforced

### 1. Spec-layer capability check (`canSignal` in `governance.ts`)

The extended `canSignal()` predicate checks `fromAgent.capability` before any flat-governance check:

- `capability === "readwrite"`: all signals allowed (subject to flat governance)
- `capability === "read"`: only signals in `READ_ONLY_SIGNALS` are allowed

```ts
export const READ_ONLY_SIGNALS = new Set([
  "spawn", "share_state", "read", "search", "challenge", "verify", "ack",
]);
```

A read-only agent attempting to send `git-commit`, `edit`, `npm-install`, or any other write signal is rejected by `canSignal()` returning `false`.

### 2. Runtime command allowlist (`herdr-session.ts`)

`HerdrSession.runInPane()` accepts an `agentCapability: Capability` parameter. When `capability === "read"`, only commands matching `READ_ONLY_COMMAND_RE` are permitted:

```
cat, ls, grep, find, rg, git log, git diff, git show, git status, git branch, jq, pi, herdr pane read, herdr pane list, herdr pane get
```

Any other command (e.g. `git commit`, `npm install`, `rm`) returns exit code 1 with stderr `"read-only agent attempted write command: <cmd>"`.

### 3. Audit log (`/tmp/agent-<id>.audit`)

Every command executed in a pane is logged to `/tmp/agent-<id>.audit` inside the container with:
- ISO timestamp
- Resolved capability
- Full command line

This provides a per-agent audit trail for post-hoc forensics.

### 4. Adversarial verification protocol (`adversarial-protocol.ts`)

Every sub-orchestrator MUST spawn exactly one adversarial child:
- `capability: "read"`, `signalOnly: true`
- Can only send `challenge` signals
- Produces `Challenge` verdicts with `severity: "block" | "warn"`

A `"block"` severity challenge aborts the workstream and forces a new plan. All challenges are logged to `/tmp/adversarial.log`.

### 5. User workspace tab always allowed

The user workspace tab (`user-workspace` tab ID) is always permitted to inject challenges — this is the human-in-the-loop override.

---

## What Is NOT Enforced

### OS-level UID separation

The current implementation does NOT enforce capability at the OS level. A sufficiently privileged process inside the container could still execute write commands regardless of `AGENT_CAPABILITY`. The enforcement is at:

1. **Spec layer** (`canSignal`) — prevents malicious signal propagation between agents
2. **Runtime layer** (`herdr-session.ts` command allowlist) — prevents shell-level write commands

This is a known gap. A future round may add OS-level UID separation (e.g. Docker `--user` flag per pane, or separate containers per capability tier). The current design documents this gap rather than leaving it implicit.

### pi self-restriction

`pi` (the opencode CLI) does not natively read `AGENT_CAPABILITY`. The wrapper script approach (injecting `AGENT_CAPABILITY=read` into the pane env) provides defense-in-depth, but pi itself does not enforce read-only behavior based on this variable. The `herdr-session.ts` command allowlist is the primary enforcement point.

### Adversarial agent liveness

The orchestrator runtime does not currently verify that a sub-orchestrator has actually spawned its adversarial child before reporting "done". The `adversarial-protocol.ts` module provides the tracker and rules, but the runtime enforcement is stubbed. A future round will wire `hasAdversarialChild()` into the orchestrator's completion check.

---

## Agent Hierarchy

```
User[User prompt] --> Orch[Orchestrator: pi, capability=read, depth 0, pane 0]
Orch -->|spawn capability=read| SO1[Sub-orchestrator: scaffold_2, depth 1]
Orch -->|spawn capability=read| SO2[Sub-orchestrator: deps, depth 1]
Orch -->|spawn capability=read| SO3[Sub-orchestrator: git-worktree, depth 1]

SO1 -->|spawn capability=readwrite| SA1a[sub-agent: create branches]
SO1 -->|spawn capability=readwrite| SA1b[sub-agent: write boilerplate]
SO2 -->|spawn capability=readwrite| SA2a[sub-agent: npm install]
SO3 -->|spawn capability=readwrite| SA3a[sub-agent: git worktree add]

SO1 -->|spawn signalOnly=true| ADV1[Adversarial: missing_evidence/unsafe_command]
SO2 -->|spawn signalOnly=true| ADV2[Adversarial: missing_evidence/unsafe_command]
SO3 -->|spawn signalOnly=true| ADV3[Adversarial: missing_evidence/unsafe_command]

ADV1 -->|challenge| Orch
ADV2 -->|challenge| Orch
ADV3 -->|challenge| Orch

Orch --> UserW[User workspace tab: bash, readwrite]
UserW -.->|human challenge| Orch
```

---

## Key Files

| File | Role |
|------|------|
| `fixtures/sandbox-spec/src/governance.ts` | `Capability`, `READ_ONLY_SIGNALS`, `canSignal()` |
| `fixtures/sandbox-spec/src/multiplexing.ts` | `SubAgentConfig.capability`, `signalOnly` |
| `fixtures/sandbox-spec/src/orchestration.ts` | `SubOrchestratorHandle.capability = "read"` |
| `pty/herdr-session.ts` | Command allowlist, audit log, `AGENT_CAPABILITY` env |
| `orchestration/orchestrator-session.ts` | Sets `AGENT_CAPABILITY=read`, sends system prompt |
| `orchestration/adversarial-protocol.ts` | `Challenge`, `ChallengeKind`, logging, tracker |

---

## References

- Plan: `read-only_orchestrator_design_1c0abf18.plan.md`
- Research: `test/sandbox/impl/docs/RESEARCH.md`
- openhands: `repos/OpenHands/` (Docker sandbox model)
- opencode: `repos/opencode/` (permission system, explore agent)
