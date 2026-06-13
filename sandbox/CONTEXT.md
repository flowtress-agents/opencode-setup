# Sandbox Context

The sandbox spec describes a Docker-based execution environment for AI agents.
It is split into concerns: tools, runtime, limits, and scripts.

## Language

**Sandbox spec**: A TOML-based contract describing how a sandbox container
is built, configured, and launched. Source of truth for the launcher.

**Avoid**: manifest, definition, config (overloaded with docker config)

**Launcher**: The program that consumes the sandbox spec and produces a
running container. The launcher is currently a zsh script; future
implementations may be TypeScript.

**Avoid**: driver, runner (overloaded with other tools)

**Tool**: A pre-installed binary inside the sandbox image (e.g. herdr, pi).

**Avoid**: package, app

**Context strategy**: How the build context is supplied to `docker build`.
`tempfile` writes a Dockerfile to disk; `stdin` pipes a heredoc. Tempfile
is the only supported value because stdin hangs in some Docker daemons
(observed with Colima legacy builder).

**Avoid**: build mode, build type

**Install step**: A named operation in `install.steps` that mutates the
image. Each step has a `cmd` (or `npm`) and an optional `fallback_cmd`
used when the primary command fails. The launcher iterates steps in
declaration order.

**Avoid**: install action, package step

**UID collision strategy**: How the launcher reconciles the spec's
agent_uid with UIDs already taken in the base image. `shift_to_first_free`
selects the first unused uid; `fail` aborts the build; `override` uses
the spec value regardless. The current base image (`node:22-bookworm`)
already claims uid 1000 for the `node` user, so `shift_to_first_free` is
the default.

**Avoid**: uid policy, user strategy
