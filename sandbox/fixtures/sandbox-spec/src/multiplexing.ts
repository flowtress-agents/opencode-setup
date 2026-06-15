/**
 * Pane multiplexing constants and helpers (F3).
 *
 * ADR 0004: each agent owns exactly one pane in one herdr tab/workspace.
 * The orchestrator (pi in pane 0, ADR 0002) spawns sub-agents in new tabs
 * via herdr's multiplexing API. Sub-agent panes are on demand, not
 * pre-allocated.
 *
 * ADR 0005: default orchestration caps. The herdr/pi forks enforce these
 * (or smaller values); this module just exposes the agreed defaults.
 */

import type { Capability } from "./governance.js";

export const PANE_DELEGATION_MODE = "spawn_new_tab" as const;

export const ONE_PANE_PER_AGENT: true = true;
export const PARENT_PANE_REQUIRED: true = true;
export const TAB_PER_AGENT_SESSION: true = true;

export const MAX_SUB_AGENTS_PER_ORCHESTRATOR = 8;
export const MAX_PANE_DEPTH = 3;

export interface SubAgentConfig {
  name: string;
  agent?: string;
  parentTabId?: string;
  /** Capability tier for the sub-agent. Defaults to "readwrite". */
  capability?: Capability;
  /**
   * If true, this agent is an adversarial agent that may only send
   * challenge signals. It cannot participate in producing artifacts.
   */
  signalOnly?: boolean;
  /**
   * Where this sub-agent lands in the herdr layout:
   *   - "tab" — a fresh tab in the parent's workspace (sub-orchestrators).
   *   - "pane" — a fresh pane inside an existing tab (sub-agents, fixers).
   *
   * Sub-orchestrators are always `'tab'`. Sub-agents inside a sub-orchestrator
   * tab are `'pane'`. Defaults to `'pane'` so leaf sub-agents keep the
   * existing in-tab behavior unless the orchestrator explicitly opts into
   * a fresh tab.
   */
  tabPlacement?: "tab" | "pane";
}

export interface SubAgentHandle {
  paneId: string;
  tabId: string;
  parentPaneId: string;
}

let _paneCounter = 0;
let _tabCounter = 0;

function nextPaneId(): string {
  _paneCounter += 1;
  return `pane-${_paneCounter}`;
}

function nextTabId(): string {
  _tabCounter += 1;
  return `tab-${_tabCounter}`;
}

/**
 * Spawn a sub-agent in a new herdr tab/workspace under the given parent pane.
 *
 * ADR 0004: one pane per agent, one tab per agent's session, parent pane
 * recorded. The runtime hooks this up to herdr's multiplexing API; this
 * stub returns a deterministic handle that satisfies the spec contract.
 *
 * @param parentPaneId - The pane ID of the parent orchestrator
 * @param agentConfig - The sub-agent's configuration (name, optional agent type)
 * @returns A SubAgentHandle with the new pane/tab IDs and parent linkage
 */
export function spawnSubAgent(
  parentPaneId: string,
  agentConfig: SubAgentConfig,
): SubAgentHandle {
  if (typeof parentPaneId !== "string" || parentPaneId.length === 0) {
    throw new Error("spawnSubAgent: parentPaneId must be a non-empty string");
  }
  if (!agentConfig || typeof agentConfig.name !== "string" || agentConfig.name.length === 0) {
    throw new Error("spawnSubAgent: agentConfig.name must be a non-empty string");
  }
  const tabId = agentConfig.parentTabId ?? nextTabId();
  return {
    paneId: nextPaneId(),
    tabId,
    parentPaneId,
  };
}

/**
 * Default tab placement for a sub-agent when the caller does not specify one.
 * Mirrors `SubAgentConfig.tabPlacement` — kept in one place so the spec and
 * the runtime agree.
 */
export const DEFAULT_TAB_PLACEMENT: "pane" = "pane";
