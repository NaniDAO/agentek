import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";
import { liveFiles } from "./live-files.js";

export default mergeConfig(base, defineConfig({
  test: {
    include: [...liveFiles, "packages/cli/cli.test.ts"],
  },
}));
