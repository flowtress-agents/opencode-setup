import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["spec.live.spec.ts"],
    globals: false,
    testTimeout: 60000,
  },
});
