/**
 * Runtime orchestration module — F4 contract.
 *
 * Mirrors `test/sandbox/fixtures/sandbox-spec/src/orchestration.ts`. The
 * runtime and the spec agree on these names; downstream code (the
 * orchestrator inside the container) imports the runtime copy, while
 * the test fixture imports the spec copy. The two implementations are
 * intentionally small and parallel; divergence is the yellow phase's
 * problem.
 */

export const SUB_ORCHESTRATOR_PROMOTION_REQUIRED = true;
export const SUB_ORCHESTRATOR_MAX_DEPTH = 3;

export interface PromotableSubAgentHandle {
  kind: "sub-agent";
  id: string;
  spawnable: boolean;
  parentSubOrchestratorId?: string;
  depth?: number;
}

// YELLOW[liberty-2]: TS2687 hardening — all fields are readonly.
export interface SubOrchestratorHandle {
  readonly id: string;
  readonly parentSubOrchestratorId: string;
  readonly depth: number;
}

export class SubOrchestratorHandle {
  constructor(
    public readonly id: string,
    public readonly parentSubOrchestratorId: string,
    public readonly depth: number,
  ) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("SubOrchestratorHandle: id must be a non-empty string");
    }
    if (typeof parentSubOrchestratorId !== "string" || parentSubOrchestratorId.length === 0) {
      throw new Error("SubOrchestratorHandle: parentSubOrchestratorId must be a non-empty string");
    }
  }
}

export function promoteToSubOrchestrator(handle: PromotableSubAgentHandle): SubOrchestratorHandle | null {
  if (!handle || handle.kind !== "sub-agent") {
    return null;
  }
  if (handle.spawnable !== true) {
    return null;
  }
  const parentId = handle.parentSubOrchestratorId ?? "orchestrator-root";
  const depth = (typeof handle.depth === "number" ? handle.depth : 1) + 1;
  if (depth > SUB_ORCHESTRATOR_MAX_DEPTH) {
    return null;
  }
  return new SubOrchestratorHandle(
    `sub-orch-${handle.id}`,
    parentId,
    depth,
  );
}
