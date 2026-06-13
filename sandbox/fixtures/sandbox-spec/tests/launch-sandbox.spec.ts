import { describe, it, expect, beforeAll } from "vitest";
import { loadLaunchSandboxSpec, type LaunchSandboxSpec } from "../src/spec-loader.js";

let spec: LaunchSandboxSpec;

beforeAll(async () => {
  try {
    spec = await loadLaunchSandboxSpec();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to load launch-sandbox.toml from /spec/sandbox/scripts/. ` +
      `Spec must exist for these tests to pass. Original error: ${msg}`
    );
  }
});

describe("launch-sandbox spec — shape", () => {
  it("meta.name is 'launch-sandbox' and version is 0.2.0", () => {
    expect(spec.meta.name).toBe("launch-sandbox");
    expect(spec.meta.version).toBe("0.2.0");
  });
  it("image.base is node:22-bookworm", () => {
    expect(spec.image.base).toBe("node:22-bookworm");
  });
  it("image.agent_uid is 1000", () => {
    expect(spec.image.agent_uid).toBe(1000);
  });
  it("image.uid_collision_strategy is shift_to_first_free", () => {
    expect(spec.image.uid_collision_strategy).toBe("shift_to_first_free");
  });
  it("build.context_strategy is tempfile (NOT stdin)", () => {
    expect(spec.build.context_strategy).toBe("tempfile");
  });
  it("entrypoint.form is 'cmd' with /bin/bash and supports_sleep_infinity", () => {
    expect(spec.entrypoint.form).toBe("cmd");
    expect(spec.entrypoint.cmd).toEqual(["/bin/bash"]);
    expect(spec.entrypoint.supports_sleep_infinity).toBe(true);
  });
  it("install.steps includes a picode step with the correct npm package", () => {
    const picode = spec.install.steps.find((x) => x.name === "picode");
    expect(picode).toBeDefined();
    expect(picode?.npm).toBe("@earendil-works/pi-coding-agent");
    expect(picode?.npm).not.toBe("@earendil-works/pi");
  });
});

describe("launch-sandbox spec — enforcement", () => {
  it("build.registry_fallbacks_required is true", () => {
    expect(spec.build.registry_fallbacks_required).toBe(true);
  });
  it("herdr step has fallback_cmd_required and must_succeed", () => {
    const herdr = spec.install.steps.find((x) => x.name === "herdr");
    expect(herdr).toBeDefined();
    expect(herdr?.fallback_cmd_required).toBe(true);
    expect(herdr?.must_succeed).toBe(true);
  });
  it("picode step has must_succeed", () => {
    const picode = spec.install.steps.find((x) => x.name === "picode");
    expect(picode).toBeDefined();
    expect(picode?.must_succeed).toBe(true);
  });
  it("user.uid_verification_required is true", () => {
    expect(spec.user.uid_verification_required).toBe(true);
  });
  it("health.post_build_checks_required is true", () => {
    expect(spec.health.post_build_checks_required).toBe(true);
  });
  it("install.steps has 3 entries in declared order with apt-base first, and health.post_build_checks lists herdr and pi --version", () => {
    // Order matters: apt-base must come before herdr/picode so packages are installed before npm/binary steps.
    expect(spec.install.steps).toHaveLength(3);
    expect(spec.install.steps.map((s) => s.name)).toEqual(["apt-base", "herdr", "picode"]);
    // Post-build health checks must verify both binaries the install steps are required to produce.
    expect(spec.health.post_build_checks).toEqual([
      "docker image inspect ${IMAGE_NAME}",
      "docker run --rm ${IMAGE_NAME} herdr --version",
      "docker run --rm ${IMAGE_NAME} pi --version",
    ]);
  });
});
