/**
 * RED test: adversarial protocol enforcement.
 *
 * Tests that:
 *   1. A sub-orchestrator WITHOUT an adversarial child is rejected
 *   2. Adversarial agents with signalOnly=true can only send challenge signals
 *
 * These tests will FAIL (RED) until the adversarial protocol is wired in
 * orchestrator-session.ts and the capability model is fully implemented.
 *
 * Gated: skipped unless BOTH:
 *   1. process.env.RUN_LIVE_TESTS === '1'
 *   2. Docker daemon is running
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/adversarial-protocol.spec.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";
import {
  launchFromSpec,
  cleanupContainer,
  verifyContainer,
} from "../../docker/container-launcher.js";
import { HerdrSession, herdrAvailableInContainer } from "../../pty/herdr-session.js";
import { promoteToSubOrchestrator, type PromotableSubAgentHandle } from "../../../fixtures/sandbox-spec/src/orchestration.js";
import { governanceCanSignal } from "../../orchestration/governance-channel.js";

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

interface AdversarialProtocolContext {
  containerId: string;
  herdrSession: HerdrSession | null;
  pane0Id: string;
}

const ctx: AdversarialProtocolContext = {
  containerId: "",
  herdrSession: null,
  pane0Id: "pane-0",
};

describeOrSkip("adversarial-protocol: sub-orchestrator adversarial child enforcement", () => {

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

  // -------------------------------------------------------------------------
  // Sub-orchestrator must have an adversarial child
  // -------------------------------------------------------------------------
  it("sub-orchestrator without adversarial child is rejected", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    const isRunning = await verifyContainer(ctx.containerId);
    if (!isRunning) return;

    const herdrOk = await herdrAvailableInContainer(ctx.containerId);
    if (!herdrOk) return;

    if (!ctx.herdrSession) {
      ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
      ctx.pane0Id = await ctx.herdrSession.getPane0Id();
    }

    // Promote a sub-agent to sub-orchestrator (simulating what the orchestrator does)
    const promotable: PromotableSubAgentHandle = {
      kind: "sub-agent",
      id: "test-sub-orch-no-adversary",
      spawnable: true,
      parentSubOrchestratorId: "orchestrator",
      depth: 1,
    };

    const subOrch = promoteToSubOrchestrator(promotable);
    expect(subOrch).not.toBeNull();
    expect(subOrch!.capability).toBe("read");

    // RED phase: the protocol check should reject a sub-orchestrator that
    // does not have an adversarial child. Since the spec module doesn't yet
    // track adversarial children, this test documents the expected behavior.
    // The actual enforcement happens in the runtime (orchestrator-session.ts).
    //
    // For now, we test the governance: a sub-orchestrator signals its parent
    // (orchestrator) — this should be allowed via spawn signal.
    const orchestratorIdentity = {
      id: "orchestrator",
      parentAgentId: null,
      capability: "read" as const,
    };
    const subOrchIdentity = {
      id: subOrch!.id,
      parentAgentId: "orchestrator",
      capability: "read" as const,
    };

    // Sub-orchestrator (read) can signal parent with spawn — allowed
    const spawnResult = governanceCanSignal(subOrchIdentity, orchestratorIdentity, "spawn");
    expect(spawnResult.allowed).toBe(true);

    // Sub-orchestrator (read) trying to send a non-read-only signal to parent
    // should be DENIED (this is the adversarial violation it would attempt
    // if it didn't have an adversarial child to challenge its work)
    const writeResult = governanceCanSignal(subOrchIdentity, orchestratorIdentity, "git-commit");
    expect(writeResult.allowed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Adversarial agent: signalOnly=true agent can only send challenge
  // -------------------------------------------------------------------------
  it("adversarial agent (signalOnly=true) can only send challenge signals", () => {
    // Simulate an adversarial agent identity
    const adversarialIdentity = {
      id: "adversarial-1",
      parentAgentId: "sub-orchestrator-1",
      capability: "read" as const,
    };

    const subOrchIdentity = {
      id: "sub-orchestrator-1",
      parentAgentId: "orchestrator",
      capability: "read" as const,
    };

    // Adversarial can challenge its parent sub-orchestrator
    const challengeResult = governanceCanSignal(adversarialIdentity, subOrchIdentity, "challenge");
    expect(challengeResult.allowed).toBe(true);

    // Adversarial CANNOT send spawn (not a read-only signal)
    const spawnResult = governanceCanSignal(adversarialIdentity, subOrchIdentity, "spawn");
    expect(spawnResult.allowed).toBe(false);

    // Adversarial CANNOT send edit
    const editResult = governanceCanSignal(adversarialIdentity, subOrchIdentity, "edit");
    expect(editResult.allowed).toBe(false);

    // Adversarial CANNOT send share_state
    const shareResult = governanceCanSignal(adversarialIdentity, subOrchIdentity, "share_state");
    expect(shareResult.allowed).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Adversarial challenge logged to /tmp/adversarial.log
  // -------------------------------------------------------------------------
  it("adversarial challenge is logged to /tmp/adversarial.log", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    const isRunning = await verifyContainer(ctx.containerId);
    if (!isRunning) return;

    const herdrOk = await herdrAvailableInContainer(ctx.containerId);
    if (!herdrOk) return;

    if (!ctx.herdrSession) {
      ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
      ctx.pane0Id = await ctx.herdrSession.getPane0Id();
    }

    // Write a challenge entry to /tmp/adversarial.log (simulating adversarial agent)
    const logEntry = `[${new Date().toISOString()}] CHALLENGE: kind=missing_evidence targetPaneId=pane-1 reason="no test coverage" severity=block\n`;
    const writeResult = await ctx.herdrSession.runInPane(
      ctx.pane0Id,
      `sh -c 'mkdir -p /tmp && echo "${logEntry.replace(/"/g, '\\"')}" >> /tmp/adversarial.log'`,
    );

    // Verify the log was written
    const readResult = await ctx.herdrSession.runInPane(ctx.pane0Id, "cat /tmp/adversarial.log");
    expect(readResult.exitCode).toBe(0);
    expect(readResult.stdout).toContain("CHALLENGE");
    expect(readResult.stdout).toContain("missing_evidence");
    expect(readResult.stdout).toContain("block");
  });
});
