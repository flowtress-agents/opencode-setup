# Dedicated user workspace + user tab (runtime reservation, no herdr fork)

> **Status:** Accepted (spec-2). Drives `fixtures/sandbox-spec/src/user-workspace.ts`,
> `impl/orchestration/team-spawner.ts` (user tab creation), and the
> `spawnPane` runtime hook in `impl/pty/herdr-session.ts` (label-prefix
> rejection).

Every orchestrator workspace is paired with a dedicated user workspace that
contains a single `user` tab running bash. No sub-orchestrator is ever
spawned into that tab — the orchestrator's system prompt forbids it and
the runtime `spawnPane` hook refuses any `herdr agent start --tab user-*`
call with an `Error`. We deliberately do not introduce a herdr fork for
this; the reservation is a runtime-layer concern. **Limitation:** a
misbehaving sub-agent can call `docker exec herdr ...` directly and bypass
the runtime hook, so this is defense-in-depth, not an airtight barrier;
the proper OS-level mitigation (separate UIDs or containers per
capability tier) is tracked in spec-3.
