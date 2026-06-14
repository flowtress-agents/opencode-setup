#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# run-live-demo.sh — End-to-end live orchestration demo
# ---------------------------------------------------------------------------
# This script runs the full orchestration setup manually (outside of vitest).
# It builds the Docker image, starts the container, and demonstrates the
# herdr + pi integration.
#
# Prerequisites:
#   - Docker daemon running (docker info exits 0)
#   - node-pty installed in test/sandbox/ (npm install --save-dev node-pty)
#
# Usage:
#   cd test/sandbox/impl/scripts
#   ./run-live-demo.sh
#
# Cleanup is automatic (trap on EXIT).
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDBOX_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
IMAGE_NAME="herdr-picode-sandbox-demo"
CONTAINER_NAME="sandbox-demo-$$"

# Cleanup on exit
cleanup() {
  echo ""
  echo "[cleanup] Stopping and removing container $CONTAINER_NAME..."
  docker stop "$CONTAINER_NAME" 2>/dev/null && docker rm "$CONTAINER_NAME" 2>/dev/null || true
  echo "[cleanup] Done."
}
trap cleanup EXIT

echo "=== Live Orchestration Demo ==="
echo ""

# Check Docker
echo "[check] Verifying Docker is available..."
if ! docker info >/dev/null 2>&1; then
  echo "[error] Docker daemon is not running. Start Docker and try again."
  exit 1
fi
echo "[check] Docker is available."

# Check node-pty
echo "[check] Verifying node-pty is installed..."
if [ ! -d "$SANDBOX_DIR/node_modules/node-pty" ]; then
  echo "[warn] node-pty not found in $SANDBOX_DIR/node_modules/"
  echo "[warn] Installing node-pty..."
  cd "$SANDBOX_DIR" && npm install --save-dev node-pty
fi
echo "[check] node-pty is installed."

# Build the image
echo ""
echo "[build] Building Docker image: $IMAGE_NAME"
docker build \
  --build-arg BASE_IMAGE=node:22-bookworm \
  --build-arg HERDR_INSTALL="curl -fsSL https://herdr.dev/install.sh | sh" \
  --build-arg PI_NPM=@earendil-works/pi-coding-agent \
  -t "$IMAGE_NAME" \
  -f - . <<'EOF'
FROM node:22-bookworm
RUN apt-get update && apt-get install -y git curl jq && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://herdr.dev/install.sh | sh || \
    (curl -L https://github.com/ogulcancelik/herdr/releases/latest/download/herdr-linux-aarch64 \
    -o /usr/local/bin/herdr && chmod +x /usr/local/bin/herdr)
RUN npm install -g @earendil-works/pi-coding-agent
EOF

echo "[build] Image built successfully: $IMAGE_NAME"

# Run the container
echo ""
echo "[run] Starting container: $CONTAINER_NAME"
docker run -d \
  --name "$CONTAINER_NAME" \
  --hostname sandbox-agent \
  --network bridge \
  -v "$SANDBOX_DIR/workspace:/home/agent/workspace" \
  -w /home/agent/workspace \
  "$IMAGE_NAME" \
  sleep infinity

echo "[run] Container started: $CONTAINER_NAME"

# Verify herdr and pi
echo ""
echo "[verify] Verifying herdr..."
HERDR_VERSION=$(docker exec "$CONTAINER_NAME" herdr --version 2>&1 || echo "FAILED")
echo "  herdr --version: $HERDR_VERSION"

echo "[verify] Verifying pi..."
PI_VERSION=$(docker exec "$CONTAINER_NAME" pi --version 2>&1 || echo "FAILED")
echo "  pi --version: $PI_VERSION"

# Show container info
echo ""
echo "[info] Container status:"
docker inspect --format "  ID: {{.Id}}" "$CONTAINER_NAME"
docker inspect --format "  Image: {{.Config.Image}}" "$CONTAINER_NAME"
docker inspect --format "  Status: {{.State.Status}}" "$CONTAINER_NAME"
docker inspect --format "  PID: {{.State.Pid}}" "$CONTAINER_NAME"

echo ""
echo "=== Demo complete ==="
echo ""
echo "To interact with the container:"
echo "  docker exec -it $CONTAINER_NAME herdr"
echo ""
echo "To run the live integration tests:"
echo "  cd $SANDBOX_DIR"
echo "  RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/"
echo ""
echo "To stop and remove:"
echo "  docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME"
echo ""
