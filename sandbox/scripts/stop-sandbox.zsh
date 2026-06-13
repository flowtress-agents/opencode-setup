#!/usr/bin/env zsh
# stop-sandbox.zsh
# Stops and removes a sandbox container.
# Usage: ./stop-sandbox.zsh <container-name> [--with-image]
#   <container-name>   Name of the container to stop
#   --with-image        Also remove the herdr-picode-sandbox image

set -euo pipefail

if [[ ${1:-} == "" ]]; then
  echo "Usage: $0 <container-name> [--with-image]" >&2
  echo "  <container-name>   Name of the container to stop and remove" >&2
  echo "  --with-image       Also remove the herdr-picode-sandbox image" >&2
  exit 1
fi

CONTAINER_NAME="$1"
WITH_IMAGE=0
if [[ ${2:-} == "--with-image" ]]; then
  WITH_IMAGE=1
fi

echo "Stopping container $CONTAINER_NAME (60s grace)..."
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  docker stop --time 60 "$CONTAINER_NAME" || {
    echo "WARNING: docker stop failed, force-killing..." >&2
    docker kill "$CONTAINER_NAME"
  }
  docker rm "$CONTAINER_NAME"
  echo "Container removed."
else
  echo "Container $CONTAINER_NAME not found (already gone?)."
fi

if [[ $WITH_IMAGE -eq 1 ]]; then
  echo "Removing image herdr-picode-sandbox..."
  docker rmi herdr-picode-sandbox 2>/dev/null || echo "(image not found, skipping)"
fi

echo "Done."
