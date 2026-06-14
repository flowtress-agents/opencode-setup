# Lessons Learned: Live Orchestration Testing

## What Broke

### smol-toml: `parseToml` vs `parse`
The smol-toml library exports `parse` as its default export, not `parseToml`. The spec and tests assumed `parseToml` was available. Always verify named vs default exports before assuming API shape.

**Fix**: Use `import { parse } from 'smol-toml'` and call `parse(content)`.

### node-pty: Native Bindings on macOS ARM64
node-pty requires platform-specific native bindings. On macOS ARM64 (Apple Silicon), the module must be rebuilt or prebuilt binaries must match the exact Electron/Node version. Installation often fails silently or produces a module that fails to load at runtime.

**Fix**: Use `PTY_FALLBACK=1` environment variable to skip node-pty and use the docker-exec fallback.

### herdr CLI: Pane API Misalignment
The spec assumed `herdr pane spawn <cmd>` would create new panes. The actual API is `herdr agent start <name> -- <cmd>`, which spawns a named agent in a new pane. These are semantically different operations.

**Fix**: Use `herdr agent start <agent-name> -- <cmd>` to create panes programmatically.

### execSync: 3-Argument Form Not Supported
`child_process.execSync` does not accept a 3-argument form like `execSync(cmd, args, opts)`. The command and arguments must be joined into a single string.

**Fix**: Use `execSync(cmd.join(" "), opts)` or `spawnSync(cmd[0], cmd.slice(1), opts)`.

---

## What Was Harder Than Expected

### node-pty Installation Requiring Platform-Specific Handling
Rebuilding node-pty for Electron's version of Node is non-trivial. The module must match the exact Node version and architecture. On macOS ARM64, finding a prebuilt binary that works with the current Electron version is trial-and-error.

**Workaround**: Implement a docker-exec fallback from the start rather than treating it as a secondary path.

### Docker Daemon Availability Checking
Tests must verify Docker is running before attempting any live tests. `docker info` returns a non-zero exit code when the daemon is unavailable, but the error message varies across platforms.

**Workaround**: Always check `docker info` as a precondition and skip live tests gracefully when Docker is unavailable.

### PTY Fallback Strategy When Native Bindings Fail
When node-pty fails to load, the fallback using `docker exec -i -t` still requires a running container with a proper shell. The fallback is not a no-op — it requires the container to be running and the container image to include a shell.

**Workaround**: Ensure the container launcher starts containers with a shell (`/bin/bash` or `/bin/sh`) and keeps them running in the background.

### Parsing herdr Pane List Output
`herdr pane list` outputs a line-based text format, not JSON. Parsing requires handling pane IDs, names, and states without structured data. Pane IDs are per-session, not global.

**Workaround**: Use regex or line-splitting to extract pane metadata. Always trim whitespace from pane IDs.

---

## What herdr's Pane API Actually Looks Like

### Spec Assumed
- `herdr pane spawn <cmd>` creates a new pane running `<cmd>`
- Panes are created explicitly via subcommand

### Actual API
- `herdr agent start <name> -- <cmd>` spawns a named agent in a new pane
- Pane 0 is auto-created at startup (not explicitly spawned)
- `herdr pane split` splits an existing pane — it does not create a new pane from scratch
- `herdr pane run <pane-id> <cmd>` executes a command in an existing pane
- `herdr pane send-text <pane-id> <text>` sends text to an interactive pane

### Key Behavioral Notes
- Pane IDs are session-scoped. They cannot be assumed stable across sessions.
- Pane 0 (the orchestrator pane) is special: it cannot be renamed or closed.
- Pane creation via `agent start` is asynchronous — the pane may not be immediately ready.

---

## Key Decisions Made

### PTY Fallback Using docker-exec
When node-pty is unavailable, use `docker exec -i -t <container> <shell> -c <cmd>` to simulate a PTY. This requires the container to have a shell and be running.

### Tempfile Strategy for Docker Build Context
Per the TOML spec, Docker build contexts are passed via a temporary directory. Create a temp directory, write the Dockerfile and any context files there, and clean up after the build.

### herdr Pane Run vs. send-text
Use `herdr pane run <pane-id> <cmd>` for non-interactive command execution. Use `herdr pane send-text` only for interactive input to existing panes (e.g., REPLs, shells).

---

## Advice for Future Maintainers

1. **Always check `docker info` before running live tests.** Live orchestration tests require a running Docker daemon. Skip gracefully when unavailable.

2. **node-pty must be installed with platform-specific native bindings.** On macOS ARM64, you may need to rebuild: `npm rebuild node-pty --runtime=electron --target=<electron-version>`. Set `PTY_FALLBACK=1` as a workaround.

3. **herdr pane IDs are per-session, not global.** Do not hardcode pane IDs. Use `herdr pane list` to discover active panes at runtime.

4. **The orchestrator pane (pane 0) is special.** It cannot be renamed or closed. All other panes can be managed via the pane API.

5. **Test both with and without PTY_FALLBACK.** The fallback path may reveal edge cases that do not appear when node-pty is available.

6. **herdr agent names must be unique per session.** Attempting to start an agent with a duplicate name returns an error.

7. **Container cleanup is critical.** Leftover containers from failed tests can interfere with subsequent runs. Use `docker ps -a` to audit and `docker rm -f` to clean up.

8. **Signal handling matters.** When PTY processes are killed, ensure child processes are also terminated to avoid orphaned containers or zombie processes.
