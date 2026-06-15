/**
 * GREEN test: read-write sub-agent bypasses the command allowlist.
 *
 * Stage C fix for Challenge 10 in `stage-B-challenges.md`. The spec
 * (ADR 0005 + spec §6.3.1) requires that a sub-agent with
 * `capability: "readwrite"` can run any command without the
 * `READ_ONLY_COMMAND_RE` allowlist rejecting it, and that the
 * command is recorded in `/tmp/agent-<id>.audit` with
 * `capability=readwrite`. This test pins BOTH halves of that
 * contract.
 *
 * Companion to `runtime-readonly.spec.ts` (which pins the
 * rejection half). Without this test, a future refactor could
 * re-enable the allowlist for readwrite and break the
 * surgical-fixer contract silently.
 *
 * Gated: skipped unless BOTH:
 *   1. process.env.RUN_LIVE_TESTS === '1'
 *   2. Docker daemon is running
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/runtime-readwrite-bypass.spec.ts
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

interface BypassContext {
  containerId: string;
  herdrSession: HerdrSession | null;
  pane0Id: string;
}

const ctx: BypassContext = {
  containerId: "",
  herdrSession: null,
  pane0Id: "pane-0",
};

const FIXER_AGENT_ID = "fixer-scaffold_2";

describeOrSkip("runtime-readwrite-bypass: read-write sub-agent can run write commands", { timeout: 240_000 }, () => {
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

  it("read-write sub-agent's git commit succeeds without rejection and is audit-logged", async () => {
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

    // Stage C / Challenge 10 GREEN test setup: build a tiny git
    // repo with an initial commit. We use a fresh dir under
    // /tmp/bypass-test-repo so the test does not depend on prior
    // state and is order-independent from `runtime-readonly.spec.ts`.
    await ctx.herdrSession.runInPane(ctx.pane0Id, "rm -rf /tmp/bypass-test-repo");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git config --global user.email 'bypass@test.com'");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git config --global user.name 'Bypass Test'");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "git init -b main /tmp/bypass-test-repo");
    await ctx.herdrSession.runInPane(ctx.pane0Id, "touch /tmp/bypass-test-repo/README");
    await ctx.herdrSession.runInPane(
      ctx.pane0Id,
      "git -C /tmp/bypass-test-repo add README",
      "readwrite",
      "setup",
    );
    await ctx.herdrSession.runInPane(
      ctx.pane0Id,
      "git -C /tmp/bypass-test-repo commit -m 'initial'",
      "readwrite",
      "setup",
    );

    // Spawn a readwrite-capability pane. The fixer's bash inherits
    // cwd=/home/agent/workspace, so `cd /tmp/bypass-test-repo` puts
    // it in the repo root. We also export AGENT_CAPABILITY=readwrite
    // so the gate (if any) sees the right value.
    const readwritePane = await ctx.herdrSession.spawnPane([
      "bash",
      "-lc",
      "cd /tmp/bypass-test-repo && export AGENT_CAPABILITY=readwrite && exec bash",
    ]);

    // Half A — the bypass itself: a readwrite sub-agent can run
    // `git commit` without the allowlist rejecting it.
    // The `agentCapability` argument to runInPane is the runtime
    // gate's input; passing "readwrite" is what makes
    // `isCommandAllowed` short-circuit to true.
    const commitResult = await ctx.herdrSession.runInPane(
      readwritePane.paneId,
      "git commit --allow-empty -m 'fixer-patched'",
      "readwrite",
      FIXER_AGENT_ID,
    );

    // The bypass is the spec-2 contract — the command runs and
    // exits 0. If the gate is wrongly re-enabled for readwrite,
    // this exits 1 with the "read-only agent attempted write
    // command" message and the test fails.
    expect(commitResult.exitCode).toBe(0);

    // Half B — observability: the audit log records the
    // readwrite command with `capability=readwrite`. This is
    // the second half of the contract from Challenge 4
    // (audit log is universal) and Challenge 10
    // (bypass is observable). A post-hoc auditor can replay
    // the log and see exactly what the surgical fixer did.
    const auditLog = execSync(
      `docker exec ${ctx.containerId} cat /tmp/agent-${FIXER_AGENT_ID}.audit 2>/dev/null || true`,
      { encoding: "utf-8" },
    );
    expect(auditLog).toMatch(/capability=readwrite/);
    expect(auditLog).toMatch(/git commit/);
  });
});
