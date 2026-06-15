/**
 * Sub-orchestrator promotion constants and helpers (F4).
 *
 * ADR 0004 + ADR 0005: a leaf sub-agent cannot promote itself to a
 * sub-orchestrator. The parent orchestrator must explicitly promote.
 * Sub-orchestrators exist in their own pane; max depth is 3 by default
 * (orchestrator -> sub-orchestrator -> sub-agent).
 *
 * Promotion is intentionally opt-in: leaf agents default to no promotion.
 * This module's promoteToSubOrchestrator() returns null for any handle
 * that is not flagged as promotable.
 *
 * The user-workspace reservation is also exported from this module
 * (see UserWorkspaceHandle + reserveUserWorkspace). It is the
 * spec-level contract that the runtime's team-spawner uses to wire the
 * user tab in. See sandbox/CONTEXT.md §1.4 (user workspace), §1.5 (user
 * tab), and §2.5 (the runtime-only enforcement rationale). ADR 0002
 * documents the limitation: a misbehaving sub-agent can call
 * `docker exec herdr ...` directly and bypass the runtime hook, so the
 * reservation is defense-in-depth, not airtight.
 */

import type { Capability } from "./governance.js";

export const SUB_ORCHESTRATOR_PROMOTION_REQUIRED: true = true;
export const SUB_ORCHESTRATOR_MAX_DEPTH = 3;

export interface PromotableSubAgentHandle {
  kind: "sub-agent";
  id: string;
  spawnable: boolean;
  parentSubOrchestratorId?: string;
  depth?: number;
}

// YELLOW[liberty-2]: TS2687 hardening — all fields are readonly.
// Interface declaration merge: the class below satisfies this interface.
export interface SubOrchestratorHandle {
  readonly id: string;
  readonly parentSubOrchestratorId: string;
  readonly depth: number;
  /** Sub-orchestrators are always "read" — they cannot mutate the repo. */
  readonly capability: Capability;
}

// Named class with public readonly fields — satisfies the readonly interface.
// The interface declaration merge makes this the canonical runtime type.
export class SubOrchestratorHandle {
  constructor(
    public readonly id: string,
    public readonly parentSubOrchestratorId: string,
    public readonly depth: number,
    public readonly capability: Capability = "read",
  ) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("SubOrchestratorHandle: id must be a non-empty string");
    }
    if (typeof parentSubOrchestratorId !== "string" || parentSubOrchestratorId.length === 0) {
      throw new Error("SubOrchestratorHandle: parentSubOrchestratorId must be a non-empty string");
    }
  }
}

/**
 * Promote a promotable sub-agent to a sub-orchestrator.
 *
 * @param handle - The sub-agent handle to promote. Must have spawnable=true.
 * @returns A SubOrchestratorHandle if promotion is permitted; null for leaf
 *   agents that cannot be promoted (ADR 0005).
 */
export function promoteToSubOrchestrator(
  handle: PromotableSubAgentHandle,
): SubOrchestratorHandle | null {
  if (!handle || handle.kind !== "sub-agent") {
    return null;
  }
  if (handle.spawnable !== true) {
    return null;
  }
  const parentId = handle.parentSubOrchestratorId ?? "orchestrator-root";
  const depth = (handle.depth ?? 1) + 1;
  if (depth > SUB_ORCHESTRATOR_MAX_DEPTH) {
    return null;
  }
  return new SubOrchestratorHandle(
    `sub-orch-${handle.id}`,
    parentId,
    depth,
    "read",
  );
}

/**
 * Factory for SubOrchestratorHandle. Mirrors the runtime contract: a
 * sub-orchestrator handle records which orchestrator spawned it.
 */
export function createSubOrchestratorHandle(args: {
  id: string;
  parentSubOrchestratorId: string;
  depth: number;
  capability?: Capability;
}): SubOrchestratorHandle {
  return new SubOrchestratorHandle(args.id, args.parentSubOrchestratorId, args.depth, args.capability ?? "read");
}

// ---------------------------------------------------------------------------
// User-workspace reservation (F7)
// ---------------------------------------------------------------------------
//
// Glossary (see sandbox/CONTEXT.md §1.4, §1.5):
//   - user workspace: the herdr workspace paired with the orchestrator's,
//     reserved for the user's direct bash interaction.
//   - user tab:       the single tab in the user workspace. The runtime
//     creates it with `herdr tab create --label user --no-focus` and a
//     `bash` root pane.
//
// The reservation has two halves:
//   1. SPEC (this module): the `LaunchSpec` MUST declare exactly one
//      `[[workspace]]` block with `role = "user"`. `reserveUserWorkspace`
//      returns the corresponding `UserWorkspaceHandle` or throws.
//   2. RUNTIME (impl/pty/herdr-session.ts): `spawnPane` refuses any
//      `targetTabId` whose tab label starts with `user-`. This is the
//      "no herdr fork" mechanical guarantee — a misbehaving sub-agent
//      that calls `herdr agent start --tab <user-tab>` is rejected.

/**
 * The label every user tab carries. Used by the runtime's `spawnPane`
 * hook to identify reserved tabs by prefix. Pinned to the exact string
 * `user` per CONTEXT.md §1.5.
 */
export const USER_WORKSPACE_LABEL = "user" as const;

/**
 * The handle the spec hands back to the runtime after a successful
 * user-workspace reservation. The runtime treats this as the source of
 * truth for "where the user lives" and refuses to spawn into it.
 *
 * `label` is a literal `"user"` — there is exactly one valid value, so
 * it's a literal type and not just a string.
 */
export interface UserWorkspaceHandle {
  workspaceId: string;
  tabId: string;
  paneId: string;
  label: "user";
}

/**
 * Minimal shape of a `[[workspace]]` block from `launch-sandbox.toml`.
 * The runtime validator (spec-2/sandbox/src/launch-sandbox.ts) parses
 * the full block; this is the trimmed view the spec needs to reserve
 * the user workspace. Fields are intentionally loose because the TOML
 * parser is the only authoritative source of shape.
 */
export interface LaunchSpecWorkspaceEntry {
  /** Optional human-readable label. */
  label?: string;
  /** Optional role; "user" is the only role this helper recognizes. */
  role?: string;
  /** Optional tab list; only the first `tab[0].label` is consulted. */
  tab?: Array<{ label?: string; cmd?: string[] }>;
}

/**
 * Minimal shape of a parsed `launch-sandbox.toml`. The validator
 * produces a stricter view; this is the loose shape the spec needs.
 */
export interface LaunchSpec {
  workspace?: LaunchSpecWorkspaceEntry[];
}

/**
 * Reserve the user workspace from a parsed launch-sandbox.toml spec.
 *
 * Throws if:
 *   - the spec declares no `[[workspace]]` blocks at all
 *   - the spec declares zero `role = "user"` blocks
 *   - the spec declares more than one `role = "user"` block
 *
 * The thrown errors are caught by the runtime validator
 * (`spec-2/sandbox/src/launch-sandbox.ts`) and surfaced as
 * `LaunchSandboxSpecError`s with stable messages so the test suite
 * can match on them.
 *
 * @param spec - The parsed launch-sandbox.toml
 * @returns A UserWorkspaceHandle the runtime can wire into the
 *   orchestrator session
 */
export function reserveUserWorkspace(spec: LaunchSpec): UserWorkspaceHandle {
  const workspaces = spec?.workspace;
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error(
      "reserveUserWorkspace: no user workspace declared in launch-sandbox.toml (need a [[workspace]] with role = \"user\")",
    );
  }

  const userBlocks = workspaces.filter((w) => w?.role === "user");
  if (userBlocks.length === 0) {
    throw new Error(
      'reserveUserWorkspace: no user workspace declared (need a [[workspace]] with role = "user")',
    );
  }
  if (userBlocks.length > 1) {
    throw new Error(
      `reserveUserWorkspace: more than one user workspace declared (found ${userBlocks.length}); exactly one user workspace is allowed (see ADR 0002)`,
    );
  }

  const block = userBlocks[0]!;
  const tab = Array.isArray(block.tab) ? block.tab[0] : undefined;
  const tabLabel = tab?.label ?? USER_WORKSPACE_LABEL;

  // The runtime hands back real workspace/tab/pane ids. The spec only
  // synthesizes deterministic placeholders so the function is pure and
  // can be unit-tested without a live herdr session.
  return {
    workspaceId: `ws-${tabLabel}`,
    tabId: `tab-${tabLabel}`,
    paneId: `pane-${tabLabel}-1`,
    label: "user",
  };
}
