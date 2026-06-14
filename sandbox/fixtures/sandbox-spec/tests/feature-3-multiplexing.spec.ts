import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "../../../../../micro-spec/sandbox/scripts/launch-sandbox.toml");
const MULTIPLEXING_MODULE_PATH = resolve(__dirname, "../src/multiplexing.js");

interface MultiplexingModule {
  PANE_DELEGATION_MODE: "spawn_new_tab";
  ONE_PANE_PER_AGENT: true;
  PARENT_PANE_REQUIRED: true;
  TAB_PER_AGENT_SESSION: true;
  MAX_SUB_AGENTS_PER_ORCHESTRATOR: number;
  MAX_PANE_DEPTH: number;
  spawnSubAgent: (parentPaneId: string, agentConfig: { name: string }) => SubAgentHandle;
}

interface SubAgentHandle {
  paneId: string;
  tabId: string;
  parentPaneId: string;
}

async function loadMultiplexing(): Promise<MultiplexingModule> {
  return (await import(MULTIPLEXING_MODULE_PATH)) as unknown as MultiplexingModule;
}

async function loadSpec(): Promise<any> {
  const text = await readFile(SPEC_PATH, "utf8");
  return parseToml(text);
}

describe("feature 3: herdr multiplexing — sub-agents in new tabs/workspaces (ADR 0004)", () => {
  describe("pane_delegation section in launch-sandbox.toml", () => {
    it("declares pane_delegation.mode = 'spawn_new_tab' (sub-agents occupy a new herdr tab/workspace)", async () => {
      const s = await loadSpec();
      expect(s.pane_delegation).toBeDefined();
      expect(s.pane_delegation.mode).toBe("spawn_new_tab");
    });

    it("declares pane_delegation.one_pane_per_agent = true (ADR 0004 pane control rule)", async () => {
      const s = await loadSpec();
      expect(s.pane_delegation).toBeDefined();
      expect(s.pane_delegation.one_pane_per_agent).toBe(true);
    });

    it("declares pane_delegation.parent_pane_required = true (sub-agent must record its parent pane)", async () => {
      const s = await loadSpec();
      expect(s.pane_delegation).toBeDefined();
      expect(s.pane_delegation.parent_pane_required).toBe(true);
    });

    it("declares pane_delegation.tab_per_agent_session = true (one tab per agent's session)", async () => {
      const s = await loadSpec();
      expect(s.pane_delegation).toBeDefined();
      expect(s.pane_delegation.tab_per_agent_session).toBe(true);
    });
  });

  describe("limits section extensions for orchestration (ADR 0005)", () => {
    it("declares limits.max_sub_agents_per_orchestrator = 8 (default cap per orchestrator)", async () => {
      const s = await loadSpec();
      expect(s.limits).toBeDefined();
      expect(s.limits.max_sub_agents_per_orchestrator).toBe(8);
    });

    it("declares limits.max_pane_depth = 3 (orchestrator → sub-orchestrator → sub-agent)", async () => {
      const s = await loadSpec();
      expect(s.limits).toBeDefined();
      expect(s.limits.max_pane_depth).toBe(3);
    });
  });

  describe("runtime multiplexing exports (../src/multiplexing.ts)", () => {
    it("exports PANE_DELEGATION_MODE constant equal to 'spawn_new_tab'", async () => {
      const m = await loadMultiplexing();
      expect(m.PANE_DELEGATION_MODE).toBe("spawn_new_tab");
    });

    it("exports ONE_PANE_PER_AGENT = true (ADR 0004)", async () => {
      const m = await loadMultiplexing();
      expect(m.ONE_PANE_PER_AGENT).toBe(true);
    });

    it("exports PARENT_PANE_REQUIRED = true (sub-agent must record its parent pane)", async () => {
      const m = await loadMultiplexing();
      expect(m.PARENT_PANE_REQUIRED).toBe(true);
    });

    it("exports TAB_PER_AGENT_SESSION = true (one tab per agent's session)", async () => {
      const m = await loadMultiplexing();
      expect(m.TAB_PER_AGENT_SESSION).toBe(true);
    });

    it("exports MAX_SUB_AGENTS_PER_ORCHESTRATOR = 8 (ADR 0005 default cap)", async () => {
      const m = await loadMultiplexing();
      expect(m.MAX_SUB_AGENTS_PER_ORCHESTRATOR).toBe(8);
    });

    it("exports MAX_PANE_DEPTH = 3 (ADR 0005 default cap)", async () => {
      const m = await loadMultiplexing();
      expect(m.MAX_PANE_DEPTH).toBe(3);
    });

    it("exports a spawnSubAgent function callable by the orchestrator", async () => {
      const m = await loadMultiplexing();
      expect(typeof m.spawnSubAgent).toBe("function");
    });

    it("spawnSubAgent returns a SubAgentHandle with paneId, tabId, parentPaneId", async () => {
      const m = await loadMultiplexing();
      // Stub the inputs the function will need in green phase.
      const fakeParentPaneId = "pane-0-orchestrator";
      const fakeAgentConfig = { name: "sub-agent-1" };

      const handle: SubAgentHandle = m.spawnSubAgent(fakeParentPaneId, fakeAgentConfig);

      expect(handle).toBeDefined();
      expect(typeof handle.paneId).toBe("string");
      expect(handle.paneId.length).toBeGreaterThan(0);
      expect(typeof handle.tabId).toBe("string");
      expect(handle.tabId.length).toBeGreaterThan(0);
      expect(handle.parentPaneId).toBe(fakeParentPaneId);
    });
  });
});
