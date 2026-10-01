import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    minWorkers: 1,
    maxWorkers: 2,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.test.*", "**/types/**", "**/types.ts", "**/index.ts", "**/toolbar-icons/**"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 70, statements: 70, branches: 70, functions: 70 },
    },
  },
});
