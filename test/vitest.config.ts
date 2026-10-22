import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "scripts/*.test.mjs"],
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    benchmark: {
      outputFile: "./bench/report.json",
      reporters: process.env.CI ? ["json"] : ["verbose"],
    },
    coverage: {
      all: false,
      provider: "v8",
      reporter: process.env.CI ? ["lcov"] : ["text", "json", "html"],
      exclude: ["node_modules/", "tests/setup.ts"],
    },
  },
});
