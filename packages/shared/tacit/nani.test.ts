import { afterEach, describe, expect, it, vi } from "vitest";
import "../../nani/jsc-entry.js";

afterEach(() => vi.unstubAllGlobals());
const engine = globalThis as any;
const context = { walletRef: "wallet_primary", chainId: 8453 };
describe("Nani Tacit host integration", () => {
  it("requires both explicit opt-in and a native reply handler", async () => {
    engine.__naniInit(undefined, undefined, undefined, [], true);
    expect(JSON.parse(engine.__naniList()).some((t: any) => t.name === "getPrivateBalance")).toBe(false);
    const postMessage = vi.fn(async () => ({ wallets: [{ ...context, canShield: true, canRelay: true,
      canReceiveDeposits: true, canCreateReceipts: true, canVerifyReceipts: true }], identityKey: "PRIVATE" }));
    vi.stubGlobal("webkit", { messageHandlers: { agentekTacit: { postMessage } } });
    engine.__naniInit(undefined, undefined, undefined, [], false);
    expect(JSON.parse(engine.__naniList()).some((t: any) => t.name === "getPrivateBalance")).toBe(false);
    engine.__naniInit(undefined, undefined, undefined, [], true);
    const names = JSON.parse(engine.__naniList()).map((t: any) => t.name);
    expect(names).toContain("intentPrivateTransfer");
    expect(names).not.toContain("approveAndExecute");
    expect(postMessage).not.toHaveBeenCalled();
    const result = await engine.__naniCall("getPrivacyOptions", "{}");
    expect(result).not.toContain("PRIVATE");
    expect(postMessage).toHaveBeenCalledWith({ version: 1, method: "getOptions", params: {} });
  });

  it("does not forward native backend exceptions or secret inputs through __naniCall", async () => {
    const postMessage = vi.fn(async () => { throw new Error("PRIVATE_DERIVATION_SIGNATURE"); });
    vi.stubGlobal("webkit", { messageHandlers: { agentekTacit: { postMessage } } });
    engine.__naniInit(undefined, undefined, undefined, [], true);
    const result = await engine.__naniCall("getPrivateBalance", JSON.stringify(context));
    expect(result).not.toContain("PRIVATE_DERIVATION_SIGNATURE");
    expect(JSON.parse(result).error).toBeDefined();
    await engine.__naniCall("getPrivateBalance", JSON.stringify({ ...context, identityKey: "PRIVATE" }));
    expect(postMessage).toHaveBeenCalledOnce();
  });
});
