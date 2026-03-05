import { parseEther, isHex, isAddress } from "viem";
import { spawn } from "node:child_process";
import { outputJson, outputError } from "../utils/output.js";
import { readLine } from "../utils/readline.js";
import { keyfileExists, readKeyfile, writeKeyfile, encrypt, decrypt } from "../signer/crypto.js";
import { defaultPolicy } from "../signer/policy.js";
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
  } else if (sub === "__daemon") {
    // Hidden subcommand: reads DecryptedPayload from stdin, runs daemon in foreground.
    // Spawned by `signer start` as a detached background process.
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    const payload: DecryptedPayload = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    await startDaemon(payload);
    return;
  } else if (sub === "start") {
    if (!keyfileExists()) {
      outputError("No keyfile found. Run 'agentek signer init' first.");
    }

    const status = getDaemonStatus();
    if (status.running) {
      outputError(`Daemon already running (PID ${status.pid})`);
    }

    const { payload } = await unlockKeyfile();

    // Spawn a detached child that runs the daemon in the background.
    // The decrypted payload is passed via stdin so it never touches
    // the command line or environment variables.
    const child = spawn(process.execPath, [process.argv[1], "signer", "__daemon"], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      env: process.env,
    });

    child.stdin!.end(JSON.stringify(payload));
    child.unref();

    // Poll until the daemon is reachable (scrypt KDF in the child takes time).
    let reachable = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      reachable = await isDaemonReachable();
      if (reachable) break;
    }
    if (!reachable) {
      outputError("Daemon process spawned but is not reachable after 6s. Check logs.");
    }

    const addr = await getDaemonAddress();
    process.stderr.write(`Signer daemon started (PID ${child.pid})\n`);
    process.stderr.write(`Address: ${addr}\n`);
    outputJson({ ok: true, pid: child.pid, address: addr });
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
    const policy = payload.policy;

    if (policyAction === "set") {
      const field = args[2];
      const value = args[3];
      if (!field || value === undefined) {
        outputError("Usage: agentek signer policy set <field> <value>");
      }

      if (field === "maxValuePerTx") {
        try {
          parseEther(value);
        } catch {
          outputError("maxValuePerTx must be a valid ETH amount (e.g. 0.1)");
        }
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
        outputError(`Unknown field: ${field}. Known: maxValuePerTx, requireApproval, approvalThresholdPct, allowedChains, allowContractCreation\nFor list fields use: policy add/remove <field> <value>`);
      }

      const keyfile = encrypt(payload, passphrase);
      writeKeyfile(keyfile);
      process.stderr.write(`Policy updated: ${field} = ${value}\n`);
      outputJson({ ok: true, policy });
    } else if (policyAction === "add" || policyAction === "remove") {
      const field = args[2];
      const value = args[3];
      if (!field || value === undefined) {
        outputError(`Usage: agentek signer policy ${policyAction} <field> <value>`);
      }

      const listFields = ["blockedContracts", "allowedContracts", "blockedFunctions"] as const;
      type ListField = typeof listFields[number];

      if (!listFields.includes(field as ListField)) {
        outputError(`Unknown list field: ${field}. Known: ${listFields.join(", ")}`);
      }

      const typedField = field as ListField;
      const entries = value.split(",").map((s) => s.trim().toLowerCase());

      // Validate entries
      if (typedField === "blockedContracts" || typedField === "allowedContracts") {
        for (const entry of entries) {
          if (!isAddress(entry)) {
            outputError(`Invalid address: ${entry}`);
          }
        }
      } else if (typedField === "blockedFunctions") {
        for (const entry of entries) {
          if (!/^0x[0-9a-f]{8}$/.test(entry)) {
            outputError(`Invalid function selector: ${entry} (must be 0x + 8 hex chars, e.g. 0x095ea7b3)`);
          }
        }
      }

      if (policyAction === "add") {
        const existing = new Set(policy[typedField]);
        for (const entry of entries) existing.add(entry);
        policy[typedField] = [...existing];
        process.stderr.write(`Added to ${field}: ${entries.join(", ")}\n`);
      } else {
        const toRemove = new Set(entries);
        policy[typedField] = policy[typedField].filter((e) => !toRemove.has(e));
        process.stderr.write(`Removed from ${field}: ${entries.join(", ")}\n`);
      }

      const keyfile = encrypt(payload, passphrase);
      writeKeyfile(keyfile);
      outputJson({ ok: true, policy });
    } else {
      // Show current policy
      outputJson(policy);
    }
  } else {
    outputError("Usage: agentek signer <init|start|stop|status|policy>");
  }
}
