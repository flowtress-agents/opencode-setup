# Live Orchestration Runtime — Behavioral Specification

> **Source of truth:** implementation files under `impl/` — docker-adapter.ts, container-launcher.ts, herdr-session.ts, orchestrator-session.ts, multiplexing-session.ts, governance-channel.ts, user-workspace.ts, plus fixture spec files under `fixtures/sandbox-spec/src/`.

This document is a behavioral specification of the live orchestration runtime. It describes the runtime as it is implemented, not as it should be. All API signatures reflect actual TypeScript interfaces in the codebase.

---

## 1. Docker Lifecycle

### 1.1 Build — tempfile strategy

The container image is built from a generated Dockerfile passed via stdin. No temporary files are written to disk; the Dockerfile content is streamed to `docker build`'s stdin.

```
docker build --progress=plain -t <imageName> -f - .
```

**API:**

```typescript
// impl/docker/docker-adapter.ts
function dockerBuild(
  dockerfileContent: string,
  imageName: string,
  buildArgs: Record<string, string> = {},
): Promise<{ imageId: string }>
```

The Dockerfile is generated from `launch-sandbox.toml` by `generateDockerfile()`:

```typescript
// impl/docker/docker-adapter.ts
function generateDockerfile(spec: any): string
```

`generateDockerfile()` emits a `FROM` line from `spec.image.base` (default: `node:22-bookworm`), then appends `RUN` steps for each install step in the TOML:

| step.name | Behavior |
|---|---|
| `"apt-base"` | emits `RUN <step.cmd>` |
| `"herdr"` | emits `RUN <step.cmd> || (<step.fallback_cmd>)` |
| `"picode"` | emits `RUN npm install -g <step.npm>` |

A final `RUN command -v bash || echo "bash not found"` is always appended.

**Build args** are populated from `spec.image.base` → `BASE_IMAGE` build arg.

**Error conditions:**

- `docker build` exits non-0 → throws `Error("docker build failed:\n<stderr>")`
- Docker daemon unavailable → `dockerAvailable()` returns `false` before build; `launchFromSpec()` throws `Error("Docker daemon is not available...")`

### 1.2 Run

```typescript
// impl/docker/docker-adapter.ts
async function dockerRun(
  imageName: string,
  options: {
    name?: string;
    hostname?: string;
    network?: string;
    volumes?: Record<string, string>;
    workdir?: string;
    entrypoint?: string[];
    detach?: boolean;  // default true
  } = {},
): Promise<{ containerId: string }>
```

`launchFromSpec()` wires this with values from the TOML spec:

```typescript
// impl/docker/container-launcher.ts
async function launchFromSpec(options?: {
  containerName?: string;
  imageName?: string;
  network?: string;
  volumes?: Record<string, string>;
}): Promise<{ containerId: string; plan: LaunchPlan }>
```

**Run behavior:**

- `--hostname sandbox-agent` is set unless overridden
- Network defaults to `"bridge"` unless overridden
- Volumes are passed as `-v <hostPath>:<containerPath>` for each entry
- Workdir is set from `spec.user.workdir` (TOML) or the option
- Entrypoint logic: if `spec.entrypoint.form === "cmd"` and `supports_sleep_infinity` is true, the container entrypoint is set to `/bin/bash` and the command is `sleep infinity` (keeps container alive for `docker exec`)
- Container always runs detached (`-d`)

**Error conditions:**

- `docker run` exits non-0 → throws `Error("docker run failed:\n<stderr>")`
- Container not running after launch → `verifyContainer()` returns `false`

### 1.3 Cleanup

```typescript
// impl/docker/container-launcher.ts
async function cleanupContainer(containerId: string): Promise<void>
```

`cleanupContainer()` calls `docker stop` then `docker rm -f` sequentially. Both are best-effort (caught and swallowed). The container is always force-removed.

---

## 2. PTY Lifecycle

### 2.1 PTY open — node-pty with fallback

`HerdrSession.open()` is the entry point:

```typescript
// impl/pty/herdr-session.ts
class HerdrSession {
  static async open(options: HerdrSessionOptions): Promise<HerdrSession>
}

interface HerdrSessionOptions {
  containerId: string;
  cwd?: string;      // default "/home/agent/workspace"
  term?: string;     // default "xterm-256color"
}
```

**Step 1 — prerequisites check:**

```typescript
herdrAvailableInContainer(containerId): Promise<boolean>
```

Runs `herdr --version` inside the container via `docker exec`. Throws if herdr is not present.

**Step 2 — node-pty load:**

```typescript
async function loadNodePty(): Promise<typeof import("node-pty") | null>
```

Attempts `await import("node-pty")`. If the module cannot be loaded (not installed, native bindings unavailable, or `MODULE_NOT_FOUND`), sets `ptyUnavailable = true` and emits:

```
YELLOW[liberty-pty-fallback]: node-pty unavailable: <reason>. Falling back to docker-exec -i -t PTY emulation.
```

**Step 3 — PTY spawn or fallback:**

*node-pty path (preferred):*

```typescript
session.ptyProcess = pty.spawn("docker", ["exec", "-i", "-t", containerId, "herdr"], {
  name: term,
  cwd,
  env: { TERM: term, HOME: "/home/agent" },
});
```

A PTY is opened with the Docker exec command as the child. PTY output is drained into `outputBuffers` to avoid backpressure.

*Fallback path (docker-exec -i -t):*

```typescript
session.fallbackProcess = spawn("docker", ["exec", "-i", "-t", containerId, "herdr"], {
  cwd,
  env: { TERM: term, HOME: "/home/agent" },
  stdio: ["pipe", "pipe", "pipe"],
});
```

No real PTY is created. The fallback process streams stdout into `outputBuffers` via a `StringDecoder`. This is a best-effort approximation.

**Step 4 — wait for herdr ready:**

```typescript
private async waitForHerdrReady(timeoutMs = 10000): Promise<void>
```

Polls `herdr pane list` every 500ms until output contains `"pane"`. Throws `Error("Timeout waiting for herdr to become ready")` on timeout.

> **YELLOW[liberty-pty-fallback]:** The fallback path does not provide a real PTY. Terminal applications that require TIOCGWINSZ or other PTY ioctls will not function correctly. This limitation affects environments where node-pty native bindings cannot be loaded (e.g. macOS ARM64 without Rosetta).

### 2.2 PTY close

```typescript
// impl/pty/herdr-session.ts
class HerdrSession {
  async close(): Promise<void>
  isUsingPty(): boolean
}
```

`close()` kills the PTY process (or fallback process) best-effort. `isUsingPty()` returns `true` if the real node-pty path was used.

---

## 3. Pane State Machine

### 3.1 Pane 0 creation

Pane 0 is created automatically by herdr at startup — before any `herdr agent start` command is issued. `HerdrSession.open()` calls `waitForHerdrReady()` which confirms pane 0 exists by polling `herdr pane list`.

```typescript
// impl/pty/herdr-session.ts
async getPane0Id(): Promise<string>
```

`getPane0Id()` runs `herdr pane list --workspace default` and parses the output for `pane-0` or a JSON `"id"` field. Returns `"pane-0"` as the fallback if parsing fails.

### 3.2 Pane lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│  pane state machine                                         │
│                                                             │
│  [created]  ──herdr agent start──►  [idle]                │
│       │                                     │               │
│       │                              herdr pane run         │
│       │                                     ▼               │
│       │                             [working]             │
│       │                                     │               │
│       │                              command exits         │
│       │                                     ▼               │
│       │                             [idle]  (ready for      │
│       │                                     next command)   │
│       │                                                     │
│  [blocked] ◄── governance denial ── cross-tree exec attempt│
└─────────────────────────────────────────────────────────────┘
```

**State descriptions:**

| State | Meaning |
|---|---|
| `created` | pane exists in herdr but has not been used |
| `idle` | pane is ready to accept a command |
| `working` | a command is actively running in the pane |
| `blocked` | governance check denied access to this pane |

**State transitions via herdr CLI:**

- `herdr agent start <name> --cwd <path> --no-focus -- <cmd>` → creates a new pane in `idle` state
- `herdr pane run <paneId> <cmd>` → runs a command, pane briefly enters `working`, returns to `idle`
- `herdr pane send-text <paneId> <text>` → injects text into a pane (used for signals)
- `herdr pane send-keys <paneId> <keys...>` → sends keypresses

**waitForPane polling** waits for a pane to reach `idle`, `working`, or `running` (case-insensitive check on `herdr pane get` output):

```typescript
// impl/pty/herdr-session.ts
async waitForPane(paneId: string, timeoutMs = 15000): Promise<void>
```

### 3.3 New pane spawning via herdr agent start

```typescript
// impl/pty/herdr-session.ts
async spawnPane(cmd: string[]): Promise<{ paneId: string; tabId: string }>
```

Calls `herdr agent start <name> --cwd /home/agent/workspace --no-focus -- <cmd>`. Parses `herdr pane list` output to extract the new pane's `pane-<N>` and `tab-<N>` IDs by matching the agent name.

> **YELLOW[liberty-pane-parse]:** Pane ID parsing relies on line-format conventions in herdr's `pane list` output. If herdr changes its output format, the parsing in `spawnPane()` and `getPane0Id()` may silently return incorrect IDs. No schema validation is performed on the herdr CLI output.

---

## 4. Signal Protocol

### 4.1 Governance rules (flat chain)

Per ADR 0004 + ADR 0005: governance is flat. No implicit authority levels. Every agent is peer-to-peer with its parent and siblings. The only authority relationships are explicit spawn/signal contracts.

```typescript
// fixtures/sandbox-spec/src/governance.ts
interface AgentIdentity {
  id: string;
  parentAgentId: string | null;
}

function canSignal(
  fromAgent: AgentIdentity,
  toAgent: AgentIdentity,
  signal: string,
): boolean
```

**Signal matrix:**

| from \ to | parent | sibling | cross-tree | grandchild |
|---|---|---|---|---|
| parent | — | ✓ | ✗ | ✗ |
| sibling | ✗ | ✓ | ✗ | ✗ |
| cross-tree | ✗ | ✗ | ✗ | ✗ |
| grandchild | ✗ | ✗ | ✗ | ✗ |

**Allowed:**

1. **Parent → child** (`toAgent.parentAgentId === fromAgent.id`): parent spawned the child, so it holds the spawn contract
2. **Sibling → sibling** (same `parentAgentId`, neither is the other's parent): peers under the same parent can signal each other

**Denied:**

3. **Cross-tree**: different parents, not in a parent/child line
4. **Grandchild → grandparent**: no implicit authority propagates upward

### 4.2 Signal delivery

```typescript
// impl/orchestration/governance-channel.ts
async function sendSignal(
  herdrSession: HerdrSession,
  fromAgent: AgentIdentity,
  toAgent: AgentIdentity,
  signal: string,
  payload?: string,
): Promise<{ delivered: boolean; result: GovernanceCheckResult }>
```

`sendSignal()` first calls `governanceCanSignal()`:

```typescript
// impl/orchestration/governance-channel.ts
function governanceCanSignal(
  fromAgent: AgentIdentity,
  toAgent: AgentIdentity,
  signal: string,
): GovernanceCheckResult
```

If the governance check denies the signal, returns `{ delivered: false, result }` immediately without attempting delivery.

If allowed, delivers via `herdrSession.runInPane(toAgent.id, signalCmd)` where `signalCmd = echo "SIGNAL:<from>-><to>:<signal>"`. The signal is fire-and-forget; delivery success is determined by `exitCode === 0`.

> **YELLOW[liberty-signal-fire-and-forget]:** Signal delivery is best-effort. If the target pane is not accepting commands at the moment of delivery, the signal is silently dropped. There is no acknowledgment, retry, or delivery confirmation. Agents using signals for critical coordination must implement their own acknowledgment protocol.

### 4.3 Signal types

The signal name is accepted but not interpreted by `canSignal()`. Common signal names referenced in tests:

| Signal | Direction | Purpose |
|---|---|---|
| `"spawn"` | parent → child | request child to spawn a sub-agent |
| `"share_state"` | sibling → sibling | share intermediate results |
| `"test-signal"` | any allowed pair | governance verification |

---

## 5. Sub-Orchestrator Promotion

### 5.1 Constants

```typescript
// fixtures/sandbox-spec/src/orchestration.ts
const SUB_ORCHESTRATOR_PROMOTION_REQUIRED: true = true;
const SUB_ORCHESTRATOR_MAX_DEPTH = 3;  // orchestrator → sub-orch → sub-agent
```

Depth 3 means: orchestrator (depth 0) → sub-orchestrator (depth 1) → sub-agent (depth 2). A sub-agent at depth 2 **cannot** be promoted further (depth 3 would exceed the max).

### 5.2 promoteToSubOrchestrator()

```typescript
// fixtures/sandbox-spec/src/orchestration.ts
interface PromotableSubAgentHandle {
  kind: "sub-agent";
  id: string;
  spawnable: boolean;
  parentSubOrchestratorId?: string;
  depth?: number;
}

function promoteToSubOrchestrator(
  handle: PromotableSubAgentHandle,
): SubOrchestratorHandle | null
```

**Returns `null` (rejected) when:**

- `handle.kind !== "sub-agent"` — not a sub-agent
- `handle.spawnable !== true` — leaf agent (cannot spawn further agents)
- `depth > SUB_ORCHESTRATOR_MAX_DEPTH` — at max depth, promotion would exceed limit

**Returns `SubOrchestratorHandle` when:**

```typescript
// fixtures/sandbox-spec/src/orchestration.ts
class SubOrchestratorHandle {
  constructor(
    public readonly id: string,                   // e.g. "sub-orch-sub-agent-1"
    public readonly parentSubOrchestratorId: string,  // parent orchestrator ID
    public readonly depth: number,                // incremented from parent
  ) {}
}
```

The promoted ID is `sub-orch-<handle.id>`. The `parentSubOrchestratorId` defaults to `"orchestrator-root"` if not set on the handle. The new depth is `(handle.depth ?? 1) + 1`.

### 5.3 Depth tracking

Depth is stored on each `SubOrchestratorHandle` and `PromotableSubAgentHandle`. The depth field is incremented on each promotion level:

```
depth 0: orchestrator (pi in pane 0)
depth 1: sub-orchestrator (promoted from a sub-agent at depth 0)
depth 2: sub-agent spawned by a sub-orchestrator at depth 1
depth 3: BLOCKED — exceeds SUB_ORCHESTRATOR_MAX_DEPTH
```

The runtime does not independently track or verify depth — it relies on `promoteToSubOrchestrator()` to enforce the cap.

> **YELLOW[liberty-depth-trust]:** Depth is tracked purely in handle objects. There is no runtime path that independently verifies that a pane's actual depth matches its handle's `depth` field. A misbehaving orchestrator could spawn agents beyond depth 3 by simply passing a falsy `depth` field; the enforcement is advisory within the spec fixture, not enforced by the runtime at spawn time.

---

## 6. User Workspace Isolation

### 6.1 Workspace separation

ADR 0004: a separate herdr workspace/tab is reserved for the user's direct bash interaction. The orchestrator (pi in pane 0) cannot reach into this workspace.

```typescript
// fixtures/sandbox-spec/src/user-workspace.ts
export const USER_WORKSPACE_TAB_ID = "user" as const;

export function isUserWorkspace(tabId: string): boolean {
  return typeof tabId === "string" && tabId === USER_WORKSPACE_TAB_ID;
}
```

The user workspace is opened via `spawnPane(["bash"])` — a new pane running bash, not under the orchestrator's tab hierarchy.

```typescript
// impl/orchestration/user-workspace.ts
async function openUserWorkspace(
  herdrSession: HerdrSession,
): Promise<{ herdrSession: HerdrSession; tabId: string; paneId: string }>
```

### 6.2 Isolation enforcement

Two assertion functions enforce isolation at the governance layer:

```typescript
// impl/orchestration/user-workspace.ts
function assertOrchestratorCannotAccessUserWorkspace(
  orchestratorPaneId: string,
  userWorkspaceTabId: string,
): void  // throws if equal

function assertUserCannotInjectIntoOrchestrator(
  userWorkspaceTabId: string,
  orchestratorPaneIds: string[],
): void  // throws if user tab matches any orchestrator pane
```

Both functions throw `Error("Isolation violation: ...")` if the check fails.

### 6.3 Live verification

```typescript
// impl/orchestration/user-workspace.ts
async function verifyUserWorkspaceIsolation(
  herdrSession: HerdrSession,
  orchestratorPaneId: string,
  userWorkspacePaneId: string,
): Promise<{ orchestratorBlocked: boolean; userBlocked: boolean }>
```

Performs two negative tests:

1. **Orchestrator → user workspace:** runs `herdr pane run <orchestratorPaneId> echo "test"` targeting the user workspace pane. If `exitCode === 0`, isolation is considered broken (`orchestratorBlocked = false`).
2. **User → orchestrator:** runs `herdr pane run <userWorkspacePaneId> echo "test"` targeting the orchestrator pane. If `exitCode !== 0`, user is blocked from orchestrator.

> **YELLOW[liberty-isolation-approximation]:** The isolation check uses `herdr pane run` exit codes as a proxy for governance enforcement. Since `herdr pane run` executes in the context of the named pane (not the caller's context), the exit code reflects whether the command ran, not whether governance correctly denied the cross-tree access. A more rigorous check would verify that the governance `canSignal()` predicate rejects the cross-tree pair before the `run` call is attempted.

---

## Error Conditions Summary

| Condition | Thrown by | Message |
|---|---|---|
| Docker daemon unavailable | `launchFromSpec()` | `"Docker daemon is not available..."` |
| herdr not in container | `HerdrSession.open()` | `"herdr not available in container..."` |
| pi not in container | `openOrchestratorSession()` | `"pi is not available in container..."` |
| docker build failure | `dockerBuild()` | `"docker build failed:\n<stderr>"` |
| docker run failure | `dockerRun()` | `"docker run failed:\n<stderr>"` |
| herdr timeout | `waitForHerdrReady()` | `"Timeout waiting for herdr to become ready"` |
| pane timeout | `waitForPane()` | `"Timeout waiting for pane <id> to be ready"` |
| pane ID collision | `assertUniquePaneIds()` | `"Pane ID collision detected..."` |
| exceeds MAX_SUB_AGENTS | `spawnSubAgentViaHerdr()` | `"Cannot spawn more than 8 sub-agents"` |
| exceeds MAX_PANE_DEPTH | `promoteToSubOrchestrator()` | returns `null` (no throw) |
| isolation violation | `assertOrchestratorCannotAccessUserWorkspace()` | `"Isolation violation: orchestrator pane..."` |
| isolation violation | `assertUserCannotInjectIntoOrchestrator()` | `"Isolation violation: user workspace tab..."` |

---

## Known Limitations (YELLOW Warnings)

1. **liberty-pty-fallback:** The `docker-exec -i -t` fallback does not provide a real PTY. Terminal apps requiring `TIOCGWINSZ` or similar ioctls will not work in fallback mode.

2. **liberty-pane-parse:** Pane ID parsing in `spawnPane()` and `getPane0Id()` relies on herdr's CLI output format conventions. No schema validation is performed.

3. **liberty-signal-fire-and-forget:** Signal delivery is best-effort with no acknowledgment, retry, or delivery confirmation.

4. **liberty-depth-trust:** Depth is advisory in handle objects; the runtime does not independently verify pane depth at spawn time.

5. **liberty-isolation-approximation:** The isolation check uses exit codes from `herdr pane run` as a proxy for governance enforcement, which is an approximation rather than a direct governance check.
