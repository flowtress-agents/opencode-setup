import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Path from this file to the in-worktree spec:
// src/launch-sandbox.ts -> src/ -> sandbox/ -> sandbox/scripts/launch-sandbox.toml
const SPEC_PATH = resolve(__dirname, "../scripts/launch-sandbox.toml");

export interface LaunchSandboxInstallStep {
  name: string;
  cmd?: string;
  fallback_cmd?: string;
  fallback_cmd_required?: boolean;
  bin_name?: string;
  npm?: string;
  must_succeed?: boolean;
}

export interface LaunchSandboxSpec {
  meta: { name: string; version: string; description: string };
  image: {
    base: string;
    agent_uid: number;
    agent_gid: number;
    agent_user: string;
    uid_collision_strategy: string;
  };
  build: {
    context_strategy: string;
    build_timeout_sec: number;
    registry_fallbacks: string[];
    pull_timeout_sec: number;
    registry_fallbacks_required: boolean;
  };
  install: { steps: LaunchSandboxInstallStep[] };
  entrypoint: { form: string; cmd: string[]; supports_sleep_infinity: boolean };
  user: {
    name: string;
    uid: number;
    gid: number;
    home: string;
    workdir: string;
    uid_verification_required: boolean;
  };
  health: {
    post_build_checks: string[];
    post_build_checks_required: boolean;
    post_start_timeout_sec: number;
  };
}

export class LaunchSandboxSpecError extends Error {
  constructor(public readonly field: string, public readonly reason: string) {
    super(`launch-sandbox.toml: ${field}: ${reason}`);
    this.name = "LaunchSandboxSpecError";
  }
}

function parseLaunchSandboxSpec(raw: unknown): LaunchSandboxSpec {
  const obj = raw as Record<string, any> | null | undefined;
  // Required top-level fields
  for (const k of ["meta", "image", "build", "install", "entrypoint", "user", "health"]) {
    if (typeof obj?.[k] !== "object" || obj[k] === null) {
      throw new LaunchSandboxSpecError(k, "missing or not an object");
    }
  }
  // Specific shape checks
  if (obj!.meta.name !== "launch-sandbox") {
    throw new LaunchSandboxSpecError("meta.name", `expected "launch-sandbox", got ${JSON.stringify(obj!.meta.name)}`);
  }
  if (obj!.image.base !== "node:22-bookworm") {
    throw new LaunchSandboxSpecError("image.base", `expected "node:22-bookworm", got ${JSON.stringify(obj!.image.base)}`);
  }
  if (obj!.image.uid_collision_strategy !== "shift_to_first_free") {
    throw new LaunchSandboxSpecError(
      "image.uid_collision_strategy",
      `expected "shift_to_first_free", got ${JSON.stringify(obj!.image.uid_collision_strategy)}`,
    );
  }
  if (obj!.build.context_strategy !== "tempfile") {
    throw new LaunchSandboxSpecError(
      "build.context_strategy",
      `expected "tempfile", got ${JSON.stringify(obj!.build.context_strategy)}`,
    );
  }
  if (obj!.entrypoint.form !== "cmd") {
    throw new LaunchSandboxSpecError("entrypoint.form", `expected "cmd", got ${JSON.stringify(obj!.entrypoint.form)}`);
  }
  // Enforcement flag checks
  if (obj!.build.registry_fallbacks_required !== true) {
    throw new LaunchSandboxSpecError("build.registry_fallbacks_required", "must be true");
  }
  if (!Array.isArray(obj!.install.steps)) {
    throw new LaunchSandboxSpecError("install.steps", "must be an array");
  }
  for (const step of obj!.install.steps) {
    if (step?.name === "herdr") {
      if (step.fallback_cmd_required !== true) {
        throw new LaunchSandboxSpecError("install.steps[herdr].fallback_cmd_required", "must be true");
      }
      if (step.must_succeed !== true) {
        throw new LaunchSandboxSpecError("install.steps[herdr].must_succeed", "must be true");
      }
    }
    if (step?.name === "picode") {
      if (step.must_succeed !== true) {
        throw new LaunchSandboxSpecError("install.steps[picode].must_succeed", "must be true");
      }
      if (step.npm !== "@earendil-works/pi-coding-agent") {
        throw new LaunchSandboxSpecError(
          "install.steps[picode].npm",
          `expected "@earendil-works/pi-coding-agent", got ${JSON.stringify(step.npm)}`,
        );
      }
    }
  }
  if (obj!.user.uid_verification_required !== true) {
    throw new LaunchSandboxSpecError("user.uid_verification_required", "must be true");
  }
  if (obj!.health.post_build_checks_required !== true) {
    throw new LaunchSandboxSpecError("health.post_build_checks_required", "must be true");
  }
  return obj as unknown as LaunchSandboxSpec;
}

const RAW = parseToml(readFileSync(SPEC_PATH, "utf8"));
export const LAUNCH_SANDBOX_SPEC: LaunchSandboxSpec = parseLaunchSandboxSpec(RAW);

export const LAUNCH_SANDBOX_META = LAUNCH_SANDBOX_SPEC.meta;
export const LAUNCH_SANDBOX_IMAGE = LAUNCH_SANDBOX_SPEC.image;
export const LAUNCH_SANDBOX_BUILD = LAUNCH_SANDBOX_SPEC.build;
export const LAUNCH_SANDBOX_INSTALL_STEPS = LAUNCH_SANDBOX_SPEC.install.steps;
export const LAUNCH_SANDBOX_ENTRYPOINT = LAUNCH_SANDBOX_SPEC.entrypoint;
export const LAUNCH_SANDBOX_USER = LAUNCH_SANDBOX_SPEC.user;
export const LAUNCH_SANDBOX_HEALTH = LAUNCH_SANDBOX_SPEC.health;
