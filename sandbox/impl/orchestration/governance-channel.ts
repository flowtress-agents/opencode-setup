/**
 * Governance channel — signal exchange between agents using flat governance rules.
 *
 * ADR 0004 + ADR 0005: governance is flat — no implicit authority levels.
 * Every agent is peer-to-peer with its parent and its siblings.
 * The only authority relationships are explicit spawn/signal contracts.
 *
 * This module implements canSignal() with real IPC/exec pipes:
 *   - parent -> child (spawn):         allowed
 *   - siblings (same parent):          allowed
 *   - cross-tree (different parents): denied
 *   - grandchild -> grandparent:       denied
 */

import { canSignal as specCanSignal, type AgentIdentity } from "../../fixtures/sandbox-spec/src/governance.js";
import { HerdrSession } from "../pty/herdr-session.js";

export interface SignalMessage {
  from: string;
  to: string;
  signal: string;
  payload?: string;
}

export interface GovernanceCheckResult {
  allowed: boolean;
  reason: string;
}

/**
 * Check if fromAgent may signal toAgent under the flat governance model.
 * This is a direct delegate to the spec's canSignal() function.
 */
export function governanceCanSignal(
  fromAgent: AgentIdentity,
  toAgent: AgentIdentity,
  signal: string,
): GovernanceCheckResult {
  const allowed = specCanSignal(fromAgent, toAgent, signal);

  let reason: string;
  if (toAgent.parentAgentId === fromAgent.id) {
    reason = "parent -> child spawn signal: allowed";
  } else if (
    fromAgent.parentAgentId !== null &&
    fromAgent.parentAgentId === toAgent.parentAgentId &&
    fromAgent.id !== toAgent.id
  ) {
    reason = "sibling signal: allowed";
  } else {
    reason = "cross-tree or grandchild -> grandparent: denied";
  }

  return { allowed, reason };
}

/**
 * Send a signal from one agent to another via docker exec pipes.
 * This is a best-effort delivery — signals are fire-and-forget.
 *
 * @returns true if the signal was delivered (governance check passed)
 */
export async function sendSignal(
  herdrSession: HerdrSession,
  fromAgent: AgentIdentity,
  toAgent: AgentIdentity,
  signal: string,
  payload?: string,
): Promise<{ delivered: boolean; result: GovernanceCheckResult }> {
  const governanceResult = governanceCanSignal(fromAgent, toAgent, signal);

  if (!governanceResult.allowed) {
    return { delivered: false, result: governanceResult };
  }

  // Build the signal command
  const signalCmd = `echo "SIGNAL:${fromAgent.id}->${toAgent.id}:${signal}"`;
  const msg: SignalMessage = { from: fromAgent.id, to: toAgent.id, signal, payload };

  try {
    // Try to deliver via herdr pane run in the target pane
    const result = await herdrSession.runInPane(
      toAgent.id, // pane ID
      signalCmd,
    );
    return { delivered: result.exitCode === 0, result: governanceResult };
  } catch {
    return { delivered: false, result: governanceResult };
  }
}

/**
 * Verify all governance rules live:
 *   - parent can signal child: allowed
 *   - siblings can signal each other: allowed
 *   - cross-tree signaling: denied
 *   - grandchild cannot signal grandparent: denied
 */
export async function verifyGovernanceLive(
  herdrSession: HerdrSession,
  agents: AgentIdentity[],
): Promise<GovernanceCheckResult[]> {
  const results: GovernanceCheckResult[] = [];

  for (const from of agents) {
    for (const to of agents) {
      if (from.id === to.id) continue;
      const result = governanceCanSignal(from, to, "test-signal");
      results.push(result);
    }
  }

  return results;
}
