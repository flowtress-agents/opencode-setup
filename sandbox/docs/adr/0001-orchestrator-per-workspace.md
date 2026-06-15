# Orchestrator per workspace, sub-orchestrators in additional tabs

> **Status:** Accepted (spec-2). Drives `impl/orchestration/orchestrator-session.ts`
> and `impl/orchestration/team-spawner.ts:spawnSubOrchestrator`.

Every orchestrator workspace has exactly one orchestrator, in pane 0 of the
workspace's first tab. Sub-orchestrators live in **additional tabs of the
same workspace**, never in panes of the orchestrator's tab. The trade-off
this picks: we give up a small amount of cross-workstream sharing in
exchange for the same isolation property the user already sees on the
TUI — one tab per workstream, one buffer per workstream, one pane-id
namespace per workstream. OpenHands' per-session workspace model
(`repos/OpenHands/containers/app/Dockerfile:WORKSPACE_BASE`) and opencode's
per-session permission ruleset (`repos/opencode/packages/core/src/permission/schema.ts`)
both confirm that the session/workspace is the right isolation unit;
we keep that property and use tabs as the next-finer boundary inside it.
