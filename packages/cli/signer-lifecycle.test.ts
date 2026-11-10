import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { encrypt } from "./signer/crypto.js";
import { defaultPolicy } from "./signer/policy.js";
import { once } from "node:events";

it("keeps the real CLI daemon alive after unlocking a pasted passphrase", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentek-daemon-lifecycle-"));
  const keyfile = encrypt({privateKey: `0x${"11".repeat(32)}`, policy: defaultPolicy()}, "test-passphrase");
  await writeFile(join(root, "keyfile.enc"), JSON.stringify(keyfile));
  const child = spawn("node", [resolve("packages/cli/dist/index.mjs"), "signer", "start"], {env: {...process.env, AGENTEK_CONFIG_DIR: root}, stdio: ["pipe", "pipe", "pipe"]});
  let stderr = "";
  child.stderr.on("data", chunk => {stderr += chunk;});
  try {
    await expect.poll(() => stderr, {timeout: 10000}).toContain("Passphrase:");
    child.stdin.write("test-passphrase\n");
    await expect.poll(() => stderr, {timeout: 10000}).toContain("Signer daemon started");
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(child.exitCode).toBeNull();
  } finally {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    await rm(root, {recursive: true, force: true});
  }
}, 25000);
