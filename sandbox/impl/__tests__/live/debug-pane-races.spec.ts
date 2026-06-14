/**
 * Debug: pane allocation race conditions in live orchestration.
 *
 * Gated: skipped unless BOTH:
 *   1. process.env.RUN_LIVE_TESTS === '1'
 *   2. `docker info` exits 0 (Docker daemon is running)
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/debug-pane-races.spec.ts
 *
 * ## What this tests
 *
 * spawnMultipleSubAgents() calls spawnSubAgentViaHerdr() for each sub-agent.
 * spawnSubAgentViaHerdr() increments _subAgentCounter, then calls herdrSession.spawnPane().
 *
 * ## The race condition
 *
 * _subAgentCounter is a module-level let (not atomic, not locked). When 8 calls
 * to spawnSubAgentViaHerdr() execute concurrently inside Promise.all:
 *
 *   1. All 8 promises are created simultaneously — they all capture the SAME
 *      _subAgentCounter value in the Array.from() closure.
 *   2. Promise.all() starts all 8 async operations at effectively the same time.
 *   3. Each spawnSubAgentViaHerdr() increments _subAgentCounter at its own pace.
 *   4. Multiple calls can read the same counter value before any of them write
 *      their incremented value back.
 *
 * Consequence: multiple sub-agents may receive the same agent name (e.g. both
 * get "sub-agent-1"). When herdr spawns two panes with the same name, the
 * subsequent `herdr pane list` parsing in spawnPane() can mis-associate pane IDs:
 * Agent A's spawnPane() call may parse Agent B's pane from the list output,
 * causing Agent A to receive { paneId: "pane-N", tabId: "tab-M" } where N or M
 * actually belong to Agent B.
 *
 * If pane IDs collide, two sub-agents share the same pane — their I/O would be
 * interleaved, breaking the one-pane-per-agent invariant (ADR 0004). This could
 * cause agents to receive each other's commands, corrupt output streams, or
 * silently fail governance checks that rely on pane identity.
 *
 * A secondary race lives in spawnPane() itself: it uses `agent-${Date.now()}`
 * as the herdr agent name. Date.now() has millisecond resolution — two concurrent
 * calls within the same millisecond get the same name, and the pane list parsing
 * (which matches by name) will grab whichever pane happens to appear first in
 * the output, potentially the wrong one.
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { execSync } from "node:child_process";
import {
  launchFromSpec,
  cleanupContainer,
  verifyContainer,
} from "../../docker/container-launcher.js";
import { HerdrSession, herdrAvailableInContainer, piAvailableInContainer } from "../../pty/herdr-session.js";
import { spawnSubAgentViaHerdr, spawnMultipleSubAgents, assertUniquePaneIds } from "../../orchestration/multiplexing-session.js";

const RUN_LIVE = process.env.RUN_LIVE_TESTS === "1";

async function dockerAvailable(): Promise<boolean> {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = RUN_LIVE ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Shared test state
// ---------------------------------------------------------------------------

interface RaceTestContext {
  containerId: string;
  herdrSession: HerdrSession | null;
  orchestratorPane0: string;
}

const ctx: RaceTestContext = {
  containerId: "",
  herdrSession: null,
  orchestratorPane0: "pane-0",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeOrSkip("DEBUG: pane allocation race conditions", () => {
  beforeAll(async () => {
    const available = await dockerAvailable();
    if (!available) return;

    const result = await launchFromSpec();
    ctx.containerId = result.containerId;

    const isRunning = await verifyContainer(ctx.containerId);
    if (!isRunning) throw new Error("Container not running");

    const [herdrOk, piOk] = await Promise.all([
      herdrAvailableInContainer(ctx.containerId),
      piAvailableInContainer(ctx.containerId),
    ]);
    if (!herdrOk || !piOk) throw new Error("herdr or pi not available");

    ctx.herdrSession = await HerdrSession.open({ containerId: ctx.containerId });
    ctx.orchestratorPane0 = await ctx.herdrSession.getPane0Id();
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

  it("spawns 8 sub-agents in parallel and all get unique pane IDs", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    /**
     * Spawn 8 sub-agents as rapidly as possible using Promise.all.
     * This maximises the chance of a race on _subAgentCounter because
     * all 8 async calls start at the same moment.
     */
    const handles = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 8);

    expect(handles).toHaveLength(8);

    // Assert all pane IDs are unique — this is the primary invariant.
    // If this fails, pane IDs collided and two agents share a pane.
    assertUniquePaneIds(handles);

    // Also verify all tab IDs are unique (same race could affect tabs).
    const tabIds = handles.map((h) => h.tabId);
    const uniqueTabIds = new Set(tabIds);
    if (uniqueTabIds.size !== tabIds.length) {
      console.warn(
        `YELLOW[pane-race-tab-id]: ${tabIds.length} sub-agents but only ${uniqueTabIds.size} unique tab IDs. ` +
          "Tab ID collision detected — ADR 0004 (one tab per agent session) may be violated.",
      );
    }
    expect(uniqueTabIds.size).toBe(tabIds.length);

    // Every handle must record the parent pane.
    for (const handle of handles) {
      expect(handle.parentPaneId).toBe(ctx.orchestratorPane0);
      expect(handle.paneId).toBeTruthy();
      expect(handle.tabId).toBeTruthy();
    }
  });

  it("YELLOW: warns if _subAgentCounter is not atomic under concurrent spawn", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // We cannot directly observe the counter from outside the module, but we
    // can detect the symptom: name collisions causing pane ID misassociation.
    // Run the parallel spawn twice and look for instability.
    const run1 = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 8);
    const run2 = await spawnMultipleSubAgents(ctx.herdrSession!, ctx.orchestratorPane0, 8);

    // If pane IDs from run1 appear in run2's pane set, we likely mis-associated.
    const run1PaneIds = new Set(run1.map((h) => h.paneId));
    const run2PaneIds = new Set(run2.map((h) => h.paneId));

    const overlap = [...run1PaneIds].filter((id) => run2PaneIds.has(id));
    if (overlap.length > 0) {
      console.warn(
        `YELLOW[pane-race-counter]: pane ID overlap between two sequential runs: ${JSON.stringify(overlap)}. ` +
          "This suggests _subAgentCounter race conditions are causing pane ID reuse or misassociation. " +
          "The module-level counter should be replaced with an atomic counter or a mutex lock.",
      );
    }

    // The test always passes — the warning is the deliverable.
    expect(true).toBe(true);
  });

  it("YELLOW: warns about Date.now() name collision risk in spawnPane", async () => {
    const available = await dockerAvailable();
    if (!available) return;
    expect(ctx.herdrSession).not.toBeNull();

    // Check how many panes we can spawn in a tight loop (simulating rapid spawns).
    // If two calls use the same Date.now() value, herdr may reject the duplicate
    // name or the pane list parsing may grab the wrong pane.
    const CONCURRENT_SPAWN_COUNT = 4;
    const paneIds: string[] = [];
    const errors: string[] = [];

    await Promise.all(
      Array.from({ length: CONCURRENT_SPAWN_COUNT }, async () => {
        try {
          const result = await ctx.herdrSession!.spawnPane(["bash", "-c", "echo ok"]);
          paneIds.push(result.paneId);
        } catch (err: any) {
          errors.push(String(err?.message ?? err));
        }
      }),
    );

    const uniquePaneIds = new Set(paneIds);
    if (uniquePaneIds.size !== paneIds.length) {
      console.warn(
        `YELLOW[pane-race-timestamp]: ${paneIds.length} concurrent spawnPane calls ` +
          `produced only ${uniquePaneIds.size} unique pane IDs. ` +
          "This strongly suggests Date.now() name collisions in spawnPane() — " +
          "two panes received the same agent name, and the list parser associated " +
          "the wrong pane ID. Replace the name scheme with a truly unique identifier " +
          "(e.g. crypto.randomUUID() prefixed with 'agent-').",
      );
    }

    if (errors.length > 0) {
      console.warn(
        `YELLOW[pane-race-herdr-error]: ${errors.length} of ${CONCURRENT_SPAWN_COUNT} ` +
          `concurrent spawnPane calls threw errors: ${errors.slice(0, 3).join("; ")}. ` +
          "This may indicate herdr rejected duplicate agent names.",
      );
    }

    // The test always passes — warnings are the deliverable.
    expect(true).toBe(true);
  });
});
