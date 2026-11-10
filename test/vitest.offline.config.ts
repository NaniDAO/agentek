import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";
export default mergeConfig(base, defineConfig({test: {env: {AGENTEK_OFFLINE_TESTS: "1"}}}));
