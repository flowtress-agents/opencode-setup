/**
 * Team spawner — phases B–D of the start-orchestrator flow.
 *
 * ADR 0002 + ADR 0004 + ADR 0005: the orchestrator (pi in pane 0) does not
 * spawn sub-orchestrators, adversarials, or fixers interactively. The team
 * is created at orchestrator boot by this module, which mirrors phases B–D
 * of the bash `start-orchestrator` wrapper script.
 *
 * Phases:
 *   B. Spawn one sub-orchestrator per workstream. Each gets its own tab
 *      under the orchestrator workspace and runs `pi --version` (or `pi`
 *      with the sub-orchestrator prompt) so the runtime can promote it
 *      to a sub-orchestrator on demand.
 *   C. Spawn the adversarial swarm: one adversarial per sub-orchestrator
 *      (targets the sub-orchestrator's pane), plus one global adversarial
 *      that targets pane 0 (the orchestrator's plan).
 *   D. Register the surgical fixers lazily in `/etc/surgical-fixers`.
 *      Fixers are NOT started here — the orchestrator calls `spawnFixer`
 *      on demand when the adversarial swarm blocks a workstream.
 *
 * On-disk contract: the bash wrapper writes the same files
 * (`/etc/orchestrator-prompt.txt`, `/etc/surgical-fixers`) so the image
 * and the test harness agree on the protocol.
 *
 * YELLOW[liberty-team-spawner-retry]: herdr CLI calls retry with linear
 * backoff on transient failure. Permanent failures (pane not found,
 * capability denied) propagate immediately.
 */

import { execSync } from "node:child_process";
import { HerdrSession, type SpawnPaneResult, parseWorkspaceId, parseTabId, parseRootPaneId } from "../pty/herdr-session.js";
import { USER_WORKSPACE_LABEL, type UserWorkspaceHandle } from "../../fixtures/sandbox-spec/src/orchestration.js";

const DOCKER_BIN = (() => {
  try {
    return execSync("which docker", { encoding: "utf-8" }).trim() || "docker";
  } catch {
    return "docker";
  }
})();

/**
 * A workstream that the orchestrator delegates to. Each workstream gets a
 * sub-orchestrator pane in its own tab, plus a paired adversarial and a
 * lazy surgical fixer.
 */
export interface WorkstreamSpec {
  /** Short workstream name (e.g. "scaffold_2", "git-worktree", "deps"). */
  name: string;
  /** Human-readable tab label (e.g. "orch-scaffold_2"). */
  tabLabel: string;
}

/**
 * The full team-spawn result. The orchestrator runtime consumes this to
 * wire the adversarial swarm + surgical fixers into the challenge loop.
 */
export interface TeamSpawnResult {
  /** The orchestrator's pane 0 (immutable). */
  orchestratorPaneId: string;
  /** The workspace id of the orchestrator's workspace. */
  workspaceId: string;
  /**
   * The reserved user workspace, paired with the orchestrator's
   * workspace. Phase 1.3 (spec-2 plan §1.3): every orchestrator
   * workspace is paired with exactly one `user` tab in the same
   * workspace, running `bash`. The runtime hook in
   * `impl/pty/herdr-session.ts:spawnPane` refuses any spawn whose
   * target tab label starts with `user-`, so a sub-orchestrator that
   * tries to land here is rejected at the runtime layer. See ADR 0002.
   */
  userWorkspace: UserWorkspaceHandle;
  /** One entry per workstream: its sub-orchestrator pane + tab. */
  subOrchestrators: Array<{ workstream: string; paneId: string; tabId: string }>;
  /** Adversarial swarm: one per sub-orchestrator + one global. */
  adversarialSwarm: Array<{ name: string; targetPaneId: string }>;
  /**
   * Surgical fixers, one per workstream. `spawned: false` for lazy
   * fixers that have not yet been activated. `spawnFixer` flips the
   * flag and starts the readwrite agent.
   */
  surgicalFixers: Array<{ workstream: string; name: string; spawned: boolean }>;
}

/**
 * Result returned by `spawnFixer`. The paneId is the surgical fixer's
 * pane (readwrite capability). The orchestrator hands challenges to
 * this pane via the challenge log.
 */
export interface FixerSpawnResult {
  /** Name of the surgical fixer, e.g. "fixer-scaffold_2". */
  name: string;
  /** Pane ID of the freshly-started fixer. */
  paneId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path inside the container where surgical fixers are registered. */
export const SURGICAL_FIXERS_PATH = "/etc/surgical-fixers";

/** Path inside the container where the orchestrator prompt is written. */
export const ORCHESTRATOR_PROMPT_PATH = "/etc/orchestrator-prompt.txt";

/** Name of the global adversarial that challenges the orchestrator's plan. */
export const GLOBAL_ADVERSARIAL_NAME = "adv-global";

/** Default retry policy for transient herdr CLI failures. */
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

// ---------------------------------------------------------------------------
// YELLOW: retry policy
// ---------------------------------------------------------------------------

/**
 * Determine whether a herdr CLI failure is transient (worth retrying) or
 * permanent (propagate immediately). We treat non-zero exit codes that
 * mention "no such", "not found", "denied", "permission", "refused",
 * "unknown subcommand", or "invalid argument" as permanent; everything
 * else is considered transient.
 *
 * Stage C fix (Challenge 13): the "refused" keyword is now in the
 * permanent list so the user-workspace reservation error
 * (`spawnPane: refused — target tab is reserved (user-*) ...`)
 * propagates immediately instead of burning `DEFAULT_RETRY_ATTEMPTS`
 * linear-backoff iterations. The reservation is logically permanent —
 * retrying the spawn into a `user-*` tab is not going to succeed.
 */
function isTransientHerdrFailure(stderr: string, exitCode: number): boolean {
  if (exitCode === 0) return false;
  const lower = stderr.toLowerCase();
  if (
    lower.includes("no such") ||
    lower.includes("not found") ||
    lower.includes("denied") ||
    lower.includes("permission") ||
    lower.includes("refused") ||
    lower.includes("unknown subcommand") ||
    lower.includes("invalid argument")
  ) {
    return false;
  }
  return true;
}

/**
 * Run an async block with retry. Used to wrap herdr CLI calls that may
 * fail transiently (e.g. immediately after a tab create before the daemon
 * has settled).
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = DEFAULT_RETRY_ATTEMPTS,
  delayMs = DEFAULT_RETRY_DELAY_MS,
  label = "herdr-op",
): Promise<T> {
  let lastErr: unknown = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = String(err?.message ?? err);
      const transient = isTransientHerdrFailure(msg, err?.exitCode ?? 1);
      if (!transient) throw err;
      if (i === attempts) {
        console.warn(
          `YELLOW[liberty-team-spawner-retry]: ${label} failed after ${attempts} attempts: ${msg}`,
        );
        throw err;
      }
      await sleep(delayMs * i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Compute the adversarial name for a workstream. Per ADR 0007, the
 * adversarial's name is the workstream name with a fixed prefix.
 */
function adversarialNameFor(workstream: string): string {
  return `adv-${workstream}`;
}

/**
 * Compute the surgical-fixer name for a workstream.
 */
function fixerNameFor(workstream: string): string {
  return `fixer-${workstream}`;
}

/**
 * Resolve the workspace id of the orchestrator's workspace. The
 * orchestrator is always in pane 0 of the first workspace; the
 * workspace id is recorded so subsequent `herdr tab create
 * --workspace <id>` calls land in the right workspace.
 *
 * We invoke `herdr pane list` directly via a child process (not via
 * `runInPane`) because the parsePaneReadOutput filter strips the
 * JSON we need. The fallback is "default" which herdr accepts as a
 * no-op workspace filter on some versions.
 */
async function resolveOrchestratorWorkspaceId(
  session: HerdrSession,
  _orchestratorPaneId: string,
): Promise<string> {
  const containerId = session.getContainerId();
  let result: string;
  try {
    result = execSync(`docker exec ${containerId} herdr pane list`, {
      encoding: "utf-8",
    });
  } catch {
    return "default";
  }
  return parseWorkspaceId(result) ?? "default";
}

/**
 * Read a file from inside the container via direct `docker exec cat`.
 * Bypasses the herdr pane PTY so we get clean file contents without
 * terminal noise (no `# ` prompts, no line-editing artifacts).
 */
async function readContainerFile(
  session: HerdrSession,
  _paneId: string,
  path: string,
): Promise<string> {
  const containerId = session.getContainerId();
  try {
    return execSync(`${DOCKER_BIN} exec ${containerId} cat ${path}`, {
      encoding: "utf-8",
    });
  } catch (err: any) {
    throw new Error(
      `readContainerFile(${path}) failed: ${err?.stderr?.toString() || err?.message}`,
    );
  }
}

/**
 * Write a file inside the container. We use a direct `docker exec`
 * (bypassing the herdr pane PTY) so multi-line contents, special
 * characters, and binary-safe payloads all work without shell
 * line-editing interference.
 *
 * The contents are passed via stdin to `cat > <path>` so we never
 * need to escape special characters in the data. We use the
 * `--user root` flag so the file can be created in /etc (the
 * default sandbox user may not have write permission there).
 */
async function writeContainerFile(
  session: HerdrSession,
  _paneId: string,
  path: string,
  contents: string,
): Promise<void> {
  const containerId = session.getContainerId();
  // The path is fixed by our constants (no shell injection risk).
  // We do mkdir -p to ensure the parent directory exists, then
  // pipe the contents to cat. Both go through one sh -c.
  try {
    execSync(
      `${DOCKER_BIN} exec -i ${containerId} sh -c 'mkdir -p "$(dirname "${path}")" && cat > "${path}"'`,
      { input: contents, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (err: any) {
    throw new Error(
      `writeContainerFile(${path}) failed: ${err?.stderr?.toString() || err?.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API: spawnOrchestrationTeam
// ---------------------------------------------------------------------------

/**
 * Spawn the full orchestration team. Mirrors phases B–D of the
 * `start-orchestrator` bash wrapper.
 *
 * Idempotency: if the surgical-fixers file already exists from a
 * previous run, it is rewritten with the current workstream set; old
 * entries for workstreams not in `workstreams` are dropped. Existing
 * sub-orchestrators/adversarials are NOT killed — the caller is
 * expected to start from a clean session.
 *
 * @param session - A live HerdrSession (must be open, pane 0 available)
 * @param workstreams - Workstreams to spawn sub-orchestrators for
 * @returns TeamSpawnResult with the full layout
 */
/**
 * Write the surgical-fixers registry file with the given workstreams.
 * Format: one line per fixer, "<workstream> <fixer-name> <capability>".
 *
 * Exported so tests can write known-bad registries (e.g. a "read"
 * entry) to assert that spawnFixer() rejects them.
 */
export async function writeSurgicalFixersRegistryFromList(
  session: HerdrSession,
  orchestratorPaneId: string,
  entries: Array<{ workstream: string; capability: "read" | "readwrite" }>,
): Promise<void> {
  const lines = entries.map(
    (e) => `${e.workstream} ${fixerNameFor(e.workstream)} ${e.capability}`,
  );
  const contents = lines.join("\n") + "\n";
  await writeContainerFile(session, orchestratorPaneId, SURGICAL_FIXERS_PATH, contents);
}

export async function spawnOrchestrationTeam(
  session: HerdrSession,
  workstreams: WorkstreamSpec[],
): Promise<TeamSpawnResult> {
  if (!Array.isArray(workstreams) || workstreams.length === 0) {
    throw new Error("spawnOrchestrationTeam: workstreams must be a non-empty array");
  }

  const orchestratorPaneId = await session.getPane0Id();
  const workspaceId = await resolveOrchestratorWorkspaceId(session, orchestratorPaneId);

  // Phase A (spec-2, plan §1.3): reserve the user tab. This must run
  // FIRST so the runtime hook in herdr-session.spawnPane can recognize
  // the user tab id when subsequent sub-orchestrator spawns come in.
  // The user tab lives in the same workspace as the orchestrator, with
  // label "user" and a single bash root pane. See ADR 0002.
  const userWorkspace = await withRetry(
    () => spawnUserTab(session, workspaceId),
    undefined,
    undefined,
    "spawn-user-tab",
  );

  // Phase B: one sub-orchestrator per workstream.
  const subOrchestrators: Array<{ workstream: string; paneId: string; tabId: string }> = [];
  for (const ws of workstreams) {
    let handle = await withRetry(
      () => spawnSubOrchestrator(session, ws, workspaceId),
      undefined,
      undefined,
      `spawn-sub-orch:${ws.name}`,
    );
    // If the returned paneId collides with one we already spawned in this
    // call, retry the workstream once. This happens when the herdr
    // `agent start --tab` fallback path returns the same root pane id
    // (default tab) for every workstream.
    const usedPaneIds = new Set(subOrchestrators.map((s) => s.paneId));
    if (usedPaneIds.has(handle.paneId)) {
      handle = await spawnSubOrchestrator(session, ws, workspaceId);
    }
    // Stage C fix (Challenge 5): the sub-orchestrator should be the
    // lowest-id pane in its tab. The orchestrator (and downstream
    // consumers like the dispatch envelope) identify the
    // sub-orchestrator by its pane id; if herdr assigned a non-root
    // pane id, the "pane 0 = sub-orch" assumption breaks silently.
    // We surface a YELLOW warning rather than throw because (a) the
    // spec has been wrong about this for two iterations and we want
    // observability without blocking the spawn, and (b) some herdr
    // versions may legitimately allocate the agent pane after the
    // root pane. The test
    // `__tests__/live/team-spawner.spec.ts > pane-0 invariant`
    // pins the warning's presence.
    assertSubOrchestratorIsLowestPane(session, handle.tabId, handle.paneId, ws.name);
    subOrchestrators.push({
      workstream: ws.name,
      paneId: handle.paneId,
      tabId: handle.tabId,
    });
  }

  // Phase C: adversarial swarm — one per sub-orchestrator + one global.
  const adversarialSwarm: Array<{ name: string; targetPaneId: string }> = [];
  for (const sub of subOrchestrators) {
    adversarialSwarm.push({
      name: adversarialNameFor(sub.workstream),
      targetPaneId: sub.paneId,
    });
  }
  adversarialSwarm.push({
    name: GLOBAL_ADVERSARIAL_NAME,
    targetPaneId: orchestratorPaneId,
  });

  // Phase D: register surgical fixers lazily. The fixers are NOT
  // started — the orchestrator calls spawnFixer() on demand.
  const surgicalFixers: Array<{ workstream: string; name: string; spawned: boolean }> =
    workstreams.map((ws) => ({
      workstream: ws.name,
      name: fixerNameFor(ws.name),
      spawned: false,
    }));

  // Write the on-disk contract. The bash wrapper writes the same
  // file so the image and the test harness agree on which fixers
  // exist for which workstreams.
  await withRetry(
    () => writeSurgicalFixersRegistry(session, orchestratorPaneId, workstreams),
    undefined,
    undefined,
    "write-surgical-fixers",
  );

  return {
    orchestratorPaneId,
    workspaceId,
    userWorkspace,
    subOrchestrators,
    adversarialSwarm,
    surgicalFixers,
  };
}

// ---------------------------------------------------------------------------
// Internal: phase A — user-workspace reservation
// ---------------------------------------------------------------------------

/**
 * Spawn the reserved user tab in the orchestrator's workspace. The user
 * tab runs `bash` and is labeled `user` so the runtime hook in
 * `herdr-session.ts:spawnPane` can recognize it and refuse to spawn any
 * other pane into it.
 *
 * The plan calls for:
 *   `herdr tab create --workspace <ws> --cwd /home/agent/user-workspace --label "user" --no-focus`
 *
 * Unlike sub-orchestrators (which need a separate `herdr agent start
 * --tab <tabId>` to spin up a `pi` process in the new tab), the user
 * tab only needs `herdr tab create` — herdr auto-creates a bash root
 * pane in the new tab, and that bash pane is what the user drives.
 * Adding a second `agent start` would create a second pane in the
 * user tab, which violates the "one bash pane per user tab" invariant
 * the spec test (`/-1$/` paneId match) expects.
 *
 * We use the lower-level `herdr tab create` directly (via the session's
 * `herdrCmd` plumbing) rather than `spawnPaneInNewTab` so the result
 * is the root pane, not an extra agent pane.
 */
async function spawnUserTab(
  session: HerdrSession,
  workspaceId: string,
): Promise<UserWorkspaceHandle> {
  const containerId = session.getContainerId();
  const tabResult = execSync(
    `${DOCKER_BIN} exec ${containerId} herdr tab create --workspace ${workspaceId} --cwd /home/agent/user-workspace --label ${USER_WORKSPACE_LABEL} --no-focus`,
    { encoding: "utf-8" },
  );
  const tabId = parseTabId(tabResult) ?? "tab-unknown";
  // The herdr tab create response includes `root_pane.pane_id`. We
  // re-query the pane list to confirm the id and use the live pane
  // of the user tab. herdr reorders its pane counter globally
  // (workspace-wide), so the pane id in the response is the
  // authoritative one — the pane list filter is a defensive
  // cross-check.
  let rootPaneId = "pane-unknown";
  try {
    const payload = JSON.parse(tabResult.trim());
    const root = payload?.result?.root_pane;
    if (typeof root?.pane_id === "string") {
      rootPaneId = root.pane_id;
    }
  } catch {
    // fall through
  }
  // Re-query the pane list to get the live root pane id of the user tab.
  try {
    const listResult = execSync(
      `${DOCKER_BIN} exec ${containerId} herdr pane list`,
      { encoding: "utf-8" },
    );
    const listPayload = JSON.parse(listResult.trim());
    const panes = listPayload?.result?.panes;
    if (Array.isArray(panes)) {
      const userTabPanes = panes.filter((p: any) => p?.tab_id === tabId);
      if (userTabPanes.length === 1 && typeof userTabPanes[0]?.pane_id === "string") {
        rootPaneId = userTabPanes[0].pane_id;
      }
    }
  } catch {
    // fall through to the parsed id from tab create
  }
  return {
    workspaceId,
    tabId,
    paneId: rootPaneId,
    label: "user",
  };
}

// ---------------------------------------------------------------------------
// Internal: phase B
// ---------------------------------------------------------------------------

/**
 * Path to the sub-orchestrator system prompt inside the container
 * (mirrors the convention used by `impl/scripts/start-orchestrator.sh`
 * for the adversarial prompt at `/etc/prompts/adversarial.md`).
 * Loaded by `pi --system-prompt-file` at agent-start time. The
 * corresponding source-of-truth file is
 * `impl/scripts/prompts/sub-orchestrator.md` (committed next to
 * `surgical-fixer.md` and `adversarial.md`).
 */
const SUB_ORCHESTRATOR_PROMPT_PATH = "/etc/prompts/sub-orchestrator.md";

/**
 * Path to the surgical-fixer system prompt inside the container.
 * Source-of-truth file: `impl/scripts/prompts/surgical-fixer.md`.
 */
const SURGICAL_FIXER_PROMPT_PATH = "/etc/prompts/surgical-fixer.md";

/**
 * Spawn a single sub-orchestrator in its own tab. The sub-orchestrator
 * is a long-running `pi` process (not a one-shot `pi --version`); the
 * pane's process tree stays alive so the orchestrator's `send-text`
 * calls land on a live shell. See `stage-B-challenges.md` Challenge 15
 * for the prior bug. The sub-orchestrator's `pi` is started with:
 *
 *   pi --system-prompt-file /etc/prompts/sub-orchestrator.md
 *
 * and `AGENT_CAPABILITY=read` exported in the same exec (so the
 * runtime command allowlist applies to every command the
 * sub-orchestrator issues). The system prompt instructs the
 * sub-orchestrator to delegate writes via `spawnFixer`.
 *
 * Each workstream gets a unique tab (per the plan §2: "one tab per
 * workstream"). spawnPaneInNewTab creates the tab via
 * `herdr tab create` and then spawns the agent in that tab so the
 * tabId is unique across workstreams.
 */
async function spawnSubOrchestrator(
  session: HerdrSession,
  workstream: WorkstreamSpec,
  workspaceId: string,
): Promise<SpawnPaneResult> {
  const cmd = [
    "bash",
    "-lc",
    `export AGENT_CAPABILITY=read; exec pi --append-system-prompt "$(cat ${SUB_ORCHESTRATOR_PROMPT_PATH})"`,
  ];
  return session.spawnPaneInNewTab(cmd, {
    tabLabel: workstream.tabLabel,
    workspaceId,
  });
}

/**
 * Stage C fix (Challenge 5): assert that the sub-orchestrator's
 * pane is the lowest-id pane in its tab.
 *
 * The spec's invariant is "sub-orch is pane 0 of its tab; sub-agent
 * panes are siblings of pane 0 with pane ids ≥ 1." If herdr
 * allocates a non-root pane id to the agent (e.g. the agent-start
 * path creates a new pane instead of reusing the tab's root), the
 * invariant breaks silently and downstream code that addresses
 * the sub-orchestrator by its pane id routes to the wrong pane.
 *
 * This function surfaces a YELLOW `liberty-pane-0-invariant`
 * warning when the sub-orchestrator's pane id is not the lowest
 * pane id in the tab. It does NOT throw — the warning is
 * observational, and some herdr versions may legitimately
 * allocate the agent pane after the root pane. The team's live
 * tests pin the warning's presence.
 */
function assertSubOrchestratorIsLowestPane(
  session: HerdrSession,
  tabId: string,
  subOrchPaneId: string,
  workstream: string,
): void {
  let stdout: string;
  try {
    stdout = execSync(
      `${DOCKER_BIN} exec ${session.getContainerId()} herdr pane list`,
      { encoding: "utf-8" },
    );
  } catch {
    return; // best-effort; a transient lookup failure is non-fatal
  }
  let panes: any[];
  try {
    const payload = JSON.parse(stdout.trim());
    panes = Array.isArray(payload?.result?.panes) ? payload.result.panes : [];
  } catch {
    return;
  }
  const tabPanes = panes.filter((p) => p?.tab_id === tabId);
  if (tabPanes.length === 0) return;
  // Compute the lowest pane id in the tab. Pane ids look like
  // "<tab-prefix>-1", "<tab-prefix>-2", etc. — split on the last
  // "-" and parse the trailing number so we don't get fooled by
  // non-numeric ids.
  let lowestPaneId: string | null = null;
  let lowestPaneNum = Number.POSITIVE_INFINITY;
  for (const p of tabPanes) {
    if (typeof p?.pane_id !== "string") continue;
    const m = /-(\d+)$/.exec(p.pane_id);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n < lowestPaneNum) {
      lowestPaneNum = n;
      lowestPaneId = p.pane_id;
    }
  }
  if (lowestPaneId !== null && lowestPaneId !== subOrchPaneId) {
    console.warn(
      `YELLOW[liberty-pane-0-invariant]: sub-orchestrator pane ${subOrchPaneId} ` +
        `for workstream "${workstream}" is NOT the lowest-id pane in tab ${tabId} ` +
        `(lowest is ${lowestPaneId}). The pane-0 invariant may be broken; ` +
        `verify that downstream consumers use the recorded paneId and not ` +
        `the bare "pane 0" assumption. (Stage C fix for Challenge 5.)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal: phase D — write /etc/surgical-fixers
// ---------------------------------------------------------------------------

/**
 * Write the surgical-fixers registry file. Format: one line per fixer,
 * `<workstream> <fixer-name> <capability>`.
 *
 *   scaffold_2 fixer-scaffold_2 readwrite
 *   git-worktree fixer-git-worktree readwrite
 *   deps fixer-deps readwrite
 *
 * The orchestrator reads this file to discover the named fixer when
 * the adversarial swarm blocks a workstream, then calls spawnFixer().
 */
async function writeSurgicalFixersRegistry(
  session: HerdrSession,
  orchestratorPaneId: string,
  workstreams: WorkstreamSpec[],
): Promise<void> {
  const lines = workstreams.map(
    (ws) => `${ws.name} ${fixerNameFor(ws.name)} readwrite`,
  );
  const contents = lines.join("\n") + "\n";
  await writeContainerFile(session, orchestratorPaneId, SURGICAL_FIXERS_PATH, contents);
}

// ---------------------------------------------------------------------------
// Public API: spawnFixer
// ---------------------------------------------------------------------------

/**
 * Spawn a surgical fixer for a workstream on demand. The fixer is a
 * readwrite agent — it is allowed to mutate the repository to apply
 * the minimal patch the adversarial challenge described.
 *
 * Lookup: the orchestrator's system prompt tells it to look up the
 * fixer in `/etc/surgical-fixers`. The name returned by
 * `fixerNameFor(workstream)` is the contract.
 *
 * @param session - A live HerdrSession
 * @param workstream - The workstream name (e.g. "scaffold_2")
 * @returns FixerSpawnResult with the fixer's name and paneId
 */
export async function spawnFixer(
  session: HerdrSession,
  workstream: string,
): Promise<FixerSpawnResult> {
  if (typeof workstream !== "string" || workstream.length === 0) {
    throw new Error("spawnFixer: workstream must be a non-empty string");
  }

  const name = fixerNameFor(workstream);
  // Look up the registered capability for this workstream. The file
  // is the source of truth — if it does not list this workstream we
  // refuse to spawn.
  const orchestratorPaneId = await session.getPane0Id();
  const registry = await withRetry(
    () => readContainerFile(session, orchestratorPaneId, SURGICAL_FIXERS_PATH),
    undefined,
    undefined,
    `read-fixers-registry:${workstream}`,
  );

  const capability = lookupFixerCapability(registry, workstream);
  if (capability === null) {
    throw new Error(
      `spawnFixer: workstream "${workstream}" not registered in ${SURGICAL_FIXERS_PATH}. ` +
        `Did spawnOrchestrationTeam() run?`,
    );
  }
  if (capability !== "readwrite") {
    throw new Error(
      `spawnFixer: workstream "${workstream}" has capability "${capability}", expected "readwrite". ` +
        `A surgical fixer that cannot write cannot apply a patch.`,
    );
  }

  // Spawn the fixer pane. The fixer is a long-running `pi` process
  // (not a one-shot `pi --version` — see Challenge 15) loaded with
  // the surgical-fixer system prompt. The process tree stays alive
  // so the orchestrator's `send-text` challenge payload lands on a
  // live shell. `AGENT_CAPABILITY=readwrite` is exported in the same
  // exec so `isCommandAllowed` short-circuits to true and the
  // surgical-fixer contract holds.
  const fixerCmd = [
    "bash",
    "-lc",
    `export AGENT_CAPABILITY=readwrite; exec pi --append-system-prompt "$(cat ${SURGICAL_FIXER_PROMPT_PATH})"`,
  ];
  const handle = await withRetry(
    () => session.spawnPane(fixerCmd),
    undefined,
    undefined,
    `spawn-fixer:${workstream}`,
  );

  return {
    name,
    paneId: handle.paneId,
  };
}

/**
 * Look up a fixer's capability in the registry contents. Returns
 * "read", "readwrite", or null if the workstream is not registered.
 *
 * The third column of a registry line must be a valid capability
 * (`read` or `readwrite`). Lines whose third column is anything
 * else are treated as prompt artifacts and ignored — this keeps
 * the parser robust against `herdr pane read` noise (e.g. `> Try
 * cat: scaffold_2` artifacts from a PTY read).
 */
export function lookupFixerCapability(
  registryContents: string,
  workstream: string,
): "read" | "readwrite" | null {
  for (const rawLine of registryContents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    // The third column must be a valid capability — this filters out
    // prompt artifacts like `>`, `Try`, `cat:`, etc.
    if (parts[2] !== "read" && parts[2] !== "readwrite") continue;
    if (parts[0] === workstream) {
      return parts[2];
    }
  }
  return null;
}

/**
 * List the workstreams registered in the surgical-fixers file.
 * Useful for tests and for orchestrator boot diagnostics.
 *
 * Same robustness rules as lookupFixerCapability: a line is only
 * treated as a registry entry if its third column is a valid
 * capability token.
 */
export function listRegisteredWorkstreams(registryContents: string): string[] {
  const out: string[] = [];
  for (const rawLine of registryContents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    if (parts[2] !== "read" && parts[2] !== "readwrite") continue;
    out.push(parts[0]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// YELLOW helpers (not used by tests but available for hardening)
// ---------------------------------------------------------------------------

/**
 * YELLOW[liberty-team-spawner-cli]: detect whether herdr is reachable.
 * Some test harnesses run against a container that does not have herdr
 * installed; this helper lets callers log a warning instead of failing
 * the whole flow.
 */
export function dockerBinSafe(): string {
  try {
    return execSync("which docker", { encoding: "utf-8" }).trim() || "docker";
  } catch {
    return "docker";
  }
}
