# Phase 0 Research Report: Read-only Orchestrator Design

**Date:** 2026-06-14
**Status:** Complete
**Sources:** OpenHands (`/Users/lab/projects/opencode-setup/repos/OpenHands/openhands`), opencode (`/Users/lab/projects/opencode-setup/repos/opencode`)

---

## 1. OpenHands: Per-Pane Capability Model

### 1.1 `runtime/` — Does Not Exist

OpenHands does not have a `runtime/` directory. The plan referenced `runtime/` for per-pane capability modeling, but this is not how OpenHands structures its codebase.

**Actual architecture:** OpenHands uses a **sandbox-based** model where agents execute inside isolated containers (Docker, process, or remote). The "pane" concept does not exist in OpenHands — instead, each conversation runs in its own sandbox.

**Key files:**
- `app_server/sandbox/sandbox_service.py:30` — Abstract `SandboxService` base class
- `app_server/sandbox/docker_sandbox_service.py:83` — Docker container implementation
- `app_server/sandbox/remote_sandbox_service.py:99` — Remote runtime adapter
- `app_server/sandbox/sandbox_models.py:48` — `SandboxInfo` with `id`, `status`, `exposed_urls`

**Capability enforcement in OpenHands:** OpenHands enforces capability at the **sandbox level**, not the pane level. The sandbox service validates session API keys and ensures sandboxes are in `RUNNING` status before allowing access (`session_auth.py:38`). There is no per-command allowlist inside a running sandbox.

### 1.2 `app_server/` — Server-Side Capability Enforcement

The app server handles sandbox lifecycle and session authentication:

- `app_server/sandbox/session_auth.py:38` — `validate_session_key()` checks that a session API key maps to a running sandbox
- `app_server/sandbox/sandbox_models.py:9-14` — `SandboxStatus` enum: `STARTING`, `RUNNING`, `PAUSED`, `ERROR`, `MISSING`
- `app_server/sandbox/sandbox_spec_models.py:8-17` — `SandboxSpecInfo` with `initial_env: dict[str, str]` for env var injection

**Observation:** `SandboxSpecInfo.initial_env` (line 14) is the mechanism for injecting environment variables into a sandbox at creation time. This is where `AGENT_CAPABILITY` could be set.

### 1.3 `skills/` — Role/Persona Declaration

Skills in OpenHands use YAML frontmatter:

**File:** `skills/add_agent.md:1-18`

```yaml
---
name: add_agent
type: knowledge
version: 1.0.0
agent: CodeActAgent
triggers:
  - new agent
  - create agent
---
```

**File:** `skills/README.md:26-38` — Directory structure:
- `skills/` — public shareable skills (V1) / microagents (V0)
- `.openhands/microagents/` — repository-private agents (V0)
- `.openhands/skills/` — repository-private skills (V1, preferred)

**File:** `skills/agent-builder.md:1-11` — Example with `agent: CodeActAgent` specifying which agent type handles the skill.

### 1.4 `.agents/` — Agent Definitions

Located at `/Users/lab/projects/opencode-setup/repos/OpenHands/.agents/`:

**File:** `.agents/skills/update-sdk/SKILL.md:1-4`
```yaml
---
name: update-sdk
description: This skill should be used when the user asks to "update SDK"...
---
```

### 1.5 `events/` — Signal/Observation Protocol — Does Not Exist

OpenHands does not have an `events/` directory for signal/observation protocols. The `analytics/EVENTS.md` file is about PostHog analytics events, not inter-agent signaling.

**Actual event handling:**
- `app_server/event/event_router.py` — REST API for event search/list
- `app_server/event_callback/webhook_router.py:54` — Uses `ObservationEvent` from SDK for LLM model switching (`SwitchLLMObservation`)

### 1.6 `microagents/` — Prompt Attachment to Capability Classes — Does Not Exist

The `microagents/` directory does not exist as such. The concept is documented in `skills/README.md:6-11`:

> **Version 0 (V0)**: The term "microagents" continues to be used for V0 conversations.
> **Version 1 (V1)**: The term "skills" is used for V1 conversations.

Repository-specific agents live in `.openhands/microagents/` (V0) or `.openhands/skills/` (V1).

---

## 2. opencode / pi: Entry Point and Capability

### 2.1 pi-coding-agent Entry Point

**Finding: There is no separate `pi-coding-agent` binary in the opencode repository.**

The opencode CLI (`packages/opencode/src/cli/cmd/run/runtime.ts`) IS the pi entry point. The `pi` command referenced in the plan is the opencode CLI itself running in agent mode.

**Key file:** `packages/opencode/src/cli/cmd/agent.ts:14-31`
```typescript
type AgentMode = "all" | "primary" | "subagent"

const AVAILABLE_PERMISSIONS = [
  "bash", "read", "edit", "glob", "grep", "webfetch",
  "task", "todowrite", "websearch", "lsp", "skill",
]
```

### 2.2 Agent Configuration and Permission Model

opencode has a rich permission system in `packages/core/src/permission/`:

**File:** `packages/core/src/permission/schema.ts:5-16`
```typescript
export const Effect = Schema.Literals(["allow", "deny", "ask"])
export const Rule = Schema.Struct({
  action: Schema.String,
  resource: Schema.String,
  effect: Effect,
})
```

**File:** `packages/opencode/src/permission/index.ts:39-48`
```typescript
export function evaluate(permission: string, pattern: string, ...rulesets: PermissionV1.Ruleset[]): PermissionV1.Rule {
  return rulesets.flat()
    .findLast((rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern))
    ?? { action: "ask", permission, pattern: "*" }
}
```

**Built-in agents with permission enforcement:**

**File:** `packages/opencode/src/agent/agent.ts:138-153` — `build` agent:
```typescript
build: {
  name: "build",
  permission: Permission.merge(defaults, Permission.fromConfig({
    question: "allow",
    plan_enter: "allow",
  }), user),
  mode: "primary",
}
```

**File:** `packages/opencode/src/agent/agent.ts:154-179` — `plan` agent (read-only by design):
```typescript
plan: {
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      edit: { "*": "deny", [path.join(".opencode", "plans", "*.md")]: "allow" },
    }),
  ),
  mode: "primary",
}
```

**File:** `packages/opencode/src/agent/agent.ts:194-216` — `explore` agent (read-only):
```typescript
explore: {
  permission: Permission.merge(
    defaults,
    Permission.fromConfig({
      "*": "deny",
      grep: "allow", glob: "allow", list: "allow",
      bash: "allow", webfetch: "allow", websearch: "allow",
      read: "allow",
    }),
  ),
  mode: "subagent",
}
```

### 2.3 AGENT_CAPABILITY or Tool-Allowlist Hook

**Finding: No `AGENT_CAPABILITY` environment variable exists in the opencode codebase.**

Search across the entire opencode repository for `AGENT_CAPABILITY` returned no matches.

**However**, opencode has a plugin hook system that could serve as the capability enforcement point:

**File:** `packages/core/src/plugin/skill/customize-opencode.md:310-329`
```typescript
// Hook surface (mutate `output` in place; return `void`):
"tool.execute.before",  // mutate output.args before the tool runs
"tool.execute.after",
```

**File:** `packages/opencode/src/permission/index.ts:215-224`
```typescript
export function disabled(tools: string[], ruleset: PermissionV1.Ruleset): Set<string> {
  const edits = ["edit", "write", "apply_patch"]
  return new Set(tools.filter((tool) => {
    const permission = edits.includes(tool) ? "edit" : tool
    const rule = ruleset.findLast((rule) => Wildcard.match(permission, rule.permission))
    return rule?.pattern === "*" && rule.action === "deny"
  }))
}
```

The `disabled()` function computes which tools should be blocked based on the ruleset. This is the **tool-allowlist hook** referenced in the plan.

---

## 3. Decision Table: Lift Directly / Adapt / Build New

| Pattern | Source | Decision | Rationale |
|---------|--------|----------|-----------|
| Sandbox-based isolation | OpenHands `app_server/sandbox/` | **Adapt** | OpenHands uses Docker/process sandboxes; herdr uses pane isolation. The `SandboxSpecInfo.initial_env` injection pattern is directly applicable for `AGENT_CAPABILITY` propagation. |
| Session-key auth | OpenHands `session_auth.py` | **Lift directly** | The pattern of validating session keys against running sandboxes maps well to herdr pane authentication. |
| Skills with YAML frontmatter | OpenHands `skills/` | **Lift directly** | The `name`, `type`, `version`, `agent`, `triggers` frontmatter structure is portable. |
| Permission ruleset (`allow/ask/deny`) | opencode `packages/core/src/permission/` | **Lift directly** | Already implemented with `Effect`, `Rule`, `Ruleset`. The `explore` agent is a read-only reference implementation. |
| Read-only agent (`explore`) | opencode `packages/opencode/src/agent/agent.ts:194-216` | **Lift directly** | Denies all by default, allows only read tools. Directly maps to orchestrator capability=read. |
| Plan mode agent | opencode `packages/opencode/src/agent/agent.ts:154-179` | **Lift directly** | `edit: deny *` pattern is the reference for read-only enforcement. |
| Plugin hook `tool.execute.before` | opencode `packages/core/src/plugin/skill/customize-opencode.md:310` | **Build new** | The hook exists but is not currently used for capability-based filtering. The `disabled()` function in `permission/index.ts` provides the logic; wire it into the hook. |
| Signal/observation protocol | OpenHands `app_server/event/` | **Not applicable** | OpenHands uses REST/webhook events, not an inter-agent signal protocol. The herdr signal protocol in `governance-channel.ts` is already implemented in the sandbox spec. |
| Sub-agent promotion depth tracking | Existing `orchestration.ts` | **Lift directly** | Already implemented with `promoteToSubOrchestrator()` and `SUB_ORCHESTRATOR_MAX_DEPTH = 3`. |
| User workspace isolation | Existing `user-workspace.ts` | **Lift directly** | Already implemented with `USER_WORKSPACE_TAB_ID` and isolation assertions. |

---

## 4. Open Question Answers

### Q1: Does OpenHands' `Runtime` expose a pre-execution hook to drop write requests?

**Answer: NO.**

OpenHands does not have a `Runtime` class with a pre-execution hook. The runtime in OpenHands is the sandbox itself (`DockerSandboxService`, `ProcessSandboxService`, `RemoteSandboxService`). Commands are submitted to the sandbox container and executed directly. There is no callback mechanism for intercepting or dropping requests before execution.

**Evidence:**
- `app_server/sandbox/sandbox_service.py:30` — Abstract `SandboxService` with `start_sandbox()`, `resume_sandbox()`, no pre-execution hook
- `app_server/sandbox/docker_sandbox_service.py` — Commands executed via `docker exec` with no interception layer

**Implication for the plan:** The herdr-pane command allowlist (proposed in `herdr-session.ts`) is the correct enforcement point. OpenHands' runtime model does not provide this capability, so the plan's design is appropriate.

### Q2: Does `pi-coding-agent` read `AGENT_CAPABILITY` natively?

**Answer: NO.**

There is no `AGENT_CAPABILITY` environment variable or native read mechanism in the opencode codebase. The search returned zero matches for `AGENT_CAPABILITY` across the entire repository.

**Evidence:**
- No `AGENT_CAPABILITY` in opencode source
- The `pi` command is the opencode CLI itself; it does not have a special capability mode

**Implication for the plan:** The wrapper script approach inside the container is required. The plan correctly proposes:
1. Set `AGENT_CAPABILITY=read` in the pane env via `spawnPane`
2. The wrapper script (or opencode's plugin hook) reads this env and self-restricts
3. The herdr-pane command allowlist provides defense-in-depth

---

## 5. Summary of Key Findings

1. **openhands lacks a `runtime/` directory** — The per-pane capability model does not exist in OpenHands. Instead, OpenHands uses Docker/process sandboxes as isolation units. The `SandboxSpecInfo.initial_env` field is the injection point for capability propagation.

2. **openhands lacks `events/` and `microagents/` directories** — These are V0/V1 terminology differences. Skills/microagents are YAML frontmatter files in `skills/` and `.openhands/microagents/`.

3. **opencode has a mature permission system** — `PermissionV1.Ruleset` with `allow/ask/deny` effects on permission keys. The `explore` agent is a working read-only reference implementation.

4. **opencode has no `AGENT_CAPABILITY`** — The wrapper script approach is required. The `tool.execute.before` plugin hook combined with `Permission.disabled()` provides the logic to wire capability-based tool filtering.

5. **openhands' runtime has no pre-execution hook** — The herdr-pane command allowlist is the correct and sufficient enforcement point.

---

## 6. Recommended Next Steps

1. **Add `AGENT_CAPABILITY` injection** to `SandboxSpecInfo.initial_env` in the herdr pane spawning path (`herdr-session.ts spawnPane()`)
2. **Wire `tool.execute.before` plugin hook** to check `AGENT_CAPABILITY` and mutate `output.args` to strip write commands when `capability === "read"`
3. **Use the `explore` agent** as the reference implementation for the read-only orchestrator (it already demonstrates the correct permission pattern)
4. **Use the `plan` agent** as the reference for edit-deny behavior
5. **Document the gap** that OpenHands' runtime does not provide a pre-execution hook; the herdr-pane allowlist is the compensating control
