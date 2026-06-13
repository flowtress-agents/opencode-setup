import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["impl/runtime/__tests__/live/sandbox.live.spec.ts"],
    globals: true,
    testTimeout: 30000,
  },
});