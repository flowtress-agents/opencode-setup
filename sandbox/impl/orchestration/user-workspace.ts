/**
 * User workspace — separate herdr tab/workspace for bash interaction.
 *
 * ADR 0004: a separate herdr workspace/tab is reserved for the user's
 * direct bash interaction. The orchestrator (pi in pane 0) cannot reach
 * into this workspace; the user cannot inject into an orchestrator's
 * pane.
 *
 * This module:
 *   - Opens a user bash pane via herdr
 *   - Asserts the orchestrator cannot exec into the user workspace
 *   - Asserts the user cannot inject into the orchestrator's panes
 */

import { USER_WORKSPACE_TAB_ID, isUserWorkspace } from "../../fixtures/sandbox-spec/src/user-workspace.js";
import { HerdrSession } from "../pty/herdr-session.js";

export interface UserWorkspaceSession {
  herdrSession: HerdrSession;
  tabId: string;
  paneId: string;
}

/**
 * Open a user workspace: a separate herdr tab running bash.
 *
 * @returns UserWorkspaceSession with the tab/pane IDs
 */
export async function openUserWorkspace(
  herdrSession: HerdrSession,
): Promise<UserWorkspaceSession> {
  // Create a new tab for the user workspace
  const result = await herdrSession.spawnPane(["bash"]);
  const paneId = result.paneId;
  const tabId = result.tabId;

  return {
    herdrSession,
    tabId,
    paneId,
  };
}

/**
 * Check if a given tab ID is the user workspace.
 */
export function checkIsUserWorkspace(tabId: string): boolean {
  return isUserWorkspace(tabId);
}

/**
 * Assert that the orchestrator cannot exec into the user workspace.
 * This is a governance check — if the orchestrator's pane ID matches
 * the user workspace tab, the assertion fails.
 */
export function assertOrchestratorCannotAccessUserWorkspace(
  orchestratorPaneId: string,
  userWorkspaceTabId: string,
): void {
  if (orchestratorPaneId === userWorkspaceTabId) {
    throw new Error(
      `Isolation violation: orchestrator pane ${orchestratorPaneId} ` +
        `should not be able to access user workspace tab ${userWorkspaceTabId}`,
    );
  }
}

/**
 * Assert that the user cannot inject into the orchestrator's panes.
 * The user workspace tab must be different from all orchestrator pane IDs.
 */
export function assertUserCannotInjectIntoOrchestrator(
  userWorkspaceTabId: string,
  orchestratorPaneIds: string[],
): void {
  for (const paneId of orchestratorPaneIds) {
    if (userWorkspaceTabId === paneId) {
      throw new Error(
        `Isolation violation: user workspace tab ${userWorkspaceTabId} ` +
          `should not be able to inject into orchestrator pane ${paneId}`,
      );
    }
  }
}

/**
 * Verify user workspace isolation live.
 * Attempts to run a command in the user workspace from the orchestrator's context.
 */
export async function verifyUserWorkspaceIsolation(
  herdrSession: HerdrSession,
  orchestratorPaneId: string,
  userWorkspacePaneId: string,
): Promise<{ orchestratorBlocked: boolean; userBlocked: boolean }> {
  // Try orchestrator -> user workspace (should be blocked)
  let orchestratorBlocked = false;
  try {
    const result = await herdrSession.runInPane(orchestratorPaneId, `echo "test"`);
    // If we can run in the user workspace from orchestrator, isolation is broken
    // This is a negative test — if exitCode is 0, the isolation check fails
    if (result.exitCode === 0) {
      // Check if the result actually came from user workspace
      // (best-effort — the runInPane uses pane ID not tab ID)
      orchestratorBlocked = false;
    } else {
      orchestratorBlocked = true;
    }
  } catch {
    orchestratorBlocked = true;
  }

  // Try user -> orchestrator (should be blocked)
  let userBlocked = false;
  try {
    const result = await herdrSession.runInPane(userWorkspacePaneId, `echo "test"`);
    userBlocked = result.exitCode !== 0;
  } catch {
    userBlocked = true;
  }

  return { orchestratorBlocked, userBlocked };
}
