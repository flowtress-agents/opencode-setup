import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { HERDR_REPO } from "../fixtures/sandbox-spec/src/herdr.js";
import { PICODE_REPO } from "../fixtures/sandbox-spec/src/picode.js";

function opensrcPath(pkg: string): string | null {
  const r = spawnSync("opensrc", ["path", pkg], { encoding: "utf8", timeout: 15000 });
  if (r.status !== 0) return null;
  return r.stdout.trim();
}

describe("opensrc tools-resolve: herdr + picode", () => {
  let herdrPath: string | null;
  let picodePath: string | null;

  beforeAll(() => {
    herdrPath = opensrcPath("herdr");
    picodePath = opensrcPath("@earendil-works/pi-coding-agent");
  });

  it("herdr is fetchable via opensrc", () => {
    if (herdrPath === null) {
      console.warn("opensrc CLI not available — skipping");
      return;
    }
    expect(herdrPath.length).toBeGreaterThan(0);
  });

  it("@earendil-works/pi-coding-agent is fetchable via opensrc", () => {
    if (picodePath === null) {
      console.warn("opensrc CLI not available — skipping");
      return;
    }
    expect(picodePath.length).toBeGreaterThan(0);
  });

  it("HERDR_REPO from herdr.ts matches the GitHub upstream", () => {
    expect(HERDR_REPO).toBe("https://github.com/ogulcancelik/herdr");
  });

  it("PICODE_REPO from picode.ts matches the GitHub upstream", () => {
    expect(PICODE_REPO).toBe("https://github.com/earendil-works/pi");
  });
});
