import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(
  __dirname,
  "../../../../../micro-spec/sandbox/scripts/launch-sandbox.toml"
);

// Path to the runtime launcher module that the green phase must add.
// The contract is: launchFromSpec(spec) returns a plan that reports exactly
// 1 container (per ADR 0004 — sub-agents live in panes, not new containers).
const RUNTIME_LAUNCH_PATH =
  "../../../../../micro-impl/sandbox/impl/runtime/launch.js";

async function loadSpec(): Promise<any> {
  const text = await readFile(SPEC_PATH, "utf8");
  return parseToml(text);
}

async function importRuntime(): Promise<any> {
  // Dynamic import with a non-literal path so TypeScript does not try to
  // resolve the module at compile time (this file does not exist yet).
  return await import(RUNTIME_LAUNCH_PATH);
}

describe("F1: 1 container per launch, data-driven from launch-sandbox.toml", () => {
  describe("spec declares single-container mode (top-level [launch] section)", () => {
    it("has a top-level [launch] section", async () => {
      const s = await loadSpec();
      expect(s.launch).toBeDefined();
    });

    it("[launch].mode is 'single-container'", async () => {
      const s = await loadSpec();
      expect(s.launch?.mode).toBe("single-container");
    });

    it("[launch].mode is NOT 'multi-container' (would re-introduce the original anti-pattern)", async () => {
      const s = await loadSpec();
      expect(s.launch?.mode).not.toBe("multi-container");
    });
  });

  describe("container-relevant fields are present in the TOML (no launcher hardcoding)", () => {
    it("spec declares a container image (string, non-empty)", async () => {
      const s = await loadSpec();
      const image = s.image?.base ?? s.launch?.image;
      expect(typeof image).toBe("string");
      expect(image.length).toBeGreaterThan(0);
    });

    it("spec declares the agent user name (string)", async () => {
      const s = await loadSpec();
      const name = s.user?.name ?? s.image?.agent_user;
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    });

    it("spec declares the agent uid and gid (numbers)", async () => {
      const s = await loadSpec();
      const uid = s.user?.uid ?? s.image?.agent_uid;
      const gid = s.user?.gid ?? s.image?.agent_gid;
      expect(typeof uid).toBe("number");
      expect(typeof gid).toBe("number");
    });

    it("spec declares the agent workdir (absolute path string)", async () => {
      const s = await loadSpec();
      const workdir = s.user?.workdir ?? s.launch?.workdir;
      expect(typeof workdir).toBe("string");
      expect(workdir.startsWith("/")).toBe(true);
    });
  });

  describe("launchFromSpec() runtime export reports exactly one container", () => {
    it("is exported as a function from micro-impl/sandbox/impl/runtime/launch.js", async () => {
      const mod = await importRuntime();
      expect(typeof mod.launchFromSpec).toBe("function");
    });

    it("returns a plan that reports exactly 1 container", async () => {
      const s = await loadSpec();
      const mod = await importRuntime();
      const plan = await mod.launchFromSpec(s);
      const count =
        plan?.containers ??
        plan?.containerCount ??
        (Array.isArray(plan) ? plan.length : undefined);
      expect(count).toBe(1);
    });

    it("does NOT report 0 containers", async () => {
      const s = await loadSpec();
      const mod = await importRuntime();
      const plan = await mod.launchFromSpec(s);
      const count =
        plan?.containers ??
        plan?.containerCount ??
        (Array.isArray(plan) ? plan.length : undefined);
      expect(count).not.toBe(0);
    });

    it("does NOT report more than 1 container (sub-agents are panes per ADR 0004)", async () => {
      const s = await loadSpec();
      const mod = await importRuntime();
      const plan = await mod.launchFromSpec(s);
      const count =
        plan?.containers ??
        plan?.containerCount ??
        (Array.isArray(plan) ? plan.length : undefined);
      expect(count).not.toBeGreaterThan(1);
    });
  });
});
