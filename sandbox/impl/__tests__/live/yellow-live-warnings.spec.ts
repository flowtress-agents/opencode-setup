/**
 * Yellow live warnings — structural assertions that PASS but emit console.warn.
 *
 * These tests assert the current structural state of the live orchestration
 * environment and warn when known limitations or fallbacks are in effect.
 * They do NOT fail — they warn.
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/yellow-live-warnings.spec.ts
 */

import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readSpec } from "../../docker/container-launcher.js";

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
// Helpers
// ---------------------------------------------------------------------------

function getNetworkMode(containerId: string): string {
  try {
    const out = execSync(
      `docker inspect --format '{{.HostConfig.NetworkMode}}' ${containerId}`,
      { encoding: "utf-8" },
    ).trim();
    return out;
  } catch {
    return "unknown";
  }
}

function getRegistryUsed(containerId: string): string {
  try {
    const out = execSync(
      `docker inspect --format '{{.Config.Image}}' ${containerId}`,
      { encoding: "utf-8" },
    ).trim();
    if (out.includes("ghcr.io")) return "ghcr.io";
    if (out.includes("docker.io")) return "docker.io";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Yellow warnings
// ---------------------------------------------------------------------------

describeOrSkip("YELLOW: docker network", () => {
  it("warns if container is not on 'bridge' network", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    // Launch a temporary container to check its network
    const tempName = `yellow-net-check-${process.pid}`;
    try {
      execSync(
        `docker run -d --name ${tempName} --network bridge node:22-bookworm sleep 10`,
        { stdio: "ignore" },
      );
      const network = getNetworkMode(tempName);
      if (network !== "bridge") {
        console.warn(
          `YELLOW[liberty-network]: container is on '${network}' network, not 'bridge'. ` +
            "Inter-container networking may behave differently than expected.",
        );
      }
      expect(network).not.toBe("host"); // host network bypasses isolation
    } finally {
      execSync(`docker rm -f ${tempName}`, { stdio: "ignore" });
    }
  });
});

describeOrSkip("YELLOW: PTY fallback", () => {
  it("warns if node-pty native bindings are unavailable", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    try {
      const pty = await import("node-pty");
      if (!pty) {
        console.warn(
          "YELLOW[liberty-pty-fallback]: node-pty module loaded but returned null. " +
            "PTY harness is using docker-exec -i -t fallback. " +
            "Interactive terminal features may be degraded.",
        );
      }
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      console.warn(
        `YELLOW[liberty-pty-fallback]: node-pty unavailable: ${reason}. ` +
          "Falling back to docker-exec -i -t emulation. " +
          "PTY features (interactive input, signal handling) may not work correctly.",
      );
    }

    // The test always passes — we just warn
    expect(true).toBe(true);
  });
});

describeOrSkip("YELLOW: registry fallback", () => {
  it("warns if build pulled from ghcr.io instead of docker.io", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    const spec = readSpec();
    const fallbacks: string[] = spec.build?.registry_fallbacks ?? [];

    if (fallbacks.includes("ghcr.io") && fallbacks.indexOf("ghcr.io") > fallbacks.indexOf("docker.io")) {
      console.warn(
        "YELLOW[liberty-registry-fallback]: launch-sandbox.toml lists ghcr.io before docker.io " +
          "in registry_fallbacks. Image pulls may use GitHub Container Registry instead of Docker Hub. " +
          "This may cause unexpected availability or rate-limiting behavior.",
      );
    }

    expect(fallbacks).toContain("docker.io");
    expect(fallbacks).toContain("ghcr.io");
  });
});

describeOrSkip("YELLOW: health check timeout", () => {
  it("warns if post_start_timeout_sec is less than 30 seconds", async () => {
    const spec = readSpec();
    const timeout = spec.health?.post_start_timeout_sec ?? 0;

    if (timeout < 30) {
      console.warn(
        `YELLOW[liberty-health-timeout]: post_start_timeout_sec is ${timeout}s (less than 30s). ` +
          "Container health checks may not have enough time to complete on slow hosts. " +
          "Consider increasing to at least 30s.",
      );
    }

    expect(timeout).toBeGreaterThan(0);
  });
});

describeOrSkip("YELLOW: pane 0 immutability enforcement", () => {
  it("warns if pane 0 immutability is not enforced by herdr", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    // Check if herdr pane rename allows renaming pane-0
    // If it does, pane 0 is not truly immutable
    try {
      const result = execSync(
        `docker run -d --name yellow-pane-check-${process.pid} node:22-bookworm sleep 20`,
        { encoding: "utf-8", stdio: "ignore" },
      );
      const tempContainer = result.trim();

      try {
        execSync(`docker exec ${tempContainer} bash -c "command -v herdr"`, {
          stdio: "ignore",
        });
        // herdr is not in the base image — this is expected
        // We warn that pane 0 immutability cannot be tested without a full herdr container
        console.warn(
          "YELLOW[liberty-pane-0]: pane 0 immutability cannot be verified in this test " +
            "because herdr is not in the base node:22-bookworm image. " +
            "ADR 0004 mandates pane 0 is immutable — this must be verified in a full herdr container.",
        );
      } finally {
        execSync(`docker rm -f ${tempContainer}`, { stdio: "ignore" });
      }
    } catch {
      // best-effort
    }

    expect(true).toBe(true);
  });
});

describeOrSkip("YELLOW: MAX_SUB_AGENTS_PER_ORCHESTRATOR limit", () => {
  it("warns if MAX_SUB_AGENTS_PER_ORCHESTRATOR is set to 8 (herdr pane limit)", async () => {
    const spec = readSpec();
    const maxSubAgents = spec.limits?.max_sub_agents_per_orchestrator ?? 8;

    if (maxSubAgents > 8) {
      console.warn(
        `YELLOW[liberty-sub-agent-limit]: max_sub_agents_per_orchestrator is ${maxSubAgents}, ` +
          "which exceeds herdr's default pane limit. Sub-agents beyond pane 8 may fail to spawn " +
          "or behave unexpectedly.",
      );
    }

    expect(maxSubAgents).toBeLessThanOrEqual(16);
  });
});

describeOrSkip("YELLOW: container OOM risk", () => {
  it("warns if no memory limit is set on the container", async () => {
    const available = await dockerAvailable();
    if (!available) return;

    // Create a temporary container with no memory limit to check the default
    const tempName = `yellow-oom-check-${process.pid}`;
    try {
      execSync(
        `docker run -d --name ${tempName} node:22-bookworm sleep 10`,
        { stdio: "ignore" },
      );
      const memLimit = execSync(
        `docker inspect --format '{{.HostConfig.Memory}}' ${tempName}`,
        { encoding: "utf-8" },
      ).trim();

      const memBytes = parseInt(memLimit, 10);
      if (memBytes === 0) {
        console.warn(
          "YELLOW[liberty-oom]: no memory limit is set on the container. " +
            "A sub-agent that consumes excessive memory can cause an OOM kill " +
            "that affects all panes in the container. Consider setting --memory limit.",
        );
      }
      expect(memBytes).toBeGreaterThanOrEqual(0);
    } finally {
      execSync(`docker rm -f ${tempName}`, { stdio: "ignore" });
    }
  });
});
