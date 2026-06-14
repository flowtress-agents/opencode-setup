export const BASE_IMAGE = "node:22-bookworm";
export const BASE_IMAGE_TAG = "node:22-bookworm";
export const BASE_IMAGE_DIGEST = "sha256:node22-bookworm-stable";

export const USER_NAME = "agent";
export const USER_UID = 1000;
export const USER_GID = 1000;
export const USER_HOME = "/home/agent";
export const USER_WORKDIR = "/home/agent/workspace";
export const USER_SHELL = "/bin/bash";

export const DOCKER_DETACH = true;
export const DOCKER_HOSTNAME = "sandbox-agent";
export const DOCKER_NETWORK_MODE = "bridge";

export const MOUNT_WORKSPACE_HOST = "${PWD}/workspace";
export const MOUNT_WORKSPACE_CONTAINER = "/home/agent/workspace";
export const MOUNT_WORKSPACE_READONLY = false;
