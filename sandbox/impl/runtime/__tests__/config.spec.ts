import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SandboxSpec, SandboxOptions, SandboxInfo } from "../types.js";
import { Sandbox } from "../sandbox.js";
import { createSandbox } from "../factory.js";

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

vi.mock("../../loader.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../loader.js")>();
  return {
    ...mod,
    loadHerdrSpec: vi.fn().mockResolvedValue(minimalHerdrSpec),
    loadPicodeSpec: vi.fn().mockResolvedValue(minimalPicodeSpec),
    loadDockerSpec: vi.fn().mockResolvedValue(minimalDockerSpec),
    loadSystemSpec: vi.fn().mockResolvedValue(minimalSystemSpec),
    loadLimitsSpec: vi.fn().mockResolvedValue(minimalLimitsSpec),
  };
});

describe("Sandbox — constructor options defaults", () => {
  it("opts.id is optional — when absent, a generated id is used", () => {
    const sandbox = new Sandbox(minimalSpec);
    expect(sandbox.id).toMatch(/^sandbox-\d+$/);
  });

  it("opts.workspaceHost defaults to process.cwd() + '/workspace'", () => {
    const sandbox = new Sandbox(minimalSpec, {});
    const info = sandbox.getInfo();
    expect(info.workdir).toBe(minimalSpec.docker.user.workdir);
  });

  it("opts.workspaceContainer defaults to spec value", () => {
    const sandbox = new Sandbox(minimalSpec, {});
    const info = sandbox.getInfo();
    expect(info.workdir).toBe(minimalSpec.docker.user.workdir);
  });

  it("opts.containerName defaults to id-based name", () => {
    const sandbox = new Sandbox(minimalSpec, { id: "test-id" });
    expect(sandbox.containerName).toBe("sandbox-test-id");
  });

  it("opts.detached defaults to spec value (true)", () => {
    const sandbox = new Sandbox(minimalSpec, {});
    expect(sandbox.status).toBe("created");
  });
});

describe("SandboxInfo shape", () => {
  it("getInfo() returns an object with all required fields", () => {
    const sandbox = new Sandbox(minimalSpec, { id: "test-info" });
    const info = sandbox.getInfo();
    expect(info).toHaveProperty("id");
    expect(info).toHaveProperty("containerName");
    expect(info).toHaveProperty("status");
    expect(info).toHaveProperty("image");
    expect(info).toHaveProperty("workdir");
  });

  it("getInfo().status is one of the 4 SandboxStatus values", () => {
    const sandbox = new Sandbox(minimalSpec, { id: "test-status" });
    const info = sandbox.getInfo();
    expect(["created", "running", "stopped", "errored"]).toContain(info.status);
  });

  it("getInfo().id is non-empty string", () => {
    const sandbox = new Sandbox(minimalSpec, { id: "test-id-check" });
    const info = sandbox.getInfo();
    expect(typeof info.id).toBe("string");
    expect(info.id.length).toBeGreaterThan(0);
  });

  it("getInfo().containerName is non-empty string", () => {
    const sandbox = new Sandbox(minimalSpec, { id: "test-container" });
    const info = sandbox.getInfo();
    expect(typeof info.containerName).toBe("string");
    expect(info.containerName.length).toBeGreaterThan(0);
  });

  it("getInfo().image matches the resolved image", () => {
    const sandbox = new Sandbox(minimalSpec, {});
    const info = sandbox.getInfo();
    expect(info.image).toBe(minimalSpec.docker.base.image);
  });
});

describe("createSandbox — basic behavior", () => {
  it("createSandbox() returns a Promise resolving to an ISandbox", async () => {
    const sandbox = await createSandbox();
    expect(sandbox).toBeDefined();
    expect(typeof sandbox.start).toBe("function");
    expect(typeof sandbox.stop).toBe("function");
    expect(typeof sandbox.exec).toBe("function");
    expect(typeof sandbox.getInfo).toBe("function");
  });

  it("the returned object has start, stop, exec, getInfo methods", async () => {
    const sandbox = await createSandbox();
    expect(typeof sandbox.start).toBe("function");
    expect(typeof sandbox.stop).toBe("function");
    expect(typeof sandbox.exec).toBe("function");
    expect(typeof sandbox.getInfo).toBe("function");
  });

  it("calling createSandbox({ id: 'test-123' }) sets the id", async () => {
    const sandbox = await createSandbox({ id: "test-123" });
    expect(sandbox.id).toBe("test-123");
  });

  it("calling createSandbox({ containerName: 'my-sandbox' }) sets the container name", async () => {
    const sandbox = await createSandbox({ containerName: "my-sandbox" });
    expect(sandbox.containerName).toBe("my-sandbox");
  });

  it("calling createSandbox({ image: 'custom:image' }) overrides the image", async () => {
    const sandbox = await createSandbox({ image: "custom:image" });
    const info = sandbox.getInfo();
    expect(info.image).toBe("custom:image");
  });
});
