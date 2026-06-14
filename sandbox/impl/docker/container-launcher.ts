/**
 * Container launcher — launches a sandbox container from the TOML spec.
 *
 * launchFromSpec() reads launch-sandbox.toml, builds the image via docker build
 * (using the tempfile context_strategy), then runs the container.
 * Returns { containerId, plan } where plan.containers === 1.
 */

import { parse as parseToml } from "smol-toml";
import { readFileSync } from "node:fs";
import {
  dockerBuild,
  dockerRun,
  dockerStop,
  dockerRm,
  dockerInspect,
  generateDockerfile,
  dockerAvailable,
  type DockerRunResult,
} from "./docker-adapter.js";

const TOML_PATH = "/Users/lab/projects/opencode-setup/micro-spec/sandbox/scripts/launch-sandbox.toml";

export interface LaunchPlan {
  containers: number;
  imageName: string;
  containerName: string;
  mode: string;
}

export interface LaunchResult {
  containerId: string;
  plan: LaunchPlan;
}

/**
 * Read and parse the TOML spec file.
 */
export function readSpec(): any {
  const content = readFileSync(TOML_PATH, "utf-8");
  return parseToml(content);
}

/**
 * Launch a sandbox container from the TOML spec.
 *
 * @param options.containeName - Optional container name override
 * @param options.imageName - Optional image name override
 * @param options.network - Optional network override
 * @param options.volumes - Optional volume mounts
 */
export async function launchFromSpec(
  options: {
    containerName?: string;
    imageName?: string;
    network?: string;
    volumes?: Record<string, string>;
  } = {},
): Promise<LaunchResult> {
  const spec = readSpec();

  const imageName = options.imageName ?? `herdr-picode-sandbox-${Date.now()}`;
  const containerName =
    options.containerName ?? `sandbox-launch-${process.pid}-${Date.now()}`;

  // Check Docker availability
  const available = await dockerAvailable();
  if (!available) {
    throw new Error("Docker daemon is not available. Cannot launch sandbox.");
  }

  // Generate Dockerfile from spec
  const dockerfile = generateDockerfile(spec);

  // Build build args from TOML
  const buildArgs: Record<string, string> = {};
  if (spec.image?.base) {
    buildArgs["BASE_IMAGE"] = spec.image.base;
  }

  // Build the image
  await dockerBuild(dockerfile, imageName, buildArgs);

  // Run the container
  const runResult: DockerRunResult = await dockerRun(imageName, {
    name: containerName,
    hostname: spec.image?.base ? "sandbox-agent" : undefined,
    network: options.network ?? "bridge",
    volumes: options.volumes,
    workdir: spec.user?.workdir,
    detach: true,
  });

  const plan: LaunchPlan = {
    containers: 1,
    imageName,
    containerName,
    mode: spec.launch?.mode ?? "single-container",
  };

  return {
    containerId: runResult.containerId,
    plan,
  };
}

/**
 * Stop and remove a container.
 */
export async function cleanupContainer(containerId: string): Promise<void> {
  try {
    await dockerStop(containerId);
  } catch { /* best-effort */ }
  try {
    await dockerRm(containerId);
  } catch { /* best-effort */ }
}

/**
 * Verify the container is running and healthy.
 */
export async function verifyContainer(containerId: string): Promise<boolean> {
  try {
    const info = await dockerInspect(containerId);
    return info.status === "running" && info.pid > 0;
  } catch {
    return false;
  }
}
