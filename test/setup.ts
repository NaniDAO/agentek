import { beforeAll } from "vitest";
import dotenv from "dotenv";

beforeAll(() => {
  dotenv.config({ path: ".env.test" });
});
