import type { SandboxSpec, SandboxOptions } from "./types.js";

/**
 * Builds a `docker run` argv array from the sandbox spec and options.
 *
 * Canonical argv order:
 *   1. Detach flag
 *   2. Container name
 *   3. Hostname
 *   4. Network mode
 *   5. User (uid:gid)
 *   6. Workdir
 *   7. Volume mounts (workspace)
 *   8. Env vars (PATH with spec.path.extra prepended)
 *   9. Entrypoint / cmd
 *
 * The returned array does NOT include the leading "docker" or the image name —
 * callers append them:
 *   spawn("docker", [...buildDockerRunArgs(spec, opts), imageName])
 */
export function buildDockerRunArgs(
  spec: SandboxSpec,
  opts: SandboxOptions
): string[] {
  const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
  const containerName = opts.containerName ?? `sandbox-${opts.id || Date.now()}`;
  if (!CONTAINER_NAME_RE.test(containerName)) {
    throw new Error(`Invalid container name: ${containerName}`);
  }
  const args: string[] = [];

  // 1. Detach
  if (opts.detached ?? spec.docker.run.detach) {
    args.push("-d");
  }

  // 2. Container name
  args.push("--name", containerName);

  // 3. Hostname
  args.push("--hostname", spec.docker.run.hostname);

  // 4. Network
  args.push("--network", spec.docker.run.networkMode);

  // 5. User (uid:gid)
  const uid = opts.uid ?? spec.docker.user.uid;
  const gid = opts.gid ?? spec.docker.user.gid;
  args.push("--user", `${uid}:${gid}`);

  // 6. Workdir
  args.push("-w", opts.workspaceContainer ?? spec.docker.user.workdir);

  // 7. Workspace mount
  const hostPath =
    opts.workspaceHost || spec.docker.mounts.workspace.host;
  const containerPath =
    opts.workspaceContainer ?? spec.docker.mounts.workspace.container;
  const readonlyFlag = String(Boolean(spec.docker.mounts.workspace.readonly)) === "true" ? ":ro" : "";
  args.push("-v", `${hostPath}:${containerPath}${readonlyFlag}`);

  // 8. PATH env (prepend spec.path.extra to system PATH)
  const extraPath = spec.system.path.extra ?? [];
  const pathValue =
    extraPath.length > 0
      ? `/usr/local/bin:/usr/bin:/bin:${extraPath.join(":")}`
      : `/usr/local/bin:/usr/bin:/bin`;
  args.push("-e", `PATH=${pathValue}`);
  args.push("-e", `LANG=${spec.system.locale.lang}`);
  args.push("-e", `TZ=${spec.system.locale.timezone}`);

  // 10. Entrypoint: bash in detached mode to keep container alive
  if (opts.detached ?? spec.docker.run.detach) {
    args.push("--entrypoint", "/bin/bash");
    args.push("-c", "sleep infinity");
  }

  return args;
}

/** Returns just the workspace mount arg for cases where only that is needed */
export function buildWorkspaceMount(
  spec: SandboxSpec,
  opts: SandboxOptions
): string {
  const hostPath =
    opts.workspaceHost || spec.docker.mounts.workspace.host;
  const containerPath =
    opts.workspaceContainer ?? spec.docker.mounts.workspace.container;
  const readonlyFlag = String(Boolean(spec.docker.mounts.workspace.readonly)) === "true" ? ":ro" : "";
  return `-v ${hostPath}:${containerPath}${readonlyFlag}`;
}
