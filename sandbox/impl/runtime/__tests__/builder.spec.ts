import { describe, it, expect } from "vitest";
import { buildDockerRunArgs, buildWorkspaceMount } from "../builder.js";
import type { SandboxSpec, SandboxOptions } from "../types.js";

const defaultSpec: SandboxSpec = {
  herdr: {
    name: "test-herdr",
    repo: "https://github.com/test/repo",
    versionMin: "1.0.0",
    paths: { sessions: "/sessions", cache: "/cache" },
    pty: { required: false, term: "xterm-256color" },
    session: { format: "json", compress: "gzip" },
    runtime: { nodeMin: "18.0.0", bunMin: "1.0.0" },
  },
  picode: {
    name: "test-picode",
    npmName: "@test/picode",
    friendlyName: "Test Picode",
    repo: "https://github.com/test/picode",
    install: { cmd: "npm install", binName: "test", entry: "index.js" },
    runtime: {
      nodeMin: "18.0.0",
      nodeRecommended: "20.0.0",
      npmMin: "9.0.0",
      pnpmMin: "8.0.0",
    },
    capabilities: {
      supportsTelemetryOff: true,
      supportsOfflineMode: true,
      supportsVersionSkip: true,
      defaultModelProvider: "test-provider",
    },
  },
  docker: {
    base: { image: "test-image", imageTag: "latest", imageDigest: "sha256:abc123" },
    user: { name: "testuser", uid: 1000, gid: 1000, home: "/home/testuser", workdir: "/app", shell: "/bin/bash" },
    run: { detach: true, hostname: "test-host", networkMode: "bridge" },
    mounts: { workspace: { host: "/tmp/workspace", container: "/workspace", readonly: false } },
  },
  system: {
    os: { family: "linux", release: "6.1.0" },
    locale: { locale: "en_US.UTF-8", timezone: "UTC", lang: "en_US.UTF-8" },
    aptPackages: { required: ["git", "curl"] },
    git: { safeDirectory: true, defaultBranch: "main", userName: "Test User", userEmail: "test@example.com" },
    path: { extra: ["/opt/bin", "/usr/local/sbin"] },
  },
  limits: {
    timeouts: {
      containerStart: 30000,
      idle: 300000,
      hookExec: 5000,
      gitSetup: 30000,
      commitCollection: 60000,
      mergeToHost: 30000,
      completionGrace: 5000,
    },
    resources: {
      cpusDefault: 2,
      memoryDefault: "2g",
      swapDefault: "1g",
      pidsDefault: 512,
    },
    rateLimits: {
      agentStart: 10,
      hookExecPerMin: 60,
      commitPerMin: 10,
    },
    disk: { quotaWorkspaceMb: 10240 },
  },
};

const defaultOpts: SandboxOptions = {
  id: "test-sandbox-123",
};

describe("buildDockerRunArgs", () => {
  describe("basic structure", () => {
    it("returns a non-empty array", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      expect(result.length).toBeGreaterThan(0);
    });

    it("does not include 'docker' as first element", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      expect(result[0]).not.toBe("docker");
    });

    it("starts with -d when detached", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, detached: true });
      expect(result[0]).toBe("-d");
    });

    it("does NOT start with -d when detached is false", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, detached: false });
      expect(result[0]).not.toBe("-d");
    });

    it("includes --name with container name", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const nameIndex = result.indexOf("--name");
      expect(nameIndex).toBeGreaterThan(-1);
      expect(result[nameIndex + 1]).toBe("sandbox-test-sandbox-123");
    });

    it("includes --hostname with hostname", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const hostnameIndex = result.indexOf("--hostname");
      expect(hostnameIndex).toBeGreaterThan(-1);
      expect(result[hostnameIndex + 1]).toBe("test-host");
    });

    it("includes --network with network mode", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const networkIndex = result.indexOf("--network");
      expect(networkIndex).toBeGreaterThan(-1);
      expect(result[networkIndex + 1]).toBe("bridge");
    });

    it("includes --user with uid:gid format", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const userIndex = result.indexOf("--user");
      expect(userIndex).toBeGreaterThan(-1);
      expect(result[userIndex + 1]).toMatch(/^\d+:\d+$/);
    });

    it("includes -w with workdir", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const workdirIndex = result.indexOf("-w");
      expect(workdirIndex).toBeGreaterThan(-1);
      expect(result[workdirIndex + 1]).toBe("/app");
    });

    it("includes -v with workspace mount", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const volumeIndex = result.indexOf("-v");
      expect(volumeIndex).toBeGreaterThan(-1);
      expect(result[volumeIndex + 1]).toContain("/workspace");
    });
  });

  describe("workspace mount", () => {
    it("mount string contains host path", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const volumeIndex = result.indexOf("-v");
      expect(result[volumeIndex + 1]).toContain("/tmp/workspace");
    });

    it("mount string contains container path", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const volumeIndex = result.indexOf("-v");
      expect(result[volumeIndex + 1]).toContain("/workspace");
    });

    it("mount string uses :ro suffix when readonly", () => {
      const spec = {
        ...defaultSpec,
        docker: {
          ...defaultSpec.docker,
          mounts: {
            ...defaultSpec.docker.mounts,
            workspace: { host: "/tmp/workspace", container: "/workspace", readonly: true },
          },
        },
      };
      const result = buildDockerRunArgs(spec, defaultOpts);
      const volumeIndex = result.indexOf("-v");
      expect(result[volumeIndex + 1]).toMatch(/:ro$/);
    });

    it("mount string has no :ro suffix when not readonly", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const volumeIndex = result.indexOf("-v");
      expect(result[volumeIndex + 1]).not.toMatch(/:ro$/);
    });

    it("uses opts.workspaceHost override when provided", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, workspaceHost: "/custom/host/path" });
      const volumeIndex = result.indexOf("-v");
      expect(result[volumeIndex + 1]).toContain("/custom/host/path");
    });
  });

  describe("environment vars", () => {
    it("includes PATH= env var", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const pathIndex = result.indexOf("-e");
      expect(result[pathIndex + 1]).toMatch(/^PATH=/);
    });

    it("PATH includes /usr/local/bin", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const pathIndex = result.indexOf("-e");
      expect(result[pathIndex + 1]).toContain("/usr/local/bin");
    });

    it("PATH includes spec.system.path.extra entries", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const pathIndex = result.indexOf("-e");
      expect(result[pathIndex + 1]).toContain("/opt/bin");
      expect(result[pathIndex + 1]).toContain("/usr/local/sbin");
    });

    it("includes LANG= env var", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      expect(result.some((e) => e.includes("LANG="))).toBe(true);
    });

    it("includes TZ= env var", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      expect(result.some((e) => e.includes("TZ="))).toBe(true);
    });
  });

  describe("user/uid", () => {
    it("uses opts.uid when provided", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, uid: 2000 });
      const userIndex = result.indexOf("--user");
      expect(result[userIndex + 1]).toMatch(/^2000:/);
    });

    it("uses spec docker.user.uid when opts.uid absent", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const userIndex = result.indexOf("--user");
      expect(result[userIndex + 1]).toMatch(/^1000:/);
    });

    it("uses opts.gid when provided", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, gid: 2000 });
      const userIndex = result.indexOf("--user");
      expect(result[userIndex + 1]).toMatch(/:2000$/);
    });

    it("uses spec docker.user.gid when opts.gid absent", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const userIndex = result.indexOf("--user");
      expect(result[userIndex + 1]).toMatch(/:1000$/);
    });

    it("format is uid:gid in single --user arg", () => {
      const result = buildDockerRunArgs(defaultSpec, defaultOpts);
      const userIndex = result.indexOf("--user");
      expect(result[userIndex + 1]).toBe("1000:1000");
    });
  });

  describe("detach flag", () => {
    it("default: uses spec.docker.run.detach value", () => {
      const specWithDetach = { ...defaultSpec, docker: { ...defaultSpec.docker, run: { ...defaultSpec.docker.run, detach: true } } };
      const result = buildDockerRunArgs(specWithDetach, defaultOpts);
      expect(result[0]).toBe("-d");
    });

    it("opts.detached true → -d present", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, detached: true });
      expect(result).toContain("-d");
    });

    it("opts.detached false → -d absent", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, detached: false });
      expect(result).not.toContain("-d");
    });

    it("opts.detached undefined + spec.detach true → -d present", () => {
      const specTrue = { ...defaultSpec, docker: { ...defaultSpec.docker, run: { ...defaultSpec.docker.run, detach: true } } };
      const result = buildDockerRunArgs(specTrue, { id: "test" });
      expect(result).toContain("-d");
    });

    it("opts.detached undefined + spec.detach false → -d absent", () => {
      const specFalse = { ...defaultSpec, docker: { ...defaultSpec.docker, run: { ...defaultSpec.docker.run, detach: false } } };
      const result = buildDockerRunArgs(specFalse, { id: "test" });
      expect(result).not.toContain("-d");
    });
  });

  describe("container name", () => {
    it("when opts.containerName provided → uses it", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, containerName: "my-custom-container" });
      const nameIndex = result.indexOf("--name");
      expect(result[nameIndex + 1]).toBe("my-custom-container");
    });

    it("when opts.containerName absent → uses sandbox-<id> or sandbox-<timestamp>", () => {
      const result = buildDockerRunArgs(defaultSpec, { id: "my-id-456" });
      const nameIndex = result.indexOf("--name");
      expect(result[nameIndex + 1]).toBe("sandbox-my-id-456");
    });

    it("id in name when opts.id provided", () => {
      const result = buildDockerRunArgs(defaultSpec, { id: "abc123" });
      const nameIndex = result.indexOf("--name");
      expect(result[nameIndex + 1]).toBe("sandbox-abc123");
    });

    it("timestamp in name when opts.id absent and no containerName", () => {
      const result = buildDockerRunArgs(defaultSpec, {});
      const nameIndex = result.indexOf("--name");
      expect(result[nameIndex + 1]).toMatch(/^sandbox-\d+$/);
    });
  });

  describe("entry point (detached mode)", () => {
    it("detached mode includes --entrypoint /bin/bash", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, detached: true });
      const entrypointIndex = result.indexOf("--entrypoint");
      expect(entrypointIndex).toBeGreaterThan(-1);
      expect(result[entrypointIndex + 1]).toBe("/bin/bash");
    });

    it("detached mode includes -c sleep infinity", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, detached: true });
      const cIndex = result.indexOf("-c");
      expect(cIndex).toBeGreaterThan(-1);
      expect(result[cIndex + 1]).toBe("sleep infinity");
    });

    it("non-detached mode does NOT include --entrypoint", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, detached: false });
      expect(result).not.toContain("--entrypoint");
    });

    it("non-detached mode does NOT include -c sleep infinity", () => {
      const result = buildDockerRunArgs(defaultSpec, { ...defaultOpts, detached: false });
      expect(result).not.toContain("-c");
    });

    it("non-detached mode does NOT include --entrypoint even when spec defaults to detach", () => {
      const specDetach = { ...defaultSpec, docker: { ...defaultSpec.docker, run: { ...defaultSpec.docker.run, detach: false } } };
      const result = buildDockerRunArgs(specDetach, { id: "test" });
      expect(result).not.toContain("--entrypoint");
    });
  });
});

describe("buildWorkspaceMount", () => {
  it("returns a string containing -v", () => {
    const result = buildWorkspaceMount(defaultSpec, defaultOpts);
    expect(result).toContain("-v");
  });

  it("contains host path", () => {
    const result = buildWorkspaceMount(defaultSpec, defaultOpts);
    expect(result).toContain("/tmp/workspace");
  });

  it("contains container path", () => {
    const result = buildWorkspaceMount(defaultSpec, defaultOpts);
    expect(result).toContain("/workspace");
  });

  it("uses :ro suffix when readonly", () => {
    const spec = {
      ...defaultSpec,
      docker: {
        ...defaultSpec.docker,
        mounts: {
          ...defaultSpec.docker.mounts,
          workspace: { host: "/tmp/workspace", container: "/workspace", readonly: true },
        },
      },
    };
    const result = buildWorkspaceMount(spec, defaultOpts);
    expect(result).toMatch(/:ro$/);
  });

  it("no :ro suffix when not readonly", () => {
    const result = buildWorkspaceMount(defaultSpec, defaultOpts);
    expect(result).not.toMatch(/:ro$/);
  });
});
