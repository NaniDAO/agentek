import { z } from "zod";
import { createTool, Intent } from "../client";
import { SLOW_ADDRESS, slowAbi, slowTransferChains } from "./constants";
import { parseEther, encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { addressSchema } from "../utils";

export const intentDepositToSlow = createTool({
  name: "intentDepositToSlow",
  description: "Deposit tokens or ETH into SLOW contract with a timelock",
  supportedChains: slowTransferChains,
  parameters: z.object({
    chainId: z.number().describe("The chainId to execute the intent on."),
    token: addressSchema.describe(
      "The token address to deposit (use 0x0000000000000000000000000000000000000000 for ETH)",
    ),
    to: addressSchema.describe("The recipient address"),
    amount: z
      .string()
      .describe(
        "The amount to deposit in human readable format (e.g. for 0.01 ETH use 0.01)",
      ),
    delay: z.number().describe("The timelock delay in seconds"),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, token, to, amount, delay } = args;
    const isEth = token === "0x0000000000000000000000000000000000000000";
    const value = isEth ? parseEther(amount).toString() : "0";

    const intent = `Deposit ${amount} ${isEth ? "ETH" : token} to ${to} with a ${delay} seconds delay`;

    const ops = [];

    if (isEth) {
      ops.push({
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "depositTo",
          args: [token, to, 0n, BigInt(delay), "0x"],
        }),
        value,
      });
    } else {
      const decimals = await client.getPublicClient(chainId).readContract({
        address: token,
        abi: erc20Abi,
        functionName: "decimals",
      });

      const tokenAmount = parseUnits(amount, decimals);

      ops.push({
        target: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [SLOW_ADDRESS, tokenAmount],
        }),
        value: "0",
      });

      ops.push({
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "depositTo",
          args: [token, to, tokenAmount, BigInt(delay), "0x"],
        }),
        value,
      });
    }

    const walletClient = client.getWalletClient(chainId);
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

export const intentSetSlowGuardian = createTool({
  name: "intentSetSlowGuardian",
  description: "Set a guardian for a user in the SLOW contract",
  supportedChains: slowTransferChains,
  parameters: z.object({
    chainId: z.number().describe("The chainId to execute the intent on."),
    guardian: addressSchema.describe(
      "The guardian address to set (use zero address to remove guardian)",
    ),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, guardian } = args;
  
    const intent = `Set guardian to ${guardian}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "setGuardian",
          args: [guardian],
        }),
        value: "0",
      },
    ];

    const walletClient = client.getWalletClient(chainId);
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

export const intentWithdrawFromSlow = createTool({
  name: "intentWithdrawFromSlow",
  description: "Withdraw unlocked tokens from SLOW contract",
  supportedChains: slowTransferChains,
  parameters: z.object({
    chainId: z.number().describe("The chainId to execute the intent on."),
    from: addressSchema.describe("The address to withdraw from"),
    to: addressSchema.describe("The recipient address"),
    id: z.string().describe("The token ID to withdraw"),
    amount: z.string().describe("The amount to withdraw"),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, from, to, id, amount } = args;

    const intent = `Withdraw ${amount} of ${id} tokenId from ${from} to ${to}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "withdrawFrom",
          args: [from, to, BigInt(id), BigInt(amount)],
        }),
        value: "0",
      },
    ];

    const walletClient = client.getWalletClient(chainId);
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

export const intentApproveSlowTransfer = createTool({
  name: "intentApproveSlowTransfer",
  description: "Guardian approves a transfer in SLOW contract",
  supportedChains: slowTransferChains,
  parameters: z.object({
    chainId: z.number().describe("The chainId to execute the intent on."),
    from: addressSchema.describe(
      "The user address that initiated the transfer",
    ),
    transferId: z.string().describe("The transfer ID to approve"),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, from, transferId } = args;

    const intent = `Approve transfer with ID ${transferId}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "approveTransfer",
          args: [from, BigInt(transferId)],
        }),
        value: "0",
      },
    ];

    const walletClient = client.getWalletClient(chainId);
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

export const intentUnlockSlow = createTool({
  name: "intentUnlockSlow",
  description: "Unlock a time-locked transfer in SLOW contract",
  supportedChains: slowTransferChains,
  parameters: z.object({
    chainId: z.number().describe("The chainId to execute the intent on."),
    transferId: z.string().describe("The transfer ID to unlock"),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, transferId } = args;

    const intent = `Unlock transfer with ID ${transferId}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "unlock",
          args: [BigInt(transferId)],
        }),
        value: "0",
      },
    ];

    const walletClient = client.getWalletClient(chainId);
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

export const intentReverseSlowTransfer = createTool({
  name: "intentReverseSlowTransfer",
  description: "Reverse a pending transfer in SLOW contract",
  supportedChains: slowTransferChains,
  parameters: z.object({
    chainId: z.number().describe("The chainId to execute the intent on."),
    transferId: z.string().describe("The transfer ID to reverse"),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, transferId } = args;

    const intent = `Reverse transfer with ID ${transferId}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "reverse",
          args: [BigInt(transferId)],
        }),
        value: "0",
      },
    ];

    const walletClient = client.getWalletClient(chainId);
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
