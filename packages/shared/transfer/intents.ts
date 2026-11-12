import { additionalFeeReserve, opFeeChains } from "../gasestimator/network-fees.js";
import * as z from "zod";
import { AgentekClient, createTool, type Intent, type Op } from "../client.js";
import { arbitrum, base, mainnet, optimism, sepolia } from "viem/chains";
import { type Address, encodeFunctionData, erc20Abi } from "viem";
import { identityAddress, positiveUnits } from "../utils/exact.js";
import { resolveENSTool } from "../ens/tools.js";

export const ETH_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const supportedChains = [mainnet, arbitrum, base, optimism, sepolia];
const common = {
  token: identityAddress.describe("Token contract, or the zero address for native ETH"),
  amount: z.string().describe("Exact positive amount in human units; excess precision is rejected"),
  to: z.string().describe("Recipient address or ENS name"),
  chainId: z.number().int().positive().safe().optional().describe("Required when more than one supported chain is configured"),
};

async function transfer(client: AgentekClient, args: z.infer<z.ZodObject<typeof common>> & {from?: string}): Promise<Intent> {
  const chains = client.filterSupportedChains(supportedChains, args.chainId);
  if (chains.length !== 1) throw new Error("Specify chainId explicitly when multiple chains are configured; token addresses and gas prices cannot establish the intended chain");
  const chainId = chains[0].id;
  const rpc = client.getPublicClient(chainId);
  const sender = await client.getAddress();
  const from = identityAddress.parse(args.from ?? sender) as Address;
  const to = identityAddress.parse(args.to.includes(".") ? await resolveENSTool.execute(client, {name: args.to}) : args.to) as Address;
  const token = args.token as Address;
  const native = token === ETH_ADDRESS;
  if (native && args.from) throw new Error("ETH transferFrom not supported");
  const decimals = native ? 18 : await rpc.readContract({address: token, abi: erc20Abi, functionName: "decimals"});
  const amount = positiveUnits(args.amount, decimals);
  const balance = native ? await rpc.getBalance({address: from}) : await rpc.readContract({address: token, abi: erc20Abi, functionName: "balanceOf", args: [from]});
  if (balance < amount) throw new Error("Insufficient token balance on the selected chain");
  if (args.from) {
    const allowance = await rpc.readContract({address: token, abi: erc20Abi, functionName: "allowance", args: [from, sender]});
    if (allowance < amount) throw new Error("Insufficient transferFrom allowance for the connected sender");
  }
  const op: Op = native ? {target: to, value: amount.toString(), data: "0x"} : {
    target: token, value: "0", data: args.from
      ? encodeFunctionData({abi: erc20Abi, functionName: "transferFrom", args: [from, to, amount]})
      : encodeFunctionData({abi: erc20Abi, functionName: "transfer", args: [to, amount]}),
  };
  const gas = await rpc.estimateGas({account: sender, to: op.target, value: BigInt(op.value), data: op.data});
  const fees = await rpc.estimateFeesPerGas();
  const price = fees.maxFeePerGas ?? fees.gasPrice;
  if (price === undefined) throw new Error("Gas fee estimate unavailable");
  let additional = 0n;
  if (opFeeChains.has(chainId)) {
    if (await rpc.getChainId() !== chainId) throw new Error("RPC network mismatch");
    additional = BigInt((await additionalFeeReserve(rpc, chainId, op.data, BigInt(gas))).additionalReserveWei);
  }
  const nativeBalance = native ? balance : await rpc.getBalance({address: sender});
  if (nativeBalance < BigInt(op.value) + BigInt(gas) * BigInt(price) + additional) throw new Error("Insufficient native balance including estimated gas reserve");
  const ops = [op];
  return {intent: `Send ${args.amount} ${token} from ${from} to ${to}`, ops, chain: chainId,
    ...(client.getWalletClient(chainId) ? {hash: await client.executeOps(ops, chainId)} : {})};
}

export const intentTransferTool = createTool({
  name: "intentTransfer", description: "Transfer tokens on an explicit chain with exact amounts, ENS resolution, balance and gas checks.",
  supportedChains, parameters: z.object(common), execute: transfer,
});
export const intentTransferFromTool = createTool({
  name: "intentTransferFrom", description: "Transfer ERC20 tokens using the connected sender's allowance on an explicit chain.",
  supportedChains, parameters: z.object({...common, from: identityAddress}), execute: transfer,
});
