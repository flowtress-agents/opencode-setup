# Herdr is the single TTY; bash is the container entry point

The container entry point is `/bin/bash` (per `entrypoint.form = "cmd"`
in `launch-sandbox.toml`). The container does NOT auto-start pi or herdr.

The user types `herdr` at the bash prompt to start the multiplexed
TTY. Herdr is the single TTY surface that owns all panes, tabs, and
workspaces. Pi is launched inside herdr's pane 0 as the orchestrator
(ADR 0002).

**Why this shape:**
- Bash is a familiar debugging surface. If pi/herdr crash, the
  container is still useful — the user can `docker exec` in and
  poke around.
- Herdr must be the *single* TTY. Multiple herdr instances would
  fight over the container's terminal discipline and split
  session state (PTY allocations, scrollback).
- The user does not need to know about herdr up-front. They can
  inspect the container with bash first if they want.

**Avoid**: "terminal multiplexer" (herdr IS one, but the user
vocabulary is "herdr"), "tmux" (herdr is a different project).

**Implications for the spec:**
- The launch-sandbox spec must declare `/bin/bash` as the
  entrypoint command; herdr/pi are runtime launches, not build
  steps.
- Health checks verify herdr and pi are present in the image
  (binaries installed) but do NOT require them to be running
  at container start.
- The runtime's "start sandbox" call ends with the container
  alive and bash prompt reachable; orchestrator activation
  (herdr → pi) is a separate user-driven step.
