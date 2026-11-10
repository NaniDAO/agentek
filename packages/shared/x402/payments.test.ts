import { afterEach, describe, expect, it, vi } from "vitest";
import { publicFetch } from "../utils/public-fetch.js";
import { x402FetchTool } from "./tools.js";
import { TOKEN_REGISTRY } from "../resolveToken/constants.js";
vi.mock("../utils/public-fetch.js", () => ({publicFetch: vi.fn()}));
afterEach(() => vi.resetAllMocks());
const address = "0x1111111111111111111111111111111111111111";
const valid = {scheme: "exact", network: "eip155:8453", asset: TOKEN_REGISTRY.USDC[8453].address,
  amount: "100000", payTo: address, maxTimeoutSeconds: 60, extra: {name: "USD Coin", version: "2"}};
function fixture(requirement = valid) {
  const signTypedData = vi.fn(async () => `0x${"11".repeat(65)}`);
  const client: any = {getWalletClient: () => ({chain: {id: 8453}, account: {address, signTypedData}}), getPublicClient: () => ({readContract: vi.fn()})};
  const payment = {x402Version: 2, resource: {url: "https://paid.example/data", description: "test", mimeType: "application/json"}, accepts: [requirement]};
  vi.mocked(publicFetch).mockResolvedValueOnce(new Response("{}", {status: 402, headers: {"payment-required": Buffer.from(JSON.stringify(payment)).toString("base64")}})).mockResolvedValueOnce(Response.json({ok: true}));
  return {client, signTypedData};
}
describe("x402 signing boundary", () => {
  it.each([
    {...valid, asset: address}, {...valid, network: "eip155:1"}, {...valid, amount: "1000001"},
    {...valid, amount: "-1"}, {...valid, amount: "0"}, {...valid, amount: "1e3"},
    {...valid, extra: {...valid.extra, assetTransferMethod: "permit2"}},
  ])("does not sign rejected payment requirements %#", async requirement => {
    const {client, signTypedData} = fixture(requirement);
    await expect(x402FetchTool.execute(client, {url: "https://paid.example/data"})).rejects.toThrow();
    expect(signTypedData).not.toHaveBeenCalled();
    expect(publicFetch).toHaveBeenCalledTimes(1);
  });
  it("signs one capped USDC authorization on the configured chain, without claiming settlement", async () => {
    const {client, signTypedData} = fixture();
    const result = await x402FetchTool.execute(client, {url: "https://paid.example/data", maxPaymentUsd: 0.1});
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(signTypedData.mock.calls[0][0]).toMatchObject({domain: {chainId: 8453, verifyingContract: valid.asset}, primaryType: "TransferWithAuthorization", message: {value: 100000n}});
    expect(result).toMatchObject({status: 200, authorizationCreated: true, settlement: "unverified"});
  });
  it.each([NaN, Infinity, -1])("rejects an invalid cap %s before any request", async cap => {
    const {client, signTypedData} = fixture();
    await expect(x402FetchTool.execute(client, {url: "https://paid.example", maxPaymentUsd: cap})).rejects.toThrow();
    expect(publicFetch).not.toHaveBeenCalled(); expect(signTypedData).not.toHaveBeenCalled();
  });
});
