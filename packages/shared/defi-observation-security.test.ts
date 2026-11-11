import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserPositions } from "./uniV3/tools.js";
import { observeAaveAccountTool } from "./aave/observation.js";
import { getAaveReserveData } from "./aave/tools.js";
import { canUnlockSlow } from "./slowTransfer/tools.js";
import { beginChainObservation, finishChainObservation } from "./utils/chainObservation.js";

const NOW = 1_800_000_000n;
const OWNER = `0x${"11".repeat(20)}`;
const TOKEN = `0x${"22".repeat(20)}`;
const HASH = `0x${"a".repeat(64)}`;
const header = (changes = {}) => ({ number: 100n, hash: HASH, timestamp: NOW - 10n, ...changes });
const client = (rpc: any) => ({ getPublicClient: () => rpc, getAddress: async () => OWNER }) as any;
const word = (value: bigint) => value.toString(16).padStart(64, "0");
const aaveData = `0x${[9007199254740993n, 1n, 0n, 8000n, 7500n, 10n ** 18n].map(word).join("")}`;
function rpcAt(chainId = 1) {
  return { getChainId: vi.fn(async () => chainId), getBlock: vi.fn(async (_args?: unknown) => header()) };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Number(NOW) * 1000);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in observation fixtures"); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("fresh canonical chain snapshots", () => {
  it.each([
    { number: null }, { number: -1n }, { hash: null }, { hash: "0x" }, { hash: `0x${"0".repeat(64)}` },
    { timestamp: undefined }, { timestamp: NOW - 301n }, { timestamp: NOW + 61n },
  ])("rejects unavailable, stale or malformed initial headers: %s", async bad => {
    const rpc = { ...rpcAt(), getBlock: async () => header(bad) };
    await expect(beginChainObservation(rpc as any, 1)).rejects.toThrow(/block/i);
  });

  it("rejects an RPC reporting another chain before any state reads", async () => {
    const rpc = rpcAt(8453);
    await expect(beginChainObservation(rpc as any, 1)).rejects.toThrow(/chain/);
    expect(rpc.getBlock).not.toHaveBeenCalled();
  });

  it.each([
    { number: 101n }, { hash: `0x${"b".repeat(64)}` }, { timestamp: NOW - 11n },
  ])("rejects changed canonical headers after the reads: %s", async changed => {
    const rpc = rpcAt();
    const snapshot = await beginChainObservation(rpc as any, 1);
    rpc.getBlock.mockResolvedValueOnce(header(changed));
    await expect(finishChainObservation(rpc as any, snapshot)).rejects.toThrow(/block/);
    expect(rpc.getBlock).toHaveBeenLastCalledWith({ blockNumber: 100n });
  });

  it("rejects a chain switch or snapshot expiring while reads are in flight", async () => {
    const rpc = rpcAt();
    const snapshot = await beginChainObservation(rpc as any, 1);
    rpc.getChainId.mockResolvedValueOnce(8453);
    await expect(finishChainObservation(rpc as any, snapshot)).rejects.toThrow(/chain changed/);
    vi.spyOn(Date, "now").mockReturnValue(Number(NOW + 301n) * 1000);
    await expect(finishChainObservation(rpc as any, snapshot)).rejects.toThrow(/stale/);
  });
});

describe("Uniswap LP pagination at one block", () => {
  function lpRpc() {
    const rpc = {
      ...rpcAt(),
      readContract: vi.fn(async ({ functionName, args, blockNumber }) => {
        expect(blockNumber).toBe(100n);
        if (functionName === "balanceOf") return 9007199254740993n;
        if (functionName === "tokenOfOwnerByIndex") return args[1] + 9007199254740993n;
        return [0n, OWNER, TOKEN, OWNER, 3000, -1, 1, 1n, 0n, 0n, 2n, 3n];
      }),
    };
    return rpc;
  }

  it("pins balance, indices and details and reports their shared block identity", async () => {
    const rpc = lpRpc();
    const result = await getUserPositions.execute(client(rpc), { chainId: 1, offset: 5, limit: 2 });
    expect(result).toMatchObject({ chainId: 1, block: "0x64", blockHash: HASH, blockTimestamp: (NOW - 10n).toString(), total: "9007199254740993", nextOffset: 7 });
    expect(result.positions.map(position => position.tokenId)).toEqual(["9007199254740998", "9007199254740999"]);
    expect(rpc.readContract).toHaveBeenCalledTimes(5);
    expect(rpc.getBlock.mock.calls.map(([args]) => args)).toEqual([{ blockTag: "latest" }, { blockNumber: 100n }]);
  });

  it("rejects the entire page if the pinned block is reorganized", async () => {
    const rpc = lpRpc();
    rpc.getBlock.mockResolvedValueOnce(header()).mockResolvedValueOnce(header({ hash: `0x${"b".repeat(64)}` }));
    await expect(getUserPositions.execute(client(rpc), { chainId: 1, offset: 0, limit: 2 })).rejects.toThrow(/block changed/);
  });

  it("keeps failed enumeration unknown and rejects duplicate token IDs", async () => {
    const rpc = lpRpc();
    rpc.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "balanceOf") return 2n;
      if (functionName === "tokenOfOwnerByIndex") throw new Error("enumeration unavailable");
      throw new Error("must not fetch details");
    });
    await expect(getUserPositions.execute(client(rpc), { chainId: 1, offset: 0, limit: 2 })).rejects.toThrow(/unavailable/);
    rpc.readContract.mockImplementation(async ({ functionName }) => functionName === "balanceOf" ? 2n : 1n);
    await expect(getUserPositions.execute(client(rpc), { chainId: 1, offset: 0, limit: 2 })).rejects.toThrow(/duplicate/);
  });
});

describe("Aave account evidence", () => {
  function aaveRpc() {
    return {
      ...rpcAt(),
      getCode: vi.fn(async ({ blockNumber }) => { expect(blockNumber).toBe(100n); return "0x6000"; }),
      call: vi.fn(async ({ blockNumber }) => { expect(blockNumber).toBe(100n); return { data: aaveData }; }),
    };
  }

  it("reports exact aggregates with chain/hash/freshness evidence", async () => {
    const rpc = aaveRpc();
    const result = await observeAaveAccountTool.execute(client(rpc), { owner: OWNER, chainId: 1 });
    expect(result).toMatchObject({ block: "0x64", blockHash: HASH, blockTimestamp: (NOW - 10n).toString(), collateral: "90071992.54740993", debt: "0.00000001", needsAttention: true });
    expect(result.coverage).toContain("Code presence is not implementation verification");
  });

  it("rejects wrong-chain, stale, changed-hash and incomplete evidence", async () => {
    const wrong = aaveRpc(); wrong.getChainId.mockResolvedValue(8453);
    await expect(observeAaveAccountTool.execute(client(wrong), { owner: OWNER, chainId: 1 })).rejects.toThrow(/chain/);
    expect(wrong.call).not.toHaveBeenCalled();
    const stale = aaveRpc(); stale.getBlock.mockResolvedValue(header({ timestamp: NOW - 301n }));
    await expect(observeAaveAccountTool.execute(client(stale), { owner: OWNER, chainId: 1 })).rejects.toThrow(/stale/);
    const reorg = aaveRpc(); reorg.getBlock.mockResolvedValueOnce(header()).mockResolvedValueOnce(header({ hash: `0x${"b".repeat(64)}` }));
    await expect(observeAaveAccountTool.execute(client(reorg), { owner: OWNER, chainId: 1 })).rejects.toThrow(/block changed/);
    const incomplete = aaveRpc(); incomplete.call.mockResolvedValue({ data: "0x" });
    await expect(observeAaveAccountTool.execute(client(incomplete), { owner: OWNER, chainId: 1 })).rejects.toThrow(/not zero/);
  });
});

describe("SLOW chain-time unlock evidence", () => {
  function slowRpc(timestamp: bigint, delay: bigint) {
    return {
      ...rpcAt(8453),
      readContract: vi.fn(async ({ functionName, blockNumber }) => {
        expect(blockNumber).toBe(100n);
        return functionName === "pendingTransfers" ? [timestamp, OWNER, TOKEN, 1n, 20n] : [TOKEN, delay];
      }),
    };
  }

  it("uses the pinned chain timestamp when the host clock would report unlocked", async () => {
    const rpc = slowRpc(NOW - 15n, 10n);
    const result = await canUnlockSlow.execute(client(rpc), { transferId: "1" });
    expect(result).toMatchObject({ canUnlock: false, timeRemaining: 5, blockTimestamp: (NOW - 10n).toString(), blockHash: HASH, chainId: 8453 });
    expect(rpc.readContract).toHaveBeenCalledTimes(2);
  });

  it("compares bigint timing before any conversion and rejects unsafe output numbers", async () => {
    const rpc = slowRpc(BigInt(Number.MAX_SAFE_INTEGER), 1n);
    await expect(canUnlockSlow.execute(client(rpc), { transferId: "1" })).rejects.toThrow(/safe numeric bounds/);
  });

  it("rejects block changes after the timing reads", async () => {
    const rpc = slowRpc(NOW - 30n, 1n);
    rpc.getBlock.mockResolvedValueOnce(header()).mockResolvedValueOnce(header({ hash: `0x${"b".repeat(64)}` }));
    await expect(canUnlockSlow.execute(client(rpc), { transferId: "1" })).rejects.toThrow(/block changed/);
  });
});

it("labels raw annualized Aave ray rates as APR and does not invent compounded APY", async () => {
  const reserve = {
    configuration: { data: 1n << 56n }, liquidityIndex: 10n ** 27n, variableBorrowIndex: 10n ** 27n,
    currentLiquidityRate: 5n * 10n ** 25n, currentVariableBorrowRate: 75n * 10n ** 24n, currentStableBorrowRate: 0n,
    lastUpdateTimestamp: Number(NOW), id: 1, aTokenAddress: TOKEN, stableDebtTokenAddress: TOKEN,
    variableDebtTokenAddress: TOKEN, interestRateStrategyAddress: TOKEN, accruedToTreasury: 0n, unbacked: 0n, isolationModeTotalDebt: 0n,
  };
  const result = await getAaveReserveData.execute(client({ readContract: async () => reserve }), { asset: TOKEN, chainId: 1 });
  expect(result.summary).toMatchObject({ supplyAPR: "5.00%", variableBorrowAPR: "7.50%", stableBorrowAPR: "0.00%", supplyAPY: null, variableBorrowAPY: null, stableBorrowAPY: null });
  expect(result.summary.rateBasis).toContain("Compounding is not calculated");
  expect(result.rawData.currentLiquidityRate).toBe(reserve.currentLiquidityRate.toString());
});
