import { z } from "zod";
import { createTool } from "../client";
import { Address, erc20Abi, formatUnits } from "viem";
import { erc20Chains } from "./constants";

const getAllowanceParameters = z.object({
  token: z.string().describe("The token address"),
  owner: z.string().describe("The token owner's address"),
  spender: z.string().describe("The spender's address"),
  chainId: z
    .number()
    .optional()
    .describe("If not specified, returns approval for all supported chains."),
});

const getBalanceOfParameters = z.object({
  token: z.string().describe("The token address"),
  owner: z.string().describe("The token owner's address"),
  chainId: z
    .number()
    .optional()
    .describe("If not specified, returns balance for all supported chains."),
});

const getTotalSupplyParameters = z.object({
  token: z.string().describe("The token address"),
  chainId: z
    .number()
    .optional()
    .describe(
      "If not specified, returns total supply for all supported chains.",
    ),
});

const getDecimalsParameters = z.object({
  token: z.string().describe("The token address"),
  chainId: z
    .number()
    .optional()
    .describe("If not specified, returns decimals for all supported chains."),
});

const getNameParameters = z.object({
  token: z.string().describe("The token address"),
  chainId: z
    .number()
    .optional()
    .describe("If not specified, returns name for all supported chains."),
});

const getSymbolParameters = z.object({
  token: z.string().describe("The token address"),
  chainId: z
    .number()
    .optional()
    .describe("If not specified, returns symbol for all supported chains."),
});

const tokenMetadataParameters = z.object({
  token: z.string().describe("The token address"),
  chainId: z.number().describe("The token chain"),
});

export const getAllowanceTool = createTool({
  name: "getAllowance",
  description: "Gets the ERC20 token allowance between an owner and spender",
  supportedChains: erc20Chains,
  parameters: getAllowanceParameters,
  execute: async (client, args) => {
    const { token, owner, spender, chainId } = args;
    const chains = client.filterSupportedChains(erc20Chains, chainId);

    const allowances = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        try {
          const decimals = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "decimals",
          });
          const allowance = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [owner as Address, spender as Address],
          });

          return {
            chain: chain.id,
            allowance: formatUnits(allowance, decimals),
          };
        } catch (error) {
          // @TODO type specific viem short errors
          return {
            chain: chain.id,
            error: `Failed to fetch allowance: ${typeof error === "object" && error ? ("shortMessage" in error ? error.shortMessage : "message" in error ? error.message : "Unknown error") : String(error)}`,
          };
        }
      }),
    );

    return allowances;
  },
});

export const getBalanceOfTool = createTool({
  name: "getBalanceOf",
  description: "Gets the ERC20 token balance of an address",
  supportedChains: erc20Chains,
  parameters: getBalanceOfParameters,
  execute: async (client, args) => {
    const { token, owner, chainId } = args;
    const chains = client.filterSupportedChains(erc20Chains, chainId);

    const balances = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        try {
          const decimals = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "decimals",
          });
          const balance = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner as Address],
          });

          return {
            chain: chain.id,
            balance: formatUnits(balance, decimals),
          };
        } catch (error) {
          return {
            chain: chain.id,
            error: `Failed to fetch balance: ${typeof error === "object" && error ? ("shortMessage" in error ? error.shortMessage : "message" in error ? error.message : "Unknown error") : String(error)}`,
          };
        }
      }),
    );

    return balances;
  },
});

export const getTotalSupplyTool = createTool({
  name: "getTotalSupply",
  description: "Gets the total supply of an ERC20 token",
  supportedChains: erc20Chains,
  parameters: getTotalSupplyParameters,
  execute: async (client, args) => {
    const { token, chainId } = args;
    const chains = client.filterSupportedChains(erc20Chains, chainId);

    const supplies = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        try {
          const decimals = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "decimals",
          });
          const totalSupply = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "totalSupply",
          });

          return {
            chain: chain.id,
            totalSupply: formatUnits(totalSupply, decimals),
          };
        } catch (error) {
          return {
            chain: chain.id,
            error: `Failed to fetch total supply: ${typeof error === "object" && error ? ("shortMessage" in error ? error.shortMessage : "message" in error ? error.message : "Unknown error") : String(error)}`,
          };
        }
      }),
    );

    return supplies;
  },
});

export const getDecimalsTool = createTool({
  name: "getDecimals",
  description: "Gets the number of decimals of an ERC20 token",
  supportedChains: erc20Chains,
  parameters: getDecimalsParameters,
  execute: async (client, args) => {
    const { token, chainId } = args;
    const chains = client.filterSupportedChains(erc20Chains, chainId);

    const tokenDecimals = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        try {
          const decimals = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "decimals",
          });

          return {
            chain: chain.id,
            decimals,
          };
        } catch (error) {
          return {
            chain: chain.id,
            error: `Failed to fetch decimals: ${typeof error === "object" && error ? ("shortMessage" in error ? error.shortMessage : "message" in error ? error.message : "Unknown error") : String(error)}`,
          };
        }
      }),
    );

    return tokenDecimals;
  },
});

export const getNameTool = createTool({
  name: "getName",
  description: "Gets the name of an ERC20 token",
  supportedChains: erc20Chains,
  parameters: getNameParameters,
  execute: async (client, args) => {
    const { token, chainId } = args;
    const chains = client.filterSupportedChains(erc20Chains, chainId);

    const names = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        try {
          const name = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "name",
          });

          return {
            chain: chain.id,
            name,
          };
        } catch (error) {
          return {
            chain: chain.id,
            error: `Failed to fetch name: ${typeof error === "object" && error ? ("shortMessage" in error ? error.shortMessage : "message" in error ? error.message : "Unknown error") : String(error)}`,
          };
        }
      }),
    );

    return names;
  },
});

export const getSymbolTool = createTool({
  name: "getSymbol",
  description: "Gets the symbol of an ERC20 token",
  supportedChains: erc20Chains,
  parameters: getSymbolParameters,
  execute: async (client, args) => {
    const { token, chainId } = args;
    const chains = client.filterSupportedChains(erc20Chains, chainId);

    const symbols = await Promise.all(
      chains.map(async (chain) => {
        const publicClient = client.getPublicClient(chain.id);
        try {
          const symbol = await publicClient.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: "symbol",
          });

          return {
            chain: chain.id,
            symbol,
          };
        } catch (error) {
          return {
            chain: chain.id,
            error: `Failed to fetch symbol: ${typeof error === "object" && error ? ("shortMessage" in error ? error.shortMessage : "message" in error ? error.message : "Unknown error") : String(error)}`,
          };
        }
      }),
    );

    return symbols;
  },
});

export const getTokenMetadataTool = createTool({
  name: "getTokenMetadata",
  description:
    "Gets all metadata (name, symbol, decimals, totalSupply) of an ERC20 token",
  supportedChains: erc20Chains,
  parameters: tokenMetadataParameters,
  execute: async (client, args) => {
    const { token, chainId } = args;
    const publicClient = client.getPublicClient(chainId);
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      publicClient.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "name",
      }),
      publicClient.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "decimals",
      }),
      publicClient.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "totalSupply",
      }),
    ]);

    return {
      chain: chainId,
      name,
      symbol,
      decimals,
      totalSupply: formatUnits(totalSupply, decimals),
    };
  },
});
