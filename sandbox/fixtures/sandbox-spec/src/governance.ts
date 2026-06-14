/**
 * Flat chain of governance (F5).
 *
 * ADR 0004 + ADR 0005: governance is flat — no implicit authority levels.
 * Every agent is peer-to-peer with its parent and its siblings. The only
 * authority relationships are explicit spawn/signal contracts.
 *
 * canSignal() captures the flat rule in a single predicate:
 *   - parent -> child (spawn):           true
 *   - siblings (same parent):            true
 *   - cross-tree (different parents):    false
 *   - grandchild -> grandparent:         false (no implicit authority)
 *
 * The model name and protocol name are exported for the runtime and
 * spec to agree on; only "flat" / "explicit_spawn_signal" are valid.
 */

export const FLAT_GOVERNANCE_MODEL = "flat" as const;

export const PEER_PROTOCOL = "explicit_spawn_signal" as const;

/**
 * Agent capability tier.
 * - "read": only query/observation signals allowed (see READ_ONLY_SIGNALS).
 * - "readwrite": all signals allowed.
 */
export type Capability = "read" | "readwrite";

/**
 * Signals that a "read"-capability agent may send.
 * These are observation/query signals that do not mutate the repo.
 */
export const READ_ONLY_SIGNALS = new Set([
  "spawn",
  "share_state",
  "read",
  "search",
  "challenge",
  "verify",
  "ack",
]);

export interface AgentIdentity {
  id: string;
  parentAgentId: string | null;
  capability: Capability;
}

/**
 * Decide whether `fromAgent` may signal `toAgent` under the flat governance
 * model. The signal name is accepted for future protocol routing but is
 * not interpreted by this predicate.
 *
 * @param fromAgent - The signaling agent
 * @param toAgent   - The signal target
 * @param signal    - Signal name (e.g. "spawn", "share_state")
 * @returns true if the signal is allowed under the flat chain
 */
export function canSignal(
  fromAgent: AgentIdentity,
  toAgent: AgentIdentity,
  signal: string,
): boolean {
  if (!fromAgent || !toAgent) return false;
  if (typeof signal !== "string") return false;

  // Capability check: read-only agents may only send read-only signals.
  if (fromAgent.capability === "read" && !READ_ONLY_SIGNALS.has(signal)) {
    return false;
  }

  // 1. Parent -> child (direct spawn relationship).
  if (toAgent.parentAgentId === fromAgent.id) {
    return true;
  }

  // 2. Siblings: same parent, neither is the parent of the other.
  const sameParent =
    fromAgent.parentAgentId !== null &&
    fromAgent.parentAgentId === toAgent.parentAgentId &&
    fromAgent.id !== toAgent.id;
  if (sameParent) {
    return true;
  }

  // 3. Cross-tree (different parents, not in a parent/child line) and
  //    grandchild -> grandparent are both denied.
  return false;
}
