/**
 * Adversarial verification protocol — challenge types and rules.
 *
 * ADR 0002 + ADR 0004 + ADR 0005: every sub-orchestrator must spawn exactly
 * one adversarial sub-agent that can only send `challenge` signals. The
 * orchestrator waits for challenge verdicts before reporting "done".
 *
 * Rules:
 *   1. Every sub-orchestrator spawns exactly one adversarial child with signalOnly=true
 *   2. Adversarial agents can only send `challenge` signals (READ_ONLY_SIGNALS includes "challenge")
 *   3. Orchestrator waits for challenge verdicts before reporting "done"
 *   4. A "block" severity challenge aborts the workstream and forces a new plan
 *   5. All challenges are logged to /tmp/adversarial.log inside the container
 *   6. User workspace tab is always allowed to inject challenges (human-in-the-loop)
 */

import { spawnSubAgent, type SubAgentConfig } from "../../fixtures/sandbox-spec/src/multiplexing.js";
import { canSignal as specCanSignal, type AgentIdentity } from "../../fixtures/sandbox-spec/src/governance.js";

/**
 * Kinds of challenges an adversarial agent can raise.
 */
export type ChallengeKind =
  | "missing_evidence"
  | "wrong_branch"
  | "untracked_file"
  | "unsafe_command"
  | "depth_violation"
  | "capability_violation";

/**
 * A challenge verdict produced by an adversarial agent.
 * The orchestrator must process every challenge received.
 */
export interface Challenge {
  /** Which challenge kind this represents */
  kind: ChallengeKind;
  /** The pane ID of the target being challenged */
  targetPaneId: string;
  /** Human-readable explanation of why this is a challenge */
  reason: string;
  /** Command output or other evidence that proves the claim */
  evidence: string;
  /** "block" aborts the workstream; "warn" logs but continues */
  severity: "block" | "warn";
}

/**
 * Build the SubAgentConfig for an adversarial sub-agent.
 * Adversarial agents are read-only, signalOnly=true, and named "adversarial".
 */
export function buildAdversarialAgentConfig(subOrchestratorId: string): SubAgentConfig {
  return {
    name: `adversarial-${subOrchestratorId}`,
    agent: "pi",
    capability: "read",
    signalOnly: true,
  };
}

/**
 * Check whether a sub-orchestrator handle has an adversarial child registered.
 * This is a simple presence check — the orchestrator runtime tracks adversarial
 * children per sub-orchestrator.
 */
export interface AdversarialTracker {
  hasAdversarialChild(subOrchestratorId: string): boolean;
  registerAdversarialChild(subOrchestratorId: string): void;
  /**
   * Count of adversarial children registered for the given sub-orchestrator.
   * ADR 0007: must be exactly 1 — 0 (missing) and 2+ (multiple) are both
   * protocol violations and cause assertAdversarialChild() to throw.
   */
  countAdversarialChildren(subOrchestratorId: string): number;
}

/**
 * In-memory adversarial child tracker. Production code may replace this with
 * a persistent map keyed by sub-orchestrator ID.
 */
class InMemoryAdversarialTracker implements AdversarialTracker {
  // subOrchestratorId -> count of adversarial children
  private adversarialChildren = new Map<string, number>();

  hasAdversarialChild(subOrchestratorId: string): boolean {
    return (this.adversarialChildren.get(subOrchestratorId) ?? 0) > 0;
  }

  registerAdversarialChild(subOrchestratorId: string): void {
    const current = this.adversarialChildren.get(subOrchestratorId) ?? 0;
    this.adversarialChildren.set(subOrchestratorId, current + 1);
  }

  countAdversarialChildren(subOrchestratorId: string): number {
    return this.adversarialChildren.get(subOrchestratorId) ?? 0;
  }
}

/**
 * Register an adversarial child for a sub-orchestrator. Thin wrapper around
 * the singleton tracker's registerAdversarialChild().
 */
export function registerAdversarialChild(subOrchestratorId: string): void {
  getAdversarialTracker().registerAdversarialChild(subOrchestratorId);
}

/**
 * Assert that a sub-orchestrator has exactly one adversarial child registered.
 * Throws on 0 (missing) or 2+ (multiple) — both are ADR 0007 violations.
 */
export function assertAdversarialChild(subOrchestratorId: string): void {
  const count = getAdversarialTracker().countAdversarialChildren(subOrchestratorId);
  if (count === 0) {
    throw new Error(
      `Adversarial child missing for sub-orchestrator "${subOrchestratorId}": ` +
      `expected exactly 1 adversarial child, got 0. ` +
      `Per ADR 0007, every sub-orchestrator must spawn exactly one adversarial agent.`,
    );
  }
  if (count > 1) {
    throw new Error(
      `Adversarial child count violation for sub-orchestrator "${subOrchestratorId}": ` +
      `expected exactly 1 adversarial child, got ${count}. ` +
      `Per ADR 0007, a sub-orchestrator must have exactly one adversarial child.`,
    );
  }
}

// Singleton tracker — one per orchestrator session
let _tracker: AdversarialTracker | null = null;

export function getAdversarialTracker(): AdversarialTracker {
  if (!_tracker) {
    _tracker = new InMemoryAdversarialTracker();
  }
  return _tracker;
}

export function resetAdversarialTracker(): void {
  _tracker = null;
}

/**
 * Log a challenge to /tmp/adversarial.log inside the container.
 * Best-effort — logging failure must not interrupt the orchestrator.
 */
export function logChallenge(
  containerId: string,
  challenge: Challenge,
  dockerBin = "docker",
): void {
  const entry = `[${new Date().toISOString()}] CHALLENGE kind=${challenge.kind} ` +
    `targetPaneId=${challenge.targetPaneId} severity=${challenge.severity} ` +
    `reason="${challenge.reason.replace(/"/g, '\\"')}" ` +
    `evidence="${challenge.evidence.replace(/"/g, '\\"')}"\n`;

  try {
    const { execSync } = require("node:child_process");
    execSync(
      `${dockerBin} exec ${containerId} sh -c 'mkdir -p /tmp && echo ${entry.replace(/'/g, "'\"'\"'")} >> /tmp/adversarial.log'`,
      { stdio: "ignore" },
    );
  } catch {
    // best-effort — challenge logging failure must not break the workstream
  }
}

/**
 * Determine whether a challenge severity requires aborting the workstream.
 * "block" severity always aborts; "warn" severity logs and continues.
 */
export function isBlockingChallenge(challenge: Challenge): boolean {
  return challenge.severity === "block";
}

/**
 * User workspace tab ID — always allowed to inject challenges.
 * This is the human-in-the-loop override path.
 */
export const USER_WORKSPACE_TAB_ID = "user-workspace";

/**
 * Identity of the user-workspace agent (the human-in-the-loop tab).
 * It has capability=readwrite so it can override any read-only constraint
 * in the user-workspace->target direction.
 */
export const USER_WORKSPACE_IDENTITY: AgentIdentity = {
  id: USER_WORKSPACE_TAB_ID,
  parentAgentId: "orchestrator",
  capability: "readwrite",
};

/**
 * Extended canSignal() with signalOnly enforcement.
 *
 * If `fromAgent` is flagged signalOnly=true (adversarial agent), only the
 * "challenge" signal is allowed. Any other signal is rejected, regardless
 * of whether the spec canSignal() would allow it.
 *
 * Non-signalOnly agents fall through to the spec canSignal() predicate.
 *
 * @returns { allowed, reason } — always returns an object (never a bare boolean)
 */
export function signalOnlyAdversarialCanSignal(
  fromAgent: AgentIdentity & { signalOnly?: boolean },
  toAgent: AgentIdentity,
  signal: string,
): { allowed: boolean; reason: string } {
  if (fromAgent.signalOnly === true) {
    if (signal === "challenge") {
      // The adversarial path for challenge still must satisfy the spec gate.
      const specAllowed = specCanSignal(fromAgent, toAgent, signal);
      return {
        allowed: specAllowed,
        reason: specAllowed
          ? "adversarial signalOnly: challenge signal allowed"
          : "adversarial signalOnly: challenge rejected by spec canSignal()",
      };
    }
    return {
      allowed: false,
      reason: `adversarial signalOnly: signal "${signal}" not allowed (only "challenge" permitted)`,
    };
  }
  // Non-signalOnly: defer to the spec canSignal() predicate.
  const allowed = specCanSignal(fromAgent, toAgent, signal);
  return {
    allowed,
    reason: allowed ? "spec canSignal() allowed" : "spec canSignal() denied",
  };
}

/**
 * Human-in-the-loop override: the user-workspace tab may always inject a
 * challenge at any sibling, even when the flat-governance rules would deny
 * it. This is the only exception to the cross-tree/grandchild denial rules.
 */
export function canUserWorkspaceChallenge(
  fromAgent: AgentIdentity,
  toAgent: AgentIdentity,
): boolean {
  return fromAgent.id === USER_WORKSPACE_TAB_ID;
}
