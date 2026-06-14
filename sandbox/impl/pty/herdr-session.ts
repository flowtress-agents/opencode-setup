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
  return dockerExecCmd(["docker", "exec", containerId, "herdr", ...args]);
}

function herdrCmdWithInput(
  args: string[],
  containerId: string,
  input: string,
): { exitCode: number; stdout: string; stderr: string } {
  const { spawnSync } = require("node:child_process");
  try {
    const result = spawnSync("docker", ["exec", ...args], {
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

    const session = new HerdrSession(containerId, usePty);

    if (usePty && pty) {
      // Use node-pty to open a PTY exec into the container
      session.ptyProcess = pty.spawn("docker", ["exec", "-i", "-t", containerId, "herdr"], {
        name: term,
        cwd,
        env: { TERM: term, HOME: "/home/agent" },
      });

      // Drain PTY output to avoid backpressure
      session.ptyProcess.onData((data: string) => {
        session.outputBuffers.push(data);
      });

      session.ptyProcess.onExit(({ exitCode }) => {
        // PTY closed
      });
    } else {
      // Fallback: docker exec -i -t (no real PTY, just streams)
      // This is a best-effort fallback for environments where node-pty
      // native bindings cannot be loaded (e.g. macOS ARM64 without Rosetta).
      session.fallbackProcess = spawn("docker", ["exec", "-i", "-t", containerId, "herdr"], {
        cwd,
        env: { TERM: term, HOME: "/home/agent" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      session.fallbackProcess.stdout?.on("data", (data: Buffer) => {
        session.outputBuffers.push(session.decoder.write(data));
      });
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
      if (result.exitCode === 0 && result.stdout.includes("pane")) {
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
    const result = herdrCmd(["pane", "list", "--workspace", "default"], this.containerId);
    if (result.exitCode !== 0) {
      throw new Error(`herdr pane list failed:\n${result.stderr}`);
    }
    // Parse pane list output to find pane 0
    // Output format: pane-0 ... or JSON
    const lines = result.stdout.split("\n").filter((l) => l.includes("pane-0") || l.includes('"id"'));
    for (const line of lines) {
      const match = line.match(/pane-0|"id"\s*:\s*"([^"]+)"/);
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
    const name = `agent-${Date.now()}`;
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

    // Find the newly created pane
    const listResult = herdrCmd(["pane", "list"], this.containerId);
    let paneId = `pane-unknown`;
    let tabId = `tab-unknown`;

    if (listResult.exitCode === 0) {
      // Parse pane list to extract the new pane's ID
      // The most recently created pane should be the last one listed
      const lines = listResult.stdout.split("\n");
      for (const line of lines) {
        if (line.includes(name)) {
          const idMatch = line.match(/pane-\d+/);
          const tabMatch = line.match(/tab-\d+/);
          if (idMatch) paneId = idMatch[0];
          if (tabMatch) tabId = tabMatch[0];
        }
      }
    }

    return { paneId, tabId };
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
   */
  async sendText(paneId: string, text: string): Promise<void> {
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
   */
  async runInPane(paneId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return herdrCmd(["pane", "run", paneId, command], this.containerId);
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
  }

  /**
   * Check if this session is using real node-pty (vs. fallback).
   */
  isUsingPty(): boolean {
    return this.usePty;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const result = dockerExecCmd(["docker", "exec", containerId, "pi", "--version"]);
  return result.exitCode === 0;
}
