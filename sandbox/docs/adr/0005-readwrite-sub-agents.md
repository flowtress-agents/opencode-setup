# Read-write sub-agents are unconstrained by the runtime command allowlist

> **Status:** Accepted (spec-2). Pins the "write-priv sub-agent" capability
> class. The runtime `READ_ONLY_COMMAND_RE` in
> `impl/pty/herdr-session.ts` is consulted only when
> `agentCapability === "read"`. When a sub-agent declares
> `capability: "readwrite"`, `isCommandAllowed` returns `true` immediately
> and the command is forwarded to the pane without an allowlist check.

A sub-agent with `capability: "readwrite"` may run **any** command:
`git commit`, `npm install`, `rm -rf`, `apt-get install`. The protection
against a malicious or buggy write-priv sub-agent is **not** enforced by
the spec-2 runtime; it is the user's responsibility, deferred to
**spec-3** (OS-UID separation, separate containers per capability tier).
The trade-off this picks: a surgical-fixer sub-agent dispatched by the
orchestrator to resolve an adversarial `block` challenge can apply the
patch (write) — the only way the spec stays consistent with the existing
adversarial+fixer protocol. Without this, every surgical patch would
have to round-trip through the read-only orchestrator, which would
itself be blocked by the `READ_ONLY_COMMAND_RE` gate. Sub-orchestrators
(their own `capability: "read"`) remain constrained: they delegate
writes by spawning readwrite sub-agents, never by writing themselves.

> **Stage C fix (Challenge 4) — the audit log is universal, the
> bypass is at the COMMAND EXECUTION layer only.** The `auditLog`
> function in `impl/pty/herdr-session.ts:43-53` records every
> command — including readwrite — to `/tmp/agent-<id>.audit` with
> `capability=<resolved-tier>` and `cmd="<full command line>"`.
> This is **intentional** and not noise: the audit log is an
> audit, not a gate. The readwrite bypass applies to whether
> `isCommandAllowed` consults the allowlist (it does not for
> readwrite), not to whether the command is recorded. Concretely:
>
> - `read` capability + allowlisted command: command runs,
>   audit-logged with `capability=read`.
> - `read` capability + non-allowlisted command: command rejected,
>   `runInPane` returns `exitCode=1` with the rejection message
>   as stderr. The audit log does **not** record the rejected
>   command (the gate fires before the audit; the call is a
>   `return`, not a log entry).
> - `readwrite` capability + any command: `isCommandAllowed`
>   short-circuits to `true`; command runs; audit-logged with
>   `capability=readwrite`.
>
> The two layers are deliberately independent. A post-hoc auditor
> (or the orchestrator's adversarial swarm) can replay the
> `/tmp/agent-<id>.audit` file and see exactly what the sub-agent
> did, including writes. The audit log is the spec-2 answer to
> "how do we know what a write-priv sub-agent did while the
> runtime was looking the other way?" — it records, it does not
> gate.
