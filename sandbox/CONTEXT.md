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

## Orchestration

The sandbox supports multi-agent orchestration via a pane delegation
model. These terms are defined by ADRs 0002–0005 and are load-bearing
for F1–F6 in the red phase of the test worktree.

**Orchestrator**: The pi instance running in pane 0 of the herdr TTY.
It is the agent the user interacts with directly. There is exactly one
top-level orchestrator per container.

**Avoid**: primary agent, root agent, main agent

**Sub-orchestrator**: A pi instance spawned by another orchestrator.
It can spawn its own sub-agents but is itself a child of one parent
orchestrator. Sub-orchestrators exist in their own pane.

**Sub-agent**: A non-pi agent spawned by an orchestrator or
sub-orchestrator. Leaf in the spawn tree; cannot spawn further agents
unless explicitly promoted.

**Pane control rule**: Each agent (orchestrator, sub-orchestrator,
sub-agent) owns exactly one pane in one herdr tab/workspace. An
agent cannot read or write the panes of any agent other than its
own descendants. (ADR 0004)

**Flat governance chain**: Despite the spawn tree being hierarchical,
governance is flat: every agent is peer-to-peer with its parent and
its siblings. No agent has authority over another except via
explicit spawn/signal contracts. (F5)

**User workspace**: A separate herdr workspace/tab reserved for the
user's direct bash interaction. The orchestrator cannot interact
with the user workspace. The user cannot inject into an
orchestrator-controlled pane. (F6)

**Avoid**: terminal, terminal multiplexer (use "herdr" for the
multiplexer, "pane" for a single subdivision)
