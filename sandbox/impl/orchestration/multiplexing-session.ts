/**
 * Multiplexing session — spawnSubAgent wired to herdr multiplex API.
 *
 * ADR 0004: each agent owns exactly one pane in one herdr tab/workspace.
 * Sub-agent panes are on demand, not pre-allocated.
 *
 * This module wires spawnSubAgent() from the spec to herdr's `agent start`
 * command, returning a real SubAgentHandle with real pane/tab IDs.
 */

import { HerdrSession, type SpawnPaneResult } from "../pty/herdr-session.js";
import {
  MAX_SUB_AGENTS_PER_ORCHESTRATOR,
  MAX_PANE_DEPTH,
  type SubAgentHandle,
  type SubAgentConfig,
} from "../../fixtures/sandbox-spec/src/multiplexing.js";

export interface MultiplexingSessionOptions {
  herdrSession: HerdrSession;
  pane0Id: string;
}

/**
 * Active sub-agent tracking.
 */
interface ActiveSubAgent {
  handle: SubAgentHandle;
  paneId: string;
  tabId: string;
}

let _subAgentCounter = 0;

/**
 * Spawn a sub-agent in a new herdr tab/workspace.
 *
 * @param parentPaneId - The pane ID of the parent orchestrator
 * @param agentConfig - The sub-agent configuration
 * @returns A real SubAgentHandle with herdr-managed pane/tab IDs
 */
export async function spawnSubAgentViaHerdr(
  herdrSession: HerdrSession,
  parentPaneId: string,
  agentConfig: SubAgentConfig,
): Promise<SubAgentHandle> {
  _subAgentCounter += 1;
  if (_subAgentCounter > MAX_SUB_AGENTS_PER_ORCHESTRATOR) {
    throw new Error(
      `Cannot spawn more than ${MAX_SUB_AGENTS_PER_ORCHESTRATOR} sub-agents`,
    );
  }

  const agentName = agentConfig.name ?? `sub-agent-${_subAgentCounter}`;
  const piArgs = agentConfig.agent === "pi" ? ["--version"] : ["bash", "--version"];

  // Use herdr agent start to spawn a new pane with the sub-agent command
  const result = await herdrSession.spawnPane(piArgs);

  return {
    paneId: result.paneId,
    tabId: result.tabId,
    parentPaneId,
  };
}

/**
 * Spawn multiple sub-agents rapidly and return all their handles.
 * Used by debug-1 to trace pane allocation race conditions.
 */
export async function spawnMultipleSubAgents(
  herdrSession: HerdrSession,
  parentPaneId: string,
  count: number,
): Promise<SubAgentHandle[]> {
  const handles = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      spawnSubAgentViaHerdr(herdrSession, parentPaneId, {
        name: `sub-agent-${_subAgentCounter + i + 1}`,
      }),
    ),
  );
  return handles;
}

/**
 * Verify that all pane IDs are unique (no two sub-agents share the same pane).
 */
export function assertUniquePaneIds(handles: SubAgentHandle[]): void {
  const paneIds = handles.map((h) => h.paneId);
  const uniquePaneIds = new Set(paneIds);
  if (uniquePaneIds.size !== paneIds.length) {
    throw new Error(
      `Pane ID collision detected: ${paneIds.length} sub-agents but only ${uniquePaneIds.size} unique pane IDs`,
    );
  }
}
