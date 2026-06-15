import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  server: {
    fs: {
      allow: [
        resolve(__dirname, ".."),
        resolve(__dirname, "../.."),
        resolve(__dirname, "../../../repos/tdad-ts"),
        resolve(__dirname, "./impl"),
      ],
    },
  },
  test: {
    include: [
      "fixtures/sandbox-spec/tests/**/*.spec.ts",
      "tdad-tests/**/*.spec.ts",
      "impl/**/*.spec.ts",
    ],
    globals: true,
    testTimeout: 60000,
    // Suite-level hookTimeout: matches the cost of `launchFromSpec() +
    // HerdrSession.open()` (~30-90s on a warm cache, up to ~180s under full
    // suite docker pressure). Tests that need more raise it via the
    // `beforeAll(..., timeout)` 2nd arg directly — vitest 2.1.x does not
    // honour `hookTimeout` in describe SuiteOptions.
    hookTimeout: 90_000,
  },
});
