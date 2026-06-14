/**
 * Adversarial herdr pane isolation and pane limit enforcement tests.
 *
 * FINDINGS SUMMARY
 * =================
 * These tests attempt to break the isolation and limit enforcement in the live
 * orchestration implementation. Each test represents an adversarial attack vector.
 * All attacks are EXPECTED TO BE BLOCKED by the implementation.
 *
 * Attack Vectors Tested:
 * ──────────────────────
 * 1. Pane 0 Immutability Attack (ADR 0004)
 *    - Attempt: Spawn a pane with ID "pane-0" directly via CLI
 *    - Expected: Should be REJECTED — pane 0 is the immutable orchestrator pane
 *    - CLI command: herdr agent start pane-0 ...
 *
 * 2. MAX_PANE_DEPTH Attack (ADR 0004/0005)
 *    - Attempt: Spawn panes beyond MAX_PANE_DEPTH=3
 *    - Expected: Should be REJECTED at depth 4
 *    - CLI command: herdr pane split <pane_id> --direction right|down (repeated)
 *
 * 3. MAX_SUB_AGENTS_PER_ORCHESTRATOR Attack (ADR 0005)
 *    - Attempt: Spawn more than 8 sub-agents via the CLI
 *    - Expected: Should be REJECTED after 8 agents
 *    - CLI command: herdr agent start <name> -- <cmd> (repeated 9+ times)
 *
 * 4. Cross-Pane Exec Attack (Isolation Breach)
 *    - Attempt: Use herdr pane run to exec commands in another pane's context
 *    - Expected: Should be BLOCKED — panes are isolated per ADR 0004
 *    - CLI command: herdr pane run <target_pane_id> <command>
 *
 * If ANY attack succeeds (constraint NOT enforced), it is documented as a FINDING.
 *
 * Gated: skipped unless BOTH:
 *   1. process.env.RUN_LIVE_TESTS === '1'
 *   2. `docker info` exits 0 (Docker daemon is running)
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/adversarial-herdr.spec.ts
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import {
  launchFromSpec,
  cleanupContainer,
  verifyContainer,
} from "../../docker/container-launcher.js";
import { HerdrSession, herdrAvailableInContainer, piAvailableInContainer } from "../../pty/herdr-session.js";
import { openOrchestratorSession, waitForPiReady, closeOrchestratorSession } from "../../orchestration/orchestrator-session.js";
import { spawnSubAgentViaHerdr, spawnMultipleSubAgents, assertUniquePaneIds } from "../../orchestration/multiplexing-session.js";
import {
  MAX_SUB_AGENTS_PER_ORCHESTRATOR,
  MAX_PANE_DEPTH,
} from "../../../fixtures/sandbox-spec/src/multiplexing.js";
import {
  canSignal,
  READ_ONLY_SIGNALS,
  type AgentIdentity,
  type Capability,
} from "../../../fixtures/sandbox-spec/src/governance.js";
import {
  getAdversarialTracker,
  resetAdversarialTracker,
  registerAdversarialChild,
  assertAdversarialChild,
  signalOnlyAdversarialCanSignal,
  canUserWorkspaceChallenge,
} from "../../orchestration/adversarial-protocol.js";

const ENABLE_LIVE_TESTS = process.env.RUN_LIVE_TESTS === "1";

async function dockerAvailable(): Promise<boolean> {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = ENABLE_LIVE_TESTS ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Constants from spec
// ---------------------------------------------------------------------------

const EXPECTED_MAX_SUB_AGENTS = MAX_SUB_AGENTS_PER_ORCHESTRATOR; // 8
const EXPECTED_MAX_PANE_DEPTH = MAX_PANE_DEPTH; // 3

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

interface AdversarialTestContext {
  containerId: string;
  herdrSession: HerdrSession | null;
  orchestratorPane0: string;
}

const ctx: AdversarialTestContext = {
  containerId: "",
  herdrSession: null,
  orchestratorPane0: "pane-0",
};

// ---------------------------------------------------------------------------
// ATK-1: Pane 0 Immutability Attack
// ---------------------------------------------------------------------------
// Attempt to spawn a pane with the reserved ID "pane-0". Per ADR 0004, pane 0
// is the immutable orchestrator pane and cannot be claimed by any other agent.
// CLI commands used:
//   herdr agent start pane-0 -- bash
//   herdr pane list
//   herdr pane get pane-0
// ---------------------------------------------------------------------------

describeOrSkip("ATK-1: Pane 0 Immutability Attack", () => {
  afterAll(async () => {
    if (ctx.herdrSession) {
      await ctx.herdrSession.close();
      ctx.herdrSession = null;
    }
    if (ctx.containerId) {
      await cleanupContainer(ctx.containerId);
      ctx.containerId = "";
    }
  });

  it("cannot spawn a new pane with the reserved ID 'pane-0'", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    const isRunning = await verifyContainer(ctx.containerId);
    if (!isRunning) return;

    // ADVESTRIAL ATTACK: Try to spawn an agent named "pane-0"
    // This attempts to claim the reserved pane-0 ID
    const attackCmd = `docker exec ${ctx.containerId} herdr agent start pane-0 -- bash --version`;
    let attackSucceeded = false;
    let attackOutput = "";

    try {
      attackOutput = execSync(attackCmd, { encoding: "utf-8" });
      // If the command succeeds without error, the attack may have succeeded
      attackSucceeded = attackOutput.length > 0;
    } catch (err: any) {
      // Non-zero exit means the attack was blocked — this is expected
      attackOutput = err.stdout ?? "";
    }

    // Now verify that pane-0 is still the orchestrator pane and NOT the
    // newly-attacked pane
    const listCmd = `docker exec ${ctx.containerId} herdr pane list`;
    const listOutput = execSync(listCmd, { encoding: "utf-8" });

    // Count how many panes have ID "pane-0" — should be exactly 1 (the original)
    const pane0Count = (listOutput.match(/pane-0/g) ?? []).length;

    // ATTACK IS BLOCKED if:
    //   1. herdr agent start pane-0 exited with non-zero, OR
    //   2. pane-0 count is still exactly 1
    // ATTACK SUCCEEDS if pane-0 count > 1 (pane-0 was duplicated/cloned)
    expect(pane0Count).toBe(1);

    if (attackSucceeded && pane0Count > 1) {
      throw new Error(
        `FINDING: Pane 0 immutability BREACHED — pane-0 was duplicated. ` +
        `Pane-0 count: ${pane0Count}`,
      );
    }
  });

  it("cannot rename pane-0 to something else", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    if (!ctx.herdrSession) {
      ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
      ctx.orchestratorPane0 = await ctx.herdrSession.getPane0Id();
    }

    // ADVVERSIAL ATTACK: Try to rename pane-0
    const renameCmd = `docker exec ${ctx.containerId} herdr pane rename pane-0 attacker-controlled-label`;
    let renameSucceeded = false;

    try {
      execSync(renameCmd, { encoding: "utf-8" });
      renameSucceeded = true;
    } catch {
      // Non-zero exit — attack blocked
    }

    // Verify pane-0 still exists and is accessible
    const listResult = await ctx.herdrSession!.runInPane(ctx.orchestratorPane0, "echo pane-0-still-here");
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toContain("pane-0-still-here");

    if (renameSucceeded) {
      // If rename appeared to succeed, check pane-0 was not actually renamed
      const paneGetCmd = `docker exec ${ctx.containerId} herdr pane get pane-0`;
      let pane0StillValid = false;
      try {
        const getOutput = execSync(paneGetCmd, { encoding: "utf-8" });
        pane0StillValid = getOutput.includes("pane-0") || getOutput.includes("state");
      } catch {
        pane0StillValid = false;
      }
      expect(pane0StillValid).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ATK-2: MAX_PANE_DEPTH Attack
// ---------------------------------------------------------------------------
// Attempt to spawn panes beyond MAX_PANE_DEPTH=3. Per ADR 0004/0005, pane
// depth is capped at 3 levels. At depth 4, the split should be rejected.
// CLI commands used:
//   herdr pane split <pane_id> --direction right
//   herdr pane split <pane_id> --direction down
//   herdr pane list
// ---------------------------------------------------------------------------

describeOrSkip("ATK-2: MAX_PANE_DEPTH Attack", () => {
  beforeAll(async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    if (!ctx.herdrSession) {
      ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
      ctx.orchestratorPane0 = await ctx.herdrSession.getPane0Id();
    }
  });

  afterAll(async () => {
    if (ctx.herdrSession) {
      await ctx.herdrSession.close();
      ctx.herdrSession = null;
    }
    if (ctx.containerId) {
      await cleanupContainer(ctx.containerId);
      ctx.containerId = "";
    }
  });

  it("rejects pane splits beyond MAX_PANE_DEPTH=3", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    const depth = EXPECTED_MAX_PANE_DEPTH; // 3

    // Build a chain of panes: pane-0 -> split -> pane-1 -> split -> pane-2 -> split -> pane-3
    // At pane-3 (depth 4), the next split MUST be rejected
    let currentPane = ctx.orchestratorPane0!;
    const paneChain: string[] = [currentPane];

    // Splits up to MAX_PANE_DEPTH (3) should succeed
    for (let d = 1; d <= depth; d++) {
      const splitDir = d % 2 === 0 ? "right" : "down";
      const splitCmd = [
        "docker", "exec", ctx.containerId!,
        "herdr", "pane", "split", currentPane,
        "--direction", splitDir,
      ];

      let splitSucceeded = false;
      let splitOutput = "";
      try {
        splitOutput = execSync(splitCmd.join(" "), { encoding: "utf-8" });
        splitSucceeded = true;
      } catch (err: any) {
        splitOutput = err.stdout ?? err.stderr ?? "";
      }

      // Each split at depth 1-3 should succeed (orchestrator -> sub-agents -> sub-sub-agents)
      // but we track for diagnostics
      if (!splitSucceeded) {
        throw new Error(
          `FINDING: Split at depth ${d} unexpectedly failed. ` +
          `This may indicate MAX_PANE_DEPTH is enforced too strictly. ` +
          `Output: ${splitOutput}`,
        );
      }

      // Parse the new pane ID from pane list
      const listOutput = execSync(
        `docker exec ${ctx.containerId!} herdr pane list`,
        { encoding: "utf-8" },
      );
      const lines = listOutput.split("\n");
      const paneLines = lines.filter((l) => l.trim().length > 0);
      const lastPaneLine = paneLines[paneLines.length - 1];
      const idMatch = lastPaneLine.match(/pane-\d+/);
      currentPane = idMatch ? idMatch[0] : `pane-unknown-${d}`;
      paneChain.push(currentPane);
    }

    // Now at depth 3 (paneChain.length === 4), attempt depth 4 — THIS MUST BE REJECTED
    const overflowPane = paneChain[paneChain.length - 1]; // pane at depth 3
    const overflowCmd = [
      "docker", "exec", ctx.containerId!,
      "herdr", "pane", "split", overflowPane,
      "--direction", "right",
    ];

    let overflowSucceeded = false;
    let overflowOutput = "";
    try {
      overflowOutput = execSync(overflowCmd.join(" "), { encoding: "utf-8" });
      overflowSucceeded = true;
    } catch (err: any) {
      overflowOutput = err.stderr ?? "";
      // Non-zero exit — attack blocked (expected)
    }

    // Count total panes after overflow attempt
    const finalListOutput = execSync(
      `docker exec ${ctx.containerId!} herdr pane list`,
      { encoding: "utf-8" },
    );
    const finalPaneCount = (finalListOutput.match(/pane-\d+/g) ?? []).length;

    // ATTACK IS BLOCKED if overflow was rejected (non-zero exit) OR pane count
    // did not increase beyond what depth 3 allows
    // ATTACK SUCCEEDS if overflow split succeeded AND pane count increased
    if (overflowSucceeded) {
      // Attacker's pane was created — check if depth constraint was bypassed
      // Max panes at depth 3: pane-0 + 3 splits = 4 panes
      // If we have > 4 panes, the depth limit was bypassed
      expect(finalPaneCount).toBeLessThanOrEqual(4);

      if (finalPaneCount > 4) {
        throw new Error(
          `FINDING: MAX_PANE_DEPTH=3 BREACHED — created ${finalPaneCount} panes ` +
          `when max should be 4 (pane-0 + 3 splits). ` +
          `Overflow pane ID: ${overflowPane}`,
        );
      }
    }

    // The overflow split MUST have been rejected
    expect(overflowSucceeded).toBe(false);
  });

  it("sub-agent spawn count is capped at MAX_SUB_AGENTS_PER_ORCHESTRATOR=8", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // Spawn exactly MAX_SUB_AGENTS (8) — should succeed
    const handles8 = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 8);
    expect(handles8).toHaveLength(8);
    assertUniquePaneIds(handles8);

    // ATTACK: Try to spawn a 9th sub-agent — MUST be rejected
    let attackSucceeded = false;
    try {
      await spawnSubAgentViaHerdr(ctx.herdrSession!, ctx.orchestratorPane0, {
        name: "overflow-agent-9",
      });
      attackSucceeded = true;
    } catch {
      // Attack blocked — this is expected
    }

    if (attackSucceeded) {
      throw new Error(
        `FINDING: MAX_SUB_AGENTS_PER_ORCHESTRATOR=${EXPECTED_MAX_SUB_AGENTS} BREACHED — ` +
        `9th sub-agent was spawned successfully.`,
      );
    }

    expect(attackSucceeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ATK-3: MAX_SUB_AGENTS_PER_ORCHESTRATOR Attack via direct CLI
// ---------------------------------------------------------------------------
// Attempt to spawn more than 8 sub-agents by calling herdr agent start directly.
// CLI command: herdr agent start <name> -- <cmd> (repeated 9+ times)
// ---------------------------------------------------------------------------

describeOrSkip("ATK-3: MAX_SUB_AGENTS_PER_ORCHESTRATOR CLI Attack", () => {
  beforeAll(async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    if (!ctx.herdrSession) {
      ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
      ctx.orchestratorPane0 = await ctx.herdrSession.getPane0Id();
    }
  });

  afterAll(async () => {
    if (ctx.herdrSession) {
      await ctx.herdrSession.close();
      ctx.herdrSession = null;
    }
    if (ctx.containerId) {
      await cleanupContainer(ctx.containerId);
      ctx.containerId = "";
    }
  });

  it("rejects 9th sub-agent spawn via direct herdr CLI", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // Spawn 8 sub-agents via the API
    const handles8 = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 8);
    expect(handles8).toHaveLength(EXPECTED_MAX_SUB_AGENTS);

    // Get current agent count
    const listBeforeCmd = `docker exec ${ctx.containerId!} herdr agent list`;
    const listBefore = execSync(listBeforeCmd, { encoding: "utf-8" });

    // ATTACK: Try to spawn a 9th agent via direct CLI
    const attackCmd = [
      "docker", "exec", ctx.containerId!,
      "herdr", "agent", "start", "overflow-agent-cli-9",
      "--", "bash", "--version",
    ];

    let attackSucceeded = false;
    let attackExitCode = -1;
    try {
      const output = execSync(attackCmd.join(" "), { encoding: "utf-8" });
      attackExitCode = 0;
      attackSucceeded = output.length > 0;
    } catch (err: any) {
      attackExitCode = err.status ?? 1;
      // Non-zero exit — attack blocked (expected)
    }

    // Verify agent count did not increase beyond 8
    const listAfterCmd = `docker exec ${ctx.containerId!} herdr agent list`;
    const listAfter = execSync(listAfterCmd, { encoding: "utf-8" });

    const agentCountAfter = (listAfter.match(/overflow-agent-cli-9/g) ?? []).length +
      (listAfter.match(/sub-agent-\d+/g) ?? []).length;

    if (attackSucceeded && agentCountAfter > EXPECTED_MAX_SUB_AGENTS) {
      throw new Error(
        `FINDING: MAX_SUB_AGENTS_PER_ORCHESTRATOR=${EXPECTED_MAX_SUB_AGENTS} BREACHED via direct CLI — ` +
        `9th agent 'overflow-agent-cli-9' was spawned. Exit code: ${attackExitCode}`,
      );
    }

    // The 9th spawn MUST have been rejected
    expect(attackSucceeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ATK-4: Cross-Pane Exec Attack (Isolation Breach)
// ---------------------------------------------------------------------------
// Attempt to exec a command in another pane's context. Per ADR 0004, panes are
// isolated — an agent in pane N cannot exec into pane M's context.
// CLI command: herdr pane run <target_pane_id> <command>
// ---------------------------------------------------------------------------

describeOrSkip("ATK-4: Cross-Pane Exec Attack (Isolation Breach)", () => {
  beforeAll(async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    if (!ctx.herdrSession) {
      ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
      ctx.orchestratorPane0 = await ctx.herdrSession.getPane0Id();
    }
  });

  afterAll(async () => {
    if (ctx.herdrSession) {
      await ctx.herdrSession.close();
      ctx.herdrSession = null;
    }
    if (ctx.containerId) {
      await cleanupContainer(ctx.containerId);
      ctx.containerId = "";
    }
  });

  it("cannot exec into another pane's context via 'herdr pane run'", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // Spawn a sub-agent (this creates a new pane separate from pane-0)
    const subAgentHandles = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 1);
    expect(subAgentHandles).toHaveLength(1);

    const targetPane = subAgentHandles[0].paneId;
    const attackerPane = ctx.orchestratorPane0;

    // ATTACK: Try to exec a command in the target pane from the attacker pane's context
    // Note: herdr pane run takes a pane ID as the first argument, so this tests
    // whether ANY pane can be targeted, not just one's own
    const attackCmd = [
      "docker", "exec", ctx.containerId!,
      "herdr", "pane", "run", targetPane,
      "echo CROSS_PANE_EXEC_ATTEMPTED",
    ];

    let crossExecSucceeded = false;
    let crossExecOutput = "";
    let crossExecExitCode = -1;

    try {
      crossExecOutput = execSync(attackCmd.join(" "), { encoding: "utf-8" });
      crossExecExitCode = 0;
      crossExecSucceeded = crossExecOutput.includes("CROSS_PANE_EXEC_ATTEMPTED");
    } catch (err: any) {
      crossExecExitCode = err.status ?? 1;
      crossExecOutput = err.stdout ?? "";
    }

    // ATTACK IS BLOCKED if crossExecSucceeded is false OR exit code is non-zero
    // ATTACK SUCCEEDS if we can exec into targetPane and read its output
    if (crossExecSucceeded) {
      // Verify that the output actually came from targetPane and not just stdout
      // If pane isolation is broken, the attacker could read targetPane's environment
      const verifyCmd = [
        "docker", "exec", ctx.containerId!,
        "herdr", "pane", "run", targetPane,
        "env | grep -E '^(PANE_ID|HERDR|TAB_ID)=' || echo ISOLATION_INTACT",
      ];

      let verifyOutput = "";
      try {
        verifyOutput = execSync(verifyCmd.join(" "), { encoding: "utf-8" });
      } catch {
        // Non-zero exit on verification — attack may still have partially succeeded
      }

      throw new Error(
        `FINDING: Cross-pane exec isolation BREACHED — ` +
        `attacker pane (${attackerPane}) successfully exec'd in target pane (${targetPane}). ` +
        `Output: ${crossExecOutput}. Verify: ${verifyOutput}`,
      );
    }

    // The cross-pane exec MUST have been blocked
    expect(crossExecSucceeded).toBe(false);
  });

  it("orchestrator pane-0 cannot be targeted by cross-pane exec", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // ATTACK: Try to exec into pane-0 (the orchestrator) from a non-orchestrator context
    // First spawn a sub-agent that will attempt the attack
    const subAgentHandles = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 1);
    const attackerPane = subAgentHandles[0].paneId;

    // ATTACK: Try to run a command in pane-0 from the context of the sub-agent
    // Note: herdr pane run allows specifying any pane ID
    const attackCmd = [
      "docker", "exec", ctx.containerId!,
      "herdr", "pane", "run", ctx.orchestratorPane0!,
      "echo ORCHESTRATOR_PANE_TARGETED",
    ];

    let attackSucceeded = false;
    let attackOutput = "";

    try {
      attackOutput = execSync(attackCmd.join(" "), { encoding: "utf-8" });
      attackSucceeded = attackOutput.includes("ORCHESTRATOR_PANE_TARGETED");
    } catch {
      // Non-zero exit — attack blocked (expected)
    }

    // Verify pane-0 still runs the orchestrator (pi) and wasn't replaced
    const pane0Health = await ctx.herdrSession!.runInPane(
      ctx.orchestratorPane0!,
      "pi --version 2>/dev/null || echo PI_STILL_RUNNING",
    );

    if (attackSucceeded) {
      throw new Error(
        `FINDING: Orchestrator pane-0 isolation BREACHED — ` +
        `attacker pane ${attackerPane} exec'd into orchestrator pane-0. ` +
        `Pane-0 pi --version result: ${pane0Health.stdout}`,
      );
    }

    // Verify pi is still running in pane-0
    expect(pane0Health.exitCode).toBe(0);
    expect(attackSucceeded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ATK-5: Pane ID Collision Attack
// ---------------------------------------------------------------------------
// Attempt to create panes with duplicate IDs by racing pane creation.
// ---------------------------------------------------------------------------

describeOrSkip("ATK-5: Pane ID Collision Attack", () => {
  beforeAll(async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    if (!ctx.herdrSession) {
      ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
      ctx.orchestratorPane0 = await ctx.herdrSession.getPane0Id();
    }
  });

  afterAll(async () => {
    if (ctx.herdrSession) {
      await ctx.herdrSession.close();
      ctx.herdrSession = null;
    }
    if (ctx.containerId) {
      await cleanupContainer(ctx.containerId);
      ctx.containerId = "";
    }
  });

  it("all pane IDs remain unique under rapid parallel spawn", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // Spawn 8 sub-agents in parallel (max allowed)
    const handles = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 8);

    // Verify no pane ID collisions
    const paneIds = handles.map((h) => h.paneId);
    const uniquePaneIds = new Set(paneIds);

    if (uniquePaneIds.size !== paneIds.length) {
      throw new Error(
        `FINDING: Pane ID collision detected under parallel spawn — ` +
        `${paneIds.length} panes created but only ${uniquePaneIds.size} unique IDs. ` +
        `Duplicate IDs: ${paneIds.filter((id) => paneIds.indexOf(id) !== paneIds.lastIndexOf(id)).join(", ")}`,
      );
    }

    expect(uniquePaneIds.size).toBe(paneIds.length);

    // Also verify no pane IDs match pane-0
    const pane0Collisions = paneIds.filter((id) => id === "pane-0");
    expect(pane0Collisions).toHaveLength(0);

    if (pane0Collisions.length > 0) {
      throw new Error(
        `FINDING: pane-0 collision detected — one or more sub-agents received ` +
        `the reserved pane-0 ID.`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ATK-CAP: Capability Model Enforcement
// ---------------------------------------------------------------------------
// These tests verify the capability model (read vs readwrite) combined with
// the signalOnly flag is correctly enforced by canSignal(). A read-only
// agent can only emit signals in READ_ONLY_SIGNALS, and a signalOnly agent
// (adversarial) can only emit "challenge".
//
// Tests are pure spec-level (no Docker needed), so they run in the regular
// suite. They are placed here in the herdr adversarial spec because they
// describe the runtime behavior of herdr-mediated agent signaling.
// ---------------------------------------------------------------------------

function makeIdentity(id: string, parentAgentId: string | null, capability: Capability): AgentIdentity {
  return { id, parentAgentId, capability };
}

describe("ATK-CAP: capability model enforcement on canSignal", () => {

  // Reset the adversarial tracker between tests so adversarial child state
  // does not leak across describe blocks.
  beforeEach(() => {
    resetAdversarialTracker();
  });

  // -------------------------------------------------------------------------
  // Test tree used for capability scenarios
  // -------------------------------------------------------------------------
  //   orchestrator (readwrite, root)
  //         |
  //   sub-orch-read  -----  user-workspace-tab (always-allowed challenge source)
  //
  // The "read-only attacker" is a sub-agent spawned under sub-orch-read.
  // -------------------------------------------------------------------------

  const orchestrator = makeIdentity("orchestrator", null, "readwrite");
  const subOrchRead = makeIdentity("sub-orch-read", "orchestrator", "read");
  const readOnlyAttacker = makeIdentity("read-only-attacker", "sub-orch-read", "read");
  const signalOnlyAttacker = makeIdentity("signal-only-attacker", "sub-orch-read", "read");
  const userWorkspaceTab = makeIdentity("user-workspace", "orchestrator", "readwrite");

  // -------------------------------------------------------------------------
  // ATK-CAP-1: read-only agent attempts herdr agent start (write intent)
  // -------------------------------------------------------------------------
  it("ATK-CAP-1: read-only agent attempting 'agent start' (write intent) is rejected by canSignal", () => {
    // The CLI signal "agent-start" is NOT in READ_ONLY_SIGNALS, so a read
    // agent must be denied. This is the gate that would prevent a read-only
    // agent from running `herdr agent start` against the orchestrator.
    const result = canSignal(readOnlyAttacker, subOrchRead, "agent-start");
    expect(result).toBe(false);

    // Spot check: every non-read-only signal should be denied.
    for (const sig of ["agent-start", "git-commit", "edit", "npm-install", "write", "git-push"]) {
      expect(canSignal(readOnlyAttacker, subOrchRead, sig)).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // ATK-CAP-2: read-only agent attempts pane run with destructive command
  // -------------------------------------------------------------------------
  it("ATK-CAP-2: read-only agent attempting 'pane run' with destructive intent is rejected by canSignal", () => {
    // "pane-run" is a write-shaped signal (it executes a command in a pane).
    // A read-only agent must be denied. The destructive payload
    // "rm -rf /" is a red herring — the rejection happens at the signal
    // level before the payload is even parsed.
    const result = canSignal(readOnlyAttacker, subOrchRead, "pane-run");
    expect(result).toBe(false);

    // Even when the attacker is sibling-of-target and would normally pass
    // the flat-governance check, the capability check fires first.
    const siblingRead = makeIdentity("sibling-read", "sub-orch-read", "read");
    expect(canSignal(siblingRead, readOnlyAttacker, "pane-run")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // ATK-CAP-3: read-only agent signals "challenge" — must be allowed
  // -------------------------------------------------------------------------
  it("ATK-CAP-3: read-only agent sending 'challenge' (in READ_ONLY_SIGNALS) is allowed", () => {
    expect(READ_ONLY_SIGNALS.has("challenge")).toBe(true);
    // siblings sharing the same parent (sub-orch-read): both children of
    // sub-orch-read, so flat-governance allows sibling signals.
    const result = canSignal(readOnlyAttacker, signalOnlyAttacker, "challenge");
    expect(result).toBe(true);

    // Adversarial pattern: a read-only parent signaling its child with
    // "challenge" is also allowed (parent -> child spawn relationship,
    // and "challenge" is in READ_ONLY_SIGNALS).
    const childForChallenge = makeIdentity("challenge-target", "sub-orch-read", "read");
    expect(canSignal(readOnlyAttacker, childForChallenge, "challenge")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ATK-CAP-4: signalOnly=true agent attempting "spawn" is rejected
  // -------------------------------------------------------------------------
  it("ATK-CAP-4: signalOnly=true agent attempting 'spawn' is rejected (adversarial constraint)", () => {
    // canSignal() in the spec does not yet know about the signalOnly flag —
    // it only knows capability. signalOnly enforcement is layered on top of
    // the spec via the signalOnlyAdversarialCanSignal() runtime check. The
    // test asserts that the runtime helper rejects any non-challenge signal
    // for an agent flagged signalOnly=true.
    //
    // Topology: signalOnlyAttacker is a child of sub-orch-read. The attacker
    // signals its parent (sub-orch-read) — the spec's parent->child rule
    // means sub-orch-read is the parent of signalOnlyAttacker, and the
    // ATTACKER is signaling the PARENT, which is the "child->parent" direction
    // and is NOT in the spec allow-list. So we use a sibling topology for the
    // positive assertions where the spec would allow.
    const siblingRead = makeIdentity("sibling-read", "sub-orch-read", "read");
    const signalOnlySibling = {
      ...siblingRead,
      id: "signal-only-sibling",
      signalOnly: true,
    } as AgentIdentity & { signalOnly: boolean };

    // "spawn" is in READ_ONLY_SIGNALS, but signalOnly rejection fires first
    // before the spec check. The rejection must NOT depend on spec acceptance.
    const result = signalOnlyAdversarialCanSignal(
      signalOnlySibling,
      siblingRead,
      "spawn",
    );
    expect(result.allowed).toBe(false);
    expect(result.reason.toLowerCase()).toMatch(/signalOnly|challenge/);

    // "challenge" is the only signal that should be allowed for a signalOnly agent
    // and only when the spec also allows it (sibling -> sibling passes).
    const challengeResult = signalOnlyAdversarialCanSignal(
      signalOnlySibling,
      siblingRead,
      "challenge",
    );
    expect(challengeResult.allowed).toBe(true);

    // Non-signalOnly agents are unaffected by this check
    const nonSignalOnly = makeIdentity("normal-read", "sub-orch-read", "read");
    const normalResult = signalOnlyAdversarialCanSignal(nonSignalOnly, siblingRead, "ack");
    expect(normalResult.allowed).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Sanity: user-workspace tab can always challenge (human-in-the-loop)
  // -------------------------------------------------------------------------
  it("user-workspace tab can always send 'challenge' to any sibling (human-in-the-loop override)", () => {
    // user-workspace is a child of orchestrator. It can challenge the
    // sub-orch-read (sibling under orchestrator) and the read-only attacker
    // (sibling's child, NOT a sibling of user-workspace, so this would
    // normally be denied). The human-in-the-loop override path allows the
    // user-workspace tab to inject challenges anyway.
    expect(canUserWorkspaceChallenge(userWorkspaceTab, subOrchRead)).toBe(true);
    expect(canUserWorkspaceChallenge(userWorkspaceTab, readOnlyAttacker)).toBe(true);
    // Non-user-workspace agents do not have this override
    expect(canUserWorkspaceChallenge(readOnlyAttacker, subOrchRead)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ATK-CHL: Adversarial Child Enforcement
// ---------------------------------------------------------------------------
// These tests verify the InMemoryAdversarialTracker enforces the rule:
//   "Every sub-orchestrator must register exactly one adversarial child."
//
// A sub-orchestrator with 0 adversarial children or 2+ adversarial children
// is rejected. The rejection surfaces as a thrown error from
// assertAdversarialChild().
// ---------------------------------------------------------------------------

describe("ATK-CHL: InMemoryAdversarialTracker enforces exactly-one adversarial child", () => {

  beforeEach(() => {
    resetAdversarialTracker();
  });

  // -------------------------------------------------------------------------
  // ATK-CHL-1: sub-orchestrator without an adversarial child is rejected
  // -------------------------------------------------------------------------
  it("ATK-CHL-1: sub-orchestrator without an adversarial child is rejected", () => {
    // No registerAdversarialChild() call has been made for sub-orch-A.
    // assertAdversarialChild() must throw.
    expect(() => assertAdversarialChild("sub-orch-A")).toThrow(
      /adversarial.*child.*missing|no adversarial child/i,
    );

    // hasAdversarialChild() must return false
    const tracker = getAdversarialTracker();
    expect(tracker.hasAdversarialChild("sub-orch-A")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // ATK-CHL-2: sub-orchestrator with 2 adversarial children is rejected
  // -------------------------------------------------------------------------
  it("ATK-CHL-2: sub-orchestrator with 2 adversarial children is rejected (must be exactly 1)", () => {
    // Register two adversarial children for sub-orch-B.
    registerAdversarialChild("sub-orch-B");
    registerAdversarialChild("sub-orch-B");

    // assertAdversarialChild() must throw because there are 2.
    expect(() => assertAdversarialChild("sub-orch-B")).toThrow(
      /adversarial.*child.*count|exactly one|multiple/i,
    );

    // Sanity: a different sub-orch is unaffected
    expect(() => assertAdversarialChild("sub-orch-C")).toThrow();
  });

  // -------------------------------------------------------------------------
  // Sanity: exactly 1 adversarial child is allowed
  // -------------------------------------------------------------------------
  it("sub-orchestrator with exactly 1 adversarial child is accepted", () => {
    registerAdversarialChild("sub-orch-D");
    expect(() => assertAdversarialChild("sub-orch-D")).not.toThrow();
    expect(getAdversarialTracker().hasAdversarialChild("sub-orch-D")).toBe(true);
  });
});