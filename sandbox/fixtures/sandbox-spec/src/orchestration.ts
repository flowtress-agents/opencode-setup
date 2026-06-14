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

export const SUB_ORCHESTRATOR_PROMOTION_REQUIRED: true = true;
export const SUB_ORCHESTRATOR_MAX_DEPTH = 3;

export interface PromotableSubAgentHandle {
  kind: "sub-agent";
  id: string;
  spawnable: boolean;
  parentSubOrchestratorId?: string;
  depth?: number;
}

export interface SubOrchestratorHandle {
  id: string;
  parentSubOrchestratorId: string;
  depth: number;
}

export interface SubOrchestratorHandleConstructor {
  new (args: { id: string; parentSubOrchestratorId: string; depth?: number }): SubOrchestratorHandle;
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
  return {
    id: `sub-orch-${handle.id}`,
    parentSubOrchestratorId: parentId,
    depth,
  };
}

/**
 * Factory for SubOrchestratorHandle. Mirrors the runtime contract: a
 * sub-orchestrator handle records which orchestrator spawned it.
 */
export function createSubOrchestratorHandle(args: {
  id: string;
  parentSubOrchestratorId: string;
  depth: number;
}): SubOrchestratorHandle {
  return {
    id: args.id,
    parentSubOrchestratorId: args.parentSubOrchestratorId,
    depth: args.depth,
  };
}

/**
 * Class form of a sub-orchestrator handle. Mirrors the runtime contract:
 * new SubOrchestratorHandle({ id, parentSubOrchestratorId }) yields an
 * object whose parentSubOrchestratorId field is set, so the F4 test that
 * instantiates the symbol as a constructor works.
 *
 * The class declarations and the SubOrchestratorHandle interface above
 * merge at the type level; the interface describes the instance shape
 * (no modifiers), the class describes the constructor.
 */
export const SubOrchestratorHandle: SubOrchestratorHandleConstructor = class {
  id: string;
  parentSubOrchestratorId: string;
  depth: number;
  constructor(args: { id: string; parentSubOrchestratorId: string; depth?: number }) {
    if (typeof args.id !== "string" || args.id.length === 0) {
      throw new Error("SubOrchestratorHandle: id must be a non-empty string");
    }
    if (typeof args.parentSubOrchestratorId !== "string" || args.parentSubOrchestratorId.length === 0) {
      throw new Error("SubOrchestratorHandle: parentSubOrchestratorId must be a non-empty string");
    }
    this.id = args.id;
    this.parentSubOrchestratorId = args.parentSubOrchestratorId;
    this.depth = typeof args.depth === "number" ? args.depth : 1;
  }
} as unknown as SubOrchestratorHandleConstructor;
