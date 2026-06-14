/**
 * Docker adapter — thin wrappers around docker CLI commands.
 *
 * Each method returns Promise<ExecResult> matching the ISandbox.exec()
 * contract. Reads launch-sandbox.toml via smol-toml and extracts
 * image.base, user.*, entrypoint.* fields.
 */

import { execFileSync, execSync, type ExecFileSyncOptions } from "node:child_process";
import { parse as parseToml } from "smol-toml";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DockerBuildResult {
  imageId: string;
}

export interface DockerRunResult {
  containerId: string;
}

export interface ContainerInfo {
  containerId: string;
  image: string;
  status: string;
  pid: number;
}

const TOML_PATH = "/Users/lab/projects/opencode-setup/micro-spec/sandbox/scripts/launch-sandbox.toml";

function readTomlSpec(): any {
  const content = readFileSync(TOML_PATH, "utf-8");
  return parseToml(content);
}

function dockerExec(cmd: string[], input?: string): ExecResult {
  const [file, ...args] = cmd;
  const opts: ExecFileSyncOptions = {
    stdio: input ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    encoding: "utf-8",
    ...(input ? { input } : {}),
  };
  try {
    const stdout = execFileSync(file, args, opts) as string;
    return { exitCode: 0, stdout: stdout ?? "", stderr: "" };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ? String(err.stdout) : "",
      stderr: err.stderr ? String(err.stderr) : "",
    };
  }
}

/**
 * Build a Docker image from a Dockerfile passed via stdin (tempfile strategy).
 * Uses the tempfile context_strategy per the TOML spec.
 */
export async function dockerBuild(
  dockerfileContent: string,
  imageName: string,
  buildArgs: Record<string, string> = {},
): Promise<DockerBuildResult> {
  const args = ["docker", "build", "-t", imageName, "-f", "-", "."];
  for (const [key, value] of Object.entries(buildArgs)) {
    args.push("--build-arg", `${key}=${value}`);
  }

  const result = dockerExec(args, dockerfileContent);
  if (result.exitCode !== 0) {
    throw new Error(`docker build failed:\n${result.stderr}`);
  }

  // Extract image ID from output
  const match = result.stdout.match(/Successfully built ([a-f0-9]+)/i);
  const imageId = match ? match[1] : imageName;
  return { imageId };
}

/**
 * Run a Docker container from the built image.
 * Returns the container ID.
 */
export async function dockerRun(
  imageName: string,
  options: {
    name?: string;
    hostname?: string;
    network?: string;
    volumes?: Record<string, string>;
    workdir?: string;
    entrypoint?: string[];
    detach?: boolean;
  } = {},
): Promise<DockerRunResult> {
  const spec = readTomlSpec();
  const userSection = spec.user ?? {};

  const args = ["docker", "run"];

  if (options.detach ?? true) {
    args.push("-d");
  }

  if (options.name) {
    args.push("--name", options.name);
  }

  if (options.hostname) {
    args.push("--hostname", options.hostname);
  } else if (spec.image?.base) {
    args.push("--hostname", "sandbox-agent");
  }

  if (options.network) {
    args.push("--network", options.network);
  }

  if (options.volumes) {
    for (const [hostPath, containerPath] of Object.entries(options.volumes)) {
      args.push("-v", `${hostPath}:${containerPath}`);
    }
  }

  if (options.workdir) {
    args.push("-w", options.workdir);
  } else if (userSection.workdir) {
    args.push("-w", userSection.workdir);
  }

  if (spec.entrypoint?.form === "cmd") {
    args.push("--entrypoint", "/bin/bash");
  }

  args.push(imageName);

  // form=cmd maps to ENTRYPOINT ["/bin/bash","-c"] + CMD ["sleep infinity"]
  if (spec.entrypoint?.form === "cmd" && spec.entrypoint?.supports_sleep_infinity) {
    args.push("-c", "sleep infinity");
  }

  const result = dockerExec(args);
  if (result.exitCode !== 0) {
    throw new Error(`docker run failed:\n${result.stderr}`);
  }

  const containerId = result.stdout.trim();
  return { containerId };
}

/**
 * Execute a command inside a running container (non-PTY).
 */
export async function dockerExecContainer(
  containerId: string,
  command: string[],
): Promise<ExecResult> {
  return dockerExec(["docker", "exec", containerId, ...command]);
}

/**
 * Execute a command inside a running container with a PTY (interactive).
 */
export async function dockerExecContainerPty(
  containerId: string,
  command: string[],
): Promise<ExecResult> {
  return dockerExec(["docker", "exec", "-i", "-t", containerId, ...command]);
}

/**
 * Stop a container.
 */
export async function dockerStop(containerId: string): Promise<void> {
  dockerExec(["docker", "stop", containerId]);
}

/**
 * Remove a container (force).
 */
export async function dockerRm(containerId: string): Promise<void> {
  dockerExec(["docker", "rm", "-f", containerId]);
}

/**
 * Get container info (ID, image, status, pid).
 */
export async function dockerInspect(containerId: string): Promise<ContainerInfo> {
  const result = dockerExec([
    "docker",
    "inspect",
    "--format",
    "{{.Id}}|{{.Config.Image}}|{{.State.Status}}|{{.State.Pid}}",
    containerId,
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`docker inspect failed for ${containerId}:\n${result.stderr}`);
  }
  const parts = result.stdout.trim().split("|");
  return {
    containerId: parts[0] ?? containerId,
    image: parts[1] ?? "",
    status: parts[2] ?? "unknown",
    pid: parseInt(parts[3] ?? "0", 10),
  };
}

/**
 * Check if Docker daemon is available.
 */
export async function dockerAvailable(): Promise<boolean> {
  try {
    execSync("docker info", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate the Dockerfile content based on the TOML spec.
 */
export function generateDockerfile(spec: any): string {
  const baseImage = spec.image?.base ?? "node:22-bookworm";
  const installSteps = spec.install?.steps ?? [];

  const lines: string[] = [
    `FROM ${baseImage}`,
  ];

  for (const step of installSteps) {
    if (step.name === "apt-base" && step.cmd) {
      lines.push(`RUN ${step.cmd}`);
    } else if (step.name === "herdr") {
      const bin = step.bin_name ?? "herdr";
      lines.push(
        `RUN (${step.cmd} || (${step.fallback_cmd})) && ` +
          `(command -v ${bin} || (test -x /root/.local/bin/${bin} && ln -sf /root/.local/bin/${bin} /usr/local/bin/${bin})) && ` +
          `command -v ${bin}`,
      );
    } else if (step.name === "picode" && step.npm) {
      lines.push(`RUN npm install -g ${step.npm}`);
    }
  }

  // Ensure bash is available
  lines.push(`RUN command -v bash || echo "bash not found"`);

  return lines.join("\n");
}
