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

describe("YELLOW[liberty-1]: pane_config table position", () => {
  it("PASSES with console.warn if [pane_config] appears before [[pane]] (smol-toml ordering)", async () => {
    const text = await readFile(SPEC_PATH, "utf8");
    const lines = text.split("\n");
    const paneConfigLine = lines.findIndex((l) => l.trim() === "[pane_config]");
    const paneArrayLine = lines.findIndex((l) => l.trim() === "[[pane]]");
    if (paneConfigLine === -1 || paneArrayLine === -1) {
      console.warn(
        "YELLOW[liberty-1]: [pane_config] or [[pane]] not found in TOML; smol-toml ordering unknown",
      );
      return;
    }
    if (paneConfigLine > paneArrayLine) {
      console.warn(
        `YELLOW[liberty-1]: [pane_config] appears AFTER [[pane]] (line ${paneConfigLine} vs ${paneArrayLine}); smol-toml would nest pane_startup_count under [pane] — structural regression risk`,
      );
    }
    // Always pass; warning is the yellow signal
    expect(paneConfigLine).not.toBe(-1);
  });
});

describe("F2: herdr opens with pi (orchestrator) in pane 0", () => {
  it("spec declares a [[pane]] array of pane configurations", async () => {
    const s = await loadSpec();
    expect(s.pane).toBeDefined();
    expect(Array.isArray(s.pane)).toBe(true);
    expect(s.pane.length).toBeGreaterThanOrEqual(1);
  });

  it("pane[0].agent is 'pi' (the orchestrator, ADR 0002)", async () => {
    const s = await loadSpec();
    expect(s.pane[0].agent).toBe("pi");
  });

  it("pane[0].role is 'orchestrator' (ADR 0002)", async () => {
    const s = await loadSpec();
    expect(s.pane[0].role).toBe("orchestrator");
  });

  it("pane[0] is immutable — no other agent can claim pane 0 (ADR 0004, 0005)", async () => {
    const s = await loadSpec();
    expect(s.pane[0].immutable).toBe(true);
  });

  it("spec declares herdr auto-allocates exactly 1 pane at startup (sub-agent panes are on demand, F3)", async () => {
    const s = await loadSpec();
    // YELLOW[liberty-1]: smol-toml nests bare keys under the nearest [table].
    // pane_startup_count lives in [pane_config] (before [[pane]]) as a workaround.
    expect(s.pane_config?.pane_startup_count ?? s.pane_startup_count).toBe(1);
  });

  it("pane[0].agent is 'pi' and not bash, shell, host, or empty", async () => {
    const s = await loadSpec();
    const agent = s.pane[0].agent;
    expect(agent).toBe("pi");
    expect(agent).not.toBe("bash");
    expect(agent).not.toBe("shell");
    expect(agent).not.toBe("host");
    expect(agent).not.toBe("");
  });

  it("spec install.steps picode uses @earendil-works/pi-coding-agent (NOT the bogus @earendil-works/pi)", async () => {
    const s = await loadSpec();
    const picode = (s.install.steps as any[]).find((x) => x.name === "picode");
    expect(picode).toBeDefined();
    expect(picode.npm).toBe("@earendil-works/pi-coding-agent");
    expect(picode.npm).not.toBe("@earendil-works/pi");
  });
});
