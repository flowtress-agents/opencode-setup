import { describe, it, expect } from "vitest";
import {
  LAUNCH_SANDBOX_META,
  LAUNCH_SANDBOX_IMAGE,
  LAUNCH_SANDBOX_BUILD,
  LAUNCH_SANDBOX_INSTALL_STEPS,
  LAUNCH_SANDBOX_ENTRYPOINT,
  LAUNCH_SANDBOX_USER,
  LAUNCH_SANDBOX_HEALTH,
} from "../../../src/launch-sandbox.js";

describe("launch-sandbox spec — shape", () => {
  it("meta.name is 'launch-sandbox' and version is 0.2.0", () => {
    expect(LAUNCH_SANDBOX_META.name).toBe("launch-sandbox");
    expect(LAUNCH_SANDBOX_META.version).toBe("0.2.0");
  });
  it("image.base is node:22-bookworm", () => {
    expect(LAUNCH_SANDBOX_IMAGE.base).toBe("node:22-bookworm");
  });
  it("image.agent_uid is 1000", () => {
    expect(LAUNCH_SANDBOX_IMAGE.agent_uid).toBe(1000);
  });
  it("image.uid_collision_strategy is shift_to_first_free", () => {
    expect(LAUNCH_SANDBOX_IMAGE.uid_collision_strategy).toBe("shift_to_first_free");
  });
  it("build.context_strategy is tempfile (NOT stdin)", () => {
    expect(LAUNCH_SANDBOX_BUILD.context_strategy).toBe("tempfile");
  });
  it("entrypoint.form is 'cmd' with /bin/bash and supports_sleep_infinity", () => {
    expect(LAUNCH_SANDBOX_ENTRYPOINT.form).toBe("cmd");
    expect(LAUNCH_SANDBOX_ENTRYPOINT.cmd).toEqual(["/bin/bash"]);
    expect(LAUNCH_SANDBOX_ENTRYPOINT.supports_sleep_infinity).toBe(true);
  });
  it("install.steps includes a picode step with the correct npm package", () => {
    const picode = LAUNCH_SANDBOX_INSTALL_STEPS.find((x) => x.name === "picode");
    expect(picode).toBeDefined();
    expect(picode?.npm).toBe("@earendil-works/pi-coding-agent");
    expect(picode?.npm).not.toBe("@earendil-works/pi");
  });
});

describe("launch-sandbox spec — enforcement", () => {
  it("build.registry_fallbacks_required is true", () => {
    expect(LAUNCH_SANDBOX_BUILD.registry_fallbacks_required).toBe(true);
  });
  it("herdr step has fallback_cmd_required and must_succeed", () => {
    const herdr = LAUNCH_SANDBOX_INSTALL_STEPS.find((x) => x.name === "herdr");
    expect(herdr).toBeDefined();
    expect(herdr?.fallback_cmd_required).toBe(true);
    expect(herdr?.must_succeed).toBe(true);
  });
  it("picode step has must_succeed", () => {
    const picode = LAUNCH_SANDBOX_INSTALL_STEPS.find((x) => x.name === "picode");
    expect(picode).toBeDefined();
    expect(picode?.must_succeed).toBe(true);
  });
  it("user.uid_verification_required is true", () => {
    expect(LAUNCH_SANDBOX_USER.uid_verification_required).toBe(true);
  });
  it("health.post_build_checks_required is true", () => {
    expect(LAUNCH_SANDBOX_HEALTH.post_build_checks_required).toBe(true);
  });
  it("install.steps has 3 entries in declared order with apt-base first, and health.post_build_checks lists herdr and pi --version", () => {
    // Order matters: apt-base must come before herdr/picode so packages are installed before npm/binary steps.
    expect(LAUNCH_SANDBOX_INSTALL_STEPS).toHaveLength(3);
    expect(LAUNCH_SANDBOX_INSTALL_STEPS.map((s) => s.name)).toEqual(["apt-base", "herdr", "picode"]);
    // Post-build health checks must verify both binaries the install steps are required to produce.
    expect(LAUNCH_SANDBOX_HEALTH.post_build_checks).toEqual([
      "docker image inspect ${IMAGE_NAME}",
      "docker run --rm ${IMAGE_NAME} herdr --version",
      "docker run --rm ${IMAGE_NAME} pi --version",
    ]);
  });
});
