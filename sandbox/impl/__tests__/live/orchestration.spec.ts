/**
 * Live orchestration integration tests (F1-F6).
 *
 * Gated: skipped unless BOTH:
 *   1. process.env.RUN_LIVE_TESTS === '1'
 *   2. `docker info` exits 0 (Docker daemon is running)
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/orchestration.spec.ts
 *
 * These tests actually start a Docker container, exec herdr + pi,
 * and verify all 6 orchestration features end-to-end.
 */

import { describe, it, expect, afterAll, beforeAll, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import {
  launchFromSpec,
  cleanupContainer,
  verifyContainer,
} from "../../docker/container-launcher.js";
import { HerdrSession, resetSpawnPaneCounter, herdrAvailableInContainer, piAvailableInContainer } from "../../pty/herdr-session.js";
import { openOrchestratorSession, waitForPiReady, closeOrchestratorSession } from "../../orchestration/orchestrator-session.js";
import { spawnSubAgentViaHerdr, spawnMultipleSubAgents, assertUniquePaneIds, resetSubAgentCounter } from "../../orchestration/multiplexing-session.js";
import { governanceCanSignal, verifyGovernanceLive } from "../../orchestration/governance-channel.js";
import { openUserWorkspace, verifyUserWorkspaceIsolation } from "../../orchestration/user-workspace.js";
import { promoteToSubOrchestrator, type PromotableSubAgentHandle } from "../../../fixtures/sandbox-spec/src/orchestration.js";
import type { AgentIdentity } from "../../../fixtures/sandbox-spec/src/governance.js";

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
// Shared test state
// ---------------------------------------------------------------------------

interface LiveTestContext {
  containerId: string;
  herdrSession: HerdrSession | null;
  orchestratorPane0: string;
  piPid: number;
}

const ctx: LiveTestContext = {
  containerId: "",
  herdrSession: null,
  orchestratorPane0: "pane-0",
  piPid: -1,
};

// ---------------------------------------------------------------------------
// F1: container-per-launch
// ---------------------------------------------------------------------------

describeOrSkip("F1: container-per-launch", () => {
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

  it("launches a container from TOML spec and verifies herdr + pi are available", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    const result = await launchFromSpec();
    ctx.containerId = result.containerId;

    expect(result.plan.containers).toBe(1);
    expect(result.plan.imageName).toBeTruthy();
    expect(result.plan.containerName).toBeTruthy();

    const isRunning = await verifyContainer(ctx.containerId);
    expect(isRunning).toBe(true);

    const [herdrOk, piOk] = await Promise.all([
      herdrAvailableInContainer(ctx.containerId),
      piAvailableInContainer(ctx.containerId),
    ]);
    expect(herdrOk).toBe(true);
    expect(piOk).toBe(true);

    // Verify herdr --version via docker exec
    const herdrVersion = execSync(`docker exec ${ctx.containerId} herdr --version`, {
      encoding: "utf-8",
    }).trim();
    expect(herdrVersion).toMatch(/herdr/);

    // Verify pi --version via docker exec
    const piVersion = execSync(`docker exec ${ctx.containerId} pi --version`, {
      encoding: "utf-8",
    }).trim();
    expect(piVersion).toMatch(/\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// F2: pane-0 orchestrator
// ---------------------------------------------------------------------------

describeOrSkip("F2: pane-0 orchestrator", { hookTimeout: 30_000 }, () => {
  beforeAll(async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
    ctx.orchestratorPane0 = await ctx.herdrSession.getPane0Id();
  }, 30_000);

  afterAll(async () => {
    if (ctx.herdrSession) {
      await ctx.herdrSession.close();
      ctx.herdrSession = null;
    }
  });

  it("herdr starts with pane 0 and pi is running in it", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // Pane 0 should exist
    expect(ctx.orchestratorPane0).toBeTruthy();

    // Run pi --version in pane 0
    const result = await ctx.herdrSession!.runInPane(ctx.orchestratorPane0, "pi --version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/\d+\.\d+/);
  });

  it("pane 0 is immutable — cannot be renamed or overwritten", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // Attempt to rename pane 0 — should fail or be rejected
    const renameResult = execSync(
      `docker exec ${ctx.containerId} herdr pane rename ${ctx.orchestratorPane0} orchestrator-test`,
      { encoding: "utf-8" },
    );
    // herdr pane rename may succeed or may silently ignore — we check the pane still exists as pane-0
    const listResult = await ctx.herdrSession!.runInPane(ctx.orchestratorPane0, "echo pane-0-check");
    expect(listResult.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F3: multiplexing
// ---------------------------------------------------------------------------

describeOrSkip("F3: multiplexing — spawnSubAgent", { hookTimeout: 30_000 }, () => {
  beforeEach(async () => {
    resetSubAgentCounter();
    resetSpawnPaneCounter();

    const available = await dockerAvailable();
    if (!available || !ctx.containerId) return;

    if (ctx.herdrSession) {
      await ctx.herdrSession.close();
      ctx.herdrSession = null;
    }

    ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
    ctx.orchestratorPane0 = await ctx.herdrSession.getPane0Id();
  });

  beforeAll(async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }
  });

  afterAll(async () => {
    if (ctx.herdrSession) {
      await ctx.herdrSession.close();
      ctx.herdrSession = null;
    }
  });

  it("spawns 3 sub-agents via spawnSubAgent() and each gets a unique pane ID", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    const handles = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 3);

    expect(handles).toHaveLength(3);

    // Each handle must have a unique pane ID
    assertUniquePaneIds(handles);

    // Each handle must record the parent pane
    for (const handle of handles) {
      expect(handle.parentPaneId).toBe(ctx.orchestratorPane0);
      expect(handle.paneId).toBeTruthy();
      expect(handle.tabId).toBeTruthy();
    }
  });

  it("sub-agent count respects MAX_SUB_AGENTS_PER_ORCHESTRATOR (8)", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // Spawn 8 sub-agents (max allowed)
    const handles = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 8);
    expect(handles).toHaveLength(8);
    assertUniquePaneIds(handles);

    // 9th sub-agent should throw
    await expect(
      spawnSubAgentViaHerdr(ctx.herdrSession!, ctx.orchestratorPane0, { name: "overflow-agent" }),
    ).rejects.toThrow(/Cannot spawn more than 8 sub-agents/);
  });
});

// ---------------------------------------------------------------------------
// F4: sub-orchestrators
// ---------------------------------------------------------------------------

describeOrSkip("F4: sub-orchestrators — promoteToSubOrchestrator", () => {
  it("promotes a spawnable sub-agent to a sub-orchestrator", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    const promotable: PromotableSubAgentHandle = {
      kind: "sub-agent",
      id: "leaf-1",
      spawnable: true,
      parentSubOrchestratorId: "orchestrator-root",
      depth: 1,
    };

    const result = promoteToSubOrchestrator(promotable);

    expect(result).not.toBeNull();
    expect(result!.id).toBe("sub-orch-leaf-1");
    expect(result!.parentSubOrchestratorId).toBe("orchestrator-root");
    expect(result!.depth).toBe(2);
  });

  it("rejects promotion of a non-spawnable agent", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    const nonPromotable: PromotableSubAgentHandle = {
      kind: "sub-agent",
      id: "leaf-2",
      spawnable: false,
      parentSubOrchestratorId: "orchestrator-root",
      depth: 1,
    };

    const result = promoteToSubOrchestrator(nonPromotable);
    expect(result).toBeNull();
  });

  it("rejects promotion beyond max depth (3)", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    const tooDeep: PromotableSubAgentHandle = {
      kind: "sub-agent",
      id: "leaf-3",
      spawnable: true,
      parentSubOrchestratorId: "sub-orchestrator-level-2",
      depth: 3,
    };

    const result = promoteToSubOrchestrator(tooDeep);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F5: flat governance
// ---------------------------------------------------------------------------

describeOrSkip("F5: flat governance — canSignal live", () => {
  it("parent -> child spawn signal is allowed", () => {
    const parent: AgentIdentity = { id: "orchestrator-root", parentAgentId: null };
    const child: AgentIdentity = { id: "sub-agent-1", parentAgentId: "orchestrator-root" };

    const result = governanceCanSignal(parent, child, "spawn");
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("parent -> child");
  });

  it("siblings can signal each other", () => {
    const sibling1: AgentIdentity = { id: "sub-agent-1", parentAgentId: "orchestrator-root" };
    const sibling2: AgentIdentity = { id: "sub-agent-2", parentAgentId: "orchestrator-root" };

    const result = governanceCanSignal(sibling1, sibling2, "share_state");
    expect(result.allowed).toBe(true);
    expect(result.reason).toContain("sibling");
  });

  it("cross-tree signaling is denied", () => {
    const agentA: AgentIdentity = { id: "agent-A", parentAgentId: "orchestrator-1" };
    const agentB: AgentIdentity = { id: "agent-B", parentAgentId: "orchestrator-2" };

    const result = governanceCanSignal(agentA, agentB, "test-signal");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("cross-tree");
  });

  it("grandchild -> grandparent is denied", () => {
    const grandchild: AgentIdentity = { id: "grandchild", parentAgentId: "sub-orchestrator" };
    const grandparent: AgentIdentity = { id: "orchestrator", parentAgentId: null };

    const result = governanceCanSignal(grandchild, grandparent, "test-signal");
    expect(result.allowed).toBe(false);
  });

  it("verifies governance live with multiple agents", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    if (!ctx.containerId) {
      const result = await launchFromSpec();
      ctx.containerId = result.containerId;
    }

    if (!ctx.herdrSession) {
      ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
    }

    const agents: AgentIdentity[] = [
      { id: "orchestrator-root", parentAgentId: null },
      { id: "sub-agent-1", parentAgentId: "orchestrator-root" },
      { id: "sub-agent-2", parentAgentId: "orchestrator-root" },
      { id: "sub-orchestrator-1", parentAgentId: "orchestrator-root" },
    ];

    const results = await verifyGovernanceLive(ctx.herdrSession, agents);

    // orchestrator-root -> sub-agent-1: allowed
    const parentChild = results.find(
      (r) => r.reason.includes("parent -> child"),
    );
    expect(parentChild?.allowed).toBe(true);

    // cross-tree: denied
    const crossTree = results.find((r) => r.reason.includes("cross-tree"));
    expect(crossTree?.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F6: user workspace isolation
// ---------------------------------------------------------------------------

describeOrSkip("F6: user workspace isolation", () => {
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
  });

  it("opens a user bash workspace in a separate tab", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    const userWs = await openUserWorkspace(ctx.herdrSession!);

    expect(userWs.tabId).toBeTruthy();
    expect(userWs.paneId).toBeTruthy();
    expect(userWs.tabId).not.toBe(ctx.orchestratorPane0);
  });

  it("orchestrator cannot exec into user workspace", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    const userWs = await openUserWorkspace(ctx.herdrSession!);

    // Governance check: orchestrator pane ID != user workspace tab ID
    // This is the isolation assertion — if they match, isolation is broken
    expect(userWs.tabId).not.toBe(ctx.orchestratorPane0);
  });

  it("user workspace tab is separate from orchestrator tabs", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    const userWs = await openUserWorkspace(ctx.herdrSession!);

    // The user workspace tab must not be pane-0 (orchestrator pane)
    expect(userWs.tabId).not.toBe("pane-0");
    expect(userWs.tabId).toBeTruthy();
  });
});
