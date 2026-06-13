import { describe, it, expect, afterAll } from "vitest";
import type { ISandbox } from "../../types.js";

/**
 * Live end-to-end Docker test.
 *
 * Gated: skipped unless BOTH:
 *   1. process.env.RUN_DOCKER_TESTS === '1'
 *   2. `docker info` exits 0 (Docker daemon is running)
 *
 * Run with:
 *   RUN_DOCKER_TESTS=1 npx vitest run impl/runtime/__tests__/live/sandbox.live.spec.ts
 *
 * This test actually starts a real Docker container, runs a command in it,
 * and verifies the result. It is slow (~5-10s) and requires Docker.
 */

const ENABLE_LIVE_TESTS = process.env.RUN_DOCKER_TESTS === "1";

async function dockerAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import("node:child_process");
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = ENABLE_LIVE_TESTS ? describe : describe.skip;

describeOrSkip("live sandbox runtime", () => {
  const containerName = `sandbox-live-${process.pid}-${Date.now()}`;
  let sandbox: ISandbox | null = null;

  afterAll(async () => {
    // Cleanup: stop and rm the container even on failure
    if (sandbox) {
      try {
        await sandbox.stop();
      } catch { /* best-effort */ }
      try {
        const { execSync } = await import("node:child_process");
        execSync(`docker rm -f ${containerName}`, { stdio: "ignore" });
      } catch { /* best-effort */ }
    }
  });

  it("creates a sandbox and starts a container", async () => {
    const available = await dockerAvailable();
    if (!available) return; // skip if docker not available

    const { createSandbox } = await import("../../factory.js");
    sandbox = await createSandbox({
      id: `test-${process.pid}`,
      containerName,
      detached: true,
    });

    await sandbox.start();
    expect(sandbox.status).toBe("running");

    const info = sandbox.getInfo();
    expect(info.containerName).toBe(containerName);
    expect(info.status).toBe("running");
    expect(info.pid).toBeGreaterThan(0);
  });

  it("executes a command inside the running container", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    expect(sandbox?.status).toBe("running");

    const result = await sandbox!.exec(["echo", "hello from container"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello from container");
  });

  it("executes a command that fails with non-zero exit", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    expect(sandbox?.status).toBe("running");

    await expect(sandbox!.exec(["false"])).rejects.toThrow();
  });

  it("stops the container cleanly", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    expect(sandbox?.status).toBe("running");
    await sandbox!.stop();
    expect(sandbox!.status).toBe("stopped");

    const info = sandbox!.getInfo();
    expect(info.stoppedAt).toBeInstanceOf(Date);
  });
});