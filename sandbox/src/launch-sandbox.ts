/**
 * Spec-2 launch-sandbox validator.
 *
 * Parses the spec-2 launch-sandbox.toml, validates the layout, and
 * exposes the typed shape to the runtime. The runtime is the consumer;
 * it is not enforced by the spec — the spec is the data, the runtime
 * is the behavior.
 *
 * Phase 1.2 adds the `[[workspace]]` validator:
 *   - Each block must have either no `role` (defaults to
 *     `"orchestrator"`), or `role = "orchestrator"`, or `role = "user"`.
 *   - Any other role is rejected.
 *   - At most one `role = "user"` block may be declared.
 *   - The user workspace's first tab must have `label = "user"`.
 *
 * The runtime hook in `impl/pty/herdr-session.ts:spawnPane` refuses
 * any `targetTabId` whose tab label starts with `user-`; this
 * validator is the spec-side half of that reservation. See ADR 0002
 * and sandbox/CONTEXT.md §1.4 / §1.5 / §2.5.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { reserveUserWorkspace, type UserWorkspaceHandle, type LaunchSpec } from "../fixtures/sandbox-spec/src/orchestration.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// launch-sandbox.ts lives next to launch-sandbox.toml in the spec-2 src tree.
const SPEC_PATH = resolve(__dirname, "./launch-sandbox.toml");

/** Valid roles for a `[[workspace]]` block. */
export type WorkspaceRole = "orchestrator" | "user";

/** A single `[[workspace]]` block after validation. */
export interface LaunchSandboxWorkspace {
  label?: string;
  role: WorkspaceRole;
  tab: Array<{ label: string; cmd: string[] }>;
}

/** The full validated spec-2 launch-sandbox contract. */
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
  install: { steps: Array<Record<string, unknown>> };
  entrypoint: { form: string; cmd: string[]; supports_sleep_infinity: boolean };
  user: { name: string; workdir: string };
  health: {
    post_build_checks: string[];
    post_build_checks_required: boolean;
    post_start_timeout_sec: number;
  };
  launch: { mode: "single-container" };
  pane_delegation: {
    mode: "spawn_new_tab";
    one_pane_per_agent: boolean;
    parent_pane_required: boolean;
    tab_per_agent_session: boolean;
  };
  limits: {
    max_sub_agents_per_orchestrator: number;
    max_pane_depth: number;
  };
  sub_orchestrator: {
    promotion_required: boolean;
    max_depth: number;
  };
  governance: {
    model: "flat";
    peer_protocol: "explicit_spawn_signal";
  };
  /** Validated `[[workspace]]` array. Exactly one block has `role = "user"`. */
  workspace: LaunchSandboxWorkspace[];
}

export class LaunchSandboxSpecError extends Error {
  constructor(public readonly field: string, public readonly reason: string) {
    super(`launch-sandbox.toml: ${field}: ${reason}`);
    this.name = "LaunchSandboxSpecError";
  }
}

/**
 * Validate the parsed raw TOML. Throws `LaunchSandboxSpecError` on the
 * first shape problem. Returns the strongly-typed spec on success.
 *
 * Validation order:
 *   1. Required top-level fields exist and have the right type.
 *   2. Required enums and value constraints (base image, build strategy,
 *      etc.) match the spec-2 contract.
 *   3. `[[workspace]]` blocks: valid role, exactly one user block, every
 *      user block's first tab has `label = "user"`.
 */
export function parseLaunchSandboxSpec(raw: unknown): LaunchSandboxSpec {
  const obj = raw as Record<string, any> | null | undefined;
  for (const k of ["meta", "image", "build", "install", "entrypoint", "user", "health"]) {
    if (typeof obj?.[k] !== "object" || obj[k] === null) {
      throw new LaunchSandboxSpecError(k, "missing or not an object");
    }
  }
  if (obj!.meta.name !== "launch-sandbox") {
    throw new LaunchSandboxSpecError(
      "meta.name",
      `expected "launch-sandbox", got ${JSON.stringify(obj!.meta.name)}`,
    );
  }
  if (obj!.image.base !== "node:22-bookworm") {
    throw new LaunchSandboxSpecError(
      "image.base",
      `expected "node:22-bookworm", got ${JSON.stringify(obj!.image.base)}`,
    );
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
  if (obj!.build.registry_fallbacks_required !== true) {
    throw new LaunchSandboxSpecError(
      "build.registry_fallbacks_required",
      "must be true",
    );
  }
  if (!Array.isArray(obj!.install.steps)) {
    throw new LaunchSandboxSpecError("install.steps", "must be an array");
  }
  if (obj!.entrypoint.form !== "cmd") {
    throw new LaunchSandboxSpecError(
      "entrypoint.form",
      `expected "cmd", got ${JSON.stringify(obj!.entrypoint.form)}`,
    );
  }
  if (obj!.health.post_build_checks_required !== true) {
    throw new LaunchSandboxSpecError(
      "health.post_build_checks_required",
      "must be true",
    );
  }

  // --- [[workspace]] validator (Phase 1.2) --------------------------------
  if (!Array.isArray(obj!.workspace)) {
    throw new LaunchSandboxSpecError("workspace", "must be an array of [[workspace]] blocks");
  }
  if (obj!.workspace.length === 0) {
    throw new LaunchSandboxSpecError("workspace", "must declare at least one [[workspace]] block");
  }

  const validRoles: ReadonlySet<WorkspaceRole> = new Set(["orchestrator", "user"]);
  let userCount = 0;
  const normalizedWorkspaces: LaunchSandboxWorkspace[] = [];

  obj!.workspace.forEach((block: any, index: number) => {
    if (typeof block !== "object" || block === null) {
      throw new LaunchSandboxSpecError(
        `workspace[${index}]`,
        "must be an object",
      );
    }

    // Role is optional; default is "orchestrator".
    const rawRole = block.role;
    let role: WorkspaceRole;
    if (rawRole === undefined || rawRole === null) {
      role = "orchestrator";
    } else if (typeof rawRole !== "string") {
      throw new LaunchSandboxSpecError(
        `workspace[${index}].role`,
        `must be a string ("orchestrator" or "user"), got ${JSON.stringify(rawRole)}`,
      );
    } else if (!validRoles.has(rawRole as WorkspaceRole)) {
      throw new LaunchSandboxSpecError(
        `workspace[${index}].role`,
        `unknown role ${JSON.stringify(rawRole)}; allowed: "orchestrator", "user"`,
      );
    } else {
      role = rawRole as WorkspaceRole;
    }

    if (role === "user") {
      userCount += 1;
    }

    // Tab list shape.
    if (!Array.isArray(block.tab) || block.tab.length === 0) {
      throw new LaunchSandboxSpecError(
        `workspace[${index}].tab`,
        "must be a non-empty array (every workspace needs at least one tab)",
      );
    }
    const normalizedTabs = block.tab.map((t: any, tabIdx: number) => {
      if (typeof t !== "object" || t === null) {
        throw new LaunchSandboxSpecError(
          `workspace[${index}].tab[${tabIdx}]`,
          "must be an object",
        );
      }
      if (typeof t.label !== "string" || t.label.length === 0) {
        throw new LaunchSandboxSpecError(
          `workspace[${index}].tab[${tabIdx}].label`,
          "must be a non-empty string",
        );
      }
      if (!Array.isArray(t.cmd) || t.cmd.length === 0) {
        throw new LaunchSandboxSpecError(
          `workspace[${index}].tab[${tabIdx}].cmd`,
          "must be a non-empty array of strings",
        );
      }
      return { label: t.label, cmd: t.cmd as string[] };
    });

    if (role === "user" && normalizedTabs[0]!.label !== "user") {
      throw new LaunchSandboxSpecError(
        `workspace[${index}].tab[0].label`,
        `user workspace's first tab label must be "user" (the runtime hook keys off the "user-" prefix), got ${JSON.stringify(normalizedTabs[0]!.label)}`,
      );
    }

    normalizedWorkspaces.push({
      label: typeof block.label === "string" ? block.label : undefined,
      role,
      tab: normalizedTabs,
    });
  });

  if (userCount > 1) {
    throw new LaunchSandboxSpecError(
      "workspace",
      `more than one [[workspace]] has role = "user" (found ${userCount}); exactly one user workspace is allowed (see ADR 0002)`,
    );
  }
  if (userCount === 0) {
    throw new LaunchSandboxSpecError(
      "workspace",
      `no [[workspace]] has role = "user"; every orchestrator workspace must be paired with a user workspace (see ADR 0002)`,
    );
  }

  // --- Orchestration tables ------------------------------------------------
  if (obj!.launch?.mode !== "single-container") {
    throw new LaunchSandboxSpecError(
      "launch.mode",
      `expected "single-container", got ${JSON.stringify(obj!.launch?.mode)}`,
    );
  }
  if (obj!.pane_delegation?.mode !== "spawn_new_tab") {
    throw new LaunchSandboxSpecError(
      "pane_delegation.mode",
      `expected "spawn_new_tab", got ${JSON.stringify(obj!.pane_delegation?.mode)}`,
    );
  }
  if (obj!.governance?.model !== "flat") {
    throw new LaunchSandboxSpecError(
      "governance.model",
      `expected "flat", got ${JSON.stringify(obj!.governance?.model)}`,
    );
  }

  return {
    meta: obj!.meta,
    image: obj!.image,
    build: obj!.build,
    install: obj!.install,
    entrypoint: obj!.entrypoint,
    user: obj!.user,
    health: obj!.health,
    launch: obj!.launch,
    pane_delegation: obj!.pane_delegation,
    limits: obj!.limits,
    sub_orchestrator: obj!.sub_orchestrator,
    governance: obj!.governance,
    workspace: normalizedWorkspaces,
  };
}

const RAW = parseToml(readFileSync(SPEC_PATH, "utf8"));
export const LAUNCH_SANDBOX_SPEC: LaunchSandboxSpec = parseLaunchSandboxSpec(RAW);

/**
 * Run the user-workspace reservation on the validated spec. Throws
 * if no user block is present (the validator already guarantees
 * exactly one is, so this should not throw in practice — it is here
 * to surface a `UserWorkspaceHandle` to the runtime).
 */
export function reserveUserWorkspaceFromSpec(): UserWorkspaceHandle {
  // Cast: LaunchSandboxSpec is a strict superset of LaunchSpec, so the
  // reservation helper accepts it.
  return reserveUserWorkspace(LAUNCH_SANDBOX_SPEC as unknown as LaunchSpec);
}

export const LAUNCH_SANDBOX_META = LAUNCH_SANDBOX_SPEC.meta;
export const LAUNCH_SANDBOX_IMAGE = LAUNCH_SANDBOX_SPEC.image;
export const LAUNCH_SANDBOX_BUILD = LAUNCH_SANDBOX_SPEC.build;
export const LAUNCH_SANDBOX_INSTALL_STEPS = LAUNCH_SANDBOX_SPEC.install.steps;
export const LAUNCH_SANDBOX_ENTRYPOINT = LAUNCH_SANDBOX_SPEC.entrypoint;
export const LAUNCH_SANDBOX_USER = LAUNCH_SANDBOX_SPEC.user;
export const LAUNCH_SANDBOX_HEALTH = LAUNCH_SANDBOX_SPEC.health;
export const LAUNCH_SANDBOX_WORKSPACES = LAUNCH_SANDBOX_SPEC.workspace;
