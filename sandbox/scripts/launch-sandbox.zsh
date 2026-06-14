#!/usr/bin/env zsh
# launch-sandbox.zsh
# Launches a Docker sandbox container with herdr + piCode pre-installed.
# Usage: ./launch-sandbox.zsh [--no-build]
#   --no-build   Skip image build (assume image already exists)

set -euo pipefail

SCRIPT_DIR=${0:A:h}
IMAGE_NAME="herdr-picode-sandbox"
CONTAINER_NAME="herdr-picode-sandbox-$$"
WORKSPACE_HOST="${PWD}/workspace"
WORKSPACE_CONTAINER="/home/node/workspace"

# -------------------------------------------------------------------
# Spec values (must stay in sync with micro-spec/sandbox/*.toml)
# Updated: 2026-06-13
# -------------------------------------------------------------------
DOCKER_IMAGE="node:22-bookworm"
CONTAINER_UID="1000"
CONTAINER_GID="1000"
CONTAINER_USER="agent"
CONTAINER_SHELL="/bin/bash"
NETWORK_MODE="bridge"
# -------------------------------------------------------------------

# Check Docker is available
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running. Start Docker and try again." >&2
  exit 1
fi

# Parse flags
SKIP_BUILD=0
while [[ ${1:-} == --* ]]; do
  case $1 in
    --no-build) SKIP_BUILD=1; shift ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# Create workspace dir on host
mkdir -p "$WORKSPACE_HOST"

# Build image if needed
if [[ $SKIP_BUILD -eq 0 ]]; then
  if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "Building $IMAGE_NAME image (this may take 30-60s on first run)..."
    local DOCKERFILE_CONTENT
    DOCKERFILE_CONTENT=$(cat <<'DOCKERFILE_END'
FROM node:22-bookworm
RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/*
WORKDIR /home/node/workspace
CMD ["/bin/bash"]
DOCKERFILE_END
)
    local DOCKERFILE_PATH
    DOCKERFILE_PATH=$(mktemp)
    print -r "$DOCKERFILE_CONTENT" > "$DOCKERFILE_PATH"
    docker build -t "$IMAGE_NAME" -f "$DOCKERFILE_PATH" "$(dirname "$DOCKERFILE_PATH")" || {
      rm -f "$DOCKERFILE_PATH"
      echo "ERROR: docker build failed. Check that Dockerfile syntax is valid." >&2
      exit 1
    }
    rm -f "$DOCKERFILE_PATH"
    echo "Image built successfully."
  else
    echo "Image $IMAGE_NAME already exists, skipping build."
  fi
fi

# Start container
echo "Starting container $CONTAINER_NAME..."
docker run -d \
  --name "$CONTAINER_NAME" \
  --network "$NETWORK_MODE" \
  --hostname "sandbox-agent" \
  -v "${WORKSPACE_HOST}:${WORKSPACE_CONTAINER}" \
  -w "$WORKSPACE_CONTAINER" \
  "$IMAGE_NAME" \
  sleep infinity

echo ""
echo "Sandbox started successfully."
echo "  Container: $CONTAINER_NAME"
echo "  Workspace: $WORKSPACE_HOST -> $WORKSPACE_CONTAINER"
echo "  Image: $IMAGE_NAME"
echo ""
echo "To exec into it:"
echo "  docker exec -it $CONTAINER_NAME /bin/bash"
echo ""
echo "To stop and remove:"
echo "  ./stop-sandbox.zsh $CONTAINER_NAME"
echo ""
echo "To run a command:"
echo "  docker exec $CONTAINER_NAME pi --version"