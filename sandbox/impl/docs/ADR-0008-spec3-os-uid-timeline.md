# ADR-0008: Spec-3 OS-UID separation — committed scope and delivery timeline

> **Date:** 2026-06-15
> **Status:** Accepted (test worktree mirror)
> **Mirrors:** `spec-2/sandbox/docs/adr/0008-spec3-os-uid-timeline.md`
>
> This ADR is the test worktree mirror of the spec-2 ADR-0008. It
> pins the spec-3 OS-level isolation work that closes the three
> spec-2 gaps (user-workspace bypass, readwrite blast radius,
> orchestrator→any-pane). The committed timeline, scope, and
> rollback plan live in the spec-2 ADR; this file is a
> pointer that lets readers of the test worktree find the
> spec-side commitment without traversing the spec-2 worktree.

## Why this ADR exists in the test worktree

The spec-2 plan (`/Users/lab/.cursor/plans/spec-2_orchestrator_v2_+_user_workspace_7cb68ec4.plan.md`)
listed this ADR under "Files to create / modify" in §"Files to
create / modify" and referenced it from the "Risks" section. Stage
C of the loop (the surgical fixer team) created the spec-2 ADR
in the spec-2 worktree; this file mirrors that decision in the
test worktree so:

1. Test-worktree readers who hit a "spec-3 is the mitigation"
   note in `ADR-0002-user-workspace.md`, `ADR-0005-readwrite-sub-agents.md`,
   or in the spec fixtures can trace the commitment to a real
   document.
2. The spec-3 work, when it lands, has a one-stop reference for
   what the test worktree's existing limitations are
   transitioning *from* and *to*.

## Committed scope (one-paragraph summary)

Per-tier UIDs inside the container (orchestrator, sub-orchestrators,
readwrite sub-agents, user tab each get a separate OS user),
filesystem ACLs on the worktree (per-worktree ownership by tier),
seccomp profile blocking `ptrace` / `mount` / `network namespace`
changes for non-orchestrator tiers, and per-tier herdr daemons (one
per orchestrator and one per sub-orchestrator) so a compromise in
one tier does not leak into another. Cross-tier IPC reuses
`herdr pane read` / `herdr pane send-text`; no fork of herdr or pi;
no per-tier rate limits (deferred to spec-4); no TPM / hardware
attestation (also deferred).

## Delivery timeline (committed)

| Phase | Date | Deliverable |
|---|---|---|
| Spec-3 kickoff | 2026-07-01 | `spec-3` branch initialized; ADRs 0001–0003 (UID, FS ACL, seccomp) drafted. |
| Per-tier UID | 2026-07-15 | `spawnPaneInNewTab` / `spawnPane` accept a `tier` argument and `setuid` before `herdr agent start`. |
| FS ACL | 2026-07-22 | `/home/agent/workspace` is created with tier-specific ownership. |
| Seccomp | 2026-07-29 | `repos/opensrc/seccomp/spec3.json` committed; `start-orchestrator.sh` adds `--security-opt`. |
| Per-tier herdr | 2026-08-05 | `HerdrSession.open` accepts a `tier` argument. |
| Spec-3 acceptance | 2026-08-12 | All spec-3 green tests pass. |
| Spec-3 ship | 2026-08-19 | `spec-3` merged to `main`; spec-2 limitation notes downgraded. |

The dates are deliberately inside one calendar quarter from
2026-06-15 so the "spec-3 will land in the next sprint" claim
in the spec-2 plan is concrete. If spec-3 slips by more than two
weeks, a YELLOW warning is emitted at `spawnOrchestrationTeam`
runtime citing this ADR by name.

## Cross-references

- `spec-2/sandbox/docs/adr/0008-spec3-os-uid-timeline.md` — the
  canonical version of this ADR (full prose; this file is a
  mirror).
- `docs/adr/ADR-0002-user-workspace.md` (this worktree) — the
  user-workspace reservation and the gap this ADR commits to
  closing.
- `docs/adr/ADR-0005-readwrite-sub-agents.md` (this worktree,
  planned for spec-3) — the readwrite bypass and the gap this
  ADR commits to closing.
- `repos/opencode/packages/core/src/permission.ts` — per-session
  permission ruleset, informing the per-tier herdr decision.
- `repos/OpenHands/openhands/app_server/sandbox/` — OpenHands'
  per-session event log, informing the same decision.
