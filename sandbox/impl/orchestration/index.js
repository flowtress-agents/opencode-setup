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

/**
 * Class form of a sub-orchestrator handle. The runtime uses this to
 * hand back identity objects to the orchestrator inside the container.
 * The class records the parent sub-orchestrator id (or the root
 * orchestrator's id when the parent is the top-level orchestrator) and
 * the depth in the spawn tree.
 */
export class SubOrchestratorHandle {
  constructor({ id, parentSubOrchestratorId, depth }) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("SubOrchestratorHandle: id must be a non-empty string");
    }
    if (typeof parentSubOrchestratorId !== "string" || parentSubOrchestratorId.length === 0) {
      throw new Error("SubOrchestratorHandle: parentSubOrchestratorId must be a non-empty string");
    }
    this.id = id;
    this.parentSubOrchestratorId = parentSubOrchestratorId;
    this.depth = typeof depth === "number" ? depth : 1;
  }
}

/**
 * Promote a promotable sub-agent to a sub-orchestrator.
 *
 * @param {object} handle - The sub-agent handle to promote. Must have
 *   `kind === "sub-agent"` and `spawnable === true`. Otherwise the
 *   agent is a leaf and cannot be promoted.
 * @returns {SubOrchestratorHandle | null} A handle if promotion is
 *   permitted; null for leaf agents (ADR 0005).
 */
export function promoteToSubOrchestrator(handle) {
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
  return new SubOrchestratorHandle({
    id: `sub-orch-${handle.id}`,
    parentSubOrchestratorId: parentId,
    depth,
  });
}
