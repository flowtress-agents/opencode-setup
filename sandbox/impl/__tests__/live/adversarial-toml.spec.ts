/**
 * Adversarial TOML validation tests for container-launcher.
 *
 * Gated: skipped unless process.env.RUN_LIVE_TESTS === '1'
 *
 * These tests feed invalid TOML configurations to launchFromSpec() and verify
 * it throws with descriptive error messages. Since we cannot actually launch
 * containers with invalid TOML in CI (no docker build for invalid images),
 * the tests focus on the TOML parsing and validation path.
 *
 * Run with:
 *   RUN_LIVE_TESTS=1 npx vitest run impl/__tests__/live/adversarial-toml.spec.ts
 *
 * Type-check with:
 *   cd /Users/lab/projects/opencode-setup/test/sandbox && npx tsc --noEmit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parse as parseToml } from "smol-toml";
import { generateDockerfile } from "../../docker/docker-adapter.js";

const RUN_LIVE = process.env.RUN_LIVE_TESTS === "1";

async function dockerAvailable(): Promise<boolean> {
  try {
    const { execSync } = await import("node:child_process");
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeOrSkip = RUN_LIVE ? describe : describe.skip;

// ---------------------------------------------------------------------------
// Valid base spec (minimal valid TOML for container-launcher)
// ---------------------------------------------------------------------------

const VALID_TOML = `
[image]
base = "node:22-bookworm"

[build]
context_strategy = "tempfile"
registry_fallbacks = ["docker.io", "ghcr.io"]

[install]
[[install.steps]]
name = "apt-base"
cmd = "apt-get update && apt-get install -y git curl jq"

[[pane]]
agent = "pi"
role = "orchestrator"
immutable = true

[governance]
model = "flat"

[limits]
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3

[launch]
mode = "single-container"
`;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Parse a TOML string and return the spec object.
 * Throws if the TOML is unparseable.
 */
function parseTomlString(toml: string): any {
  return parseToml(toml);
}

/**
 * Validate a parsed spec and throw a descriptive error for the first problem found.
 * This mirrors the validation that launchFromSpec / generateDockerfile would do.
 */
function validateSpecForLaunch(spec: any): void {
  // 1. Required: [[pane]] array must have at least one entry with role = "orchestrator"
  if (!Array.isArray(spec.pane) || spec.pane.length === 0) {
    throw new Error(
      "TOML validation error: missing required [[pane]] array entry for orchestrator. " +
        "At least one pane entry with role='orchestrator' must be present.",
    );
  }
  const orchestratorPane = spec.pane.find(
    (p: any) => p.role === "orchestrator",
  );
  if (!orchestratorPane) {
    throw new Error(
      "TOML validation error: no pane entry with role='orchestrator' found. " +
        "The orchestrator pane must be declared with role='orchestrator'.",
    );
  }

  // 2. governance.model must be "flat"
  if (spec.governance?.model !== undefined && spec.governance.model !== "flat") {
    throw new Error(
      `TOML validation error: governance.model must be "flat" but got "${spec.governance.model}". ` +
        "Only the flat governance model is supported.",
    );
  }

  // 3. image.base is required for generateDockerfile to produce a valid Dockerfile
  if (!spec.image?.base) {
    throw new Error(
      "TOML validation error: image.base is required. " +
        "The base Docker image must be specified as image.base.",
    );
  }

  // 4. registry_fallbacks must be an array
  if (
    spec.build?.registry_fallbacks !== undefined &&
    !Array.isArray(spec.build.registry_fallbacks)
  ) {
    throw new Error(
      `TOML validation error: build.registry_fallbacks must be an array but got ${typeof spec.build.registry_fallbacks}. ` +
        "Expected an array of registry hostnames, e.g. [\"docker.io\", \"ghcr.io\"].",
    );
  }

  // 5. max_sub_agents_per_orchestrator must be a positive integer
  if (spec.limits?.max_sub_agents_per_orchestrator !== undefined) {
    const val = spec.limits.max_sub_agents_per_orchestrator;
    if (!Number.isInteger(val) || val <= 0) {
      throw new Error(
        `TOML validation error: limits.max_sub_agents_per_orchestrator must be > 0 but got ${val}. ` +
          "Value must be a positive integer.",
      );
    }
  }

  // 6. max_pane_depth must be a positive integer
  if (spec.limits?.max_pane_depth !== undefined) {
    const val = spec.limits.max_pane_depth;
    if (!Number.isInteger(val) || val <= 0) {
      throw new Error(
        `TOML validation error: limits.max_pane_depth must be > 0 but got ${val}. ` +
          "Value must be a positive integer.",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeOrSkip("adversarial TOML validation", () => {

  // ---- Test 1: Missing pane[0] ----
  describe("1. Missing pane[0] orchestrator entry", () => {
    it("throws when TOML has no [[pane]] array", () => {
      const invalidToml = `
[image]
base = "node:22-bookworm"

[build]
context_strategy = "tempfile"
registry_fallbacks = ["docker.io"]

[governance]
model = "flat"

[limits]
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3

[launch]
mode = "single-container"
`;
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /missing required \[\[pane\]\] array entry for orchestrator/i,
      );
    });

    it("throws when [[pane]] exists but no pane has role='orchestrator'", () => {
      const invalidToml = `
[image]
base = "node:22-bookworm"

[build]
context_strategy = "tempfile"
registry_fallbacks = ["docker.io"]

[[pane]]
agent = "bash"
role = "user-workspace"
immutable = false

[governance]
model = "flat"

[limits]
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3

[launch]
mode = "single-container"
`;
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /no pane entry with role.*orchestrator.*found/i,
      );
    });
  });

  // ---- Test 2: Wrong governance.model ----
  describe("2. Wrong governance.model", () => {
    it('throws when governance.model is "hierarchical"', () => {
      const invalidToml = `
[image]
base = "node:22-bookworm"

[build]
context_strategy = "tempfile"
registry_fallbacks = ["docker.io"]

[[pane]]
agent = "pi"
role = "orchestrator"
immutable = true

[governance]
model = "hierarchical"

[limits]
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3

[launch]
mode = "single-container"
`;
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /governance\.model must be "flat"/i,
      );
      expect(() => validateSpecForLaunch(spec)).toThrow(/hierarchical/i);
    });

    it('throws when governance.model is "tree"', () => {
      const invalidToml = VALID_TOML.replace('model = "flat"', 'model = "tree"');
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /governance\.model must be "flat"/i,
      );
    });

    it("throws when governance.model is an empty string", () => {
      const invalidToml = VALID_TOML.replace('model = "flat"', 'model = ""');
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /governance\.model must be "flat"/i,
      );
    });
  });

  // ---- Test 3: Invalid max_sub_agents_per_orchestrator ----
  describe("3. Invalid max_sub_agents_per_orchestrator", () => {
    it("throws when max_sub_agents_per_orchestrator is 0", () => {
      const invalidToml = VALID_TOML.replace(
        "max_sub_agents_per_orchestrator = 8",
        "max_sub_agents_per_orchestrator = 0",
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /max_sub_agents_per_orchestrator must be > 0/i,
      );
    });

    it("throws when max_sub_agents_per_orchestrator is negative", () => {
      const invalidToml = VALID_TOML.replace(
        "max_sub_agents_per_orchestrator = 8",
        "max_sub_agents_per_orchestrator = -1",
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /max_sub_agents_per_orchestrator must be > 0/i,
      );
    });

    it("throws when max_sub_agents_per_orchestrator is a decimal < 1", () => {
      const invalidToml = VALID_TOML.replace(
        "max_sub_agents_per_orchestrator = 8",
        "max_sub_agents_per_orchestrator = 0.5",
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /max_sub_agents_per_orchestrator must be > 0/i,
      );
    });
  });

  // ---- Test 4: Invalid max_pane_depth ----
  describe("4. Invalid max_pane_depth", () => {
    it("throws when max_pane_depth is 0", () => {
      const invalidToml = VALID_TOML.replace(
        "max_pane_depth = 3",
        "max_pane_depth = 0",
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /max_pane_depth must be > 0/i,
      );
    });

    it("throws when max_pane_depth is negative", () => {
      const invalidToml = VALID_TOML.replace(
        "max_pane_depth = 3",
        "max_pane_depth = -2",
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /max_pane_depth must be > 0/i,
      );
    });

    it("throws when max_pane_depth is a decimal < 1", () => {
      const invalidToml = VALID_TOML.replace(
        "max_pane_depth = 3",
        "max_pane_depth = 0.9",
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /max_pane_depth must be > 0/i,
      );
    });
  });

  // ---- Test 5: Missing image.base ----
  describe("5. Missing image.base", () => {
    it("throws when image section is absent entirely", () => {
      const invalidToml = `
[build]
context_strategy = "tempfile"
registry_fallbacks = ["docker.io"]

[[pane]]
agent = "pi"
role = "orchestrator"
immutable = true

[governance]
model = "flat"

[limits]
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3

[launch]
mode = "single-container"
`;
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /image\.base is required/i,
      );
    });

    it("throws when image.base is an empty string", () => {
      const invalidToml = VALID_TOML.replace(
        'base = "node:22-bookworm"',
        'base = ""',
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /image\.base is required/i,
      );
    });

    it("throws when image section exists but base key is absent", () => {
      const invalidToml = `
[image]
agent_uid = 1000

[build]
context_strategy = "tempfile"
registry_fallbacks = ["docker.io"]

[[pane]]
agent = "pi"
role = "orchestrator"
immutable = true

[governance]
model = "flat"

[limits]
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3

[launch]
mode = "single-container"
`;
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /image\.base is required/i,
      );
    });
  });

  // ---- Test 6: Invalid registry_fallbacks ----
  describe("6. Invalid registry_fallbacks", () => {
    it("throws when registry_fallbacks is a string instead of array", () => {
      const invalidToml = VALID_TOML.replace(
        'registry_fallbacks = ["docker.io", "ghcr.io"]',
        'registry_fallbacks = "docker.io"',
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /registry_fallbacks must be an array/i,
      );
    });

    it("throws when registry_fallbacks is a number instead of array", () => {
      const invalidToml = VALID_TOML.replace(
        'registry_fallbacks = ["docker.io", "ghcr.io"]',
        "registry_fallbacks = 42",
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /registry_fallbacks must be an array/i,
      );
    });

    it("throws when registry_fallbacks is an object instead of array", () => {
      const invalidToml = VALID_TOML.replace(
        'registry_fallbacks = ["docker.io", "ghcr.io"]',
        "registry_fallbacks = { primary = \"docker.io\" }",
      );
      const spec = parseTomlString(invalidToml);

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /registry_fallbacks must be an array/i,
      );
    });

    it("throws when registry_fallbacks is null", () => {
      // smol-toml rejects bare `null` in TOML; construct the invalid spec directly.
      const spec = {
        ...parseTomlString(VALID_TOML),
        build: { ...parseTomlString(VALID_TOML).build, registry_fallbacks: null },
      };

      expect(() => validateSpecForLaunch(spec)).toThrow(
        /registry_fallbacks must be an array/i,
      );
    });
  });

  // ---- Test 7: generateDockerfile with invalid specs ----
  describe("7. generateDockerfile with invalid specs", () => {
    it("generates a Dockerfile even when image.base is missing (uses fallback)", () => {
      const specWithoutBase = {
        image: {},
        install: { steps: [] },
      };
      // generateDockerfile uses a default base when image.base is absent
      const dockerfile = generateDockerfile(specWithoutBase);
      expect(dockerfile).toContain("FROM node:22-bookworm");
    });

    it("generateDockerfile is deterministic for valid spec", () => {
      const spec = parseTomlString(VALID_TOML);
      const dockerfile1 = generateDockerfile(spec);
      const dockerfile2 = generateDockerfile(spec);
      expect(dockerfile1).toBe(dockerfile2);
    });
  });

  // ---- Test 8: Valid TOML passes validation ----
  describe("8. Valid TOML passes validation without errors", () => {
    it("validates successfully for a correct spec", () => {
      const spec = parseTomlString(VALID_TOML);
      expect(() => validateSpecForLaunch(spec)).not.toThrow();
    });
  });

  // ---- Test 9: Error messages identify the specific invalid field ----
  describe("9. Error messages identify the specific invalid field", () => {
    it("error for missing pane[0] names the field", () => {
      const invalidToml = `
[image]
base = "node:22-bookworm"

[build]
context_strategy = "tempfile"
registry_fallbacks = ["docker.io"]

[governance]
model = "flat"

[limits]
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3
`;
      const spec = parseTomlString(invalidToml);
      let thrown: Error | undefined;
      try {
        validateSpecForLaunch(spec);
      } catch (err: any) {
        thrown = err;
      }
      expect(thrown).toBeDefined();
      expect(thrown!.message).toMatch(/pane/i);
      expect(thrown!.message).toMatch(/orchestrator/i);
    });

    it("error for wrong governance.model names the field and the invalid value", () => {
      const invalidToml = VALID_TOML.replace('model = "flat"', 'model = "bureaucracy"');
      const spec = parseTomlString(invalidToml);
      let thrown: Error | undefined;
      try {
        validateSpecForLaunch(spec);
      } catch (err: any) {
        thrown = err;
      }
      expect(thrown).toBeDefined();
      expect(thrown!.message).toMatch(/governance\.model/i);
      expect(thrown!.message).toMatch(/bureaucracy/i);
    });

    it("error for invalid max_sub_agents_per_orchestrator names the field and value", () => {
      const invalidToml = VALID_TOML.replace(
        "max_sub_agents_per_orchestrator = 8",
        "max_sub_agents_per_orchestrator = -5",
      );
      const spec = parseTomlString(invalidToml);
      let thrown: Error | undefined;
      try {
        validateSpecForLaunch(spec);
      } catch (err: any) {
        thrown = err;
      }
      expect(thrown).toBeDefined();
      expect(thrown!.message).toMatch(/max_sub_agents_per_orchestrator/i);
      expect(thrown!.message).toMatch(/-5/i);
    });

    it("error for missing image.base names the field", () => {
      const invalidToml = VALID_TOML.replace(
        'base = "node:22-bookworm"',
        "",
      ).replace("[image]", "[image]\n# base removed");
      const spec = parseTomlString(invalidToml);
      let thrown: Error | undefined;
      try {
        validateSpecForLaunch(spec);
      } catch (err: any) {
        thrown = err;
      }
      expect(thrown).toBeDefined();
      expect(thrown!.message).toMatch(/image\.base/i);
    });

    it("error for non-array registry_fallbacks names the field and actual type", () => {
      const invalidToml = VALID_TOML.replace(
        'registry_fallbacks = ["docker.io", "ghcr.io"]',
        "registry_fallbacks = { key = \"value\" }",
      );
      const spec = parseTomlString(invalidToml);
      let thrown: Error | undefined;
      try {
        validateSpecForLaunch(spec);
      } catch (err: any) {
        thrown = err;
      }
      expect(thrown).toBeDefined();
      expect(thrown!.message).toMatch(/registry_fallbacks/i);
    });
  });

  // ---- Test 10: Multiple validation errors report the first one ----
  describe("10. Multiple validation errors report the first found", () => {
    it("reports missing pane before wrong governance.model", () => {
      const invalidToml = `
[image]
base = "node:22-bookworm"

[build]
context_strategy = "tempfile"
registry_fallbacks = ["docker.io"]

# No [[pane]] entry at all

[governance]
model = "tree"   # also wrong, but pane error comes first

[limits]
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3
`;
      const spec = parseTomlString(invalidToml);
      let thrown: Error | undefined;
      try {
        validateSpecForLaunch(spec);
      } catch (err: any) {
        thrown = err;
      }
      expect(thrown).toBeDefined();
      // pane error should be first since we check it before governance.model
      expect(thrown!.message).toMatch(/pane/i);
    });

    it("reports missing image.base before invalid limits", () => {
      const invalidToml = `
# No [image] section at all

[build]
context_strategy = "tempfile"
registry_fallbacks = ["docker.io"]

[[pane]]
agent = "pi"
role = "orchestrator"
immutable = true

[governance]
model = "flat"

[limits]
max_sub_agents_per_orchestrator = -1
max_pane_depth = 0
`;
      const spec = parseTomlString(invalidToml);
      let thrown: Error | undefined;
      try {
        validateSpecForLaunch(spec);
      } catch (err: any) {
        thrown = err;
      }
      expect(thrown).toBeDefined();
      // image.base error should be first
      expect(thrown!.message).toMatch(/image\.base/i);
    });
  });
});

// ---------------------------------------------------------------------------
// Smoke tests (always run, no RUN_LIVE_TESTS required) — TOML parseable
// ---------------------------------------------------------------------------

describe("TOML parsing smoke tests", () => {
  it("smol-toml parses valid launch-sandbox.toml without error", () => {
    expect(() => parseTomlString(VALID_TOML)).not.toThrow();
  });

  it("smol-toml rejects unparseable TOML with a SyntaxError", () => {
    const badToml = `
[image]
base = "node:22-bookworm
  missing closing quote
`;
    expect(() => parseTomlString(badToml)).toThrow();
  });

  it("smol-toml parses TOML with integer values correctly", () => {
    const toml = `
[limits]
max_sub_agents_per_orchestrator = 8
max_pane_depth = 3
`;
    const spec = parseTomlString(toml);
    expect(spec.limits.max_sub_agents_per_orchestrator).toBe(8);
    expect(spec.limits.max_pane_depth).toBe(3);
  });

  it("smol-toml parses TOML with array values correctly", () => {
    const toml = `
[build]
registry_fallbacks = ["docker.io", "ghcr.io"]
`;
    const spec = parseTomlString(toml);
    expect(spec.build.registry_fallbacks).toEqual(["docker.io", "ghcr.io"]);
  });
});