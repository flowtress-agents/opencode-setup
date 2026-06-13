import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = resolve(__dirname, "../../../../../micro-spec/sandbox/scripts/launch-sandbox.toml");

async function loadSpec(): Promise<any> {
  const text = await readFile(SPEC_PATH, "utf8");
  return parseToml(text);
}

describe("launch-sandbox spec", () => {
  it("image.base is node:22-bookworm", async () => {
    const s = await loadSpec();
    expect(s.image.base).toBe("node:22-bookworm");
  });
  it("image.agent_uid is 1000", async () => {
    const s = await loadSpec();
    expect(s.image.agent_uid).toBe(1000);
  });
  it("build.context_strategy is tempfile (NOT stdin)", async () => {
    const s = await loadSpec();
    expect(s.build.context_strategy).toBe("tempfile");
  });
  it("build.build_timeout_sec is set", async () => {
    const s = await loadSpec();
    expect(s.build.build_timeout_sec).toBeGreaterThan(0);
  });
  it("install.steps includes a picode step with @earendil-works/pi-coding-agent", async () => {
    const s = await loadSpec();
    const picode = (s.install.steps as any[]).find((x) => x.name === "picode");
    expect(picode).toBeDefined();
    expect(picode.npm).toBe("@earendil-works/pi-coding-agent");
    expect(picode.npm).not.toBe("@earendil-works/pi");
  });
  it("install.steps includes a herdr step with fallback_cmd", async () => {
    const s = await loadSpec();
    const herdr = (s.install.steps as any[]).find((x) => x.name === "herdr");
    expect(herdr).toBeDefined();
    expect(herdr.fallback_cmd).toContain("github.com/ogulcancelik/herdr");
  });
  it("entrypoint.form is 'cmd' with /bin/bash and supports_sleep_infinity", async () => {
    const s = await loadSpec();
    expect(s.entrypoint.form).toBe("cmd");
    expect(s.entrypoint.cmd).toEqual(["/bin/bash"]);
    expect(s.entrypoint.supports_sleep_infinity).toBe(true);
  });
  it("image.uid_collision_strategy is set (NOT 'fail' which would re-introduce the original bug)", async () => {
    const s = await loadSpec();
    expect(s.image.uid_collision_strategy).toBe("shift_to_first_free");
  });
});
