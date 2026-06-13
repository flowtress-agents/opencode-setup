import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: {
      allow: ["../..", "../../../repos/tdad-ts"],
    },
  },
  test: {
    include: [
      "fixtures/sandbox-spec/tests/**/*.spec.ts",
      "tdad-tests/**/*.spec.ts",
    ],
    globals: false,
    testTimeout: 10000,
  },
});
