import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sandbox } from "../sandbox.js";
import type { SandboxSpec, SandboxOptions } from "../types.js";
import {
  SandboxStartError,
  SandboxExecError,
  SandboxNotRunningError,
  SandboxAlreadyRunningError,
  SandboxTimeoutError,
} from "../errors.js";

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
    base: { image: "test-image:latest", imageTag: "latest", imageDigest: "sha256:abc123" },
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
      completionGrace: 5,
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

function createTestSandbox(extraOpts: Partial<SandboxOptions> = {}): Sandbox {
  return new Sandbox(defaultSpec, { id: "test-123", containerName: "test-container-123", idleTimeoutMs: 50, ...extraOpts }, "docker");
}

describe("Sandbox", () => {
  describe("initial state", () => {
    it("has status 'created' initially", () => {
      const sandbox = createTestSandbox();
      expect(sandbox.status).toBe("created");
    });

    it("has correct id from opts", () => {
      const sandbox = createTestSandbox();
      expect(sandbox.id).toBe("test-123");
    });

    it("has correct containerName from opts", () => {
      const sandbox = createTestSandbox();
      expect(sandbox.containerName).toBe("test-container-123");
    });

    it("getInfo returns correct initial state", () => {
      const sandbox = createTestSandbox();
      const info = sandbox.getInfo();
      expect(info.status).toBe("created");
      expect(info.id).toBe("test-123");
      expect(info.containerName).toBe("test-container-123");
      expect(info.startedAt).toBeUndefined();
      expect(info.stoppedAt).toBeUndefined();
    });
  });

  describe("exec() — not running", () => {
    it("when status is created, exec rejects with SandboxNotRunningError", async () => {
      const sandbox = createTestSandbox();
      await expect(sandbox.exec(["echo", "hello"])).rejects.toThrow(SandboxNotRunningError);
    });

    it("error includes the operation name", async () => {
      const sandbox = createTestSandbox();
      await expect(sandbox.exec(["echo", "hello"])).rejects.toThrow(/exec/);
    });

    it("error includes the container name", async () => {
      const sandbox = createTestSandbox();
      await expect(sandbox.exec(["echo", "hello"])).rejects.toThrow(/test-container-123/);
    });
  });

  describe("double start detection", () => {
    it("calling start() twice while running rejects with SandboxAlreadyRunningError", async () => {
      const sandbox = createTestSandbox();
      Object.defineProperty(sandbox, "status", { get: () => "running" });
      await expect(sandbox.start()).rejects.toThrow(SandboxAlreadyRunningError);
    });

    it("error message includes container name", async () => {
      const sandbox = createTestSandbox();
      Object.defineProperty(sandbox, "status", { get: () => "running" });
      await expect(sandbox.start()).rejects.toThrow(/test-container-123/);
    });
  });

  describe("stop() idempotency", () => {
    it("calling stop() when not running does not throw", async () => {
      const sandbox = createTestSandbox();
      await expect(sandbox.stop()).resolves.toBeUndefined();
    });

    it("getInfo().status is 'created' after stop without start", () => {
      const sandbox = createTestSandbox();
      expect(sandbox.getInfo().status).toBe("created");
    });
  });

  describe("getInfo()", () => {
    it("returns correct image from opts", () => {
      const sandbox = createTestSandbox({ image: "custom-image:latest" });
      expect(sandbox.getInfo().image).toBe("custom-image:latest");
    });

    it("returns correct image from spec when not overridden", () => {
      const sandbox = createTestSandbox();
      expect(sandbox.getInfo().image).toBe("test-image:latest");
    });

    it("returns correct workdir from opts", () => {
      const sandbox = createTestSandbox({ workspaceContainer: "/custom/workdir" });
      expect(sandbox.getInfo().workdir).toBe("/custom/workdir");
    });

    it("returns correct workdir from spec when not overridden", () => {
      const sandbox = createTestSandbox();
      expect(sandbox.getInfo().workdir).toBe("/app");
    });
  });

  describe("SandboxError classes", () => {
    it("SandboxStartError has correct properties", () => {
      const error = new SandboxStartError("my-container", 42, "some error");
      expect(error.name).toBe("SandboxStartError");
      expect(error.code).toBe("SANDBOX_START_FAILED");
      expect(error.containerName).toBe("my-container");
      expect(error.exitCode).toBe(42);
      expect(error.stderr).toBe("some error");
    });

    it("SandboxExecError has correct properties", () => {
      const error = new SandboxExecError("my-container", ["ls", "-la"], 127, "not found");
      expect(error.name).toBe("SandboxExecError");
      expect(error.code).toBe("SANDBOX_EXEC_FAILED");
      expect(error.containerName).toBe("my-container");
      expect(error.cmd).toEqual(["ls", "-la"]);
      expect(error.exitCode).toBe(127);
      expect(error.stderr).toBe("not found");
    });

    it("SandboxNotRunningError has correct properties", () => {
      const error = new SandboxNotRunningError("my-container", "exec(ls)");
      expect(error.name).toBe("SandboxNotRunningError");
      expect(error.code).toBe("SANDBOX_NOT_RUNNING");
      expect(error.containerName).toBe("my-container");
      expect(error.operation).toBe("exec(ls)");
    });

    it("SandboxAlreadyRunningError has correct properties", () => {
      const error = new SandboxAlreadyRunningError("my-container");
      expect(error.name).toBe("SandboxAlreadyRunningError");
      expect(error.code).toBe("SANDBOX_ALREADY_RUNNING");
      expect(error.containerName).toBe("my-container");
    });

    it("SandboxTimeoutError has correct properties", () => {
      const error = new SandboxTimeoutError("start", 5000);
      expect(error.name).toBe("SandboxTimeoutError");
      expect(error.code).toBe("SANDBOX_TIMEOUT");
      expect(error.operation).toBe("start");
      expect(error.timeoutMs).toBe(5000);
    });
  });
});
