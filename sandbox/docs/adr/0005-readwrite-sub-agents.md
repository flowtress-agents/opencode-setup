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
