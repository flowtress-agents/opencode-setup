import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_ROOT = resolve(__dirname, "../../../micro-spec/sandbox");

async function loadToml<T>(relPath: string): Promise<T> {
  const fullPath = resolve(SPEC_ROOT, relPath);
  const text = await readFile(fullPath, "utf8");
  return parseToml(text) as T;
}

export interface HerdrSpec {
  name: string;
  repo: string;
  versionMin: string;
  paths: { sessions: string; cache: string };
  pty: { required: boolean; term: string };
  session: { format: string; compress: string };
  runtime: { nodeMin: string; bunMin: string };
}

export interface PicodeSpec {
  name: string;
  npmName: string;
  repo: string;
  install: { cmd: string; binName: string; entry: string };
  runtime: { nodeMin: string; nodeRecommended: string; npmMin: string; pnpmMin: string };
  capabilities: {
    supportsTelemetryOff: boolean;
    supportsOfflineMode: boolean;
    supportsVersionSkip: boolean;
    defaultModelProvider: string;
  };
}

export interface DockerSpec {
  base: { image: string; imageTag: string; imageDigest: string };
  user: { name: string; uid: number; gid: number; home: string; workdir: string; shell: string };
  run: { detach: boolean; hostname: string; networkMode: string };
  mounts: { workspace: { host: string; container: string; readonly: boolean } };
}

export interface SystemSpec {
  os: { family: string; release: string };
  locale: { locale: string; timezone: string; lang: string };
  aptPackages: { required: string[] };
  git: { safeDirectory: boolean; defaultBranch: string; userName: string; userEmail: string };
  path: { extra: string[] };
}

export interface LimitsSpec {
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
}

export async function loadHerdrSpec(): Promise<HerdrSpec> {
  const raw = await loadToml<any>("tools/herdr.toml");
  return {
    name: raw.meta.name,
    repo: raw.meta.repo,
    versionMin: raw.meta.version_min,
    paths: { sessions: raw.paths.sessions, cache: raw.paths.cache },
    pty: { required: raw.pty.required, term: raw.pty.term },
    session: { format: raw.session.format, compress: raw.session.compress },
    runtime: { nodeMin: raw.runtime.node_min, bunMin: raw.runtime.bun_min },
  };
}

export async function loadPicodeSpec(): Promise<PicodeSpec> {
  const raw = await loadToml<any>("tools/picode.toml");
  return {
    name: raw.meta.name,
    npmName: raw.meta.npm_name,
    repo: raw.meta.repo,
    install: { cmd: raw.install.cmd, binName: raw.install.bin_name, entry: raw.install.entry },
    runtime: {
      nodeMin: raw.runtime.node_min,
      nodeRecommended: raw.runtime.node_recommended,
      npmMin: raw.runtime.npm_min,
      pnpmMin: raw.runtime.pnpm_min,
    },
    capabilities: {
      supportsTelemetryOff: raw.capabilities.supports_telemetry_off,
      supportsOfflineMode: raw.capabilities.supports_offline_mode,
      supportsVersionSkip: raw.capabilities.supports_version_skip,
      defaultModelProvider: raw.capabilities.default_model_provider,
    },
  };
}

export async function loadDockerSpec(): Promise<DockerSpec> {
  const raw = await loadToml<any>("runtime/docker.toml");
  return {
    base: { image: raw.base.image, imageTag: raw.base.image_tag, imageDigest: raw.base.image_digest },
    user: {
      name: raw.user.name,
      uid: raw.user.uid,
      gid: raw.user.gid,
      home: raw.user.home,
      workdir: raw.user.workdir,
      shell: raw.user.shell,
    },
    run: { detach: raw.run.detach, hostname: raw.run.hostname, networkMode: raw.run.network_mode },
    mounts: { workspace: { host: raw.mounts.workspace.host, container: raw.mounts.workspace.container, readonly: raw.mounts.workspace.readonly } },
  };
}

export async function loadSystemSpec(): Promise<SystemSpec> {
  const raw = await loadToml<any>("runtime/system.toml");
  return {
    os: { family: raw.os.family, release: raw.os.release },
    locale: { locale: raw.locale.locale, timezone: raw.locale.timezone, lang: raw.locale.lang },
    aptPackages: { required: raw.apt_packages.required },
    git: { safeDirectory: raw.git.safe_directory, defaultBranch: raw.git.default_branch, userName: raw.git.user_name, userEmail: raw.git.user_email },
    path: { extra: raw.path.extra },
  };
}

export async function loadLimitsSpec(): Promise<LimitsSpec> {
  const raw = await loadToml<any>("limits.toml");
  return {
    timeouts: {
      containerStart: raw.timeouts.container_start,
      idle: raw.timeouts.idle,
      hookExec: raw.timeouts.hook_exec,
      gitSetup: raw.timeouts.git_setup,
      commitCollection: raw.timeouts.commit_collection,
      mergeToHost: raw.timeouts.merge_to_host,
      completionGrace: raw.timeouts.completion_grace,
    },
    resources: {
      cpusDefault: raw.resources.cpus_default,
      memoryDefault: raw.resources.memory_default,
      swapDefault: raw.resources.swap_default,
      pidsDefault: raw.resources.pids_default,
    },
    rateLimits: {
      agentStart: raw.rate_limits.agent_start,
      hookExecPerMin: raw.rate_limits.hook_exec_per_min,
      commitPerMin: raw.rate_limits.commit_per_min,
    },
    disk: { quotaWorkspaceMb: raw.disk.quota_workspace_mb },
  };
}
