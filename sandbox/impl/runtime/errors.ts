export class SandboxError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "SandboxError";
  }
}

export class SandboxTimeoutError extends SandboxError {
  constructor(
    public readonly operation: string,
    public readonly timeoutMs: number,
    options?: ErrorOptions
  ) {
    super(
      `Operation "${operation}" timed out after ${timeoutMs}ms`,
      "SANDBOX_TIMEOUT",
      options
    );
    this.name = "SandboxTimeoutError";
  }
}

export class SandboxStartError extends SandboxError {
  constructor(
    public readonly containerName: string,
    public readonly exitCode: number,
    public readonly stderr: string,
    options?: ErrorOptions
  ) {
    super(
      `Container "${containerName}" failed to start (exit code ${exitCode}): ${stderr}`,
      "SANDBOX_START_FAILED",
      options
    );
    this.name = "SandboxStartError";
  }
}

export class SandboxExecError extends SandboxError {
  constructor(
    public readonly containerName: string,
    public readonly cmd: string[],
    public readonly exitCode: number,
    public readonly stderr: string,
    options?: ErrorOptions
  ) {
    super(
      `exec "${cmd.join(" ")}" in "${containerName}" failed (exit code ${exitCode}): ${stderr}`,
      "SANDBOX_EXEC_FAILED",
      options
    );
    this.name = "SandboxExecError";
  }
}

export class SandboxNotRunningError extends SandboxError {
  constructor(
    public readonly containerName: string,
    public readonly operation: string,
    options?: ErrorOptions
  ) {
    super(
      `Cannot "${operation}" — container "${containerName}" is not running`,
      "SANDBOX_NOT_RUNNING",
      options
    );
    this.name = "SandboxNotRunningError";
  }
}

export class SandboxAlreadyRunningError extends SandboxError {
  constructor(
    public readonly containerName: string,
    options?: ErrorOptions
  ) {
    super(
      `Container "${containerName}" is already running`,
      "SANDBOX_ALREADY_RUNNING",
      options
    );
    this.name = "SandboxAlreadyRunningError";
  }
}