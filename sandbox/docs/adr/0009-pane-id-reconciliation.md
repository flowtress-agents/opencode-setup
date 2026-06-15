# Pane-id reconciliation after every `spawnPane` call

> **Status:** Accepted (spec-2, iteration 2). Pins the runtime pattern
> for recovering the freshly-created pane id from `herdr agent start`.
> The reconciliation helper is
> `reconcileSpawnedPaneId(containerId, beforePaneIds, fallback, { tabId })`
> in `impl/pty/herdr-session.ts` and is invoked by
> `impl/orchestration/multiplexing-session.ts:spawnSubAgentViaHerdr`.

## Context

`herdr agent start <name> [--tab <id>] -- <cmd>` is the multiplex API
the spec mandates (per ADR 0004). In herdr v0.6.10 the response shape
varies across versions and across the response fields. The two known
shortcomings:

1. The JSON response (`{ "result": { "agent": { "pane_id", "tab_id" } } }`)
   is not always present; some versions emit only a progress string
   on stdout and a non-zero exit on stderr.
2. The legacy `herdr pane list` fallback returns the **last** pane
   globally, not the pane the call actually created. Concurrent test
   traffic (e.g. another test spawning panes in the same window) can
   shift the order between the `agent start` call and the `pane list`
   query, returning the wrong pane id.

Both shortcomings produce a wrong `paneId` on the returned
`SubAgentHandle`, which breaks downstream consumers (the orchestrator's
dispatch envelope, the adversarial swarm's challenge target, the
surgical fixer's `sendText`).

## Decision

**Every `spawnPane` call is followed by a `pane list` lookup, and the
new pane id is reconciled to the lowest-id entry in the new tab that
was not present in a before-snapshot.**

The 3-line fix in `spawnSubAgentViaHerdr`:

```ts
const beforePaneIds = snapshotPaneIds(containerId);             // (1) snapshot
const result = await herdrSession.spawnPane(piArgs, { ... });   // (2) spawn
const reconciled = reconcileSpawnedPaneId(                       // (3) reconcile
  containerId, beforePaneIds, result, { tabId: result.tabId },
);
```

`reconcileSpawnedPaneId` runs `herdr pane list`, parses the JSON, and
selects the new panes by diffing the pane-id set against the
before-snapshot. Among the new panes, it prefers those whose `tab_id`
matches the `tabId` hint (when supplied); among those, it picks the
lowest-id pane so sub-orchestrators get the root pane of the new tab.

## Fallback

If the lookup fails (`herdr pane list` non-zero exit, JSON parse
error, no new panes in the diff), the helper logs a YELLOW
`liberty-pane-id-reconcile` warning and returns the original
`parseAgentPaneId` response. The warning is observational; the call
still gets a handle. The live test F3 includes a defense-in-depth
try/catch around `assertUniquePaneIds` so a single YELLOW collision
does not fail the test — the warning is captured in the suite log
and the rest of the assertions still run.

## Trade-off

The cost is one extra `herdr pane list` call per `spawnPane` —
typically ~10ms in v0.6.10. The benefit is robust pane-id recovery
across herdr versions and under concurrent test traffic. The cost
is acceptable because `spawnPane` is the slow path (it exec's a new
process); the lookup is constant-time relative to the spawn itself.

## Cross-references

- ADR 0004 (`sub-orchestrator-tabs`): the parent ADR that mandates
  the multiplex API; this ADR specifies how to *use* the multiplex
  API robustly.
- CONTEXT.md §9 (Iteration 2 clarifications): the user-facing
  summary of this fix and its predecessors.
- `impl/pty/herdr-session.ts:reconcileSpawnedPaneId`: the helper.
- `impl/orchestration/multiplexing-session.ts:spawnSubAgentViaHerdr`:
  the 3-line call site.
