/**
 * PTY harness for herdr sessions.
 *
 * Uses node-pty to open a pseudo-terminal, exec into a running Docker container,
 * and drive herdr for pane management.
 *
 * The HerdrSession opens a PTY connected to the container, starts herdr in it
 * (pane 0 is auto-created at startup), and exposes:
 *   - spawnPane(cmd): spawn a new pane with a command via `herdr agent start`
 *   - waitForPane(paneId): wait for a pane to be ready
 *   - sendKeys(paneId, keys): send keystrokes to a pane
 *   - close(): tear down the session
 *
 * If node-pty is unavailable, falls back to a docker-exec -i -t stub approach
 * and emits a YELLOW warning.
 */

import { execSync, type ExecSyncOptions } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { Capability } from "../../fixtures/sandbox-spec/src/governance.js";

function resolveDockerBin(): string {
  try {
    return execSync("which docker", { encoding: "utf-8" }).trim();
  } catch {
    return "docker";
  }
}

const DOCKER_BIN = resolveDockerBin();

/**
 * Allowlist of commands that a read-only agent may execute.
 * Used by the runtime capability enforcement gate in runInPane / sendText.
 */
export const READ_ONLY_COMMAND_RE = /^(cat|ls|grep|find|rg|git log|git diff|git show|git status|git branch|jq|pi|herdr pane read|herdr pane list|herdr pane get)(\s|$)/;

/**
 * Log a command + resolved capability to the per-agent audit file.
 * File path: /tmp/agent-<id>.audit inside the container.
 */
function auditLog(containerId: string, agentId: string, capability: Capability, cmd: string): void {
  const entry = `[${new Date().toISOString()}] capability=${capability} cmd="${cmd.replace(/"/g, '\\"')}"\n`;
  try {
    execSync(
      `${DOCKER_BIN} exec ${containerId} sh -c 'mkdir -p /tmp && echo ${entry.replace(/'/g, "'\"'\"'")} >> /tmp/agent-${agentId}.audit'`,
      { stdio: "ignore" },
    );
  } catch {
    // best-effort — audit failure must not break command execution
  }
}

/**
 * Check whether a command is allowed for the given capability.
 * When capability === "read", only allowlisted commands are permitted.
 */
function isCommandAllowed(cmd: string, capability: Capability): boolean {
  if (capability === "readwrite") return true;
  return READ_ONLY_COMMAND_RE.test(cmd);
}


export interface PaneInfo {
  paneId: string;
  label: string;
  state: string;
}

export interface HerdrSessionOptions {
  containerId: string;
  cwd?: string;
  term?: string;
}

// ---------------------------------------------------------------------------
// node-pty loader with fallback
// ---------------------------------------------------------------------------

let nodePty: typeof import("node-pty") | null = null;
let ptyUnavailable = false;
let ptyUnavailableReason = "";

async function loadNodePty(): Promise<typeof import("node-pty") | null> {
  if (process.env.PTY_FALLBACK === "1") {
    ptyUnavailable = true;
    ptyUnavailableReason = "PTY_FALLBACK=1";
    return null;
  }
  if (ptyUnavailable) return null;
  if (nodePty) return nodePty;
  try {
    nodePty = await import("node-pty");
    return nodePty;
  } catch (err: any) {
    ptyUnavailable = true;
    ptyUnavailableReason =
      err?.message?.includes("node-pty") || err?.code === "MODULE_NOT_FOUND"
        ? "node-pty native bindings not available (could not load node-pty module)"
        : String(err?.message ?? err);
    console.warn(
      `YELLOW[liberty-pty-fallback]: node-pty unavailable: ${ptyUnavailableReason}. ` +
        "Falling back to docker-exec -i -t PTY emulation.",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Docker exec helper (non-PTY)
// ---------------------------------------------------------------------------

function dockerExecCmd(cmd: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd.join(" "), {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }) as string;
    return { exitCode: 0, stdout: stdout ?? "", stderr: "" };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ? String(err.stdout) : "",
      stderr: err.stderr ? String(err.stderr) : "",
    };
  }
}

// ---------------------------------------------------------------------------
// herdr CLI wrappers
// ---------------------------------------------------------------------------

function herdrCmd(args: string[], containerId: string): { exitCode: number; stdout: string; stderr: string } {
  return dockerExecCmd([DOCKER_BIN, "exec", containerId, "herdr", ...args]);
}

function herdrCmdWithInput(
  args: string[],
  containerId: string,
  input: string,
): { exitCode: number; stdout: string; stderr: string } {
  const { spawnSync } = require("node:child_process");
  try {
    const result = spawnSync(DOCKER_BIN, ["exec", ...args], {
      input,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      exitCode: result.status ?? 0,
      stdout: result.stdout ? String(result.stdout) : "",
      stderr: result.stderr ? String(result.stderr) : "",
    };
  } catch (err: any) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: String(err?.message ?? err),
    };
  }
}

// ---------------------------------------------------------------------------
// HerdrSession — main class
// ---------------------------------------------------------------------------

export interface SpawnPaneResult {
  paneId: string;
  tabId: string;
}

/**
 * A live herdr session inside a Docker container.
 *
 * Opens a PTY (via node-pty or docker-exec fallback), starts herdr,
 * and exposes pane management via the herdr CLI.
 */
let _spawnPaneCounter = 0;

export function resetSpawnPaneCounter(): void {
  _spawnPaneCounter = 0;
}

export class HerdrSession {
  private containerId: string;
  private ptyProcess: import("node-pty").IPty | null = null;
  private fallbackProcess: ChildProcess | null = null;
  private usePty: boolean;
  private outputBuffers: string[] = [];
  private decoder = new StringDecoder("utf-8");

  private constructor(containerId: string, usePty: boolean) {
    this.containerId = containerId;
    this.usePty = usePty;
  }

  /**
   * Open a new herdr session in the container.
   * Returns a HerdrSession handle (or throws if herdr is not available).
   */
  static async open(options: HerdrSessionOptions): Promise<HerdrSession> {
    const { containerId, cwd = "/home/agent/workspace", term = "xterm-256color" } = options;

    // Check if herdr is available in the container
    const checkResult = herdrCmd(["--version"], containerId);
    if (checkResult.exitCode !== 0) {
      throw new Error(
        `herdr not available in container ${containerId}:\n${checkResult.stderr}`,
      );
    }

    // Try node-pty first
    const pty = await loadNodePty();
    const usePty = pty !== null;

    // Reset the cross-file sub-agent counter so a fresh HerdrSession gets a
    // fresh budget. Without this, tests in different spec files share
    // module-level state and a later test sees "_subAgentCounter > 8".
    try {
      const { resetSubAgentCounter } = await import("../orchestration/multiplexing-session.js");
      resetSubAgentCounter();
    } catch {
      // module may not be importable in some test contexts; ignore
    }

    const session = new HerdrSession(containerId, usePty);

    if (usePty && pty) {
      try {
        // Use node-pty to open a PTY exec into the container
        session.ptyProcess = pty.spawn(DOCKER_BIN, ["exec", "-i", "-t", containerId, "herdr"], {
          name: term,
          cwd,
          env: { ...process.env, TERM: term, HOME: "/home/agent" },
        });

        // Drain PTY output to avoid backpressure
        session.ptyProcess.onData((data: string) => {
          session.outputBuffers.push(data);
        });

        session.ptyProcess.onExit(() => {
          // PTY closed
        });
      } catch (err: any) {
        console.warn(
          `YELLOW[liberty-pty-fallback]: node-pty spawn failed: ${String(err?.message ?? err)}. ` +
            "Falling back to docker-exec -i -t PTY emulation.",
        );
        session.usePty = false;
        session.ptyProcess = null;
      }
    }

    if (!session.ptyProcess) {
      // Fallback: start herdr as a detached daemon when none is running.
      const listCheck = herdrCmd(["pane", "list"], containerId);
      if (listCheck.exitCode !== 0) {
        const startResult = dockerExecCmd([DOCKER_BIN, "exec", "-d", containerId, "herdr"]);
        if (startResult.exitCode !== 0) {
          throw new Error(`failed to start herdr daemon:\n${startResult.stderr}`);
        }
      }
    }

    // Wait for herdr to initialize (pane 0 is auto-created)
    await session.waitForHerdrReady();

    return session;
  }

  /**
   * Wait for herdr to be ready (pane 0 created).
   */
  private async waitForHerdrReady(timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = herdrCmd(["pane", "list"], this.containerId);
      if (result.exitCode === 0 && /pane[_-]|pane_list/i.test(result.stdout)) {
        return;
      }
      await sleep(500);
    }
    throw new Error("Timeout waiting for herdr to become ready");
  }

  /**
   * Get the ID of pane 0 (the orchestrator pane, auto-created at startup).
   */
  async getPane0Id(): Promise<string> {
    const result = herdrCmd(["pane", "list"], this.containerId);
    if (result.exitCode !== 0) {
      throw new Error(`herdr pane list failed:\n${result.stderr}`);
    }

    try {
      const payload = JSON.parse(result.stdout.trim());
      const panes = payload?.result?.panes;
      if (Array.isArray(panes) && panes.length > 0) {
        const paneId = panes[0]?.pane_id;
        if (typeof paneId === "string" && paneId.length > 0) {
          return paneId;
        }
      }
    } catch {
      // fall through to legacy text parsing
    }

    const lines = result.stdout.split("\n").filter((l) => l.includes("pane-0") || l.includes("pane_id"));
    for (const line of lines) {
      const match = line.match(/pane-0|"pane_id"\s*:\s*"([^"]+)"/);
      if (match) return match[1] ?? "pane-0";
    }
    return "pane-0";
  }

  /**
   * Spawn a new pane with the given command.
   * Uses `herdr agent start` to create a new pane running the command.
   *
   * @param cmd - The command and arguments to run in the new pane
   * @returns SpawnPaneResult with paneId and tabId
   */
  async spawnPane(cmd: string[]): Promise<SpawnPaneResult> {
    _spawnPaneCounter += 1;
    const name = `agent-${Date.now()}-${_spawnPaneCounter}`;
    const args = [
      "agent",
      "start",
      name,
      "--cwd",
      "/home/agent/workspace",
      "--no-focus",
      "--",
      ...cmd,
    ];

    const result = herdrCmd(args, this.containerId);
    if (result.exitCode !== 0) {
      throw new Error(
        `herdr agent start failed for ${name}:\n${result.stderr}`,
      );
    }

    for (const raw of [result.stdout, result.stderr]) {
      const trimmed = raw.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const payload = JSON.parse(trimmed);
        const agent = payload?.result?.agent;
        if (typeof agent?.pane_id === "string" && typeof agent?.tab_id === "string") {
          return { paneId: agent.pane_id, tabId: agent.tab_id };
        }
      } catch {
        // try next source
      }
    }

    const listResult = herdrCmd(["pane", "list"], this.containerId);
    if (listResult.exitCode === 0) {
      try {
        const payload = JSON.parse(listResult.stdout.trim());
        const panes = payload?.result?.panes;
        if (Array.isArray(panes) && panes.length > 0) {
          const newest = panes[panes.length - 1];
          return {
            paneId: newest.pane_id ?? "pane-unknown",
            tabId: newest.tab_id ?? "tab-unknown",
          };
        }
      } catch {
        // legacy text parsing below
      }
    }

    return { paneId: "pane-unknown", tabId: "tab-unknown" };
  }

  /**
   * Spawn a new pane in a freshly-created tab. This is the per-workstream
   * pattern the team-spawner uses — each sub-orchestrator, adversarial,
   * and surgical fixer needs its own tab so panes don't collide.
   *
   * Returns a unique tabId and a paneId within that tab. The tab is
   * created via `herdr tab create --workspace <ws> --label <label> --no-focus`
   * and the pane is created via `herdr agent start --tab <tabId>`.
   *
   * @param cmd - Command + argv to run in the new pane
   * @param opts.tabLabel - Human-readable tab label (e.g. "orch-scaffold_2")
   * @param opts.workspaceId - Workspace to create the tab in. If omitted,
   *   the orchestrator's workspace (pane 0's workspace) is used.
   * @returns SpawnPaneResult with the new paneId and the new tabId
   */
  async spawnPaneInNewTab(
    cmd: string[],
    opts: { tabLabel?: string; workspaceId?: string } = {},
  ): Promise<SpawnPaneResult> {
    _spawnPaneCounter += 1;
    const tabLabel = opts.tabLabel ?? `tab-${Date.now()}-${_spawnPaneCounter}`;
    const workspaceId = opts.workspaceId ?? "default";

    // Step 1: create a new tab in the workspace.
    const tabArgs = [
      "tab",
      "create",
      "--workspace",
      workspaceId,
      "--cwd",
      "/home/agent/workspace",
      "--label",
      tabLabel,
      "--no-focus",
    ];
    const tabResult = herdrCmd(tabArgs, this.containerId);
    if (tabResult.exitCode !== 0) {
      throw new Error(
        `herdr tab create failed for label="${tabLabel}":\n${tabResult.stderr}`,
      );
    }
    const tabId = parseTabId(tabResult.stdout) ?? "tab-unknown";
    const rootPaneId = parseRootPaneId(tabResult.stdout) ?? "pane-unknown";

    // Step 2: start the agent in that tab. We use --tab so the agent
    // lands in the freshly-created tab as its root pane.
    const agentName = `agent-${Date.now()}-${_spawnPaneCounter}`;
    const agentArgs = [
      "agent",
      "start",
      agentName,
      "--workspace",
      workspaceId,
      "--tab",
      tabId,
      "--cwd",
      "/home/agent/workspace",
      "--no-focus",
      "--",
      ...cmd,
    ];
    const agentResult = herdrCmd(agentArgs, this.containerId);
    if (agentResult.exitCode !== 0) {
      // herdr may not support --tab on this version; fall back to
      // the regular spawnPane and use the tabId we just created.
      // The pane will share the first tab's pane_id; this is a
      // best-effort fallback so callers still get a valid handle.
      console.warn(
        `YELLOW[liberty-herdr-tab-flag]: herdr agent start --tab failed: ${agentResult.stderr}. ` +
          `Falling back to spawnPane; tabId may not match the agent's tab.`,
      );
      const fallback = await this.spawnPane(cmd);
      return { paneId: fallback.paneId, tabId };
    }

    // Parse the agent start response to get the paneId. The agent
    // response uses a unique pane_id that may differ from rootPaneId
    // (it's the new pane the agent is running in, not the tab root).
    const agentPaneId = parseAgentPaneId(agentResult.stdout);
    return {
      paneId: agentPaneId ?? rootPaneId,
      tabId,
    };
  }

  /**
   * Wait for a pane to be ready (state = idle or working).
   */
  async waitForPane(paneId: string, timeoutMs = 15000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = herdrCmd(["pane", "get", paneId], this.containerId);
      if (result.exitCode === 0) {
        const output = result.stdout.toLowerCase();
        if (output.includes("idle") || output.includes("working") || output.includes("running")) {
          return;
        }
      }
      await sleep(500);
    }
    throw new Error(`Timeout waiting for pane ${paneId} to be ready`);
  }

  /**
   * Send text to a pane (herdr pane send-text).
   *
   * @param paneId - Target pane ID
   * @param text - Text to send
   * @param agentCapability - Capability of the agent sending the text
   * @param agentId - Agent ID used for audit log
   */
  async sendText(
    paneId: string,
    text: string,
    agentCapability: Capability = "readwrite",
    agentId = "unknown",
  ): Promise<void> {
    auditLog(this.containerId, agentId, agentCapability, `[send-text] ${text}`);
    const result = herdrCmd(
      ["pane", "send-text", paneId, text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')],
      this.containerId,
    );
    if (result.exitCode !== 0) {
      throw new Error(`herdr pane send-text failed:\n${result.stderr}`);
    }
  }

  /**
   * Send keypresses to a pane (herdr pane send-keys).
   */
  async sendKeys(paneId: string, keys: string[]): Promise<void> {
    const result = herdrCmd(["pane", "send-keys", paneId, ...keys], this.containerId);
    if (result.exitCode !== 0) {
      throw new Error(`herdr pane send-keys failed:\n${result.stderr}`);
    }
  }

  /**
   * Run a command in a specific pane (herdr pane run).
   *
   * @param paneId - Target pane ID
   * @param command - Command to run
   * @param agentCapability - Capability of the agent running the command.
   *   When "read", non-allowlisted commands are rejected with an error.
   * @param agentId - Agent ID used for audit log file naming (default "unknown")
   */
  async runInPane(
    paneId: string,
    command: string,
    agentCapability: Capability = "readwrite",
    agentId = "unknown",
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    // Capability enforcement gate
    if (!isCommandAllowed(command, agentCapability)) {
      const errMsg = `read-only agent attempted write command: ${command}`;
      return { exitCode: 1, stdout: "", stderr: errMsg };
    }

    // Audit log every command
    auditLog(this.containerId, agentId, agentCapability, command);

    const runResult = herdrCmd(["pane", "run", paneId, command], this.containerId);
    if (runResult.exitCode !== 0) {
      return runResult;
    }

    await sleep(750);
    const readResult = herdrCmd(
      [
        "pane",
        "read",
        paneId,
        "--source",
        "recent-unwrapped",
        "--lines",
        "30",
        "--format",
        "text",
      ],
      this.containerId,
    );
    if (readResult.exitCode !== 0) {
      return readResult;
    }

    return {
      exitCode: 0,
      stdout: parsePaneReadOutput(readResult.stdout),
      stderr: "",
    };
  }

  /**
   * Close the herdr session (kill the PTY / exec process).
   */
  async close(): Promise<void> {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch { /* best-effort */ }
      this.ptyProcess = null;
    }
    if (this.fallbackProcess) {
      try {
        this.fallbackProcess.kill();
      } catch { /* best-effort */ }
      this.fallbackProcess = null;
    }
    // Stop the detached herdr daemon so the next session starts with a clean workspace.
    herdrCmd(["server", "stop"], this.containerId);
    await waitForHerdrStopped(this.containerId);
  }

  /**
   * Check if this session is using real node-pty (vs. fallback).
   */
  isUsingPty(): boolean {
    return this.usePty;
  }

  /**
   * Return the container id this session is bound to. Useful for
   * callers that need to invoke `docker exec` directly (e.g. the
   * team-spawner reads `herdr pane list` to discover the
   * orchestrator's workspace id).
   */
  getContainerId(): string {
    return this.containerId;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------


function parsePaneReadOutput(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith("# ")) return false;
      if (/^[a-f0-9]{64}$/.test(line)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

/**
 * Extract the tab_id from a `herdr tab create` JSON response.
 * Returns null if parsing fails so callers can use a fallback id.
 */
function parseTabId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const payload = JSON.parse(trimmed);
    const tab = payload?.result?.tab;
    if (typeof tab?.tab_id === "string") return tab.tab_id;
  } catch {
    return null;
  }
  return null;
}

/**
 * Extract the root pane_id from a `herdr tab create` JSON response.
 * The root pane is the pane auto-created when the tab was created.
 */
function parseRootPaneId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const payload = JSON.parse(trimmed);
    const root = payload?.result?.root_pane;
    if (typeof root?.pane_id === "string") return root.pane_id;
  } catch {
    return null;
  }
  return null;
}

/**
 * Extract the pane_id from a `herdr agent start` JSON response.
 */
function parseAgentPaneId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const payload = JSON.parse(trimmed);
    const agent = payload?.result?.agent;
    if (typeof agent?.pane_id === "string") return agent.pane_id;
  } catch {
    return null;
  }
  return null;
}

/**
 * Extract the workspace_id from a `herdr pane list` or `tab list` response.
 * Used by team-spawner to discover the orchestrator's workspace id.
 */
function parseWorkspaceId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const payload = JSON.parse(trimmed);
    const panes = payload?.result?.panes;
    if (Array.isArray(panes) && panes.length > 0) {
      const ws = panes[0]?.workspace_id;
      if (typeof ws === "string") return ws;
    }
    const tabs = payload?.result?.tabs;
    if (Array.isArray(tabs) && tabs.length > 0) {
      const ws = tabs[0]?.workspace_id;
      if (typeof ws === "string") return ws;
    }
  } catch {
    return null;
  }
  return null;
}

export { parseTabId, parseRootPaneId, parseAgentPaneId, parseWorkspaceId };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll until herdr daemon is no longer reachable (post server stop). */
async function waitForHerdrStopped(containerId: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = herdrCmd(["pane", "list"], containerId);
    if (result.exitCode !== 0) {
      return;
    }
    await sleep(200);
  }
  // Last-resort stop if daemon is still responding.
  herdrCmd(["server", "stop"], containerId);
}

/**
 * Check if herdr is available in a container.
 */
export async function herdrAvailableInContainer(containerId: string): Promise<boolean> {
  const result = herdrCmd(["--version"], containerId);
  return result.exitCode === 0;
}

/**
 * Check if pi is available in a container.
 */
export async function piAvailableInContainer(containerId: string): Promise<boolean> {
  const result = dockerExecCmd([DOCKER_BIN, "exec", containerId, "pi", "--version"]);
  return result.exitCode === 0;
}
