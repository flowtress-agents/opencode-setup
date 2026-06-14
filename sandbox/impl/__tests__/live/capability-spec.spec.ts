/**
 * RED test: capability-extended canSignal unit tests.
 *
 * Tests the extended canSignal() governance predicate that adds capability
 * checking to the flat governance model:
 *   - readwrite agents: all signals allowed (subject to flat governance)
 *   - read agents: only READ_ONLY_SIGNALS allowed
 *
 * These tests document the expected behavior. They will FAIL (RED) until
 * Phase 1 (capability types in governance.ts) is fully implemented.
 *
 * Gated: skipped unless process.env.RUN_LIVE_TESTS === '1'
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/capability-spec.spec.ts
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
// Test trees
// ---------------------------------------------------------------------------
//              orchestrator (root, readwrite)
//                    |
//          +---------+---------+
//          |                   |
//      child-read           child-rw
//          |
//    grandchild-read
// ---------------------------------------------------------------------------

const orchestratorRW = makeIdentity("orchestrator", null, "readwrite");
const childRead = makeIdentity("child-read", "orchestrator", "read");
const childRW = makeIdentity("child-rw", "orchestrator", "readwrite");
const grandchildRead = makeIdentity("grandchild-read", "child-read", "read");

// ---------------------------------------------------------------------------
// RED phase: capability-extended canSignal
// ---------------------------------------------------------------------------

describeOrSkip("capability-spec: capability-extended canSignal", () => {

  // -------------------------------------------------------------------------
  // readwrite agent: all flat-governance-allowed signals pass
  // -------------------------------------------------------------------------
  it("readwrite parent can signal child (spawn)", () => {
    const result = canSignal(orchestratorRW, childRW, "spawn");
    expect(result).toBe(true);
  });

  it("readwrite siblings can signal each other", () => {
    const result = canSignal(childRW, childRead, "share_state");
    expect(result).toBe(true);
  });

  // -------------------------------------------------------------------------
  // read agent: only READ_ONLY_SIGNALS pass
  // -------------------------------------------------------------------------
  it("read agent CAN signal sibling with spawn (in READ_ONLY_SIGNALS)", () => {
    const result = canSignal(childRead, grandchildRead, "spawn");
    expect(result).toBe(true);
  });

  it("read agent CAN signal sibling with share_state (in READ_ONLY_SIGNALS)", () => {
    const result = canSignal(childRead, grandchildRead, "share_state");
    expect(result).toBe(true);
  });

  it("read agent CAN signal sibling with challenge (in READ_ONLY_SIGNALS)", () => {
    const result = canSignal(childRead, grandchildRead, "challenge");
    expect(result).toBe(true);
  });

  it("read agent CAN signal sibling with ack (in READ_ONLY_SIGNALS)", () => {
    const result = canSignal(childRead, grandchildRead, "ack");
    expect(result).toBe(true);
  });

  it("read agent CANNOT signal sibling with git-commit (NOT in READ_ONLY_SIGNALS)", () => {
    // This is the key capability violation: a read-only agent attempting
    // a write signal should be rejected.
    const result = canSignal(childRead, grandchildRead, "git-commit");
    expect(result).toBe(false);
  });

  it("read agent CANNOT signal sibling with edit (NOT in READ_ONLY_SIGNALS)", () => {
    const result = canSignal(childRead, grandchildRead, "edit");
    expect(result).toBe(false);
  });

  it("read agent CANNOT signal sibling with npm-install (NOT in READ_ONLY_SIGNALS)", () => {
    const result = canSignal(childRead, grandchildRead, "npm-install");
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // read agent sibling-to-sibling signals
  // -------------------------------------------------------------------------
  it("read agent sibling CAN signal sibling with read (in READ_ONLY_SIGNALS)", () => {
    const result = canSignal(childRead, childRW, "read");
    expect(result).toBe(true);
  });

  it("read agent sibling CANNOT signal sibling with write (NOT in READ_ONLY_SIGNALS)", () => {
    const result = canSignal(childRead, childRW, "write");
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // cross-tree still denied even with readwrite
  // -------------------------------------------------------------------------
  it("readwrite cross-tree is denied", () => {
    const crossTreeChild = makeIdentity("cross-child", "other-orch", "readwrite");
    const result = canSignal(childRW, crossTreeChild, "spawn");
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // grandchild->grandparent still denied even with readwrite
  // -------------------------------------------------------------------------
  it("grandchild->grandparent is denied even with readwrite capability", () => {
    const result = canSignal(grandchildRead, orchestratorRW, "status-report");
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Sanity: READ_ONLY_SIGNALS set has expected members
  // -------------------------------------------------------------------------
  it("READ_ONLY_SIGNALS contains expected signals", () => {
    expect(READ_ONLY_SIGNALS.has("spawn")).toBe(true);
    expect(READ_ONLY_SIGNALS.has("share_state")).toBe(true);
    expect(READ_ONLY_SIGNALS.has("read")).toBe(true);
    expect(READ_ONLY_SIGNALS.has("search")).toBe(true);
    expect(READ_ONLY_SIGNALS.has("challenge")).toBe(true);
    expect(READ_ONLY_SIGNALS.has("verify")).toBe(true);
    expect(READ_ONLY_SIGNALS.has("ack")).toBe(true);
  });

  it("READ_ONLY_SIGNALS does NOT contain write signals", () => {
    expect(READ_ONLY_SIGNALS.has("git-commit")).toBe(false);
    expect(READ_ONLY_SIGNALS.has("edit")).toBe(false);
    expect(READ_ONLY_SIGNALS.has("npm-install")).toBe(false);
    expect(READ_ONLY_SIGNALS.has("write")).toBe(false);
  });
});
