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
}

/**
 * In-memory adversarial child tracker. Production code may replace this with
 * a persistent map keyed by sub-orchestrator ID.
 */
class InMemoryAdversarialTracker implements AdversarialTracker {
  private adversarialChildren = new Set<string>();

  hasAdversarialChild(subOrchestratorId: string): boolean {
    return this.adversarialChildren.has(subOrchestratorId);
  }

  registerAdversarialChild(subOrchestratorId: string): void {
    this.adversarialChildren.add(subOrchestratorId);
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
