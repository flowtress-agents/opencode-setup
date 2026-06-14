import { describe, it, expect } from "vitest";
import {
  TIMEOUT_CONTAINER_START,
  TIMEOUT_IDLE,
  TIMEOUT_HOOK_EXEC,
  TIMEOUT_GIT_SETUP,
  TIMEOUT_COMMIT_COLLECTION,
  TIMEOUT_MERGE_TO_HOST,
  TIMEOUT_COMPLETION_GRACE,
  CPUS_DEFAULT,
  MEMORY_DEFAULT,
  SWAP_DEFAULT,
  PIDS_DEFAULT,
  RATE_LIMIT_AGENT_START,
  RATE_LIMIT_HOOK_EXEC_PER_MIN,
  RATE_LIMIT_COMMIT_PER_MIN,
  DISK_QUOTA_WORKSPACE_MB,
} from "../src/limits.js";

describe("limits spec", () => {
  it("TIMEOUT_CONTAINER_START is 120 seconds (per startSandbox.ts)", () => {
    expect(TIMEOUT_CONTAINER_START).toBe(120);
  });
  it("TIMEOUT_IDLE is 600 seconds (10 minutes)", () => {
    expect(TIMEOUT_IDLE).toBe(600);
  });
  it("TIMEOUT_HOOK_EXEC is 60 seconds", () => {
    expect(TIMEOUT_HOOK_EXEC).toBe(60);
  });
  it("TIMEOUT_GIT_SETUP is 10 seconds", () => {
    expect(TIMEOUT_GIT_SETUP).toBe(10);
  });
  it("TIMEOUT_COMMIT_COLLECTION is 30 seconds", () => {
    expect(TIMEOUT_COMMIT_COLLECTION).toBe(30);
  });
  it("TIMEOUT_MERGE_TO_HOST is 30 seconds", () => {
    expect(TIMEOUT_MERGE_TO_HOST).toBe(30);
  });
  it("TIMEOUT_COMPLETION_GRACE is 60 seconds", () => {
    expect(TIMEOUT_COMPLETION_GRACE).toBe(60);
  });

  it("CPUS_DEFAULT is null (unconstrained)", () => {
    expect(CPUS_DEFAULT).toBeNull();
  });
  it("MEMORY_DEFAULT is null (unconstrained)", () => {
    expect(MEMORY_DEFAULT).toBeNull();
  });
  it("SWAP_DEFAULT is null (unconstrained)", () => {
    expect(SWAP_DEFAULT).toBeNull();
  });
  it("PIDS_DEFAULT is 1024", () => {
    expect(PIDS_DEFAULT).toBe(1024);
  });

  it("RATE_LIMIT_AGENT_START is null (unbounded)", () => {
    expect(RATE_LIMIT_AGENT_START).toBeNull();
  });
  it("RATE_LIMIT_HOOK_EXEC_PER_MIN is 60", () => {
    expect(RATE_LIMIT_HOOK_EXEC_PER_MIN).toBe(60);
  });
  it("RATE_LIMIT_COMMIT_PER_MIN is 30", () => {
    expect(RATE_LIMIT_COMMIT_PER_MIN).toBe(30);
  });

  it("DISK_QUOTA_WORKSPACE_MB is 1024", () => {
    expect(DISK_QUOTA_WORKSPACE_MB).toBe(1024);
  });
});
