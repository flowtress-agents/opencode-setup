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
