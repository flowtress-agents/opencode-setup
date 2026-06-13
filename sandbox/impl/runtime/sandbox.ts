import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { SandboxSpec, SandboxOptions, ISandbox, SandboxInfo, ExecResult, SandboxStatus } from "./types.js";
import {
  SandboxStartError,
  SandboxExecError,
  SandboxNotRunningError,
  SandboxAlreadyRunningError,
  SandboxTimeoutError,
} from "./errors.js";
import { buildDockerRunArgs } from "./builder.js";

/**
 * Docker sandbox container lifecycle manager.
 */
export class Sandbox extends EventEmitter implements ISandbox {
  public readonly id: string;
  public readonly containerName: string;
  private _status: SandboxStatus = "created";
  private _proc?: ChildProcess;
  private _startTime?: Date;
  private _stopTime?: Date;
  private _containerPid?: number;

  constructor(
    public readonly spec: SandboxSpec,
    public readonly opts: SandboxOptions = {},
    public readonly dockerBin: string = "docker"
  ) {
    super();
    this.id = opts.id !== undefined ? opts.id : `sandbox-${Date.now()}`;
    this.containerName = opts.containerName ?? (opts.id !== undefined ? `sandbox-${opts.id}` : this.id);
  }

  get status(): SandboxStatus {
    return this._status;
  }

  /**
   * Starts the container. Resolves when the container is running.
   * @throws {SandboxTimeoutError} if container does not start within idleTimeoutMs
   * @throws {SandboxStartError} if docker run fails
   * @throws {SandboxAlreadyRunningError} if already running
   */
  async start(): Promise<void> {
    if (this.status === "running" || this.status === "stopped" || this.status === "errored") {
      throw new SandboxAlreadyRunningError(this.containerName);
    }
    if (this._status === "stopped") {
      throw new SandboxAlreadyRunningError(this.containerName);
    }

    const argv = buildDockerRunArgs(this.spec, {
      ...this.opts,
      containerName: this.containerName,
      detached: true,
    });
    const image = this.opts.image ?? this.spec.docker.base.image;

    return new Promise((resolve, reject) => {
      let timeout = this.opts.idleTimeoutMs ?? this.spec.limits.timeouts.containerStart * 1000;
      if (timeout <= 0) timeout = this.spec.limits.timeouts.containerStart * 1000 || 1000;
      const timeoutId = setTimeout(() => {
        reject(new SandboxTimeoutError("start", timeout));
      }, timeout);

      this._proc = spawn(this.dockerBin, [...argv, image], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      let stderr = "";
      this._proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      this._proc.on("error", (err: Error) => {
        clearTimeout(timeoutId);
        reject(new SandboxStartError(this.containerName, -1, err.message));
      });

      this._proc.on("close", (code: number | null, signal: string | null) => {
        clearTimeout(timeoutId);
        if (code !== 0) {
          reject(new SandboxStartError(this.containerName, code ?? -1, stderr));
        }
      });

      this._pollContainerRunning(timeout).then((pid) => {
        this._status = "running";
        this._startTime = new Date();
        this._containerPid = pid;
        clearTimeout(timeoutId);
        resolve();
      }).catch(async (err) => {
        clearTimeout(timeoutId);
        this._proc?.kill();
        const ps = await this._execSilently(["ps", "-q", "--filter", `name=${this.containerName}`]);
        const pid = parseInt(ps.stdout.trim(), 10);
        if (pid > 0) {
          await this._execSilently(["kill", this.containerName]);
        }
        reject(err);
      });
    });
  }

  private async _pollContainerRunning(timeoutMs: number, interval = 200): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      try {
        const out = await this._execSilently(["ps", "-q", "--format", "{{.PID}}", "--filter", `name=${this.containerName}`]);
        const pid = parseInt(out.stdout.trim(), 10);
        if (pid > 0) return pid;
      } catch { /* keep polling */ }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new SandboxTimeoutError("container startup poll", timeoutMs);
  }

  private _execSilently(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const p = spawn(this.dockerBin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let so = "", se = "";
      p.stdout?.on("data", (c: Buffer) => { so += c.toString(); });
      p.stderr?.on("data", (c: Buffer) => { se += c.toString(); });
      p.on("close", (code) => resolve({ stdout: so, stderr: se, exitCode: code ?? -1 }));
    });
  }

  /**
   * Stops the container gracefully, then kills it if it doesn't stop in time.
   * @throws {Error} if docker stop fails
   */
  async stop(): Promise<void> {
    if (this._status !== "running") {
      this._status = "stopped";
      return;
    }

    const graceSeconds = Math.min(Math.ceil(this.spec.limits.timeouts.completionGrace ?? 60), 300);
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        spawn(this.dockerBin, ["kill", this.containerName], { stdio: "ignore" }).on("close", () => resolve());
      }, graceSeconds * 1000);

      spawn(this.dockerBin, ["stop", `--time`, String(graceSeconds), this.containerName], { stdio: "ignore" })
        .on("close", (code) => {
          clearTimeout(timeoutId);
          this._status = "stopped";
          this._stopTime = new Date();
          this._proc?.kill();
          if (code !== 0) reject(new Error(`docker stop failed with code ${code}`));
          else resolve();
        });
    });
  }

  /**
   * Executes a command inside the running container.
   * @param cmd - Command and arguments to execute
   * @throws {SandboxNotRunningError} if container is not running
   * @throws {SandboxExecError} if exec fails
   */
  async exec(cmd: string[]): Promise<ExecResult> {
    if (this._status !== "running") {
      throw new SandboxNotRunningError(this.containerName, `exec(${cmd.join(" ")})`);
    }
    if (cmd.length === 0) {
      throw new SandboxExecError(this.containerName, cmd, -1, "exec requires at least one command argument");
    }
    return new Promise((resolve, reject) => {
      const args = ["exec", "-i", this.containerName, ...cmd];
      const child = spawn(this.dockerBin, args, { stdio: ["ignore", "pipe", "pipe"] });
      const outChunks: string[] = [], errChunks: string[] = [];
      child.stdout?.on("data", (c: Buffer) => { outChunks.push(c.toString()); });
      child.stderr?.on("data", (c: Buffer) => { errChunks.push(c.toString()); });
      child.on("close", (code, signal) => {
        if (code !== 0) {
          reject(new SandboxExecError(this.containerName, cmd, code ?? -1, errChunks.join("")));
        } else {
          resolve({ exitCode: code ?? 0, stdout: outChunks.join(""), stderr: errChunks.join(""), signal: signal ?? undefined });
        }
      });
      child.on("error", (err) => reject(new SandboxExecError(this.containerName, cmd, -1, err.message)));
    });
  }

  /**
   * Returns information about the sandbox.
   */
  getInfo(): SandboxInfo {
    return {
      id: this.id,
      containerName: this.containerName,
      status: this._status,
      image: this.opts.image ?? this.spec.docker.base.image,
      workdir: this.opts.workspaceContainer ?? this.spec.docker.user.workdir,
      startedAt: this._startTime,
      stoppedAt: this._stopTime,
      pid: this._containerPid,
    };
  }
}
