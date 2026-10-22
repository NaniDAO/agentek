import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";
import { liveFiles } from "./live-files.js";

export default mergeConfig(base, defineConfig({
  test: {
    env: { AGENTEK_OFFLINE_TESTS: "1" },
    exclude: [...configDefaults.exclude, ...liveFiles],
  },
}));
