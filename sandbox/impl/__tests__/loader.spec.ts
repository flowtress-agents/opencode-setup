import { describe, it, expect, beforeAll } from "vitest";
import {
  loadHerdrSpec, loadPicodeSpec, loadDockerSpec, loadSystemSpec, loadLimitsSpec,
  type HerdrSpec, type PicodeSpec, type DockerSpec, type SystemSpec, type LimitsSpec,
} from "../loader.js";

import {
  HERDR_NAME, HERDR_VERSION_MIN, HERDR_REPO, PATHS_SESSIONS, PATHS_CACHE,
  PTY_REQUIRED, PTY_TERM, SESSION_FORMAT, SESSION_COMPRESS,
  RUNTIME_NODE_MIN, RUNTIME_BUN_MIN,
} from "../../fixtures/sandbox-spec/src/herdr.js";

import {
  PICODE_NAME, PICODE_REPO, NODE_MIN_VERSION, NODE_RECOMMENDED_VERSION,
  NPM_MIN_VERSION, PNPM_MIN_VERSION, PICODE_INSTALL_CMD, PICODE_BIN_NAME, PICODE_ENTRY,
  PICODE_SUPPORTS_TELEMETRY_OFF, PICODE_SUPPORTS_OFFLINE_MODE, PICODE_SUPPORTS_VERSION_SKIP,
  PICODE_DEFAULT_MODEL_PROVIDER,
} from "../../fixtures/sandbox-spec/src/picode.js";

import {
  BASE_IMAGE, BASE_IMAGE_TAG, BASE_IMAGE_DIGEST, USER_NAME, USER_UID, USER_GID,
  USER_HOME, USER_WORKDIR, USER_SHELL, DOCKER_DETACH, DOCKER_HOSTNAME, DOCKER_NETWORK_MODE,
  MOUNT_WORKSPACE_HOST, MOUNT_WORKSPACE_CONTAINER, MOUNT_WORKSPACE_READONLY,
} from "../../fixtures/sandbox-spec/src/docker.js";

import {
  OS_FAMILY, OS_RELEASE, LOCALE, TIMEZONE, LANG, APT_REQUIRED,
  GIT_SAFE_DIRECTORY, GIT_DEFAULT_BRANCH, GIT_USER_NAME, GIT_USER_EMAIL, PATH_EXTRA,
} from "../../fixtures/sandbox-spec/src/system.js";

import {
  TIMEOUT_CONTAINER_START, TIMEOUT_IDLE, TIMEOUT_HOOK_EXEC, TIMEOUT_GIT_SETUP,
  TIMEOUT_COMMIT_COLLECTION, TIMEOUT_MERGE_TO_HOST, TIMEOUT_COMPLETION_GRACE,
  CPUS_DEFAULT, MEMORY_DEFAULT, SWAP_DEFAULT, PIDS_DEFAULT,
  RATE_LIMIT_AGENT_START, RATE_LIMIT_HOOK_EXEC_PER_MIN, RATE_LIMIT_COMMIT_PER_MIN,
  DISK_QUOTA_WORKSPACE_MB,
} from "../../fixtures/sandbox-spec/src/limits.js";

describe("TOML loader — herdr", () => {
  let spec: HerdrSpec;
  beforeAll(async () => { spec = await loadHerdrSpec(); });

  it("matches HERDR_NAME", () => { expect(spec.name).toBe(HERDR_NAME); });
  it("matches HERDR_VERSION_MIN", () => { expect(spec.versionMin).toBe(HERDR_VERSION_MIN); });
  it("matches HERDR_REPO", () => { expect(spec.repo).toBe(HERDR_REPO); });
  it("matches PATHS_SESSIONS", () => { expect(spec.paths.sessions).toBe(PATHS_SESSIONS); });
  it("matches PATHS_CACHE", () => { expect(spec.paths.cache).toBe(PATHS_CACHE); });
  it("matches PTY_REQUIRED", () => { expect(spec.pty.required).toBe(PTY_REQUIRED); });
  it("matches PTY_TERM", () => { expect(spec.pty.term).toBe(PTY_TERM); });
  it("matches SESSION_FORMAT", () => { expect(spec.session.format).toBe(SESSION_FORMAT); });
  it("matches SESSION_COMPRESS", () => { expect(spec.session.compress).toBe(SESSION_COMPRESS); });
  it("matches RUNTIME_NODE_MIN", () => { expect(spec.runtime.nodeMin).toBe(RUNTIME_NODE_MIN); });
  it("matches RUNTIME_BUN_MIN", () => { expect(spec.runtime.bunMin).toBe(RUNTIME_BUN_MIN); });
});

describe("TOML loader — picode", () => {
  let spec: PicodeSpec;
  beforeAll(async () => { spec = await loadPicodeSpec(); });

  it("matches PICODE_NAME", () => { expect(spec.name).toBe(PICODE_NAME); });
  it("matches PICODE_REPO", () => { expect(spec.repo).toBe(PICODE_REPO); });
  it("matches NODE_MIN_VERSION", () => { expect(spec.runtime.nodeMin).toBe(NODE_MIN_VERSION); });
  it("matches NODE_RECOMMENDED_VERSION", () => { expect(spec.runtime.nodeRecommended).toBe(NODE_RECOMMENDED_VERSION); });
  it("matches NPM_MIN_VERSION", () => { expect(spec.runtime.npmMin).toBe(NPM_MIN_VERSION); });
  it("matches PNPM_MIN_VERSION", () => { expect(spec.runtime.pnpmMin).toBe(PNPM_MIN_VERSION); });
  it("matches PICODE_INSTALL_CMD", () => { expect(spec.install.cmd).toBe(PICODE_INSTALL_CMD); });
  it("matches PICODE_BIN_NAME", () => { expect(spec.install.binName).toBe(PICODE_BIN_NAME); });
  it("matches PICODE_ENTRY", () => { expect(spec.install.entry).toBe(PICODE_ENTRY); });
  it("matches PICODE_SUPPORTS_TELEMETRY_OFF", () => { expect(spec.capabilities.supportsTelemetryOff).toBe(PICODE_SUPPORTS_TELEMETRY_OFF); });
  it("matches PICODE_SUPPORTS_OFFLINE_MODE", () => { expect(spec.capabilities.supportsOfflineMode).toBe(PICODE_SUPPORTS_OFFLINE_MODE); });
  it("matches PICODE_SUPPORTS_VERSION_SKIP", () => { expect(spec.capabilities.supportsVersionSkip).toBe(PICODE_SUPPORTS_VERSION_SKIP); });
  it("matches PICODE_DEFAULT_MODEL_PROVIDER", () => { expect(spec.capabilities.defaultModelProvider).toBe(PICODE_DEFAULT_MODEL_PROVIDER); });
});

describe("TOML loader — docker", () => {
  let spec: DockerSpec;
  beforeAll(async () => { spec = await loadDockerSpec(); });

  it("matches BASE_IMAGE", () => { expect(spec.base.image).toBe(BASE_IMAGE); });
  it("matches BASE_IMAGE_TAG", () => { expect(spec.base.imageTag).toBe(BASE_IMAGE_TAG); });
  it("matches BASE_IMAGE_DIGEST", () => { expect(spec.base.imageDigest).toBe(BASE_IMAGE_DIGEST); });
  it("matches USER_NAME", () => { expect(spec.user.name).toBe(USER_NAME); });
  it("matches USER_UID", () => { expect(spec.user.uid).toBe(USER_UID); });
  it("matches USER_GID", () => { expect(spec.user.gid).toBe(USER_GID); });
  it("matches USER_HOME", () => { expect(spec.user.home).toBe(USER_HOME); });
  it("matches USER_WORKDIR", () => { expect(spec.user.workdir).toBe(USER_WORKDIR); });
  it("matches USER_SHELL", () => { expect(spec.user.shell).toBe(USER_SHELL); });
  it("matches DOCKER_DETACH", () => { expect(spec.run.detach).toBe(DOCKER_DETACH); });
  it("matches DOCKER_HOSTNAME", () => { expect(spec.run.hostname).toBe(DOCKER_HOSTNAME); });
  it("matches DOCKER_NETWORK_MODE", () => { expect(spec.run.networkMode).toBe(DOCKER_NETWORK_MODE); });
  it("matches MOUNT_WORKSPACE_HOST", () => { expect(spec.mounts.workspace.host).toBe(MOUNT_WORKSPACE_HOST); });
  it("matches MOUNT_WORKSPACE_CONTAINER", () => { expect(spec.mounts.workspace.container).toBe(MOUNT_WORKSPACE_CONTAINER); });
  it("matches MOUNT_WORKSPACE_READONLY", () => { expect(spec.mounts.workspace.readonly).toBe(MOUNT_WORKSPACE_READONLY); });
});

describe("TOML loader — system", () => {
  let spec: SystemSpec;
  beforeAll(async () => { spec = await loadSystemSpec(); });

  it("matches OS_FAMILY", () => { expect(spec.os.family).toBe(OS_FAMILY); });
  it("matches OS_RELEASE", () => { expect(spec.os.release).toBe(OS_RELEASE); });
  it("matches LOCALE", () => { expect(spec.locale.locale).toBe(LOCALE); });
  it("matches TIMEZONE", () => { expect(spec.locale.timezone).toBe(TIMEZONE); });
  it("matches LANG", () => { expect(spec.locale.lang).toBe(LANG); });
  it("matches APT_REQUIRED exactly", () => { expect(spec.aptPackages.required).toEqual(APT_REQUIRED); });
  it("matches GIT_SAFE_DIRECTORY", () => { expect(spec.git.safeDirectory).toBe(GIT_SAFE_DIRECTORY); });
  it("matches GIT_DEFAULT_BRANCH", () => { expect(spec.git.defaultBranch).toBe(GIT_DEFAULT_BRANCH); });
  it("matches GIT_USER_NAME", () => { expect(spec.git.userName).toBe(GIT_USER_NAME); });
  it("matches GIT_USER_EMAIL", () => { expect(spec.git.userEmail).toBe(GIT_USER_EMAIL); });
  it("matches PATH_EXTRA", () => { expect(spec.path.extra).toEqual(PATH_EXTRA); });
});

describe("TOML loader — limits", () => {
  let spec: LimitsSpec;
  beforeAll(async () => { spec = await loadLimitsSpec(); });

  it("matches TIMEOUT_CONTAINER_START", () => { expect(spec.timeouts.containerStart).toBe(TIMEOUT_CONTAINER_START); });
  it("matches TIMEOUT_IDLE", () => { expect(spec.timeouts.idle).toBe(TIMEOUT_IDLE); });
  it("matches TIMEOUT_HOOK_EXEC", () => { expect(spec.timeouts.hookExec).toBe(TIMEOUT_HOOK_EXEC); });
  it("matches TIMEOUT_GIT_SETUP", () => { expect(spec.timeouts.gitSetup).toBe(TIMEOUT_GIT_SETUP); });
  it("matches TIMEOUT_COMMIT_COLLECTION", () => { expect(spec.timeouts.commitCollection).toBe(TIMEOUT_COMMIT_COLLECTION); });
  it("matches TIMEOUT_MERGE_TO_HOST", () => { expect(spec.timeouts.mergeToHost).toBe(TIMEOUT_MERGE_TO_HOST); });
  it("matches TIMEOUT_COMPLETION_GRACE", () => { expect(spec.timeouts.completionGrace).toBe(TIMEOUT_COMPLETION_GRACE); });
  it("matches CPUS_DEFAULT", () => { expect(spec.resources.cpusDefault).toBe(CPUS_DEFAULT); });
  it("matches MEMORY_DEFAULT", () => { expect(spec.resources.memoryDefault).toBe(MEMORY_DEFAULT); });
  it("matches SWAP_DEFAULT", () => { expect(spec.resources.swapDefault).toBe(SWAP_DEFAULT); });
  it("matches PIDS_DEFAULT", () => { expect(spec.resources.pidsDefault).toBe(PIDS_DEFAULT); });
  it("matches RATE_LIMIT_AGENT_START", () => { expect(spec.rateLimits.agentStart).toBe(RATE_LIMIT_AGENT_START); });
  it("matches RATE_LIMIT_HOOK_EXEC_PER_MIN", () => { expect(spec.rateLimits.hookExecPerMin).toBe(RATE_LIMIT_HOOK_EXEC_PER_MIN); });
  it("matches RATE_LIMIT_COMMIT_PER_MIN", () => { expect(spec.rateLimits.commitPerMin).toBe(RATE_LIMIT_COMMIT_PER_MIN); });
  it("matches DISK_QUOTA_WORKSPACE_MB", () => { expect(spec.disk.quotaWorkspaceMb).toBe(DISK_QUOTA_WORKSPACE_MB); });
});
