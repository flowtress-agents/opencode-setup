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
      "src/**/*.spec.ts",
    ],
    globals: true,
    testTimeout: 60000,
  },
});
