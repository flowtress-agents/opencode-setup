# Launch sandbox as data

The launch-sandbox.zsh script (v0.1.0) encoded build context, install
steps, UID handling, and health checks as imperative shell. Debugging
that script surfaced three classes of bug — wrong Dockerfile form, missing
tool installs, base-image UID collisions — that were only discoverable by
running the script end-to-end. v0.2.0 moves the launcher contract to
`scripts/launch-sandbox.toml` so the zsh launcher becomes a thin loader
over a testable spec, mirroring the spec/test/impl split already used for
the runtime.
