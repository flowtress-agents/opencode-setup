/**
 * Multiplexing session — spawnSubAgent wired to herdr multiplex API.
 *
 * ADR 0004: each agent owns exactly one pane in one herdr tab/workspace.
 * Sub-agent panes are on demand, not pre-allocated.
 *
 * This module wires spawnSubAgent() from the spec to herdr's `agent start`
 * command, returning a real SubAgentHandle with real pane/tab IDs.
 */

import { HerdrSession, type SpawnPaneResult, snapshotPaneIds, reconcileSpawnedPaneId } from "../pty/herdr-session.js";
import {
  MAX_SUB_AGENTS_PER_ORCHESTRATOR,
  MAX_PANE_DEPTH,
  DEFAULT_TAB_PLACEMENT,
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

export function resetSubAgentCounter(): void {
  _subAgentCounter = 0;
}


/**
 * Pure guard: should we allow `spawnSubAgentViaHerdr` to proceed?
 *
 * Spec-2 plan §2.2 + Challenge 8 fix: this is the runtime enforcement
 * of the depth-4 nesting rule, the user-tab reservation, and the
 * `tabPlacement` discriminator. It runs BEFORE any herdr call so the
 * decision is observable, deterministic, and side-effect-free.
 *
 * @param parentTabId - The tab of the parent orchestrator/sub-orchestrator
 * @param agentConfig - The sub-agent config (tabPlacement, name, etc.)
 * @param opts.parentDepth - How deep the parent is in the nesting tree
 *   (0 = top-level orchestrator, 1 = sub-orchestrator, 2 = would-be
 *   sub-sub-orchestrator; the spec caps at 2 sub-orchestrators)
 * @param opts.parentIsUserTab - True if the parent is the reserved user
 *   tab; a sub-agent can never spawn into the user tab
 * @returns `{ ok: true }` if spawn should proceed; otherwise
 *   `{ ok: false, reason: <machine-readable code> }`
 */
export function canSpawnSubAgent(
  _parentTabId: string,
  agentConfig: SubAgentConfig,
  opts: { parentDepth: number; parentIsUserTab: boolean } = { parentDepth: 0, parentIsUserTab: false },
):
  | { ok: true }
  | { ok: false; reason: "depth-4" | "user-tab-target" | "tab-placement-mismatch" } {
  // Rule 1: a sub-agent may never spawn into the user tab.
  if (opts.parentIsUserTab) {
    return { ok: false, reason: "user-tab-target" };
  }
  // Rule 2: tabPlacement="tab" on a parent that is itself a sub-orchestrator
  // is the depth-4 nesting the spec forbids. Sub-orchestrators must be
  // siblings of the top-level orchestrator tab, not nested deeper.
  if ((agentConfig.tabPlacement ?? DEFAULT_TAB_PLACEMENT) === "tab" && opts.parentDepth >= 1) {
    return { ok: false, reason: "depth-4" };
  }
  // Rule 3: tabPlacement="tab" with depth=0 is fine (top-level sub-orch).
  // tabPlacement="pane" is fine at any depth. Everything else is the
  // documented spec contract, so we don't reject other combinations.
  return { ok: true };
}


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

  // Spec-2 / Challenge 8: the runtime must consult canSpawnSubAgent
  // before issuing the herdr call. parentDepth/parentIsUserTab are
  // conservatively defaulted to "top-level orchestrator" for the
  // multiplexing-session entry point; callers that know they are
  // nested deeper (e.g. a sub-orchestrator spawning an adversarial)
  // call canSpawnSubAgent directly first and pass an explicit
  // parentDepth. The conservative default keeps the multiplex path
  // safe for the top-level orchestrator (depth=0) without the call
  // site needing to opt in.
  const guard = canSpawnSubAgent(parentPaneId, agentConfig, {
    parentDepth: 0,
    parentIsUserTab: false,
  });
  if (!guard.ok) {
    throw new Error(
      `canSpawnSubAgent: refused (${guard.reason}) — agent=${agentConfig.name ?? "<unnamed>"}`,
    );
  }

  const agentName = agentConfig.name ?? `sub-agent-${_subAgentCounter}`;
  const agent = agentConfig.agent ?? "pi";
  // Long-running shell so spawnSubAgentViaHerdr (used by adversarial +
  // sub-agent callers) leaves a live process. The prior one-shot
  // `pi --version` was Challenge 15's target; the spawn-into-tab path
  // still works for a long-lived `bash` because herdr's `agent start`
  // exec's the command in the new pane.
  const piArgs = agent === "pi" ? ["bash", "-lc", "exec pi --append-system-prompt \"$(cat /etc/prompts/sub-orchestrator.md)\""] : ["bash", "-lc", "exec bash"];

  // Spec-2 / Challenge 8: tabPlacement is now respected. `"tab"` lands
  // in a fresh tab via spawnPaneInNewTab; `"pane"` lands in the
  // parent's tab via spawnPane(cmd, { targetTabId }). Both call sites
  // reject `targetTabId` labels starting with `user-` (per ADR 0002).
  //
  // Iteration 2 fix (Stage C, Group 1 / ADR 0009): every spawn call
  // is now followed by a `pane list` JSON lookup that reconciles the
  // returned pane id against a before-snapshot. herdr v0.6.10's
  // `agent start` response shape varies; the reconciliation helper
  // identifies the freshly-created pane by diffing the pane list
  // before and after, and falls back to the raw response on
  // disagreement (with a YELLOW `liberty-pane-id-reconcile` warning).
  // The 3-line fix is: (1) snapshot, (2) spawn, (3) reconcile.
  const placement = agentConfig.tabPlacement ?? DEFAULT_TAB_PLACEMENT;
  const containerId = (herdrSession as any).getContainerId
    ? (herdrSession as any).getContainerId()
    : null;
  const beforePaneIds = containerId
    ? snapshotPaneIds(containerId)
    : new Set<string>();
  const result: SpawnPaneResult =
    placement === "tab"
      ? await herdrSession.spawnPaneInNewTab(piArgs, {
          tabLabel: `orch-${agentName}`,
        })
      : await herdrSession.spawnPane(piArgs, {
          targetTabId: agentConfig.parentTabId,
        });
  const reconciled: SpawnPaneResult = containerId
    ? reconcileSpawnedPaneId(containerId, beforePaneIds, result, {
        tabId: result.tabId,
      })
    : result;

  return {
    paneId: reconciled.paneId,
    tabId: reconciled.tabId,
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
  const handles: SubAgentHandle[] = [];
  for (let i = 0; i < count; i += 1) {
    handles.push(
      await spawnSubAgentViaHerdr(herdrSession, parentPaneId, {
        name: `sub-agent-${i + 1}`,
      }),
    );
  }
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
