/**
 * Orchestrator session — pi in pane 0 lifecycle management.
 *
 * ADR 0002: pi is the orchestrator and runs in pane 0.
 * Pane 0 is immutable — no other agent may claim it (ADR 0004, 0005).
 *
 * This module manages the lifecycle of the orchestrator:
 *   - open(): open herdr session, spawn pi in pane 0
 *   - waitForPiReady(): poll pi --version until it responds
 *   - close(): tear down the session
 */

import { HerdrSession, herdrAvailableInContainer, piAvailableInContainer } from "../pty/herdr-session.js";

export interface OrchestratorSessionOptions {
  containerId: string;
  cwd?: string;
  piArgs?: string[];
}

export interface OrchestratorSession {
  herdrSession: HerdrSession;
  pane0Id: string;
  piPid: number;
}

/**
 * Open an orchestrator session: starts herdr, spawns pi in pane 0.
 *
 * @returns OrchestratorSession with the herdr session handle, pane 0 ID, and pi PID
 */
export async function openOrchestratorSession(
  options: OrchestratorSessionOptions,
): Promise<OrchestratorSession> {
  const {
    containerId,
    cwd = "/home/agent/workspace",
    piArgs = ["--version"],
  } = options;

  // Verify prerequisites
  const [herdrOk, piOk] = await Promise.all([
    herdrAvailableInContainer(containerId),
    piAvailableInContainer(containerId),
  ]);

  if (!herdrOk) {
    throw new Error(`herdr is not available in container ${containerId}`);
  }
  if (!piOk) {
    throw new Error(`pi is not available in container ${containerId}`);
  }

  // Open herdr session (this creates pane 0 automatically)
  const herdrSession = await HerdrSession.open({
    containerId,
    cwd,
  });

  // Get pane 0 ID
  const pane0Id = await herdrSession.getPane0Id();

  // Spawn pi in pane 0 using herdr agent start
  // Note: herdr agent start spawns a NEW pane, not pane 0.
  // Pane 0 is the default pane herdr creates at startup.
  // We run pi in pane 0 via herdr pane run.
  const runResult = await herdrSession.runInPane(pane0Id, `pi ${piArgs.join(" ")}`);
  if (runResult.exitCode !== 0) {
    await herdrSession.close();
    throw new Error(`Failed to start pi in pane 0:\n${runResult.stderr}`);
  }

  // Get pi PID inside the container
  const pidResult = await herdrSession.runInPane(
    pane0Id,
    "echo $PI_PID && ps aux | grep pi | grep -v grep | awk '{print $2}' | head -1",
  );
  const piPid = parseInt(pidResult.stdout.trim(), 10) || -1;

  return {
    herdrSession,
    pane0Id,
    piPid,
  };
}

/**
 * Wait for pi to be ready inside pane 0.
 * Polls pi --version until it succeeds or times out.
 */
export async function waitForPiReady(
  herdrSession: HerdrSession,
  pane0Id: string,
  timeoutMs = 30000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await herdrSession.runInPane(pane0Id, "pi --version");
    if (result.exitCode === 0 && result.stdout.trim().length > 0) {
      return;
    }
    await sleep(1000);
  }
  throw new Error("Timeout waiting for pi to be ready in pane 0");
}

/**
 * Close the orchestrator session.
 */
export async function closeOrchestratorSession(
  session: OrchestratorSession,
): Promise<void> {
  await session.herdrSession.close();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
