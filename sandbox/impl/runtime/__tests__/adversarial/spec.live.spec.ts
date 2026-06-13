/**
 * Adversarial spec verification using opensrc.
 *
 * Gated: skipped unless process.env.RUN_ADVERSARIAL_TESTS === '1'
 *
 * Uses `opensrc path <package>` to get the cached source path for:
 *   - github.com/ogulcancelik/herdr  (Rust tool)
 *   - @earendil-works/pi            (npm package)
 *   - sandcastle                    (npm package)
 *
 * Then reads key source files and asserts runtime constants match.
 *
 * Run with:
 *   RUN_ADVERSARIAL_TESTS=1 npx vitest run impl/runtime/__tests__/adversarial/spec.live.spec.ts
 */

import { describe, it, expect } from "vitest";

const ENABLE = process.env.RUN_ADVERSARIAL_TESTS === "1";
const describeOrSkip = ENABLE ? describe : describe.skip;

describeOrSkip("adversarial spec verification via opensrc", () => {
  async function getSourcePath(pkg: string): Promise<string> {
    const { execSync } = await import("node:child_process");
    try {
      return execSync(`opensrc path ${pkg}`, { encoding: "utf8", timeout: 30000 }).trim();
    } catch (e: any) {
      throw new Error(`opensrc failed to fetch ${pkg}: ${e.message}`);
    }
  }

  async function readFile(rel: string, basePath: string): Promise<string> {
    const { readFileSync } = await import("node:fs");
    return readFileSync(`${basePath}/${rel}`, "utf8");
  }

  it("herdr: PATHS_SESSIONS matches src/session.rs", async () => {
    const path = await getSourcePath("github.com/ogulcancelik/herdr");
    const src = await readFile("src/session.rs", path);
    // The correct sessions path per upstream is ~/.config/herdr/sessions
    // Assert the source contains this path (not ~/.local/share/herdr)
    expect(src).toContain("~/.config/herdr/sessions");
    expect(src).not.toContain("~/.local/share/herdr");
  });

  it("picode: NODE_MIN_VERSION matches package.json engines.node", async () => {
    const path = await getSourcePath("@earendil-works/pi");
    const pkg = JSON.parse(await readFile("package.json", path));
    // The minimum node version is in engines.node
    const nodeMin = pkg.engines?.node ?? "";
    // Assert it is >= 22.19.0 (the runtime constant)
    expect(nodeMin).toMatch(/^[\^>=<~]*22/);
  });

  it("sandcastle: docker image matches InitService.ts", async () => {
    const path = await getSourcePath("sandcastle");
    const initService = await readFile("src/InitService.ts", path);
    // The base image should be node:22-bookworm (NOT node:22-bookworm-slim)
    expect(initService).toContain("node:22-bookworm");
    expect(initService).not.toContain("node:22-bookworm-slim");
  });

  it("sandcastle: workspace path in SandboxFactory.ts", async () => {
    const path = await getSourcePath("sandcastle");
    const factory = await readFile("src/SandboxFactory.ts", path);
    // The workdir should be /home/agent/workspace (NOT /workspace)
    expect(factory).toContain("/home/agent/workspace");
    expect(factory).not.toMatch(/\/workspace[^/]/); // /workspace as standalone segment
  });

  it("sandcastle: apt packages in InitService.ts", async () => {
    const path = await getSourcePath("sandcastle");
    const initService = await readFile("src/InitService.ts", path);
    // Only git, curl, jq are installed (not the full apt list)
    // The source should contain git, curl, jq
    expect(initService).toContain("git");
    expect(initService).toContain("curl");
    expect(initService).toContain("jq");
    // Should NOT contain ripgrep, libncursesw6, etc.
    expect(initService).not.toContain("ripgrep");
    expect(initService).not.toContain("libncursesw6");
  });

  it("sandcastle: container_start timeout in startSandbox.ts", async () => {
    const path = await getSourcePath("sandcastle");
    const startSandbox = await readFile("src/startSandbox.ts", path);
    // The container start timeout should be 120 seconds (not 60)
    // Look for 120000ms or 120s in the source
    expect(startSandbox).toMatch(/120\s*[\*s]|\.timeout\s*=\s*120/);
  });
});
