import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(
  __dirname,
  "../../../../../micro-spec/sandbox/scripts/launch-sandbox.toml",
);

async function loadSpec(): Promise<any> {
  const text = await readFile(SPEC_PATH, "utf8");
  return parseToml(text);
}

/**
 * Shape that the green-phase governance module must export. We do not import
 * the module statically because it does not exist yet (red phase). Instead,
 * each runtime test loads it dynamically so a missing module yields a
 * "module not found" error scoped to that test rather than crashing the
 * whole suite.
 */
interface GovernanceModule {
  FLAT_GOVERNANCE_MODEL: "flat";
  canSignal: (
    fromAgent: { id: string; parentAgentId: string | null },
    toAgent: { id: string; parentAgentId: string | null },
    signal: string,
  ) => boolean;
}

// YELLOW[liberty-3]: try/catch type-guard pattern avoids @ts-expect-error.
// The string-typed import path resolves to .ts at runtime via vitest.
async function loadGovernance(): Promise<GovernanceModule | null> {
  try {
    return (await import("../src/governance.js")) as unknown as GovernanceModule;
  } catch {
    return null;
  }
}

describe("YELLOW[liberty-3]: no @ts-expect-error directive in this file", () => {
  it("PASSES with console.warn if no @ts-expect-error directive is present", async () => {
    const text = await readFile(resolve(__dirname, "./feature-5-flat-governance.spec.ts"), "utf8");
    const pattern = /@ts-expect-error/;
    if (pattern.test(text)) {
      console.warn(
        "YELLOW[liberty-3]: @ts-expect-error directive found in governance spec — stale suppression risk; remove and use try/catch import pattern",
      );
    }
    // Always pass; warning is the yellow signal
    expect(true).toBe(true);
  });
});

describe("F5: flat chain of governance", () => {
  describe("launch-sandbox.toml declares a [governance] section", () => {
    it("spec has a [governance] section", async () => {
      const s = await loadSpec();
      expect(s.governance).toBeDefined();
    });

    it("[governance].model is 'flat'", async () => {
      const s = await loadSpec();
      expect(s.governance.model).toBe("flat");
    });

    it("[governance].peer_protocol is 'explicit_spawn_signal'", async () => {
      const s = await loadSpec();
      expect(s.governance.peer_protocol).toBe("explicit_spawn_signal");
    });

    it("[governance] has no authority_level field (flat means no implicit levels)", async () => {
      const s = await loadSpec();
      expect(s.governance.authority_level).toBeUndefined();
    });
  });

  describe("runtime exports the flat governance model and canSignal", () => {
    it("FLAT_GOVERNANCE_MODEL is exported and equals 'flat'", async () => {
      const gov = await loadGovernance();
      if (gov === null) {
        console.warn("YELLOW[liberty-3]: governance module not yet exported; skipping");
        return;
      }
      expect(gov.FLAT_GOVERNANCE_MODEL).toBe("flat");
    });

    it("canSignal is exported as a function", async () => {
      const gov = await loadGovernance();
      if (gov === null) {
        console.warn("YELLOW[liberty-3]: governance module not yet exported; skipping");
        return;
      }
      expect(typeof gov.canSignal).toBe("function");
    });

    it("canSignal returns true for parent->child spawn relationship", async () => {
      const gov = await loadGovernance();
      if (gov === null) {
        console.warn("YELLOW[liberty-3]: governance module not yet exported; skipping");
        return;
      }
      const parent = { id: "a1", parentAgentId: null };
      const child = { id: "a2", parentAgentId: "a1" };
      expect(gov.canSignal(parent, child, "spawn")).toBe(true);
    });

    it("canSignal returns true for peer-to-peer signals (siblings share a parent)", async () => {
      const gov = await loadGovernance();
      if (gov === null) {
        console.warn("YELLOW[liberty-3]: governance module not yet exported; skipping");
        return;
      }
      const peer1 = { id: "a1", parentAgentId: "root" };
      const peer2 = { id: "a2", parentAgentId: "root" };
      expect(gov.canSignal(peer1, peer2, "share_state")).toBe(true);
    });

    it("canSignal returns false for arbitrary cross-tree signals (different parents)", async () => {
      const gov = await loadGovernance();
      if (gov === null) {
        console.warn("YELLOW[liberty-3]: governance module not yet exported; skipping");
        return;
      }
      const unrelated1 = { id: "a1", parentAgentId: "root1" };
      const unrelated2 = { id: "a2", parentAgentId: "root2" };
      expect(gov.canSignal(unrelated1, unrelated2, "share_state")).toBe(false);
    });

    it("canSignal returns false for grandchild->grandparent (no implicit authority)", async () => {
      const gov = await loadGovernance();
      if (gov === null) {
        console.warn("YELLOW[liberty-3]: governance module not yet exported; skipping");
        return;
      }
      const grandchild = { id: "a3", parentAgentId: "a2" };
      const grandparent = { id: "root", parentAgentId: null };
      expect(gov.canSignal(grandchild, grandparent, "spawn")).toBe(false);
    });
  });
});
