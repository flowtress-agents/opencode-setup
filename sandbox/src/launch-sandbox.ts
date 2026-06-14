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

export interface LaunchSandboxPane {
  agent: string;
  role: string;
  immutable: boolean;
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
  // F1: 1 container per launch.
  launch?: { mode: "single-container" };
  // F2: pane 0 = orchestrator.
  pane?: LaunchSandboxPane[];
  // YELLOW[liberty-1]: pane_startup_count lives in [pane_config] (smol-toml workaround).
  pane_config?: { pane_startup_count: number };
  // F3: pane delegation / multiplexing.
  pane_delegation?: {
    mode: "spawn_new_tab";
    one_pane_per_agent: boolean;
    parent_pane_required: boolean;
    tab_per_agent_session: boolean;
  };
  // F3: orchestration limits (top-level [limits] table in the TOML).
  limits?: {
    max_sub_agents_per_orchestrator: number;
    max_pane_depth: number;
  };
  // F4: sub-orchestrator promotion.
  sub_orchestrator?: {
    promotion_required: boolean;
    max_depth: number;
  };
  // F5: flat governance chain.
  governance?: {
    model: "flat";
    peer_protocol: "explicit_spawn_signal";
  };
  // F6: user workspace.
  user_workspace?: {
    tab_id: string;
    agent: string;
    orchestrator_can_interact: boolean;
    user_can_inject_into_orchestrator: boolean;
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

  // ---- Orchestration (F1-F6) — additive shape checks (do not relax the
  // existing enforcement flags above). The new sections are optional in the
  // type but, if present, must be well-formed per their ADRs.

  if (obj!.launch !== undefined) {
    if (typeof obj!.launch !== "object" || obj!.launch === null) {
      throw new LaunchSandboxSpecError("launch", "must be an object");
    }
    if (obj!.launch.mode !== "single-container") {
      throw new LaunchSandboxSpecError(
        "launch.mode",
        `expected "single-container", got ${JSON.stringify(obj!.launch.mode)}`,
      );
    }
  }
  if (obj!.pane_config !== undefined) {
    if (typeof obj!.pane_config !== "object" || obj!.pane_config === null) {
      throw new LaunchSandboxSpecError("pane_config", "must be an object");
    }
    if (obj!.pane_config.pane_startup_count !== 1) {
      throw new LaunchSandboxSpecError(
        "pane_config.pane_startup_count",
        `expected 1, got ${JSON.stringify(obj!.pane_config.pane_startup_count)}`,
      );
    }
  }
  if (obj!.pane !== undefined) {
    if (!Array.isArray(obj!.pane)) {
      throw new LaunchSandboxSpecError("pane", "must be an array");
    }
    if (obj!.pane.length === 0) {
      throw new LaunchSandboxSpecError("pane", "must declare at least one pane");
    }
    const orchestratorPane = obj!.pane[0];
    if (orchestratorPane?.agent !== "pi") {
      throw new LaunchSandboxSpecError(
        "pane[0].agent",
        `expected "pi" (ADR 0002), got ${JSON.stringify(orchestratorPane?.agent)}`,
      );
    }
    if (orchestratorPane?.role !== "orchestrator") {
      throw new LaunchSandboxSpecError(
        "pane[0].role",
        `expected "orchestrator" (ADR 0002), got ${JSON.stringify(orchestratorPane?.role)}`,
      );
    }
    if (orchestratorPane?.immutable !== true) {
      throw new LaunchSandboxSpecError(
        "pane[0].immutable",
        `expected true (ADR 0004/0005), got ${JSON.stringify(orchestratorPane?.immutable)}`,
      );
    }
  }
  if (obj!.pane_delegation !== undefined) {
    const pd = obj!.pane_delegation;
    if (typeof pd !== "object" || pd === null) {
      throw new LaunchSandboxSpecError("pane_delegation", "must be an object");
    }
    if (pd.mode !== "spawn_new_tab") {
      throw new LaunchSandboxSpecError(
        "pane_delegation.mode",
        `expected "spawn_new_tab", got ${JSON.stringify(pd.mode)}`,
      );
    }
    if (pd.one_pane_per_agent !== true) {
      throw new LaunchSandboxSpecError("pane_delegation.one_pane_per_agent", "must be true");
    }
    if (pd.parent_pane_required !== true) {
      throw new LaunchSandboxSpecError("pane_delegation.parent_pane_required", "must be true");
    }
    if (pd.tab_per_agent_session !== true) {
      throw new LaunchSandboxSpecError("pane_delegation.tab_per_agent_session", "must be true");
    }
  }
  if (obj!.limits !== undefined) {
    const lim = obj!.limits;
    if (typeof lim !== "object" || lim === null) {
      throw new LaunchSandboxSpecError("limits", "must be an object");
    }
    if (lim.max_sub_agents_per_orchestrator !== 8) {
      throw new LaunchSandboxSpecError(
        "limits.max_sub_agents_per_orchestrator",
        `expected 8, got ${JSON.stringify(lim.max_sub_agents_per_orchestrator)}`,
      );
    }
    if (lim.max_pane_depth !== 3) {
      throw new LaunchSandboxSpecError(
        "limits.max_pane_depth",
        `expected 3, got ${JSON.stringify(lim.max_pane_depth)}`,
      );
    }
  }
  if (obj!.sub_orchestrator !== undefined) {
    const so = obj!.sub_orchestrator;
    if (typeof so !== "object" || so === null) {
      throw new LaunchSandboxSpecError("sub_orchestrator", "must be an object");
    }
    if (so.promotion_required !== true) {
      throw new LaunchSandboxSpecError("sub_orchestrator.promotion_required", "must be true");
    }
    if (so.max_depth !== 3) {
      throw new LaunchSandboxSpecError(
        "sub_orchestrator.max_depth",
        `expected 3, got ${JSON.stringify(so.max_depth)}`,
      );
    }
  }
  if (obj!.governance !== undefined) {
    const g = obj!.governance;
    if (typeof g !== "object" || g === null) {
      throw new LaunchSandboxSpecError("governance", "must be an object");
    }
    if (g.model !== "flat") {
      throw new LaunchSandboxSpecError(
        "governance.model",
        `expected "flat", got ${JSON.stringify(g.model)}`,
      );
    }
    if (g.peer_protocol !== "explicit_spawn_signal") {
      throw new LaunchSandboxSpecError(
        "governance.peer_protocol",
        `expected "explicit_spawn_signal", got ${JSON.stringify(g.peer_protocol)}`,
      );
    }
    if ("authority_level" in g && g.authority_level !== undefined) {
      throw new LaunchSandboxSpecError(
        "governance.authority_level",
        "flat governance must NOT carry an authority_level field (ADR 0005)",
      );
    }
  }
  if (obj!.user_workspace !== undefined) {
    const uw = obj!.user_workspace;
    if (typeof uw !== "object" || uw === null) {
      throw new LaunchSandboxSpecError("user_workspace", "must be an object");
    }
    if (uw.tab_id !== "user") {
      throw new LaunchSandboxSpecError(
        "user_workspace.tab_id",
        `expected "user", got ${JSON.stringify(uw.tab_id)}`,
      );
    }
    if (uw.agent !== "bash") {
      throw new LaunchSandboxSpecError(
        "user_workspace.agent",
        `expected "bash", got ${JSON.stringify(uw.agent)}`,
      );
    }
    if (uw.orchestrator_can_interact !== false) {
      throw new LaunchSandboxSpecError(
        "user_workspace.orchestrator_can_interact",
        "must be false (orchestrator must not interact with user workspace)",
      );
    }
    if (uw.user_can_inject_into_orchestrator !== false) {
      throw new LaunchSandboxSpecError(
        "user_workspace.user_can_inject_into_orchestrator",
        "must be false (user must not inject into orchestrator panes)",
      );
    }
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
