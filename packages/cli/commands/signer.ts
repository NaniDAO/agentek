import { parseEther, isHex } from "viem";
import { outputJson, outputError } from "../utils/output.js";
import { readLine } from "../utils/readline.js";
import { keyfileExists, readKeyfile, writeKeyfile, encrypt, decrypt } from "../signer/crypto.js";
import { defaultPolicy, validatePolicy } from "../signer/policy.js";
import { startDaemon, stopDaemon, getDaemonStatus } from "../signer/daemon.js";
import { isDaemonReachable, getDaemonAddress, shutdownDaemon } from "../signer/client.js";
import { getKeyfilePath } from "../signer/protocol.js";
import type { DecryptedPayload, PolicyConfig } from "../signer/protocol.js";

/** Prompt for passphrase and decrypt the keyfile. */
async function unlockKeyfile(): Promise<{ payload: DecryptedPayload; passphrase: string }> {
  const passphrase = await readLine("Passphrase: ", true);
  try {
    const keyfile = readKeyfile();
    const payload = decrypt(keyfile, passphrase);
    return { payload, passphrase };
  } catch {
    outputError("Failed to decrypt keyfile. Wrong passphrase?");
  }
}

export async function handleSigner(args: string[]): Promise<void> {
  const sub = args[0];

  if (!sub) {
    outputError("Usage: agentek signer <init|start|stop|status|policy>");
  }

  if (sub === "init") {
    if (keyfileExists()) {
      outputError(`Keyfile already exists. Delete ${getKeyfilePath()} to reinitialize.`);
    }

    const privateKey = await readLine("Private key (hex, 0x...): ", true);
    if (!privateKey || !isHex(privateKey)) {
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

    process.stderr.write(`Keyfile created at ${getKeyfilePath()}\n`);
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

    const { payload } = await unlockKeyfile();

    await startDaemon(payload);
    // Daemon stays running — don't exit
    return;
  } else if (sub === "stop") {
    const status = getDaemonStatus();
    if (!status.running) {
      process.stderr.write("Daemon is not running.\n");
      return outputJson({ ok: true, wasRunning: false });
    }

    try {
      const reachable = await isDaemonReachable();
      if (!reachable) {
        // Socket unreachable while pidfile exists => stale local state.
        stopDaemon();
        process.stderr.write(`Signer daemon appears unreachable (stale state for PID ${status.pid}). Cleaned local state only.\n`);
        return outputJson({ ok: true, wasRunning: false, staleStateCleaned: true, pid: status.pid });
      }

      await shutdownDaemon();
    } catch (err: any) {
      outputError(`Failed to stop daemon cleanly: ${err?.message || "unknown error"}`);
    }

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
        stopDaemon();
        outputJson({ running: false, staleStateCleaned: true, pid: status.pid, reachable: false });
      }
    } else {
      outputJson({ running: false });
    }
  } else if (sub === "policy") {
    if (!keyfileExists()) {
      outputError("No keyfile found. Run 'agentek signer init' first.");
    }

    const { payload, passphrase } = await unlockKeyfile();
    if (payload.policy.allowContractCreation === undefined) {
      payload.policy.allowContractCreation = false;
    }

    const policyAction = args[1];
    if (policyAction === "set") {
      const field = args[2];
      const value = args[3];
      if (!field || value === undefined) {
        outputError("Usage: agentek signer policy set <field> <value>");
      }

      const policy = payload.policy;
      if (field === "maxValuePerTx" || field === "maxValuePerSession") {
        try {
          parseEther(value);
        } catch {
          outputError(`${field} must be a valid ETH amount (e.g. 0.1)`);
        }
        policy[field] = value;
      } else if (field === "requireApproval") {
        if (!["always", "above_threshold", "never"].includes(value)) {
          outputError("requireApproval must be: always, above_threshold, or never");
        }
        policy.requireApproval = value as PolicyConfig["requireApproval"];
      } else if (field === "approvalThresholdPct") {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0 || n > 100) outputError("approvalThresholdPct must be 0-100");
        policy.approvalThresholdPct = n;
      } else if (field === "allowedChains") {
        const chains = value.split(",").map((s) => Number(s.trim()));
        if (chains.length === 0 || chains.some((n) => !Number.isInteger(n) || n <= 0)) {
          outputError("allowedChains must be a comma-separated list of positive integers");
        }
        policy.allowedChains = chains;
      } else if (field === "allowContractCreation") {
        const normalized = value.trim().toLowerCase();
        if (!["true", "false"].includes(normalized)) {
          outputError("allowContractCreation must be true or false");
        }
        policy.allowContractCreation = normalized === "true";
      } else {
        outputError(`Unknown policy field: ${field}. Known: maxValuePerTx, maxValuePerSession, requireApproval, approvalThresholdPct, allowedChains, allowContractCreation`);
      }

      payload.policy = validatePolicy(policy);
      if (await isDaemonReachable()) outputError("Stop the signer daemon before changing policy; restart it to activate the new policy");
      const keyfile = encrypt(payload, passphrase);
      writeKeyfile(keyfile);
      process.stderr.write(`Policy updated: ${field} = ${value}\n`);
      outputJson({ ok: true, policy });
    } else {
      // Show current policy
      outputJson(payload.policy);
    }
  } else {
    outputError("Usage: agentek signer <init|start|stop|status|policy>");
  }
}
