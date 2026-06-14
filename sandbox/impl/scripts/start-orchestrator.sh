#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start-orchestrator.sh — One-shot orchestrator boot inside the container.
# ---------------------------------------------------------------------------
# Inside the sandbox container, runs phases A through E:
#
#   Phase A — defensive herdr start, identify ws/tab/pane, rename to
#             "orchestrator", write prompt to /etc/orchestrator-prompt.txt,
#             boot pi with `pane run`.
#   Phase B — spawn one sub-orchestrator per workstream (scaffold_2,
#             git-worktree, deps) using `herdr tab create --workspace <ws>
#             --cwd /home/agent/workspace --label "orch-<name>" --no-focus`.
#   Phase C — spawn adversarial swarm using
#             `herdr agent start --workspace <ws> --split right` for each.
#   Phase D — write /etc/surgical-fixers registry (do NOT start fixers yet).
#   Phase E — exec herdr (leave the user at the interactive TUI).
#
# The orchestrator system prompt content is copied verbatim from
# test/sandbox/impl/orchestration/orchestrator-session.ts:31-61.
# ---------------------------------------------------------------------------
set -euo pipefail

ORCH_PROMPT="$(cat <<'PROMPT'
You are the orchestrator (pi) running in pane 0. You are READ-ONLY — you cannot mutate the repository.

## Your role
- Receive the user prompt and plan the work
- Delegate all tasks to sub-orchestrators (never run git/npm/file commands yourself)
- Monitor progress and trigger adversarial verification

## Available sub-orchestrator templates
- `scaffold_2`: create branches, write boilerplate files
- `deps`: install dependencies (npm install, etc.)
- `git-worktree`: set up git worktrees

## Adversarial verification protocol
Every sub-orchestrator MUST spawn exactly one adversarial sub-agent that:
- Has capability=read, signalOnly=true
- Can only send `challenge` signals
- Produces `CHALLENGE` verdicts with severity: "block" | "warn"

A "block" severity challenge aborts the workstream and forces a new plan.
All challenges are logged to /tmp/adversarial.log.

## Capability rules
- You (orchestrator) have capability="read" — no git commit, no file creation
- Sub-orchestrators have capability="read" — they only delegate
- Sub-agents may have capability="read" or "readwrite" depending on their task
- Adversarial agents have capability="read", signalOnly=true — they only challenge

## Allowed commands for read-only agents
cat, ls, grep, find, rg, git log, git diff, git show, git status, git branch, jq, pi, herdr pane read, herdr pane list, herdr pane get
PROMPT
)"

WORKSPACE_CWD="/home/agent/workspace"
WORKSTREAMS=(scaffold_2 git-worktree deps)
ORCH_PANE_LABEL="orchestrator"
LOG_DIR="/etc"
SURGICAL_FIXERS_REGISTRY="${LOG_DIR}/surgical-fixers"
ORCH_PROMPT_FILE="${LOG_DIR}/orchestrator-prompt.txt"

# ---------------------------------------------------------------------------
# Phase A — defensive herdr start, identify ws/tab/pane, rename, boot pi.
# ---------------------------------------------------------------------------
echo "[start-orchestrator] Phase A: ensuring herdr daemon is up..."
if ! herdr pane list >/dev/null 2>&1; then
  echo "[start-orchestrator] herdr daemon not running, starting it..."
  nohup herdr >/dev/null 2>&1 &
  sleep 1
fi

# Verify the daemon is now responsive.
if ! herdr pane list >/dev/null 2>&1; then
  echo "[start-orchestrator] [error] herdr daemon failed to start" >&2
  exit 1
fi

echo "[start-orchestrator] Identifying first workspace, tab, and pane..."
WS_JSON=$(herdr workspace list)
TAB_JSON=$(herdr tab list)
WS_ID=$(echo "$WS_JSON"  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['workspaces'][0]['workspace_id'])")
TAB_ID=$(echo "$TAB_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['tabs'][0]['tab_id'])")
PANE_ID="${WS_ID}-1"   # first pane in the first tab of the first workspace

echo "[start-orchestrator] Renaming workspace and tab to '${ORCH_PANE_LABEL}'..."
herdr workspace rename "$WS_ID" "$ORCH_PANE_LABEL"
herdr tab rename "$TAB_ID" "$ORCH_PANE_LABEL"

echo "[start-orchestrator] Writing orchestrator prompt to ${ORCH_PROMPT_FILE}..."
mkdir -p "$LOG_DIR"
printf '%s\n' "$ORCH_PROMPT" > "$ORCH_PROMPT_FILE"

echo "[start-orchestrator] Booting pi in pane ${PANE_ID}..."
# Set the read-only capability env, then exec pi with the system prompt file.
# Use `pane run` so the command actually executes (herdr pane send-text only
# writes literal text, which would leave pi in the shell).
herdr pane run "$PANE_ID" "export AGENT_CAPABILITY=read && exec pi --system-prompt-file ${ORCH_PROMPT_FILE}"
sleep 1

# ---------------------------------------------------------------------------
# Phase B — spawn one sub-orchestrator per workstream.
# Each sub-orchestrator gets its own tab under the orchestrator workspace,
# does not steal focus, and is booted with capability=read.
# ---------------------------------------------------------------------------
echo "[start-orchestrator] Phase B: spawning sub-orchestrators..."
declare -A SUB_TAB_IDS
for ws in "${WORKSTREAMS[@]}"; do
  tab_label="orch-${ws}"
  echo "[start-orchestrator]   creating tab '${tab_label}'..."
  tab_create_json=$(herdr tab create \
    --workspace "$WS_ID" \
    --cwd "$WORKSPACE_CWD" \
    --label "$tab_label" \
    --no-focus)
  tab_id=$(echo "$tab_create_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['tab_id'])")
  SUB_TAB_IDS["$ws"]="$tab_id"

  # Identify the first pane in the new tab so we can boot the sub-orchestrator.
  sub_pane_id="${tab_id}-1"
  herdr pane run "$sub_pane_id" \
    "export AGENT_CAPABILITY=read && export SUB_ORCH_WORKSTREAM=${ws} && exec pi --system-prompt-file ${ORCH_PROMPT_FILE}"
done

# ---------------------------------------------------------------------------
# Phase C — spawn adversarial swarm.
# One adversarial per workstream (targets that workstream's pane) plus one
# global adversarial that targets pane 0 (the orchestrator's plan).
# All adversarials are capability=read, signalOnly=true.
# ---------------------------------------------------------------------------
echo "[start-orchestrator] Phase C: spawning adversarial swarm..."
# Per-workstream adversarials.
for ws in "${WORKSTREAMS[@]}"; do
  sub_tab_id="${SUB_TAB_IDS[$ws]}"
  sub_pane_id="${sub_tab_id}-1"
  adv_name="adv-${ws}"
  echo "[start-orchestrator]   spawning ${adv_name} (split right)..."
  herdr agent start "$adv_name" \
    --workspace "$WS_ID" \
    --split right \
    --no-focus \
    -- env \
      AGENT_CAPABILITY=read \
      AGENT_TARGET_PANE="$sub_pane_id" \
      pi --prompt-file /etc/prompts/adversarial.md
done

# Global adversarial that challenges pane 0 (the orchestrator's plan).
echo "[start-orchestrator]   spawning adv-global (split right)..."
herdr agent start adv-global \
  --workspace "$WS_ID" \
  --split right \
  --no-focus \
  -- env \
    AGENT_CAPABILITY=read \
    AGENT_TARGET_PANE="$PANE_ID" \
    pi --prompt-file /etc/prompts/adversarial.md

# ---------------------------------------------------------------------------
# Phase D — write /etc/surgical-fixers registry. Fixers are NOT started here.
# The orchestrator spawns them lazily when a block-severity challenge lands
# in /tmp/adversarial.log.
# ---------------------------------------------------------------------------
echo "[start-orchestrator] Phase D: writing /etc/surgical-fixers registry..."
mkdir -p "$LOG_DIR"
{
  for ws in "${WORKSTREAMS[@]}"; do
    sub_tab_id="${SUB_TAB_IDS[$ws]}"
    printf 'workstream=%s fixer=fixer-%s target_pane=%s-1 capability=readwrite spawned=false\n' \
      "$ws" "$ws" "$sub_tab_id"
  done
} > "$SURGICAL_FIXERS_REGISTRY"
chmod 0644 "$SURGICAL_FIXERS_REGISTRY"

# ---------------------------------------------------------------------------
# Phase E — exec herdr. Hand the user the interactive TUI.
# ---------------------------------------------------------------------------
echo "[start-orchestrator] Phase E: handing over to interactive herdr TUI."
exec herdr
