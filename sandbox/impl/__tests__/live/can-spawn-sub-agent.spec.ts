/**
 * Unit-level tests for `canSpawnSubAgent` (the pure guard added in
 * Stage C of the spec-2 loop to address Challenge 8).
 *
 * This test is intentionally dependency-free — it does NOT spin up
 * a Docker container or a herdr daemon. It is a pure-function test
 * that pins the contract `multiplexing-session.ts:canSpawnSubAgent`
 * must honor.
 *
 * Spec-2 plan §2.2 + stage-B-challenges.md Challenge 8: the depth-4
 * nesting rule, the user-tab reservation, and the `tabPlacement`
 * discriminator are all enforced by this guard.
 */

import { describe, it, expect } from "vitest";
import { canSpawnSubAgent } from "../../orchestration/multiplexing-session.js";

describe("canSpawnSubAgent: pure guard (Challenge 8)", () => {
  it("accepts a sub-orchestrator request at the top level (depth=0, tabPlacement=tab)", () => {
    const result = canSpawnSubAgent(
      "tab-orch",
      { name: "sub-orch-scaffold_2", tabPlacement: "tab" },
      { parentDepth: 0, parentIsUserTab: false },
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a sub-orchestrator request inside a sub-orchestrator (depth=1, tabPlacement=tab) — depth-4 nesting", () => {
    const result = canSpawnSubAgent(
      "tab-sub-orch-1",
      { name: "sub-sub-orch", tabPlacement: "tab" },
      { parentDepth: 1, parentIsUserTab: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("depth-4");
    }
  });

  it("accepts a sub-agent (pane placement) inside a sub-orchestrator (depth=1)", () => {
    const result = canSpawnSubAgent(
      "tab-sub-orch-1",
      { name: "npm-installer-1", tabPlacement: "pane" },
      { parentDepth: 1, parentIsUserTab: false },
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects any spawn into the user tab (parentIsUserTab=true)", () => {
    const result = canSpawnSubAgent(
      "tab-user",
      { name: "anything", tabPlacement: "pane" },
      { parentDepth: 0, parentIsUserTab: true },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("user-tab-target");
    }
  });

  it("defaults tabPlacement to pane when omitted (existing behavior preserved)", () => {
    const result = canSpawnSubAgent(
      "tab-orch",
      { name: "leaf-worker" },
      { parentDepth: 0, parentIsUserTab: false },
    );
    expect(result).toEqual({ ok: true });
  });

  it("reason codes are stable: depth-4 | user-tab-target | tab-placement-mismatch", () => {
    // This test pins the machine-readable reason vocabulary so
    // orchestrator-side error handlers can branch on the string
    // without parsing English error messages. If a future change
    // adds a new reason, the test must be updated explicitly.
    const accepted = canSpawnSubAgent("tab-orch", { name: "x" }, {
      parentDepth: 0,
      parentIsUserTab: false,
    });
    expect(accepted).toEqual({ ok: true });

    const d4 = canSpawnSubAgent("tab-so", { name: "x", tabPlacement: "tab" }, {
      parentDepth: 1,
      parentIsUserTab: false,
    });
    expect(d4.ok).toBe(false);
    if (!d4.ok) {
      expect(d4.reason).toMatch(/^(depth-4|user-tab-target|tab-placement-mismatch)$/);
    }

    const u = canSpawnSubAgent("tab-user", { name: "x" }, {
      parentDepth: 0,
      parentIsUserTab: true,
    });
    expect(u.ok).toBe(false);
    if (!u.ok) {
      expect(u.reason).toMatch(/^(depth-4|user-tab-target|tab-placement-mismatch)$/);
    }
  });
});
