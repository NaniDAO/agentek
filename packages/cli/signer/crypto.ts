import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { scryptSync, randomBytes, createCipheriv, createDecipheriv, randomUUID } from "node:crypto";
import { keccak256 } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { getConfigDir } from "../config.js";
import type { AgentekKeyfile, DecryptedPayload, V3Keystore, EncryptedPolicy } from "./protocol.js";
import { getKeyfilePath } from "./protocol.js";

const SCRYPT_N = 16384; // 2 ** 14
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const DK_LEN = 32;
const SCRYPT_MAXMEM = 64 * 1024 * 1024; // 64 MB

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, DK_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function encrypt(payload: DecryptedPayload, passphrase: string): AgentekKeyfile {
  const salt = randomBytes(32);
  const dk = deriveKey(passphrase, salt);

  // ── V3 keystore: AES-128-CTR ──────────────────────────────────────────
  const privateKeyBytes = Buffer.from(payload.privateKey.slice(2), "hex"); // strip 0x
  const cipherKey = dk.subarray(0, 16); // first 16 bytes for AES-128
  const keystoreIv = randomBytes(16);

  const cipher = createCipheriv("aes-128-ctr", cipherKey, keystoreIv);
  const ciphertext = Buffer.concat([cipher.update(privateKeyBytes), cipher.final()]);

  // MAC = keccak256(dk[16:32] ++ ciphertext)
  const macInput = Buffer.concat([dk.subarray(16, 32), ciphertext]);
  const mac = keccak256(`0x${macInput.toString("hex")}`).slice(2); // strip 0x

  const address = privateKeyToAddress(payload.privateKey as `0x${string}`).slice(2).toLowerCase();

  const keystore: V3Keystore = {
    version: 3,
    id: randomUUID(),
    address,
    crypto: {
      cipher: "aes-128-ctr",
      ciphertext: ciphertext.toString("hex"),
      cipherparams: { iv: keystoreIv.toString("hex") },
      kdf: "scrypt",
      kdfparams: {
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        dklen: DK_LEN,
        salt: salt.toString("hex"),
      },
      mac,
    },
  };

  // ── Encrypted policy: AES-256-GCM with full 32-byte dk ────────────────
  const policyIv = randomBytes(12);
  const policyCipher = createCipheriv("aes-256-gcm", dk, policyIv);
  const policyPlaintext = JSON.stringify(payload.policy);
  const policyCiphertext = Buffer.concat([
    policyCipher.update(policyPlaintext, "utf-8"),
    policyCipher.final(),
  ]);
  const policyTag = policyCipher.getAuthTag();

  const encryptedPolicy: EncryptedPolicy = {
    ciphertext: policyCiphertext.toString("hex"),
    iv: policyIv.toString("hex"),
    tag: policyTag.toString("hex"),
  };

  return { keystore, encryptedPolicy };
}

export function decrypt(keyfile: AgentekKeyfile, passphrase: string): DecryptedPayload {
  const { keystore, encryptedPolicy } = keyfile;
  const { crypto } = keystore;

  // ── Derive key ────────────────────────────────────────────────────────
  const salt = Buffer.from(crypto.kdfparams.salt, "hex");
  const dk = scryptSync(passphrase, salt, DK_LEN, {
    N: crypto.kdfparams.n,
    r: crypto.kdfparams.r,
    p: crypto.kdfparams.p,
    maxmem: SCRYPT_MAXMEM,
  });

  // ── Verify MAC ────────────────────────────────────────────────────────
  const ciphertext = Buffer.from(crypto.ciphertext, "hex");
  const macInput = Buffer.concat([dk.subarray(16, 32), ciphertext]);
  const computedMac = keccak256(`0x${macInput.toString("hex")}`).slice(2);

  if (computedMac !== crypto.mac) {
    throw new Error("MAC verification failed — wrong passphrase or corrupted keyfile");
  }

  // ── Decrypt private key: AES-128-CTR ──────────────────────────────────
  const cipherKey = dk.subarray(0, 16);
  const keystoreIv = Buffer.from(crypto.cipherparams.iv, "hex");
  const decipher = createDecipheriv("aes-128-ctr", cipherKey, keystoreIv);
  const privateKeyBytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const privateKey = `0x${privateKeyBytes.toString("hex")}`;

  // ── Decrypt policy: AES-256-GCM ──────────────────────────────────────
  const policyIv = Buffer.from(encryptedPolicy.iv, "hex");
  const policyDecipher = createDecipheriv("aes-256-gcm", dk, policyIv);
  policyDecipher.setAuthTag(Buffer.from(encryptedPolicy.tag, "hex"));
  const policyCiphertext = Buffer.from(encryptedPolicy.ciphertext, "hex");
  const policyDecrypted = Buffer.concat([
    policyDecipher.update(policyCiphertext),
    policyDecipher.final(),
  ]);
  const policy = JSON.parse(policyDecrypted.toString("utf-8"));

  return { privateKey, policy };
}

export function keyfileExists(): boolean {
  return existsSync(getKeyfilePath());
}

export function readKeyfile(): AgentekKeyfile {
  const raw = readFileSync(getKeyfilePath(), "utf-8");
  return JSON.parse(raw) as AgentekKeyfile;
}

export function writeKeyfile(keyfile: AgentekKeyfile): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const path = getKeyfilePath();
  writeFileSync(path, JSON.stringify(keyfile, null, 2) + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}
