import {
  createPublicClient,
  erc20Abi,
  http,
  isAddress,
  parseUnits,
  type Address,
} from "viem";
import { mainnet } from "viem/chains";
import { GYM_CHAIN_IDS, AnvilForkEnvironment } from "../environment/AnvilForkEnvironment.js";
import { MultiChainForkEnvironment } from "../environment/MultiChainForkEnvironment.js";
import { ETHEREUM_MVP_ASSETS } from "../environment/wallet.js";
import type { AcrossRelayTrace } from "../adapters/AcrossRelayerAdapter.js";
import type { MvpGraderDefinition, MvpTask } from "../task/schema.js";

export interface GradeResult {
  type: "balance" | "allowance" | "acrossSettlement" | "outputContains" | "contractView";
  chain: string;
  passed: boolean;
  asset: string;
  account: Address;
  spender?: Address;
  operator: "gte" | "lte" | "eq" | "contains";
  expected: string;
  actual?: string;
  tolerance?: string;
  decimals?: number;
  error?: string;
}

export function compareAmounts(
  actual: bigint,
  expected: bigint,
  operator: "gte" | "lte" | "eq",
  tolerance = 0n,
): boolean {
  if (operator === "gte") return actual >= expected;
  if (operator === "lte") return actual <= expected;
  return actual >= expected - tolerance && actual <= expected + tolerance;
}

function tokenAddress(asset: string, chain: string, task?: MvpTask): Address {
  if (isAddress(asset)) return asset;
  const configured = task?.wallet.chains?.[chain as keyof typeof task.wallet.chains]?.assets?.[asset.toUpperCase()]
    ?? (chain === "ethereum" ? ETHEREUM_MVP_ASSETS[asset.toUpperCase()] : undefined);
  if (!configured) throw new Error(`Unknown MVP token ${asset}`);
  return configured.address;
}

export async function gradeTask(
  definitions: readonly MvpGraderDefinition[],
  environment: AnvilForkEnvironment | MultiChainForkEnvironment,
  task?: MvpTask,
  acrossRelays: readonly AcrossRelayTrace[] = [],
  agentOutput?: string,
): Promise<GradeResult[]> {
  const agent = environment.getWalletAccount().address;
  const results: GradeResult[] = [];

  for (const definition of definitions) {
    if (definition.type === "outputContains") {
      const actual = agentOutput ?? "";
      const passed = definition.caseSensitive
        ? actual.includes(definition.value)
        : actual.toLowerCase().includes(definition.value.toLowerCase());
      results.push({ type: "outputContains", chain: "offchain", passed,
        asset: "agentOutput", account: agent, operator: "contains",
        expected: definition.value, actual });
      continue;
    }
    if (definition.type === "acrossSettlement") {
      const matches = acrossRelays.filter((relay) =>
        relay.status === "settled" &&
        relay.originChainId === GYM_CHAIN_IDS[definition.originChain] &&
        relay.destinationChainId === GYM_CHAIN_IDS[definition.destinationChain] &&
        relay.recipient.toLowerCase() === definition.recipient.toLowerCase() &&
        relay.outputToken.toLowerCase() === definition.outputToken.toLowerCase());
      results.push({
        type: "acrossSettlement",
        chain: definition.destinationChain,
        passed: matches.length > 0,
        asset: definition.outputToken,
        account: definition.recipient,
        operator: "gte",
        expected: "1",
        actual: String(matches.length),
        decimals: 0,
      });
      continue;
    }
    const chain = definition.chain ?? "ethereum";
    const chainId = GYM_CHAIN_IDS[chain];
    const client = createPublicClient({
      chain: { ...mainnet, id: chainId },
      transport: http(environment.getRpcUrl(chainId), { retryCount: 0 }),
    });
    if (definition.type === "contractView") {
      const result: GradeResult = {
        type: "contractView", chain, passed: false, asset: definition.address,
        account: agent, operator: definition.operator, expected: definition.value,
        tolerance: definition.tolerance, decimals: definition.decimals,
      };
      try {
        const value = await client.readContract({
          address: definition.address,
          abi: definition.abi,
          functionName: definition.functionName,
          args: definition.args,
        });
        if (typeof value !== "bigint" && typeof value !== "number" && typeof value !== "string") {
          throw new Error("contractView grader requires a scalar numeric return value");
        }
        const actual = BigInt(value);
        const expected = parseUnits(definition.value, definition.decimals);
        const tolerance = definition.tolerance === undefined
          ? 0n : parseUnits(definition.tolerance, definition.decimals);
        result.actual = actual.toString();
        result.passed = compareAmounts(actual, expected, definition.operator, tolerance);
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
      }
      results.push(result);
      continue;
    }
    const account = definition.type === "balance"
      ? definition.account === "agent" ? agent : definition.account
      : definition.owner === "agent" ? agent : definition.owner;
    const asset = definition.type === "balance" ? definition.asset : definition.token;
    const result: GradeResult = {
      type: definition.type,
      chain,
      passed: false,
      asset,
      account,
      spender: definition.type === "allowance" ? definition.spender : undefined,
      operator: definition.operator,
      expected: definition.value,
      tolerance: definition.tolerance,
    };
    try {
      let actual: bigint;
      let decimals: number;
      if (definition.type === "balance" && asset.toUpperCase() === "ETH") {
        actual = await client.getBalance({ address: account });
        decimals = 18;
      } else {
        const token = tokenAddress(asset, chain, task);
        decimals = await client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "decimals",
        });
        actual = definition.type === "balance"
          ? await client.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [account],
            })
          : await client.readContract({
              address: token,
              abi: erc20Abi,
              functionName: "allowance",
              args: [account, definition.spender],
            });
      }
      const expected = parseUnits(definition.value, decimals);
      const tolerance = parseUnits(definition.tolerance ?? "0", decimals);
      result.decimals = decimals;
      result.actual = actual.toString();
      result.passed = compareAmounts(actual, expected, definition.operator, tolerance);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }
    results.push(result);
  }
  return results;
}
