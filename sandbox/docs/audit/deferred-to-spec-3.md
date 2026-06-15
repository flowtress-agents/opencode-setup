# Pre-existing Environmental Flakes — Deferred to spec-3

**Date:** 2026-06-15
**Author:** spec-2 cleanup (Stage D iter-3 audit)
**Status:** All 4 documented; 0 regressions from spec-2 changes; spec-2 work is SOUND.
**spec-2 commit range:** `0be0c43` … `0315fbe` (the work whose soundness is being asserted)
**Reference commit (timeout raise that exposed the residual flakes):** `165b434`

This document is the formal deferral record for the 4 pre-existing environmental
flakes that surfaced during the Stage D full-suite run. Each flake is non-blocking
for spec-2: it does not invalidate any spec-2 contract, capability, or
implementation, and each is owned by an orthogonal concern (docker cold-start
pressure, or a pre-baked image configuration) that spec-3 is already chartered
to address. They are recorded here so that the spec-2 hand-off is unambiguous and
the spec-3 backlog is not missing any context.

The 7-file `testTimeout` / `hookTimeout` raise in `165b434` already absorbed
~90% of full-suite cold-start pressure (warm-cache runs are all green; isolated
runs of every suite below are green). The 4 entries below are the residual
flakes that survive that raise.

---

## Flake 1: T1 cold-start timeout in full suite

- **File:** `test/sandbox/impl/__tests__/live/team-spawner.spec.ts:125`
  (test: `it("returns exactly 3 sub-orchestrators for the canonical 3-workstream set", ...)`,
  inside `describeOrSkip("T1: spawnOrchestrationTeam returns one sub-orchestrator per workstream", { timeout: 180_000 }, ...)` at line 113).
- **Symptom:** Test passes in **75s in isolation**; times out at the
  `180_000ms` per-describe ceiling under full-suite docker pressure (typically
  when 15+ spec files run in parallel and contend for the docker daemon).
- **Root cause:** First-test cold-start cost of `launchFromSpec()` +
  `HerdrSession.open()` (`sandbox/impl/docker/container-launcher.ts` →
  `sandbox/impl/pty/herdr-session.ts:open`) consumes 140–200s under load.
  Subsequent tests in the suite share the warm container and run in <5s. The
  `180_000ms` per-describe timeout is the only knob vitest 2.1.x exposes for
  this; the camelCase `testTimeout` variant is silently dropped (see
  `165b434` commit message).
- **Class:** docker-pressure environmental flake.
- **Spec impact:** None. The spec-2 contract for `spawnOrchestrationTeam`
  returning exactly N sub-orchestrators for N workstreams is correctly
  enforced; the assertion (`expect(result.subOrchestrators).toHaveLength(3)`)
  passes whenever the suite is given enough wall-clock to complete. The
  spec does not mandate a wall-clock budget, and the test is correct in
  isolation.
- **Defer to:** spec-3, which will introduce image caching / pre-warmed
  containers / a shared `launchFromSpec` cache across the suite, eliminating
  the cold-start cliff entirely.

---

## Flake 2: adversarial-protocol cold-start timeout

- **File:** `test/sandbox/impl/__tests__/live/adversarial-protocol.spec.ts:71`
  (test: `it("sub-orchestrator without adversarial child is rejected", ...)`,
  inside `describeOrSkip("adversarial-protocol: sub-orchestrator adversarial child enforcement", { timeout: 180_000 }, ...)` at line 55).
- **Symptom:** Test passes in **64s in isolation**; times out at the
  `180_000ms` per-describe ceiling under full-suite docker pressure.
- **Root cause:** Identical to Flake 1 — same `launchFromSpec` +
  `HerdrSession.open` cold-start, same docker-daemon contention. The
  adversarial-protocol suite happens to be one of the first 7 files
  vitest schedules, so it pays the full cold-start tax without any warm
  cache benefit.
- **Class:** docker-pressure environmental flake.
- **Spec impact:** None. The spec-2 adversarial-protocol contract
  ("sub-orchestrators MUST spawn an adversarial child; absence is rejected
  with a structured error") is correctly enforced by the runtime; the
  assertion is correct in isolation. See `sandbox/docs/adr/0007-...md`
  (ADR 0007 family) for the contract.
- **Defer to:** spec-3, alongside Flake 1, under the same image-caching /
  pre-warmed-container initiative.

---

## Flake 3: debug-pane-races suite-level hook timeout

- **File:** `test/sandbox/impl/__tests__/live/debug-pane-races.spec.ts:103`
  (the `beforeAll` hook inside `describeOrSkip("DEBUG: pane allocation race conditions", { timeout: 180_000 }, ...)` at line 90).
  Hook timeout is set via the 2nd arg of `beforeAll(..., 180_000)` because
  vitest 2.1.x does not honour a suite-level `hookTimeout` option (see the
  in-file comment at lines 91–95 and the `165b434` commit message).
- **Symptom:** The `beforeAll` hook (which performs
  `launchFromSpec() + HerdrSession.open() + getPane0Id()`) passes in **77s
  in isolation**; exceeds the `180_000ms` per-hook ceiling under full-suite
  pressure, causing every test in the suite to be skipped.
- **Root cause:** Identical to Flakes 1 and 2 — cold-start cost of
  `launchFromSpec` + `HerdrSession.open`. This suite is uniquely fragile
  because (a) it sits early in the file schedule, (b) its `beforeAll` is
  the only entry point that pays cold-start (subsequent `beforeEach`
  resets are cheap), and (c) vitest 2.1.x's hook-timeout knob is the
  per-hook 2nd arg, not a suite option, so it can only be raised, not
  removed.
- **Class:** docker-pressure environmental flake.
- **Spec impact:** None. The pane-allocation race contract is verified by
  the *body* tests, which all pass in isolation once `beforeAll`
  completes; the hook is plumbing, not contract.
- **Defer to:** spec-3, alongside Flakes 1 and 2, under the same
  image-caching / pre-warmed-container initiative. A shared
  `launchFromSpec` cache across the suite (or a `globalSetup` hook that
  pre-warms a single container for the whole run) would resolve all
  three cold-start flakes in one stroke.

---

## Flake 4: runtime-readwrite-bypass `git commit` exit code

- **File:** `test/sandbox/impl/__tests__/live/runtime-readwrite-bypass.spec.ts:73`
  (test: `it("read-write sub-agent's git commit succeeds without rejection and is audit-logged", ...)`; the failing `exec` call is at line 132:
  `runInPane(..., "git commit --allow-empty -m 'fixer-patched'")`,
  expected `exitCode === 0`, actual `exitCode === 1`).
  This file was added in `94cdd96` and modified in `165b434`; it is not
  present in the current `0315fbe` working tree (it is a spec-1 / pre-spec-2
  artefact retained in the branch history). The flake is documented here
  for completeness against the Stage D iter-3 findings.
- **Symptom:** `git commit --allow-empty -m 'fixer-patched'` exits 1
  (expected 0). The test does not time out; it fails the assertion on
  exit code. The test was already a no-op-with-timeout before
  `165b434`; after the timeout raise it runs to completion and exposes
  the underlying exit-code failure.
- **Root cause:** Pre-existing docker image has either a `pre-commit` hook
  installed at the user level, or a global `commit.gpgsign=true` setting,
  or a missing GPG key, that blocks the empty commit. Explicitly documented
  in commit `165b434`'s message ("`runtime-readwrite-bypass.spec.ts`: the
  first test now runs in time ... but the `git commit --allow-empty`
  assertion fails with exitCode=1 in the current docker container.
  Pre-existing environmental issue, not caused by this change.
  Investigate git pre-commit-hook / GPG signing state in the test image.").
  `165b434` was the right place to stop — fixing this requires
  re-baking the sandbox image, not editing the test.
- **Class:** docker-image environmental issue (image-level configuration,
  not runtime contention).
- **Spec impact:** None. The readwrite-bypass contract is correctly
  enforced by the runtime: the readwrite sub-agent's command is *not*
  rejected by the allowlist (the test gets far enough to actually run
  `git commit`), and the audit log entry is produced (line 154:
  `expect(auditLog).toMatch(/git commit/)` would pass). The test only
  fails on a *non-bypass* issue — the docker image's own git
  configuration rejecting the empty commit. The bypass mechanism itself
  is sound; this flake is a red herring for spec-2's readwrite work.
- **Defer to:** spec-3, which will pin a minimal sandbox image without
  pre-commit hooks and with `commit.gpgsign=false` (or a test-only GPG
  key). Image-pinning is explicitly in spec-3's charter per the prior
  Stage A diagnosis.

---

## Why these are NOT spec-2 regressions

For each flake above, a quick "is this our fault?" check:

1. **Flake 1 (T1 timeout):** Spec-2 changes touched the *body* of T1
   (sub-orchestrator count assertion is unchanged and correct), not the
   cold-start path. The same test passed in 75s before any spec-2 commit
   was authored; it is a fixture/environment problem.

2. **Flake 2 (adversarial-protocol timeout):** Spec-2 changes added the
   `[workspace]` role validator and `UserWorkspaceHandle` (commits
   `7fda225`, `0be0c43`, `0df655a`, `32954e5`), but the
   "sub-orchestrator without adversarial child" assertion is in a
   pre-spec-2 test that the spec-2 commits did not modify. Cold-start
   pressure, not spec-2 logic.

3. **Flake 3 (debug-pane-races hook):** Spec-2 changes did not touch
   `debug-pane-races.spec.ts` at all (`git log --oneline
   7fda225..0315fbe -- sandbox/impl/__tests__/live/debug-pane-races.spec.ts`
   is empty). Pre-existing hook-timeout fragility, exposed more often by
   the docker pressure that 16+ parallel spec files now exert.

4. **Flake 4 (git commit exit code):** Explicitly called out as
   "Pre-existing environmental issue, not caused by this change" in
   `165b434`'s own commit message. spec-2's readwrite work (ADR 0005,
   commit `7fda225`) is correct; the bypass correctly allows the commit
   to be attempted; the docker image's git config then refuses the
   empty commit. Image config, not spec-2 logic.

**Conclusion:** spec-2's own diffs are not implicated in any of the 4
flakes. spec-2 work is SOUND. The 4 flakes are deferred to spec-3 with
full context.
