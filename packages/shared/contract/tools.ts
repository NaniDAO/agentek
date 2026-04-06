import { z } from "zod";
import type { Abi, Address } from "viem";
import { encodeFunctionData } from "viem";
import type { AgentekClient, Intent } from "../client.js";
import { createTool } from "../client.js";
import { clean } from "../utils.js";
import { supportedChains, BLOCKSCOUT_API_ENDPOINTS } from "./constants.js";

const abiSchema = z
  .array(z.any())
  .describe(
    "Contract ABI as a JSON array. If omitted, the ABI will be auto-fetched from Blockscout for verified contracts.",
  )
  .optional();

const argsSchema = z
  .array(z.any())
  .describe(
    "Arguments to pass to the function. Use strings for addresses and uint256 values. Order must match the function signature.",
  )
  .optional();

/**
 * Fetch the ABI of a verified contract from Blockscout v2.
 * If the contract is a proxy, follows the implementation address to get the full ABI.
 * Returns null if the contract is not verified or the chain is unsupported.
 */
async function fetchAbiFromBlockscout(
  chainId: number,
  address: string,
): Promise<Abi | null> {
  const baseUrl = BLOCKSCOUT_API_ENDPOINTS[chainId];
  if (!baseUrl) return null;

  const res = await fetch(`${baseUrl}/smart-contracts/${address}`);
  if (!res.ok) return null;

  const data = await res.json();

  // If the contract is a proxy with a known implementation, fetch the implementation ABI
  if (
    data.implementations &&
    Array.isArray(data.implementations) &&
    data.implementations.length > 0
  ) {
    const implAddress = data.implementations[0].address_hash;
    if (implAddress) {
      const implRes = await fetch(`${baseUrl}/smart-contracts/${implAddress}`);
      if (implRes.ok) {
        const implData = await implRes.json();
        if (implData.abi && Array.isArray(implData.abi) && implData.abi.length > 0) {
          return implData.abi as Abi;
        }
      }
    }
  }

  if (!data.abi || !Array.isArray(data.abi) || data.abi.length === 0) {
    return null;
  }

  return data.abi as Abi;
}

/**
 * Resolve the ABI — use the provided one, or auto-fetch from Blockscout.
 */
async function resolveAbi(
  chainId: number,
  address: string,
  providedAbi?: any[],
): Promise<Abi> {
  if (providedAbi && providedAbi.length > 0) {
    return providedAbi as Abi;
  }

  const fetched = await fetchAbiFromBlockscout(chainId, address);
  if (!fetched) {
    throw new Error(
      `No ABI provided and contract ${address} is not verified on Blockscout for chain ${chainId}. Please provide the ABI manually.`,
    );
  }
  return fetched;
}

export const readContractTool = createTool({
  name: "readContract",
  description:
    "Read data from any smart contract by calling a view/pure function. Supports any chain and any contract. If the ABI is not provided, it will be auto-fetched from Blockscout for verified contracts.",
  supportedChains,
  parameters: z.object({
    address: z
      .string()
      .describe("The contract address to read from (0x...)"),
    functionName: z
      .string()
      .describe("The name of the function to call (e.g. 'balanceOf', 'totalSupply')"),
    args: argsSchema,
    abi: abiSchema,
    chainId: z
      .number()
      .describe("Chain ID to read from (e.g. 1 for Ethereum, 8453 for Base)"),
  }),
  execute: async (client: AgentekClient, params) => {
    const { address, functionName, args, chainId } = params;

    const abi = await resolveAbi(chainId, address, params.abi);
    const publicClient = client.getPublicClient(chainId);

    const result = await publicClient.readContract({
      address: address as Address,
      abi,
      functionName,
      args: args ?? [],
    });

    return clean(result);
  },
});

export const intentWriteContractTool = createTool({
  name: "intentWriteContract",
  description:
    "Write to any smart contract by calling a state-changing function. Builds a transaction intent that can be executed if a wallet is connected. If the ABI is not provided, it will be auto-fetched from Blockscout for verified contracts.",
  supportedChains,
  parameters: z.object({
    address: z
      .string()
      .describe("The contract address to write to (0x...)"),
    functionName: z
      .string()
      .describe("The name of the function to call (e.g. 'transfer', 'approve', 'mint')"),
    args: argsSchema,
    abi: abiSchema,
    value: z
      .string()
      .optional()
      .describe("ETH value to send with the transaction in wei. Defaults to '0'."),
    chainId: z
      .number()
      .describe("Chain ID to execute on (e.g. 1 for Ethereum, 8453 for Base)"),
  }),
  execute: async (client: AgentekClient, params): Promise<Intent> => {
    const { address, functionName, args, value, chainId } = params;

    const abi = await resolveAbi(chainId, address, params.abi);

    const data = encodeFunctionData({
      abi,
      functionName,
      args: args ?? [],
    });

    const ops = [
      {
        target: address as Address,
        value: value ?? "0",
        data,
      },
    ];

    const intentDescription = `Call ${functionName} on ${address} (chain ${chainId})`;
    const walletClient = client.getWalletClient(chainId);

    if (!walletClient) {
      return {
        intent: intentDescription,
        ops,
        chain: chainId,
      };
    }

    const hash = await client.executeOps(ops, chainId);
    return {
      intent: intentDescription,
      ops,
      chain: chainId,
      hash,
    };
  },
});
