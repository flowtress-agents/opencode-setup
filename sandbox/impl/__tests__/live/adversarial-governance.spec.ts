/**
 * Adversarial governance boundary tests.
 *
 * Gated: skipped unless process.env.RUN_LIVE_TESTS === '1'
 *
 * These tests attempt to violate the flat governance rules defined in
 * governance.ts (ADR 0004 + ADR 0005):
 *   - parent -> child (spawn):         allowed
 *   - siblings (same parent):            allowed
 *   - cross-tree (different parents):  denied
 *   - grandchild -> grandparent:        denied
 *
 * If any attack SUCCEEDS (governance allows a signal it should deny),
 * that is a finding — the test will fail and document the breach.
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/adversarial-governance.spec.ts
 */

import { describe, it, expect } from "vitest";
import { governanceCanSignal } from "../../orchestration/governance-channel.js";
import type { AgentIdentity } from "../../../fixtures/sandbox-spec/src/governance.js";

const ENABLE_LIVE_TESTS = process.env.RUN_LIVE_TESTS === "1";

const describeOrSkip = ENABLE_LIVE_TESTS ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helper: build an AgentIdentity
// ---------------------------------------------------------------------------

function makeIdentity(id: string, parentAgentId: string | null): AgentIdentity {
  return { id, parentAgentId };
}

// ---------------------------------------------------------------------------
// Test tree A (orchestration tree 1)
// ---------------------------------------------------------------------------
//           orchestrator-A (root, no parent)
//                  |
//        +--------+--------+
//        |                 |
//    child-A1           child-A2
//        |
//    grandchild-A1
// ---------------------------------------------------------------------------

const orchestratorA = makeIdentity("orchestrator-A", null);
const childA1 = makeIdentity("child-A1", "orchestrator-A");
const childA2 = makeIdentity("child-A2", "orchestrator-A");
const grandchildA1 = makeIdentity("grandchild-A1", "child-A1");

// ---------------------------------------------------------------------------
// Test tree B (orchestration tree 2 — completely separate tree)
// ---------------------------------------------------------------------------
//           orchestrator-B (root, no parent)
//                  |
//        +---------+---------+
//        |                   |
//    child-B1             child-B2
// ---------------------------------------------------------------------------

const orchestratorB = makeIdentity("orchestrator-B", null);
const childB1 = makeIdentity("child-B1", "orchestrator-B");
const childB2 = makeIdentity("child-B2", "orchestrator-B");

// ---------------------------------------------------------------------------
// Adversarial tests
// ---------------------------------------------------------------------------

describeOrSkip("adversarial-governance: flat-chain boundary violations", () => {

  // -------------------------------------------------------------------------
  // Attack 1: Sub-agent signals parent without a spawn signal relationship
  // -------------------------------------------------------------------------
  it(
    "ATTACK 1: sub-agent signals parent orchestrator without a proper spawn signal " +
    "(should be BLOCKED — only child->parent via spawn is allowed, not arbitrary reverse)",
    () => {
      // child-A1 tries to signal its parent (orchestrator-A).
      // Under flat governance, a child cannot signal its parent unless that
      // signal IS the spawn signal.  Here the signal is NOT "spawn", so it
      // should be denied.
      const result = governanceCanSignal(childA1, orchestratorA, "status-report");
      expect(result.allowed).toBe(false);
    },
  );

  // -------------------------------------------------------------------------
  // Attack 2: Grandchild signals grandparent (depth 2)
  // -------------------------------------------------------------------------
  it(
    "ATTACK 2: grandchild (depth 2) signals grandparent orchestrator " +
    "(should be BLOCKED — no implicit authority per ADR 0005)",
    () => {
      // grandchild-A1 tries to signal orchestrator-A (its grandparent).
      // There is no direct spawn relationship here — only an indirect chain.
      // Flat governance denies this.
      const result = governanceCanSignal(grandchildA1, orchestratorA, "request-help");
      expect(result.allowed).toBe(false);
    },
  );

  // -------------------------------------------------------------------------
  // Attack 3: Cross-tree signal (agent in tree A signals agent in tree B)
  // -------------------------------------------------------------------------
  it(
    "ATTACK 3: agent in tree A signals agent in tree B " +
    "(should be BLOCKED — cross-tree signaling is denied)",
    () => {
      // child-A1 (tree A) tries to signal child-B1 (tree B).
      // These two agents share no parent and belong to different trees.
      const result = governanceCanSignal(childA1, childB1, "collaborate");
      expect(result.allowed).toBe(false);
    },
  );

  it(
    "ATTACK 3b: root agent in tree A signals agent in tree B " +
    "(should be BLOCKED — cross-tree root-to-child is also denied)",
    () => {
      // orchestrator-A (tree A root) tries to signal child-B1 (tree B).
      // Cross-tree root-to-child is not a parent->child relationship.
      const result = governanceCanSignal(orchestratorA, childB1, "supervise");
      expect(result.allowed).toBe(false);
    },
  );

  it(
    "ATTACK 3c: child in tree B signals root agent in tree A " +
    "(should be BLOCKED — cross-tree child-to-root is also denied)",
    () => {
      // child-B1 (tree B) tries to signal orchestrator-A (tree A root).
      const result = governanceCanSignal(childB1, orchestratorA, "status-report");
      expect(result.allowed).toBe(false);
    },
  );

  // -------------------------------------------------------------------------
  // Attack 4: Self-signal (agent tries to signal itself)
  // -------------------------------------------------------------------------
  it(
    "ATTACK 4: agent signals itself " +
    "(should be BLOCKED — self-signaling is not a valid signal relationship)",
    () => {
      // An agent attempting to signal its own ID.
      const result = governanceCanSignal(childA1, childA1, "self-ping");
      expect(result.allowed).toBe(false);
    },
  );

  it(
    "ATTACK 4b: root agent signals itself " +
    "(should be BLOCKED — orchestrator signaling itself is also denied)",
    () => {
      const result = governanceCanSignal(orchestratorA, orchestratorA, "self-check");
      expect(result.allowed).toBe(false);
    },
  );

  // -------------------------------------------------------------------------
  // Sanity: allowed relationships should still be allowed
  // -------------------------------------------------------------------------

  it("SANITY: parent (orchestrator) can signal direct child (spawn signal)", () => {
    const result = governanceCanSignal(orchestratorA, childA1, "spawn");
    expect(result.allowed).toBe(true);
  });

  it("SANITY: siblings with the same parent can signal each other", () => {
    // child-A1 signals child-A2 — both have orchestrator-A as parent.
    const result = governanceCanSignal(childA1, childA2, "share-state");
    expect(result.allowed).toBe(true);
  });

  it("SANITY: cross-tree is denied (verify the test itself is not broken)", () => {
    // This is the inverse of attack 3 — ensure the governance actually
    // distinguishes tree membership.
    const result = governanceCanSignal(childA1, childB1, "anything");
    expect(result.allowed).toBe(false);
  });
});
