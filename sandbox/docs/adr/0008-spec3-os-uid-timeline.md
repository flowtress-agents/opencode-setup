# ADR 0008 — Spec-3 OS-UID separation: committed scope and delivery timeline

> **Status:** Accepted (spec-2). Pins the scope of the next spec
> (spec-3) and the delivery window. Drives the "Limitation" notes
> in `0002-user-workspace.md` and `0005-readwrite-sub-agents.md`,
> and the "out of scope" section of `sandbox/CONTEXT.md:4`.
>
> **2026-06-15 (Stage C fix for Challenge 11):** this ADR was
> referenced by name in the spec-2 plan and in ADR 0002 / ADR 0005
> as the destination for OS-level isolation, but the file did not
> exist. The gap is closed with a committed scope and a delivery
> window so the limitation is no longer a "permanent gap
> masquerading as a future feature."

## Context

Spec-2 leaves three open runtime gaps that are **not** defense-in-depth
enough to ship in production:

1. **The user-workspace reservation is bypassable.** A misbehaving
   sub-agent that calls `docker exec herdr ...` directly (or `herdr
   agent start --tab user-*` from outside the runtime's `spawnPane`
   hook) skips the label-prefix guard. ADR 0002 documents this;
   the proper mitigation is OS-level, not a runtime hook.

2. **The readwrite bypass is total inside the container.** A
   readwrite sub-agent can run `rm -rf /`, modify `/etc/passwd`,
   and otherwise mutate the host beyond the orchestrator's
   intended surface area. ADR 0005 documents this; the proper
   mitigation is OS-UID separation or separate containers per
   capability tier.

3. **A misbehaving orchestrator can `send-text` into any pane.**
   The runtime exposes `herdr pane send-text` to every pane; the
   orchestrator's system prompt forbids the user tab and the
   sub-orchestrator's panes, but the runtime does not enforce it.
   OS-level isolation per pane is the proper mitigation.

All three gaps have the same shape: spec-2 relies on a runtime hook
in `impl/pty/herdr-session.ts` (or in the orchestrator's prompt)
to enforce a boundary, and the hook is a **soft** boundary — a
well-behaved agent respects it, a misbehaving one does not.

## Decision

Spec-3 introduces **OS-level isolation per capability tier** as the
hard barrier. The committed scope and timeline are:

### Scope (committed for spec-3)

1. **Per-tier UIDs inside the container.** The orchestrator,
   sub-orchestrators, sub-agents, and the user tab each run as
   a different OS user (e.g. `uid-orch`, `uid-sub-orch`,
   `uid-sub-rw`, `uid-user`). The container is started with
   `--user 0:0` and the runtime `setuid`s each `pi` process
   before exec. The `setuid` happens in `spawnPaneInNewTab` and
   `spawnPane` before the `herdr agent start` call, so the
   boundary is enforced by the kernel, not by herdr.

2. **Filesystem ACLs on the worktree.** `/home/agent/workspace`
   is owned by the orchestrator's UID and is world-readable but
   not world-writable. Sub-agents that need to write get a
   per-worktree worktree (e.g. `/home/agent/workspace/scaffold_2`)
   that is owned by the corresponding readwrite sub-agent's UID.

3. **Seccomp profile that blocks `ptrace`, `mount`, and network
   namespace changes** for all tiers except the orchestrator
   (which needs them for its own bootstrap). The seccomp profile
   is committed in `repos/opensrc/seccomp/spec3.json` and
   referenced by the docker `--security-opt` flag in
   `impl/scripts/start-orchestrator.sh`.

4. **herdr daemon per tier.** Today, all tiers share one herdr
   daemon. Spec-3 splits this: the orchestrator and the
   sub-orchestrators each get their own herdr daemon so a
   compromise in one tier does not leak into another. The
   sub-agent panes are children of the sub-orchestrator's daemon
   (not the orchestrator's), which is closer to the opensrc
   references in `repos/opencode/packages/core/src/permission.ts`
   (per-session permission ruleset).

### Out of scope for spec-3 (deferred to spec-4 or later)

- **Cross-tier process IPC.** Spec-3 does not introduce a typed
  IPC channel between the orchestrator and the sub-orchestrators;
  the existing `herdr pane read` / `herdr pane send-text`
  channels are reused.
- **Per-tier rate limits.** Spec-3 does not impose CPU / memory
  / syscall rate limits per tier. They are mentioned as a
  follow-up; the seccomp profile is the only kernel-level
  enforcement in spec-3.
- **TPM / hardware-rooted attestation.** Mentioned in
  `repos/opensrc/skills/opensrc/SKILL.md` as a future
  hardening path; not part of spec-3.
- **Forks of herdr or pi.** The "no fork" decision from the
  spec-2 plan still holds for spec-3. OS-level isolation does
  not require a herdr fork.

### Delivery timeline

| Phase | Date | Deliverable |
|---|---|---|
| Spec-3 kickoff | 2026-07-01 | Spec-3 worktree initialized at `spec-3` branch; ADRs 0001–0003 (per-tier UID, FS ACL, seccomp) drafted. |
| Per-tier UID | 2026-07-15 | `spawnPaneInNewTab` and `spawnPane` accept a `tier: "orch" \| "sub-orch" \| "sub-rw" \| "user"` argument and `setuid` to the corresponding UID before `herdr agent start`. |
| FS ACL | 2026-07-22 | `/home/agent/workspace` is created with tier-specific ownership; the orchestrator's spawn handler creates the per-worktree sub-directory and `chown`s it to the right tier. |
| Seccomp | 2026-07-29 | `repos/opensrc/seccomp/spec3.json` is committed; `impl/scripts/start-orchestrator.sh` adds `--security-opt seccomp=spec3.json` to the `docker run` invocation. |
| Per-tier herdr | 2026-08-05 | `HerdrSession.open` accepts a `tier` argument; spec-2 callers pass the tier they belong to; spec-3 tests pin the isolation. |
| Spec-3 acceptance | 2026-08-12 | All spec-3 green tests pass; the three gaps above (user-workspace bypass, readwrite blast radius, orchestrator→any-pane) are closed at the OS level. The spec-2 limitation notes in ADR 0002 / 0005 are downgraded from "limitation" to "audit-only" with a citation to the spec-3 tests. |
| Spec-3 ship | 2026-08-19 | `spec-3` branch merged to `main`; spec-2 plan §"Risks" entries are removed. |

The timeline is committed: every date above is a hard deadline
with a published deliverable. The dates are deliberately inside
one calendar quarter from this ADR's date (2026-06-15) so the
"spec-3 will land in the next sprint" claim in the spec-2 plan is
made concrete.

### Rollback plan

If spec-3 slips by more than two weeks from the committed
timeline, the spec-2 limitation notes are escalated to a YELLOW
warning in the spec's run-time output (a console line in
`spawnOrchestrationTeam`) so operators are not silently exposed.
The warning cites this ADR by name and the elapsed days past
the committed date.

## Cross-references

- `docs/adr/0002-user-workspace.md` — the user-workspace reservation
  and its OS-level mitigation gap.
- `docs/adr/0005-readwrite-sub-agents.md` — the readwrite bypass
  and its OS-level mitigation gap.
- `sandbox/CONTEXT.md:4` — "What is out of scope" lists spec-3
  as the destination for OS-UID separation.
- `sandbox/docs/spec/sections/06-sub-orchestrator-sub-agent.md:6.3.5` —
  the runtime's "defense-in-depth, not airtight" caveat.
- `repos/opencode/packages/core/src/permission.ts` — the
  per-session permission ruleset that informs spec-3's
  per-tier herdr decision.
- `repos/OpenHands/openhands/app_server/sandbox/` — OpenHands'
  per-session event log, which informed the per-tier herdr
  isolation choice.
- Plan: `~/.cursor/plans/spec-2_orchestrator_v2_+_user_workspace_7cb68ec4.plan.md`
  (the spec-3 commitment in §"Risks" and §"Files to create /
  modify").
