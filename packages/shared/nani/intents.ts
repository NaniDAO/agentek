import z from "zod";
import { Intent } from "../client.js";
import { encodeFunctionData, erc20Abi, maxUint256, parseEther } from "viem";
import { mainnet, base } from "viem/chains";

import { XNaniAbi, SignalsAbi } from "./abis.js";
import { XNANI_TOKEN, SIGNALS_ADDRESS, NANI_TOKEN } from "./constants.js";
import { createTool } from "../client.js";

export const intentStakeNani = createTool({
  name: "intentStakeNani",
  description:
    "Stake NANI tokens to receive xNANI tokens, which can be used for governance",
  parameters: z.object({
    amount: z.string().describe("The amount of NANI tokens to stake"),
    chainId: z.number().describe("The chain to stake on"),
  }),
  supportedChains: [mainnet, base],
  execute: async (client, args): Promise<Intent> => {
    const { chainId, amount } = args;
    const publicClient = client.getPublicClient(chainId);
    if (!publicClient) {
      throw new Error("No public client found for " + chainId);
    }
    const walletClient = client.getWalletClient(chainId);
    const user = await client.getAddress();
    const intent = `stake ${amount} NANI`;

    const allowance = await publicClient.readContract({
      address: NANI_TOKEN,
      abi: erc20Abi,
      functionName: "allowance",
      args: [user, XNANI_TOKEN],
    });

    const amountBigInt = parseEther(amount);

    let ops = [];

    if (allowance < amountBigInt) {
      ops.push({
        target: NANI_TOKEN,
        value: "0",
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [XNANI_TOKEN, maxUint256],
        }),
      });
    }

    ops.push({
      target: XNANI_TOKEN,
      value: "0",
      data: encodeFunctionData({
        abi: XNaniAbi,
        functionName: "stake",
        args: [amountBigInt],
      }),
    });

    if (walletClient) {
      const hash = await client.executeOps(ops, chainId);

      return {
        intent,
        chain: chainId,
        ops,
        hash,
      };
    }

    return {
      intent,
      chain: chainId,
      ops,
    };
  },
});

export const intentUnstakeNani = createTool({
  name: "intentUnstakeNani",
  description: "Unstake xNANI tokens back to NANI tokens",
  parameters: z.object({
    amount: z.string().describe("The amount of xNANI tokens to unstake"),
    chainId: z.number().describe("The chain to unstake on"),
  }),
  supportedChains: [mainnet, base],
  execute: async (client, args): Promise<Intent> => {
    const { chainId, amount } = args;
    const publicClient = client.getPublicClient(chainId);
    if (!publicClient) {
      throw new Error("No public client found for " + chainId);
    }
    const walletClient = client.getWalletClient(chainId);
    const user = await client.getAddress();
    const intent = `unstake ${amount} xNANI`;

    const amountBigInt = parseEther(amount);

    const xNaniBalance = await publicClient.readContract({
      address: XNANI_TOKEN,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [user],
    });

    if (xNaniBalance < amountBigInt) {
      throw new Error("Insufficient xNANI balance for unstake");
    }

    const ops = [
      {
        target: XNANI_TOKEN,
        value: "0",
        data: encodeFunctionData({
          abi: XNaniAbi,
          functionName: "unstake",
          args: [parseEther(amount)],
        }),
      },
    ];

    if (walletClient) {
      const hash = await client.executeOps(ops, chainId);

      return {
        intent,
        chain: chainId,
        ops,
        hash,
      };
    }

    return {
      intent,
      chain: chainId,
      ops,
    };
  },
});

export const intentProposeNani = createTool({
  name: "intentProposeNani",
  description: "Create a new governance proposal for NANIDAO",
  parameters: z.object({
    content: z.string().describe("The proposal content/description"),
    chainId: z.number().describe("The chain ID to propose on"),
  }),
  supportedChains: [mainnet, base],
  execute: async (client, args): Promise<Intent> => {
    const { chainId } = args;
    const publicClient = client.getPublicClient(chainId);
    if (!publicClient) {
      throw new Error("No public client found for " + chainId);
    }
    const walletClient = client.getWalletClient(chainId);

    const ops = [
      {
        target: SIGNALS_ADDRESS,
        value: "0",
        data: encodeFunctionData({
          abi: SignalsAbi,
          functionName: "propose",
          args: [args.content],
        }),
      },
    ];

    if (walletClient) {
      const hash = await client.executeOps(ops, chainId);

      return {
        intent: `propose "${args.content}" on NANI`,
        chain: chainId,
        ops,
        hash,
      };
    }

    return {
      intent: `propose "${args.content})" on NANI`,
      chain: chainId,
      ops,
    };
  },
});

export const intentVoteNaniProposal = createTool({
  name: "intentVoteNaniProposal",
  description: "Vote on an existing NANIDAO governance proposal",
  parameters: z.object({
    proposalId: z.number().describe("The ID of the proposal to vote on"),
    approve: z.boolean().describe("True to vote yes, false to vote no"),
    chainId: z.number().describe("The chain ID to vote on"),
  }),
  supportedChains: [mainnet, base],
  execute: async (client, args): Promise<Intent> => {
    const { chainId } = args;
    const publicClient = client.getPublicClient(chainId);
    if (!publicClient) {
      throw new Error("No public client found for " + chainId);
    }
    const walletClient = client.getWalletClient(chainId);

    const ops = [
      {
        target: SIGNALS_ADDRESS,
        value: "0",
        data: encodeFunctionData({
          abi: SignalsAbi,
          functionName: "vote",
          args: [BigInt(args.proposalId), args.approve],
        }),
      },
    ];

    if (walletClient) {
      const hash = await client.executeOps(ops, chainId);

      return {
        intent: `vote ${args.approve ? "yes" : "no"} on NANI proposal ${args.proposalId}`,
        chain: chainId,
        ops,
        hash,
      };
    }

    return {
      intent: `vote ${args.approve ? "yes" : "no"} on NANI proposal ${args.proposalId}`,
      chain: chainId,
      ops,
    };
  },
});
