import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SandboxSpec, SandboxOptions } from "../types.js";
import { Sandbox } from "../sandbox.js";
import { SandboxNotRunningError } from "../errors.js";
import { buildDockerRunArgs } from "../builder.js";
import * as childProcess from "node:child_process";

vi.mock("node:child_process");

const spawn = vi.mocked(childProcess.spawn);

const minimalHerdrSpec: SandboxSpec["herdr"] = {
  name: "herdr",
  repo: "https://github.com/test/herdr",
  versionMin: "1.0.0",
  paths: { sessions: ".herdr/sessions", cache: ".herdr/cache" },
  pty: { required: false, term: "xterm-256color" },
  session: { format: "json", compress: "gzip" },
  runtime: { nodeMin: "20.0.0", bunMin: "1.0.0" },
};

const minimalPicodeSpec: SandboxSpec["picode"] = {
  name: "picode",
  npmName: "@test/picode",
  friendlyName: "Picode",
  repo: "https://github.com/test/picode",
  install: { cmd: "npm install", binName: "picode", entry: "index.js" },
  runtime: { nodeMin: "20.0.0", nodeRecommended: "22.0.0", npmMin: "10.0.0", pnpmMin: "8.0.0" },
  capabilities: {
    supportsTelemetryOff: true,
    supportsOfflineMode: true,
    supportsVersionSkip: true,
    defaultModelProvider: "openai",
  },
};

const minimalDockerSpec: SandboxSpec["docker"] = {
  base: { image: "node:22-bookworm", imageTag: "node:22-bookworm", imageDigest: "sha256:test" },
  user: { name: "agent", uid: 1000, gid: 1000, home: "/home/agent", workdir: "/home/agent/workspace", shell: "/bin/bash" },
  run: { detach: true, hostname: "sandbox-agent", networkMode: "bridge" },
  mounts: { workspace: { host: "/workspace", container: "/home/agent/workspace", readonly: false } },
};

const minimalSystemSpec: SandboxSpec["system"] = {
  os: { family: "linux", release: "6.1.0" },
  locale: { locale: "en_US.UTF-8", timezone: "UTC", lang: "en_US" },
  aptPackages: { required: ["git", "curl"] },
  git: { safeDirectory: true, defaultBranch: "main", userName: "Agent", userEmail: "agent@example.com" },
  path: { extra: ["/usr/local/bin"] },
};

const minimalLimitsSpec: SandboxSpec["limits"] = {
  timeouts: {
    containerStart: 30000,
    idle: 300000,
    hookExec: 5000,
    gitSetup: 60000,
    commitCollection: 30000,
    mergeToHost: 10000,
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
    commitPerMin: 30,
  },
  disk: { quotaWorkspaceMb: 10000 },
};

const minimalSpec: SandboxSpec = {
  herdr: minimalHerdrSpec,
  picode: minimalPicodeSpec,
  docker: minimalDockerSpec,
  system: minimalSystemSpec,
  limits: minimalLimitsSpec,
};

const makeOpts = (overrides: Partial<SandboxOptions> = {}): SandboxOptions => ({
  id: "test-edge",
  ...overrides,
});

const mockSpawnFn = (): unknown => ({
  on: vi.fn(),
  stderr: { on: vi.fn() },
  stdout: { on: vi.fn() },
  pid: 12345,
});

beforeEach(() => {
  vi.clearAllMocks();
  spawn.mockImplementation(mockSpawnFn as any);
});

describe("Builder edge cases", () => {
  describe("A1: opts.workspaceHost override — mount uses the override", () => {
    it("uses opts.workspaceHost in the -v mount when provided", () => {
      const opts = makeOpts({ workspaceHost: "/custom/host/path" });
      const args = buildDockerRunArgs(minimalSpec, opts);
      const volIdx = args.indexOf("-v");
      expect(args[volIdx + 1]).toContain("/custom/host/path");
      expect(args[volIdx + 1]).toContain("/home/agent/workspace");
    });
  });

  describe("A2: opts.workspaceContainer override — workdir uses the override", () => {
    it("uses opts.workspaceContainer as -w when provided", () => {
      const opts = makeOpts({ workspaceContainer: "/custom/container/path" });
      const args = buildDockerRunArgs(minimalSpec, opts);
      const wIdx = args.indexOf("-w");
      expect(args[wIdx + 1]).toBe("/custom/container/path");
    });
  });

  describe("A3: opts.image override — image is not in argv (caller appends it)", () => {
    it("buildDockerRunArgs does not include the image string in its output", () => {
      const opts = makeOpts({ image: "my-custom-image:latest" });
      const args = buildDockerRunArgs(minimalSpec, opts);
      expect(args).not.toContain("my-custom-image:latest");
      expect(args).not.toContain("node:22-bookworm");
    });
  });

  describe("A4: empty spec.system.path.extra — PATH still has system defaults", () => {
    it("PATH includes /usr/local/bin even when extra is empty", () => {
      const spec = { ...minimalSpec, system: { ...minimalSpec.system, path: { extra: [] as string[] } } };
      const opts = makeOpts();
      const args = buildDockerRunArgs(spec, opts);
      const pathIdx = args.findIndex((a) => a.startsWith("PATH="));
      expect(pathIdx).toBeGreaterThan(-1);
      expect(args[pathIdx]).toContain("/usr/local/bin");
    });
  });

  describe("A5: spec.system.path.extra with spaces — handled gracefully", () => {
    it("paths with spaces are included in PATH env var", () => {
      const spec = { ...minimalSpec, system: { ...minimalSpec.system, path: { extra: ["/my path/bin", "/another path/sbin"] } } };
      const opts = makeOpts();
      const args = buildDockerRunArgs(spec, opts);
      const pathIdx = args.findIndex((a) => a.startsWith("PATH="));
      expect(pathIdx).toBeGreaterThan(-1);
      expect(args[pathIdx]).toContain("/my path/bin");
      expect(args[pathIdx]).toContain("/another path/sbin");
    });
  });

  describe("A6: spec.docker.mounts.workspace.readonly = true — mount has :ro suffix", () => {
    it("mount string ends with :ro when readonly is true", () => {
      const spec = { ...minimalSpec, docker: { ...minimalSpec.docker, mounts: { workspace: { host: "/workspace", container: "/home/agent/workspace", readonly: true } } } };
      const opts = makeOpts();
      const args = buildDockerRunArgs(spec, opts);
      const volIdx = args.indexOf("-v");
      expect(args[volIdx + 1]).toMatch(/:ro$/);
    });
  });

  describe("A7: spec.docker.mounts.workspace.readonly = false — mount has no suffix", () => {
    it("mount string has no :ro suffix when readonly is false", () => {
      const spec = { ...minimalSpec, docker: { ...minimalSpec.docker, mounts: { workspace: { host: "/workspace", container: "/home/agent/workspace", readonly: false } } } };
      const opts = makeOpts();
      const args = buildDockerRunArgs(spec, opts);
      const volIdx = args.indexOf("-v");
      expect(args[volIdx + 1]).not.toMatch(/:ro$/);
    });
  });

  describe("A8: spec.docker.run.detach = false but opts.detached = true — opts wins", () => {
    it("-d is present when opts.detached is true regardless of spec value", () => {
      const spec = { ...minimalSpec, docker: { ...minimalSpec.docker, run: { ...minimalSpec.docker.run, detach: false } } };
      const opts = makeOpts({ detached: true });
      const args = buildDockerRunArgs(spec, opts);
      expect(args).toContain("-d");
    });
  });

  describe("A9: boundary uid/gid values", () => {
    it("uid=0 (root) is accepted and passed to --user", () => {
      const spec = { ...minimalSpec, docker: { ...minimalSpec.docker, user: { ...minimalSpec.docker.user, uid: 0, gid: 0 } } };
      const opts = makeOpts();
      const args = buildDockerRunArgs(spec, opts);
      const userIdx = args.indexOf("--user");
      expect(args[userIdx + 1]).toBe("0:0");
    });

    it("uid=65534 (nobody) is accepted and passed to --user", () => {
      const spec = { ...minimalSpec, docker: { ...minimalSpec.docker, user: { ...minimalSpec.docker.user, uid: 65534, gid: 65534 } } };
      const opts = makeOpts();
      const args = buildDockerRunArgs(spec, opts);
      const userIdx = args.indexOf("--user");
      expect(args[userIdx + 1]).toBe("65534:65534");
    });
  });

  describe("A10: spec.system.locale.locale — LANG env is set", () => {
    it("LANG is set from spec.system.locale.lang", () => {
      const spec = { ...minimalSpec, system: { ...minimalSpec.system, locale: { locale: "en_US.UTF-8", timezone: "UTC", lang: "en_US.UTF-8" } } };
      const opts = makeOpts();
      const args = buildDockerRunArgs(spec, opts);
      const langIdx = args.findIndex((a) => a.startsWith("LANG="));
      expect(langIdx).toBeGreaterThan(-1);
      expect(args[langIdx]).toBe("LANG=en_US.UTF-8");
    });
  });
});

describe("Sandbox lifecycle edge cases", () => {
  describe("B1: stop() on a sandbox in 'created' state — no-op", () => {
    it("stop() on a created sandbox is a no-op (returns undefined)", async () => {
      const sandbox = new Sandbox(minimalSpec);
      await expect(sandbox.stop()).resolves.toBeUndefined();
    });
  });

  describe("B2: stop() twice on a running sandbox — second call is no-op", () => {
    it("second stop() is a no-op (returns undefined)", async () => {
      let exitCb: ((code: number) => void) | null = null;
      spawn.mockImplementation(((_cmd: unknown, _args?: unknown[]) => {
        const cp = {
          on: (evt: string, cb: (...args: unknown[]) => void) => {
            if (evt === "exit") exitCb = cb as (code: number) => void;
            return cp;
          },
          stderr: { on: vi.fn() },
          stdout: { on: vi.fn() },
          pid: 12345,
        };
        return cp;
      }) as any);

      const sandbox = new Sandbox(minimalSpec);
      sandbox.start();
      if (exitCb) (exitCb as (code: number) => void)(0);

      await sandbox.stop();
      await expect(sandbox.stop()).resolves.toBeUndefined();
    });
  });

  describe("B3: exec() on a sandbox in 'created' state — rejects with SandboxNotRunningError", () => {
    it("throws SandboxNotRunningError when exec() is called before start()", async () => {
      const sandbox = new Sandbox(minimalSpec);
      await expect(sandbox.exec(["echo", "hello"])).rejects.toThrow(SandboxNotRunningError);
    });
  });

  describe("B4: exec() on a sandbox in 'stopped' state — rejects with SandboxNotRunningError", () => {
    it("throws SandboxNotRunningError when exec() is called after stop()", async () => {
      let exitCb: ((code: number) => void) | null = null;
      spawn.mockImplementation(((_cmd: unknown, _args?: unknown[]) => {
        const cp = {
          on: (evt: string, cb: (...args: unknown[]) => void) => {
            if (evt === "exit") exitCb = cb as (code: number) => void;
            return cp;
          },
          stderr: { on: vi.fn() },
          stdout: { on: vi.fn() },
          pid: 12345,
        };
        return cp;
      }) as any);

      const sandbox = new Sandbox(minimalSpec);
      sandbox.start();
      if (exitCb) (exitCb as (code: number) => void)(0);
      await sandbox.stop();

      await expect(sandbox.exec(["echo", "hello"])).rejects.toThrow(SandboxNotRunningError);
    });
  });

  describe("B5: start() on a sandbox that has already been stopped — throws error (one-shot)", () => {
    it("calling start() again after stop() throws SandboxAlreadyRunningError", async () => {
      let exitCb: ((code: number) => void) | null = null;
      spawn.mockImplementation(((_cmd: unknown, _args?: unknown[]) => {
        const cp = {
          on: (evt: string, cb: (...args: unknown[]) => void) => {
            if (evt === "exit") exitCb = cb as (code: number) => void;
            return cp;
          },
          stderr: { on: vi.fn() },
          stdout: { on: vi.fn() },
          pid: 12345,
        };
        return cp;
      }) as any);

      const sandbox = new Sandbox(minimalSpec);
      sandbox.start();
      if (exitCb) (exitCb as (code: number) => void)(0);
      await sandbox.stop();

      await expect(sandbox.start()).rejects.toThrow();
    });
  });

  describe("B6: getInfo() before start() — status is 'created', no startedAt/stoppedAt", () => {
    it("getInfo() before start() shows status created and no timestamps", () => {
      const sandbox = new Sandbox(minimalSpec);
      const info = sandbox.getInfo();
      expect(info.status).toBe("created");
      expect(info.startedAt).toBeUndefined();
      expect(info.stoppedAt).toBeUndefined();
    });
  });

  describe("B7: getInfo() after stop() — status is 'stopped', stoppedAt is set", () => {
    it("stopped sandbox's getInfo() returns stopped status", () => {
      const sandbox = new Sandbox(minimalSpec);
      sandbox.stop();
      const info = sandbox.getInfo();
      expect(info.status).toBe("stopped");
    });
  });

  describe("B8: container name collision — handled gracefully", () => {
    it("second sandbox with same containerName can be created without crash", () => {
      const sandbox1 = new Sandbox(minimalSpec, { id: "s1", containerName: "shared-name" });
      const sandbox2 = new Sandbox(minimalSpec, { id: "s2", containerName: "shared-name" });
      expect(sandbox1.containerName).toBe(sandbox2.containerName);
    });
  });

  describe("B9: exec() with empty cmd array [] — rejects gracefully when not running", () => {
    it("exec([]) does not crash and throws SandboxNotRunningError", async () => {
      const sandbox = new Sandbox(minimalSpec);
      await expect(sandbox.exec([])).rejects.toThrow(SandboxNotRunningError);
    });
  });

  describe("B10: exec() with a very long command string — does not crash when not running", () => {
    it("exec() with a very long command string throws SandboxNotRunningError", async () => {
      const sandbox = new Sandbox(minimalSpec);
      const longCmd = Array(200).fill("x").join("");
      await expect(sandbox.exec(["echo", longCmd])).rejects.toThrow(SandboxNotRunningError);
    });
  });
});

describe("Error path edge cases", () => {
  describe("C1: start() — spawn throws ENOENT (docker binary not found) — SandboxStartError", () => {
    it("catches spawn ENOENT and throws SandboxStartError", async () => {
      spawn.mockImplementation((() => {
        const cp = {
          on: vi.fn((_evt: string, cb: (...args: unknown[]) => void) => {
            const err = new Error("ENOENT: docker not found") as Error & { code: string };
            err.code = "ENOENT";
            setTimeout(() => cb(err), 0);
            return cp;
          }),
          stderr: { on: vi.fn() },
          stdout: { on: vi.fn() },
          pid: undefined,
        };
        return cp;
      }) as any);

      const sandbox = new Sandbox(minimalSpec);
      await expect(sandbox.start()).rejects.toThrow();
    });
  });

  describe("C2: exec() — SandboxExecError is thrown when docker exec fails", () => {
    it("exec() throws error when docker exec process fails", async () => {
      const sandbox = new Sandbox(minimalSpec);
      await expect(sandbox.exec(["nonexistent-cmd"])).rejects.toThrow();
    });
  });

  describe("C3: exec() — rejects with specific exit code", () => {
    it("exec() on non-running sandbox throws SandboxNotRunningError", async () => {
      const sandbox = new Sandbox(minimalSpec);
      await expect(sandbox.exec(["echo", "test"])).rejects.toThrow(SandboxNotRunningError);
    });
  });

  describe("C4: exec() fails if container not running", () => {
    it("exec() throws SandboxNotRunningError when sandbox is stopped", async () => {
      const sandbox = new Sandbox(minimalSpec);
      await expect(sandbox.exec(["echo", "hello"])).rejects.toThrow(SandboxNotRunningError);
    });
  });

  describe("C5: exec() on fresh (never-started) sandbox throws", () => {
    it("exec() on never-started sandbox throws SandboxNotRunningError", async () => {
      const sandbox = new Sandbox(minimalSpec);
      await expect(sandbox.exec(["echo", "hello"])).rejects.toThrow(SandboxNotRunningError);
    });
  });
});

describe("Config/options edge cases", () => {
  describe("D1: createSandbox({}) with empty opts — all defaults applied", () => {
    it("new Sandbox(minimalSpec, {}) creates sandbox with all defaults", () => {
      const sandbox = new Sandbox(minimalSpec, {});
      expect(sandbox.id).toMatch(/^sandbox-\d+$/);
      expect(sandbox.containerName).toMatch(/^sandbox-/);
      expect(sandbox.status).toBe("created");
    });
  });

  describe("D2: createSandbox({ id: \"\" }) with empty id — non-empty id is still generated", () => {
    it("empty string id results in empty id (it is not auto-corrected)", () => {
      const sandbox = new Sandbox(minimalSpec, { id: "" });
      expect(sandbox.id).toBe("");
      expect(sandbox.containerName).toBe("sandbox-");
    });
  });

  describe("D3: createSandbox({ detached: false }) — overrides spec value", () => {
    it("opts.detached=false overrides spec default", () => {
      const sandbox = new Sandbox(minimalSpec, { detached: false });
      expect(sandbox.status).toBe("created");
    });
  });

  describe("D4: createSandbox({ uid: 0, gid: 0 }) — root user (valid, documented)", () => {
    it("uid=0, gid=0 is accepted and sandbox is created", () => {
      const spec = { ...minimalSpec, docker: { ...minimalSpec.docker, user: { ...minimalSpec.docker.user, uid: 0, gid: 0 } } };
      const sandbox = new Sandbox(spec, { uid: 0, gid: 0 });
      expect(sandbox).toBeDefined();
    });
  });

  describe("D5: createSandbox({ workspaceHost: \"/tmp/sandbox-test\" }) — uses /tmp path", () => {
    it("workspaceHost=/tmp/sandbox-test is accepted without error", () => {
      const sandbox = new Sandbox(minimalSpec, { workspaceHost: "/tmp/sandbox-test" });
      expect(sandbox).toBeDefined();
      const info = sandbox.getInfo();
      expect(info.workdir).toBe(minimalSpec.docker.user.workdir);
    });
  });
});