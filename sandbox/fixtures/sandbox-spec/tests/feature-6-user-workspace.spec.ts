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

async function loadSpec(): Promise<any> {
  const text = await readFile(SPEC_PATH, "utf8");
  return parseToml(text);
}

async function loadUserWorkspaceModule(): Promise<any> {
  // Dynamic import via a non-literal path so TypeScript does not try to
  // resolve the module at compile time (this file does not exist yet).
  const path = resolve(__dirname, "../src/user-workspace.js");
  const mod = await import(path);
  return mod;
}

describe("F6: user has separate workspace for bash (orchestrator cannot interact)", () => {
  describe("spec (launch-sandbox.toml) declares the user workspace", () => {
    it("spec has a [user_workspace] section", async () => {
      const s = await loadSpec();
      expect(s.user_workspace).toBeDefined();
    });

    it("spec user_workspace.tab_id is 'user'", async () => {
      const s = await loadSpec();
      expect(s.user_workspace.tab_id).toBe("user");
    });

    it("spec user_workspace.agent is 'bash'", async () => {
      const s = await loadSpec();
      expect(s.user_workspace.agent).toBe("bash");
    });

    it("spec user_workspace.orchestrator_can_interact is false (explicit)", async () => {
      const s = await loadSpec();
      expect(s.user_workspace.orchestrator_can_interact).toBe(false);
    });

    it("spec user_workspace.user_can_inject_into_orchestrator is false (explicit)", async () => {
      const s = await loadSpec();
      expect(s.user_workspace.user_can_inject_into_orchestrator).toBe(false);
    });
  });

  describe("runtime exports the user workspace identity and predicate", () => {
    it("USER_WORKSPACE_TAB_ID is exported and equals 'user'", async () => {
      const mod = await loadUserWorkspaceModule();
      expect(mod.USER_WORKSPACE_TAB_ID).toBe("user");
    });

    it("isUserWorkspace('user') returns true (user's bash tab)", async () => {
      const mod = await loadUserWorkspaceModule();
      expect(mod.isUserWorkspace("user")).toBe(true);
    });

    it("isUserWorkspace('agent-0') returns false (sub-agent pane)", async () => {
      const mod = await loadUserWorkspaceModule();
      expect(mod.isUserWorkspace("agent-0")).toBe(false);
    });

    it("isUserWorkspace('orchestrator') returns false (orchestrator pane)", async () => {
      const mod = await loadUserWorkspaceModule();
      expect(mod.isUserWorkspace("orchestrator")).toBe(false);
    });
  });
});
