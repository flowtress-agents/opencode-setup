import type { ChildProcess } from "node:child_process";

/** The runtime's view of the full sandbox spec, composed from all 5 loader outputs */
export interface SandboxSpec {
  herdr: {
    name: string;
    repo: string;
    versionMin: string;
    paths: { sessions: string; cache: string };
    pty: { required: boolean; term: string };
    session: { format: string; compress: string };
    runtime: { nodeMin: string; bunMin: string };
  };
  picode: {
    name: string;
    npmName: string;
    friendlyName: string;
    repo: string;
    install: { cmd: string; binName: string; entry: string };
    runtime: { nodeMin: string; nodeRecommended: string; npmMin: string; pnpmMin: string };
    capabilities: {
      supportsTelemetryOff: boolean;
      supportsOfflineMode: boolean;
      supportsVersionSkip: boolean;
      defaultModelProvider: string;
    };
  };
  docker: {
    base: { image: string; imageTag: string; imageDigest: string };
    user: { name: string; uid: number; gid: number; home: string; workdir: string; shell: string };
    run: { detach: boolean; hostname: string; networkMode: string };
    mounts: { workspace: { host: string; container: string; readonly: boolean } };
  };
  system: {
    os: { family: string; release: string };
    locale: { locale: string; timezone: string; lang: string };
    aptPackages: { required: string[] };
    git: { safeDirectory: boolean; defaultBranch: string; userName: string; userEmail: string };
    path: { extra: string[] };
  };
  limits: {
    timeouts: {
      containerStart: number;
      idle: number;
      hookExec: number;
      gitSetup: number;
      commitCollection: number;
      mergeToHost: number;
      completionGrace: number;
    };
    resources: {
      cpusDefault: number | null;
      memoryDefault: string | null;
      swapDefault: string | null;
      pidsDefault: number;
    };
    rateLimits: {
      agentStart: number | null;
      hookExecPerMin: number;
      commitPerMin: number;
    };
    disk: { quotaWorkspaceMb: number };
  };
}

/** Options passed to createSandbox() */
export interface SandboxOptions {
  /** Unique identifier for this sandbox instance. Auto-generated if omitted. */
  id?: string;
  /** Override the workspace host path. Defaults to process.cwd() + '/workspace'. */
  workspaceHost?: string;
  /** Override the workspace container path. Defaults to spec value. */
  workspaceContainer?: string;
  /** Override the container name. Auto-generated from id if omitted. */
  containerName?: string;
  /** Override the image. Defaults to spec value. */
  image?: string;
  /** Override uid/gid. Defaults to spec values. */
  uid?: number;
  gid?: number;
  /** If true, starts the container detached (default: true). */
  detached?: boolean;
  /** Override the idle timeout (ms). Defaults to spec value. */
  idleTimeoutMs?: number;
}

/** Sandbox lifecycle states */
export type SandboxStatus = "created" | "running" | "stopped" | "errored";

/** Result of a sandbox.exec() call */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
}

/** Runtime options — controls how the runtime itself behaves */
export interface RuntimeOptions {
  /** Path to docker binary. Defaults to 'docker'. */
  dockerBin?: string;
  /** Override the docker run argv builder. For testing only. */
  builderOverride?: (spec: SandboxSpec, opts: SandboxOptions) => string[];
}

/** Public Sandbox API */
export interface ISandbox {
  readonly id: string;
  readonly containerName: string;
  readonly status: SandboxStatus;
  start(): Promise<void>;
  stop(): Promise<void>;
  exec(cmd: string[]): Promise<ExecResult>;
  getInfo(): SandboxInfo;
}

export interface SandboxInfo {
  id: string;
  containerName: string;
  status: SandboxStatus;
  image: string;
  workdir: string;
  startedAt?: Date;
  stoppedAt?: Date;
  pid?: number;
}