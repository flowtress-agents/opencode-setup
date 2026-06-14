/**
 * User workspace identity (F6).
 *
 * ADR 0004: a separate herdr workspace/tab is reserved for the user's
 * direct bash interaction. The orchestrator (pi in pane 0) cannot reach
 * into this workspace; the user cannot inject into an orchestrator's
 * sub-agent pane.
 *
 * The runtime exposes USER_WORKSPACE_TAB_ID and isUserWorkspace() so that
 * governance checks and pane-routing code can ask "is this tab the
 * user's?" without hard-coding the string.
 */

export const USER_WORKSPACE_TAB_ID = "user" as const;

/**
 * Predicate: is the given tab ID the user's bash workspace?
 *
 * @param tabId - The tab/pane/workspace ID to test
 * @returns true only when tabId === "user"; false for any agent or
 *   orchestrator pane ID.
 */
export function isUserWorkspace(tabId: string): boolean {
  return typeof tabId === "string" && tabId === USER_WORKSPACE_TAB_ID;
}
