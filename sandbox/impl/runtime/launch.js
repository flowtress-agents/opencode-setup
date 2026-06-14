/**
 * launchFromSpec() — F1 runtime contract.
 *
 * ADR 0004: sub-agents live in panes inside the same container, NOT in
 * separate containers. As a consequence, the launch plan produced from
 * a single launch-sandbox.toml describes exactly one container.
 *
 * The runtime is in the process of being built up around the existing
 * Sandbox class; this helper gives the spec test a stable entry point
 * that returns a plan shape with `containers: 1`. The actual container
 * creation still goes through Sandbox / createSandbox(); the plan is
 * the data the green-phase orchestrator consumes to decide which panes
 * to allocate.
 *
 * @param {object} spec - Parsed launch-sandbox.toml object.
 * @returns {Promise<{ containers: number, image: string, mode: string }>}
 *   A plan describing exactly 1 container.
 */
export async function launchFromSpec(spec) {
  const mode = spec?.launch?.mode ?? "single-container";
  if (mode !== "single-container") {
    throw new Error(
      `launchFromSpec: launch.mode must be "single-container" (ADR 0004), got ${JSON.stringify(mode)}`,
    );
  }
  const image =
    spec?.image?.base ??
    spec?.image?.base_image ??
    spec?.docker?.base?.image ??
    "node:22-bookworm";
  return {
    containers: 1,
    containerCount: 1,
    image,
    mode,
  };
}
