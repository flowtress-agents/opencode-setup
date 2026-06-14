import { describe, it, expect } from "vitest";
import {
  BASE_IMAGE,
  BASE_IMAGE_TAG,
  BASE_IMAGE_DIGEST,
  USER_NAME,
  USER_UID,
  USER_GID,
  USER_HOME,
  USER_WORKDIR,
  USER_SHELL,
  DOCKER_DETACH,
  DOCKER_HOSTNAME,
  DOCKER_NETWORK_MODE,
  MOUNT_WORKSPACE_HOST,
  MOUNT_WORKSPACE_CONTAINER,
  MOUNT_WORKSPACE_READONLY,
} from "../src/docker.js";

describe("docker spec", () => {
  it("BASE_IMAGE is node:22-bookworm (no -slim variant)", () => {
    expect(BASE_IMAGE).toBe("node:22-bookworm");
  });
  it("BASE_IMAGE_TAG matches BASE_IMAGE", () => {
    expect(BASE_IMAGE_TAG).toBe("node:22-bookworm");
  });
  it("BASE_IMAGE_DIGEST is a sha256 pin", () => {
    expect(BASE_IMAGE_DIGEST).toMatch(/^sha256:/);
  });

  it("USER_NAME is 'agent'", () => {
    expect(USER_NAME).toBe("agent");
  });
  it("USER_UID is 1000", () => {
    expect(USER_UID).toBe(1000);
  });
  it("USER_GID is 1000", () => {
    expect(USER_GID).toBe(1000);
  });
  it("USER_HOME is /home/agent", () => {
    expect(USER_HOME).toBe("/home/agent");
  });
  it("USER_WORKDIR is /home/agent/workspace (NOT /workspace)", () => {
    expect(USER_WORKDIR).toBe("/home/agent/workspace");
  });
  it("USER_SHELL is /bin/bash", () => {
    expect(USER_SHELL).toBe("/bin/bash");
  });

  it("DOCKER_DETACH is true (container runs detached)", () => {
    expect(DOCKER_DETACH).toBe(true);
  });
  it("DOCKER_HOSTNAME is 'sandbox-agent'", () => {
    expect(DOCKER_HOSTNAME).toBe("sandbox-agent");
  });
  it("DOCKER_NETWORK_MODE is 'bridge'", () => {
    expect(DOCKER_NETWORK_MODE).toBe("bridge");
  });

  it("MOUNT_WORKSPACE_HOST uses \${PWD}/workspace", () => {
    expect(MOUNT_WORKSPACE_HOST).toBe("${PWD}/workspace");
  });
  it("MOUNT_WORKSPACE_CONTAINER is /home/agent/workspace", () => {
    expect(MOUNT_WORKSPACE_CONTAINER).toBe("/home/agent/workspace");
  });
  it("MOUNT_WORKSPACE_READONLY is false", () => {
    expect(MOUNT_WORKSPACE_READONLY).toBe(false);
  });
});
