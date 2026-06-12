import { describe, it, expect } from "vitest";
import {
  PICODE_NAME,
  PICODE_REPO,
  NODE_MIN_VERSION,
  NODE_RECOMMENDED_VERSION,
  NPM_MIN_VERSION,
  PNPM_MIN_VERSION,
  PICODE_INSTALL_CMD,
  PICODE_BIN_NAME,
  PICODE_ENTRY,
  PICODE_SUPPORTS_TELEMETRY_OFF,
  PICODE_SUPPORTS_OFFLINE_MODE,
  PICODE_SUPPORTS_VERSION_SKIP,
  PICODE_DEFAULT_MODEL_PROVIDER,
} from "../src/picode.js";

describe("picode spec", () => {
  it("PICODE_NAME is the npm package name", () => {
    expect(PICODE_NAME).toBe("@earendil-works/pi");
  });
  it("PICODE_REPO points to upstream", () => {
    expect(PICODE_REPO).toBe("https://github.com/earendil-works/pi");
  });

  it("NODE_MIN_VERSION is 22.19.0 (REQUIRED by piCode)", () => {
    expect(NODE_MIN_VERSION).toBe("22.19.0");
  });
  it("NODE_RECOMMENDED_VERSION is 22.19.0", () => {
    expect(NODE_RECOMMENDED_VERSION).toBe("22.19.0");
  });
  it("NPM_MIN_VERSION is 10.0.0", () => {
    expect(NPM_MIN_VERSION).toBe("10.0.0");
  });
  it("PNPM_MIN_VERSION is 9.0.0", () => {
    expect(PNPM_MIN_VERSION).toBe("9.0.0");
  });

  it("PICODE_INSTALL_CMD uses npm install -g", () => {
    expect(PICODE_INSTALL_CMD).toBe("npm install -g @earendil-works/pi");
  });
  it("PICODE_BIN_NAME is 'pi'", () => {
    expect(PICODE_BIN_NAME).toBe("pi");
  });
  it("PICODE_ENTRY is 'pi'", () => {
    expect(PICODE_ENTRY).toBe("pi");
  });

  it("PICODE_SUPPORTS_TELEMETRY_OFF is true", () => {
    expect(PICODE_SUPPORTS_TELEMETRY_OFF).toBe(true);
  });
  it("PICODE_SUPPORTS_OFFLINE_MODE is true", () => {
    expect(PICODE_SUPPORTS_OFFLINE_MODE).toBe(true);
  });
  it("PICODE_SUPPORTS_VERSION_SKIP is true", () => {
    expect(PICODE_SUPPORTS_VERSION_SKIP).toBe(true);
  });
  it("PICODE_DEFAULT_MODEL_PROVIDER is anthropic", () => {
    expect(PICODE_DEFAULT_MODEL_PROVIDER).toBe("anthropic");
  });
});
