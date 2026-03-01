import { type Hex, isHex } from "viem";
import { outputJson, outputError } from "../utils/output.js";
import { readLine } from "../utils/readline.js";
import { keyfileExists, readKeyfile, writeKeyfile, encrypt, decrypt } from "../signer/crypto.js";
import { defaultPolicy } from "../signer/policy.js";
import { startDaemon, stopDaemon, getDaemonStatus } from "../signer/daemon.js";
import { isDaemonReachable, getDaemonAddress } from "../signer/client.js";
import type { DecryptedPayload, PolicyConfig } from "../signer/protocol.js";

export async function handleSigner(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub) {
    outputError("Usage: agentek signer <init|start|stop|status|policy>");
  }

  if (sub === "init") {
    if (keyfileExists()) {
      outputError("Keyfile already exists. Delete ~/.agentek/keyfile.enc to reinitialize.");
    }

    const privateKey = await readLine("Private key (hex, 0x...): ", true);
    if (!privateKey || !isHex(privateKey as Hex)) {
      outputError("Invalid private key format. Must be hex starting with 0x.");
    }

    const passphrase = await readLine("Passphrase: ", true);
    if (!passphrase || passphrase.length < 8) {
      outputError("Passphrase must be at least 8 characters.");
    }
    const confirm = await readLine("Confirm passphrase: ", true);
    if (passphrase !== confirm) {
      outputError("Passphrases do not match.");
    }

    const policy = defaultPolicy();
    const payload: DecryptedPayload = { privateKey, policy };
    const keyfile = encrypt(payload, passphrase);
    writeKeyfile(keyfile);

    process.stderr.write("Keyfile created at ~/.agentek/keyfile.enc\n");
    process.stderr.write("Default policy applied. Use 'agentek signer policy' to view.\n");
    outputJson({ ok: true });
  } else if (sub === "start") {
    if (!keyfileExists()) {
      outputError("No keyfile found. Run 'agentek signer init' first.");
    }

    const status = getDaemonStatus();
    if (status.running) {
      outputError(`Daemon already running (PID ${status.pid})`);
    }

    const passphrase = await readLine("Passphrase: ", true);
    let payload: DecryptedPayload;
    try {
      const keyfile = readKeyfile();
      payload = decrypt(keyfile, passphrase);
    } catch {
      outputError("Failed to decrypt keyfile. Wrong passphrase?");
    }

    await startDaemon(payload!);
    // Daemon stays running — don't exit
    return;
  } else if (sub === "stop") {
    const status = getDaemonStatus();
    if (!status.running) {
      process.stderr.write("Daemon is not running.\n");
      outputJson({ ok: true, wasRunning: false });
    }

    try {
      process.kill(status.pid!, "SIGTERM");
    } catch {}

    // Clean up
    stopDaemon();
    process.stderr.write("Daemon stopped.\n");
    outputJson({ ok: true, wasRunning: true });
  } else if (sub === "status") {
    const status = getDaemonStatus();
    if (status.running) {
      const reachable = await isDaemonReachable();
      if (reachable) {
        const addr = await getDaemonAddress();
        outputJson({ running: true, pid: status.pid, address: addr, reachable: true });
      } else {
        outputJson({ running: true, pid: status.pid, reachable: false });
      }
    } else {
      outputJson({ running: false });
    }
  } else if (sub === "policy") {
    if (!keyfileExists()) {
      outputError("No keyfile found. Run 'agentek signer init' first.");
    }

    const passphrase = await readLine("Passphrase: ", true);
    let payload: DecryptedPayload;
    try {
      const keyfile = readKeyfile();
      payload = decrypt(keyfile, passphrase);
    } catch {
      outputError("Failed to decrypt keyfile. Wrong passphrase?");
    }

    const policyAction = args[1];
    if (policyAction === "set") {
      const field = args[2];
      const value = args[3];
      if (!field || value === undefined) {
        outputError("Usage: agentek signer policy set <field> <value>");
      }

      const policy = payload!.policy;
      if (field === "maxValuePerTx") {
        policy.maxValuePerTx = value;
      } else if (field === "requireApproval") {
        if (!["always", "above_threshold", "never"].includes(value)) {
          outputError("requireApproval must be: always, above_threshold, or never");
        }
        policy.requireApproval = value as PolicyConfig["requireApproval"];
      } else if (field === "approvalThresholdPct") {
        const n = Number(value);
        if (isNaN(n) || n < 0 || n > 100) outputError("approvalThresholdPct must be 0-100");
        policy.approvalThresholdPct = n;
      } else if (field === "allowedChains") {
        policy.allowedChains = value.split(",").map(Number);
      } else {
        outputError(`Unknown policy field: ${field}. Known: maxValuePerTx, requireApproval, approvalThresholdPct, allowedChains`);
      }

      const keyfile = encrypt(payload!, passphrase);
      writeKeyfile(keyfile);
      process.stderr.write(`Policy updated: ${field} = ${value}\n`);
      outputJson({ ok: true, policy });
    } else {
      // Show current policy
      outputJson(payload!.policy);
    }
  } else {
    outputError("Usage: agentek signer <init|start|stop|status|policy>");
  }
}
