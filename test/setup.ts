import { beforeAll } from "vitest";
import { loadEnvFile } from "node:process";

beforeAll(() => {
  try { loadEnvFile(".env.test"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
});
