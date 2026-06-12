import { describe, it, expect } from "vitest";
import {
  HERDR_NAME,
  HERDR_VERSION_MIN,
  HERDR_REPO,
  PATHS_SESSIONS,
  PATHS_CACHE,
  PTY_REQUIRED,
  PTY_TERM,
  SESSION_FORMAT,
  SESSION_COMPRESS,
  RUNTIME_NODE_MIN,
  RUNTIME_BUN_MIN,
} from "../src/herdr.js";

describe("herdr spec", () => {
  it("HERDR_NAME is the correct package name", () => {
    expect(HERDR_NAME).toBe("herdr");
  });
  it("HERDR_VERSION_MIN is set", () => {
    expect(HERDR_VERSION_MIN).toBe("0.1.0");
  });
  it("HERDR_REPO points to the upstream repo", () => {
    expect(HERDR_REPO).toBe("https://github.com/ogulcancelik/herdr");
  });

  it("PATHS_SESSIONS uses the XDG config dir (NOT ~/.local/share)", () => {
    // Correct: XDG-compliant config location
    expect(PATHS_SESSIONS).toBe("~/.config/herdr/sessions");
  });
  it("PATHS_CACHE is in ~/.cache", () => {
    expect(PATHS_CACHE).toBe("~/.cache/herdr");
  });

  it("PTY_REQUIRED is true (herdr runs in a PTY)", () => {
    expect(PTY_REQUIRED).toBe(true);
  });
  it("PTY_TERM is xterm-256color", () => {
    expect(PTY_TERM).toBe("xterm-256color");
  });

  it("SESSION_FORMAT is jsonl", () => {
    expect(SESSION_FORMAT).toBe("jsonl");
  });
  it("SESSION_COMPRESS uses gzip", () => {
    expect(SESSION_COMPRESS).toBe("gzip");
  });

  it("RUNTIME_NODE_MIN is 22.19.0 (matches piCode requirement)", () => {
    expect(RUNTIME_NODE_MIN).toBe("22.19.0");
  });
  it("RUNTIME_BUN_MIN is set", () => {
    expect(RUNTIME_BUN_MIN).toBe("1.1.0");
  });
});
