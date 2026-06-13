import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Path from this file to the in-worktree spec:
// src/launch-sandbox.ts -> src/ -> sandbox-spec/ -> fixtures/ -> sandbox/ -> spec/ -> sandbox/scripts/launch-sandbox.toml
const SPEC_PATH = resolve(__dirname, "../../../../sandbox/scripts/launch-sandbox.toml");

const SPEC = parseToml(readFileSync(SPEC_PATH, "utf8")) as unknown as LaunchSandboxSpec;

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

export const LAUNCH_SANDBOX_META = SPEC.meta;
export const LAUNCH_SANDBOX_IMAGE = SPEC.image;
export const LAUNCH_SANDBOX_BUILD = SPEC.build;
export const LAUNCH_SANDBOX_INSTALL_STEPS = SPEC.install.steps;
export const LAUNCH_SANDBOX_ENTRYPOINT = SPEC.entrypoint;
export const LAUNCH_SANDBOX_USER = SPEC.user;
export const LAUNCH_SANDBOX_HEALTH = SPEC.health;

export const LAUNCH_SANDBOX_SPEC: LaunchSandboxSpec = SPEC;
