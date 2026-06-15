import { describe, it, expect } from "vitest";
import {
  reserveUserWorkspace,
  type UserWorkspaceHandle,
} from "../src/orchestration.js";

const SAMPLE_SPEC = {
  workspace: [
    { label: "user", role: "user", tab: [{ label: "user", cmd: ["bash"] }] },
  ],
  // ...minimal stub to satisfy the type
};

describe("user-workspace reservation", () => {
  it("returns a UserWorkspaceHandle for the user workspace", () => {
    const result = reserveUserWorkspace(SAMPLE_SPEC as any);
    expect(result.label).toBe("user");
    expect(result.workspaceId).toBeTruthy();
    expect(result.tabId).toBeTruthy();
  });

  it("throws when no user workspace is declared", () => {
    expect(() => reserveUserWorkspace({ workspace: [] } as any)).toThrow(/user workspace/i);
  });

  it("throws when more than one user workspace is declared", () => {
    const spec = {
      workspace: [
        { label: "user", role: "user", tab: [{ label: "user", cmd: ["bash"] }] },
        { label: "user2", role: "user", tab: [{ label: "user", cmd: ["bash"] }] },
      ],
    };
    expect(() => reserveUserWorkspace(spec as any)).toThrow(/one user/i);
  });
});
