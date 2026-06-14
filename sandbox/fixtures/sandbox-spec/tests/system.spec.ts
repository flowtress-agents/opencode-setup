import { describe, it, expect } from "vitest";
import {
  OS_FAMILY,
  OS_RELEASE,
  LOCALE,
  TIMEZONE,
  LANG,
  APT_REQUIRED,
  GIT_SAFE_DIRECTORY,
  GIT_DEFAULT_BRANCH,
  GIT_USER_NAME,
  GIT_USER_EMAIL,
  PATH_EXTRA,
} from "../src/system.js";

describe("system spec", () => {
  it("OS_FAMILY is debian", () => {
    expect(OS_FAMILY).toBe("debian");
  });
  it("OS_RELEASE is bookworm", () => {
    expect(OS_RELEASE).toBe("bookworm");
  });

  it("LOCALE is C.UTF-8", () => {
    expect(LOCALE).toBe("C.UTF-8");
  });
  it("TIMEZONE is Etc/UTC", () => {
    expect(TIMEZONE).toBe("Etc/UTC");
  });
  it("LANG is C.UTF-8", () => {
    expect(LANG).toBe("C.UTF-8");
  });

  it("APT_REQUIRED contains exactly git, curl, jq (per sandcastle Dockerfile)", () => {
    expect(APT_REQUIRED).toEqual(["git", "curl", "jq"]);
  });
  it("APT_REQUIRED does NOT include bash (base image has it)", () => {
    expect(APT_REQUIRED).not.toContain("bash");
  });
  it("APT_REQUIRED does NOT include ripgrep (not a sandcastle dep)", () => {
    expect(APT_REQUIRED).not.toContain("ripgrep");
  });
  it("APT_REQUIRED does NOT include libncursesw6 (not a sandcastle dep)", () => {
    expect(APT_REQUIRED).not.toContain("libncursesw6");
  });
  it("APT_REQUIRED has exactly 3 entries", () => {
    expect(APT_REQUIRED).toHaveLength(3);
  });

  it("GIT_SAFE_DIRECTORY is true (so git inside container works on mounted volume)", () => {
    expect(GIT_SAFE_DIRECTORY).toBe(true);
  });
  it("GIT_DEFAULT_BRANCH is 'main'", () => {
    expect(GIT_DEFAULT_BRANCH).toBe("main");
  });
  it("GIT_USER_NAME is 'agent'", () => {
    expect(GIT_USER_NAME).toBe("agent");
  });
  it("GIT_USER_EMAIL is 'agent@localhost'", () => {
    expect(GIT_USER_EMAIL).toBe("agent@localhost");
  });

  it("PATH_EXTRA includes /usr/local/bin", () => {
    expect(PATH_EXTRA).toContain("/usr/local/bin");
  });
  it("PATH_EXTRA includes /home/agent/.local/bin", () => {
    expect(PATH_EXTRA).toContain("/home/agent/.local/bin");
  });
});
