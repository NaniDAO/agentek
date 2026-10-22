import { describe, expect, it } from "vitest";
import { encrypt, decrypt } from "./crypto.js";
import { defaultPolicy, evaluatePolicy } from "./policy.js";
import type { PolicyConfig } from "./protocol.js";

describe("published 0.1.27 policy compatibility", () => {
  const target = "0x1234567890abcdef1234567890abcdef12345678";
  const tx = { chainId: 1, to: target, value: "0", data: "0x095ea7b3" };
  const { blockedContracts, allowedContracts, blockedFunctions, ...common } = defaultPolicy();
  const publishedPolicy = { ...common, contracts: { [target]: ["0x095ea7b3"] } };

  it("decrypts the shipped map format and preserves selective approval", () => {
    const keyfile = encrypt({
      privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      policy: publishedPolicy as PolicyConfig,
    }, "fixture-passphrase");
    const before = JSON.stringify(keyfile);
    const { policy } = decrypt(keyfile, "fixture-passphrase");
    expect(evaluatePolicy(policy, tx)).toEqual({ allowed: true, needsApproval: false });
    expect(evaluatePolicy(policy, { ...tx, data: "0xa9059cbb" })).toEqual({ allowed: true, needsApproval: true });
    expect(evaluatePolicy(policy, { ...tx, to: "0x0000000000000000000000000000000000000001" }).needsApproval).toBe(true);
    expect(evaluatePolicy(policy, { ...tx, value: "100000000000000001" }).allowed).toBe(false);
    expect(JSON.stringify(keyfile)).toBe(before);
  });

  it("keeps legacy deny rules and always-approval rules stronger than the map", () => {
    const policy = { ...defaultPolicy(), contracts: { [target]: ["*"] }, blockedContracts: [target] };
    expect(evaluatePolicy(policy, tx).allowed).toBe(false);
    expect(evaluatePolicy({ ...policy, blockedContracts: [], requireApproval: "always" }, tx).needsApproval).toBe(true);
  });
});
