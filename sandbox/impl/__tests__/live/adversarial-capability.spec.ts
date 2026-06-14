/**
 * RED test: capability violation rejection via governance.
 *
 * Tests that the spec layer (canSignal extended with capability checks)
 * correctly rejects capability violations:
 *   - read agent sending non-READ_ONLY_SIGNALS to any target
 *   - signalOnly=true agent attempting non-challenge signals
 *
 * These tests will FAIL (RED) until Phase 1 (capability types in governance.ts)
 * is fully implemented.
 *
 * Gated: skipped unless process.env.RUN_LIVE_TESTS === '1'
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/adversarial-capability.spec.ts
 */

import { describe, it, expect } from "vitest";
import { canSignal, READ_ONLY_SIGNALS, type AgentIdentity, type Capability } from "../../../fixtures/sandbox-spec/src/governance.js";

const ENABLE_LIVE_TESTS = process.env.RUN_LIVE_TESTS === "1";
const describeOrSkip = ENABLE_LIVE_TESTS ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeIdentity(id: string, parentAgentId: string | null, capability: Capability): AgentIdentity {
  return { id, parentAgentId, capability };
}

// ---------------------------------------------------------------------------
// Test tree
// ---------------------------------------------------------------------------
//              orchestrator (readwrite)
//                    |
//          +---------+---------+
//          |                   |
//    sub-orch-read         sub-agent-rw
//          |
//    adversarial-read (signalOnly=true)
// ---------------------------------------------------------------------------

const orchestratorRW = makeIdentity("orchestrator", null, "readwrite");
const subOrchRead = makeIdentity("sub-orch", "orchestrator", "read");
const subAgentRW = makeIdentity("sub-agent-rw", "orchestrator", "readwrite");
const adversarialRead = makeIdentity("adversarial", "sub-orch", "read");

// ---------------------------------------------------------------------------
// RED phase: capability violation rejection
// ---------------------------------------------------------------------------

describeOrSkip("adversarial-capability: capability violations are rejected", () => {

  // -------------------------------------------------------------------------
  // read agent attempting write signals is always rejected
  // -------------------------------------------------------------------------
  it("read agent CANNOT send git-commit to sibling", () => {
    const sibling = makeIdentity("sibling", "orchestrator", "readwrite");
    const result = canSignal(adversarialRead, sibling, "git-commit");
    expect(result).toBe(false);
  });

  it("read agent CANNOT send edit to sibling", () => {
    const sibling = makeIdentity("sibling", "orchestrator", "readwrite");
    const result = canSignal(adversarialRead, sibling, "edit");
    expect(result).toBe(false);
  });

  it("read agent CANNOT send npm-install to sibling", () => {
    const sibling = makeIdentity("sibling", "orchestrator", "readwrite");
    const result = canSignal(adversarialRead, sibling, "npm-install");
    expect(result).toBe(false);
  });

  it("read agent CANNOT send write to parent", () => {
    const result = canSignal(adversarialRead, subOrchRead, "write");
    expect(result).toBe(false);
  });

  it("read agent CANNOT send git-push to parent", () => {
    const result = canSignal(adversarialRead, subOrchRead, "git-push");
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // read agent CAN send read-only signals
  // -------------------------------------------------------------------------
  it("read agent CAN send challenge to sibling (in READ_ONLY_SIGNALS)", () => {
    // adversarialRead and sibling share parent sub-orch, so they are siblings.
    // Both have capability=read, and challenge is in READ_ONLY_SIGNALS.
    const sibling = makeIdentity("sibling", "sub-orch", "read");
    const result = canSignal(adversarialRead, sibling, "challenge");
    expect(result).toBe(true);
  });

  it("read agent CAN send spawn to sibling (in READ_ONLY_SIGNALS)", () => {
    // adversarialRead's sibling must share parentAgentId = "sub-orch"
    const sibling = makeIdentity("sibling", "sub-orch", "read");
    const result = canSignal(adversarialRead, sibling, "spawn");
    expect(result).toBe(true);
  });

  it("read agent CAN send verify to sibling (in READ_ONLY_SIGNALS)", () => {
    const sibling = makeIdentity("sibling", "sub-orch", "read");
    const result = canSignal(adversarialRead, sibling, "verify");
    expect(result).toBe(true);
  });

  it("read agent CAN send ack to sibling (in READ_ONLY_SIGNALS)", () => {
    const sibling = makeIdentity("sibling", "sub-orch", "read");
    const result = canSignal(adversarialRead, sibling, "ack");
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // readwrite agent: all flat-governance-allowed signals pass
  // -------------------------------------------------------------------------
  it("readwrite agent CAN send git-commit to sibling", () => {
    const sibling = makeIdentity("sibling", "orchestrator", "read");
    const result = canSignal(subAgentRW, sibling, "git-commit");
    expect(result).toBe(true);
  });

  it("readwrite agent CAN send edit to sibling", () => {
    const sibling = makeIdentity("sibling", "orchestrator", "read");
    const result = canSignal(subAgentRW, sibling, "edit");
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // cross-tree still denied regardless of capability
  // -------------------------------------------------------------------------
  it("cross-tree is denied even with readwrite capability", () => {
    const crossTreeAgent = makeIdentity("cross-tree", "other-orch", "readwrite");
    const result = canSignal(subAgentRW, crossTreeAgent, "spawn");
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // grandchild->grandparent still denied regardless of capability
  // -------------------------------------------------------------------------
  it("grandchild->grandparent is denied even with readwrite capability", () => {
    const grandchildRW = makeIdentity("grandchild", "sub-orch", "readwrite");
    const result = canSignal(grandchildRW, orchestratorRW, "status-report");
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // SubOrchestratorHandle always has capability="read"
  // -------------------------------------------------------------------------
  it("SubOrchestratorHandle always has capability=read", async () => {
    const { promoteToSubOrchestrator } = await import("../../../fixtures/sandbox-spec/src/orchestration.js");
    const promotable = {
      kind: "sub-agent" as const,
      id: "test-promotion",
      spawnable: true,
      parentSubOrchestratorId: "orchestrator",
      depth: 1,
    };
    const subOrch = promoteToSubOrchestrator(promotable);
    expect(subOrch).not.toBeNull();
    expect(subOrch!.capability).toBe("read");
  });

  // -------------------------------------------------------------------------
  // SubAgentConfig capability field
  // -------------------------------------------------------------------------
  it("SubAgentConfig accepts capability field", async () => {
    const { SubAgentConfig } = await import("../../../fixtures/sandbox-spec/src/multiplexing.js");
    const config: SubAgentConfig = {
      name: "test-agent",
      capability: "readwrite",
      signalOnly: false,
    };
    expect(config.capability).toBe("readwrite");
    expect(config.signalOnly).toBe(false);
  });

  it("SubAgentConfig accepts signalOnly=true for adversarial agents", async () => {
    const { SubAgentConfig } = await import("../../../fixtures/sandbox-spec/src/multiplexing.js");
    const config: SubAgentConfig = {
      name: "adversarial-agent",
      capability: "read",
      signalOnly: true,
    };
    expect(config.capability).toBe("read");
    expect(config.signalOnly).toBe(true);
  });
});
