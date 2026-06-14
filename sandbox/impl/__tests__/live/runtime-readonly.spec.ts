/**
 * RED test: read-only agent attempts git commit — expects rejection.
 *
 * This test exercises the runtime layer (herdr-session.ts command allowlist)
 * to verify that a read-only agent's git commit attempt is rejected.
 *
 * RED phase: this test documents the expected rejection behavior.
 * It will FAIL (RED) until the runtime command allowlist is wired in herdr-session.ts.
 *
 * Gated: skipped unless BOTH:
 *   1. process.env.RUN_LIVE_TESTS === '1'
 *   2. Docker daemon is running
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/runtime-readonly.spec.ts
 */

import { describe, it, expect, afterAll } from "vitest";
import { execSync } from "node:child_process";
import {
  launchFromSpec,
  cleanupContainer,
  verifyContainer,
} from "../../docker/container-launcher.js";
import { HerdrSession, herdrAvailableInContainer } from "../../pty/herdr-session.js";

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

interface RuntimeReadonlyContext {
  containerId: string;
  herdrSession: HerdrSession | null;
  pane0Id: string;
}

const ctx: RuntimeReadonlyContext = {
  containerId: "",
  herdrSession: null,
  pane0Id: "pane-0",
};

describeOrSkip("runtime-readonly: read-only agent git commit rejection", () => {
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

  it("read-only agent attempting git commit is rejected by the command allowlist", async () => {
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

    // Set up a git repo in the container
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git config --global user.email 'test@test.com'");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git config --global user.name 'Test User'");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git init /tmp/test-readonly-repo");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "touch /tmp/test-readonly-repo/README");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git -C /tmp/test-readonly-repo add .");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git -C /tmp/test-readonly-repo commit -m 'initial'");

    // Spawn a read-only agent pane (capability=read)
    const readOnlyPane = await ctx.herdrSession.spawnPane(["bash", "-c", "export AGENT_CAPABILITY=read && bash"]);

    // Attempt: read-only agent tries to git commit
    // This should be rejected by the command allowlist in runInPane.
    const result = await ctx.herdrSession.runInPane(
      readOnlyPane.paneId,
      "git -C /tmp/test-readonly-repo commit --allow-empty -m 'hacked commit'",
    );

    // RED phase expectation: the command should be rejected.
    // After GREEN phase (runtime allowlist wired), exitCode should be non-zero
    // and stderr should contain the read-only rejection message.
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/read.only|not allowed|permission denied|command not allowed/i);
  });

  it("read-only agent CAN run git status (allowed command)", async () => {
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

    // Set up a git repo
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git init /tmp/test-readonly-repo2");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "touch /tmp/test-readonly-repo2/README");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git -C /tmp/test-readonly-repo2 add .");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git -C /tmp/test-readonly-repo2 commit -m 'init'");

    // Spawn a read-only agent pane
    const readOnlyPane = await ctx.herdrSession.spawnPane(["bash", "-c", "export AGENT_CAPABILITY=read && bash"]);

    // git status is in the READ_ONLY_COMMAND_RE allowlist — should succeed
    const result = await ctx.herdrSession.runInPane(
      readOnlyPane.paneId,
      "git -C /tmp/test-readonly-repo2 status",
    );

    expect(result.exitCode).toBe(0);
  });

  it("read-only agent CAN run cat/ls/grep (allowed commands)", async () => {
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

    const readOnlyPane = await ctx.herdrSession.spawnPane(["bash", "-c", "export AGENT_CAPABILITY=read && bash"]);

    // All of these are in the READ_ONLY_COMMAND_RE allowlist
    const catResult = await ctx.herdrSession.runInPane(readOnlyPane.paneId, "cat /etc/os-release");
    expect(catResult.exitCode).toBe(0);

    const lsResult = await ctx.herdrSession.runInPane(readOnlyPane.paneId, "ls /tmp");
    expect(lsResult.exitCode).toBe(0);

    const grepResult = await ctx.herdrSession.runInPane(readOnlyPane.paneId, "grep -r 'test' /tmp");
    expect(grepResult.exitCode).toBe(0);
  });

  it("read-only agent attempting npm install is rejected", async () => {
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

    const readOnlyPane = await ctx.herdrSession.spawnPane(["bash", "-c", "export AGENT_CAPABILITY=read && bash"]);

    // npm install is NOT in the allowlist — should be rejected
    const result = await ctx.herdrSession.runInPane(
      readOnlyPane.paneId,
      "npm install",
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toLowerCase()).toMatch(/read.only|not allowed|permission denied|command not allowed/i);
  });
});
