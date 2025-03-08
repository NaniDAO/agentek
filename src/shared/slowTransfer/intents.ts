import { z } from "zod";
import { createTool, Intent } from "../client";
import { SLOW_ADDRESS, slowAbi, slowTransferChains } from "./constants";
import { parseEther, encodeFunctionData } from "viem";

export const intentDepositToSlow = createTool({
  name: "intentDepositToSlow",
  description: "Deposit tokens or ETH into SLOW contract with a timelock",
  supportedChains: slowTransferChains,
  parameters: z.object({
    chainId: z.number().describe("The chainId to execute the intent on."),
    token: z
      .string()
      .describe(
        "The token address to deposit (use 0x0 or empty string for ETH)",
      ),
    to: z.string().describe("The recipient address"),
    amount: z.string().describe("The amount to deposit in token units or ETH"),
    delay: z.number().describe("The timelock delay in seconds"),
    data: z.string().optional().describe("Optional data for the deposit"),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, token, to, amount, delay, data = "0x" } = args;
    const tokenAddress =
      token === "0x0" || token === ""
        ? "0x0000000000000000000000000000000000000000"
        : token;

    const isEth = tokenAddress === "0x0000000000000000000000000000000000000000";
    const value = isEth ? parseEther(amount) : 0n;

    const intent = `Deposit ${amount} ${isEth ? "ETH" : token} to ${to} with a ${delay} seconds delay`;

    // For ETH deposits
    if (isEth) {
      const ops = [
        {
          target: SLOW_ADDRESS,
          data: encodeFunctionData({
            abi: slowAbi,
            functionName: "depositTo",
            args: [tokenAddress, to, 0n, BigInt(delay), data],
          }),
          value: parseEther(amount),
        },
      ];

      const walletClient = client.getWalletClient();
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
    }

    // For ERC20 deposits, we need to approve first
    const erc20Abi = [
      {
        inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
        type: "function",
      },
    ] as const;

    const tokenAmount = BigInt(amount);

    const ops = [
      {
        target: tokenAddress,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [SLOW_ADDRESS, tokenAmount],
        }),
        value: 0n,
      },
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "depositTo",
          args: [tokenAddress, to, tokenAmount, BigInt(delay), data],
        }),
        value: 0n,
      },
    ];

    const walletClient = client.getWalletClient();
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
    guardian: z
      .string()
      .describe("The guardian address to set (use 0x0 to remove guardian)"),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, guardian } = args;
    const guardianAddress =
      guardian === "0x0"
        ? "0x0000000000000000000000000000000000000000"
        : guardian;

    const intent = `Set guardian to ${guardianAddress}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "setGuardian",
          args: [guardianAddress],
        }),
        value: 0n,
      },
    ];

    const walletClient = client.getWalletClient();
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
    from: z.string().describe("The address to withdraw from"),
    to: z.string().describe("The recipient address"),
    id: z.string().describe("The token ID to withdraw"),
    amount: z.string().describe("The amount to withdraw"),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, from, to, id, amount } = args;

    const intent = `Withdraw ${amount} of token ID ${id} from ${from} to ${to}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "withdrawFrom",
          args: [from, to, BigInt(id), BigInt(amount)],
        }),
        value: 0n,
      },
    ];

    const walletClient = client.getWalletClient();
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
    from: z.string().describe("The user address that initiated the transfer"),
    transferId: z.string().describe("The transfer ID to approve"),
  }),
  execute: async (client, args): Promise<Intent> => {
    const { chainId, from, transferId } = args;

    const intent = `Approve transfer ID ${transferId} from ${from}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "approveTransfer",
          args: [from, BigInt(transferId)],
        }),
        value: 0n,
      },
    ];

    const walletClient = client.getWalletClient();
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

    const intent = `Unlock transfer ID ${transferId}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "unlock",
          args: [BigInt(transferId)],
        }),
        value: 0n,
      },
    ];

    const walletClient = client.getWalletClient();
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

    const intent = `Reverse transfer ID ${transferId}`;

    const ops = [
      {
        target: SLOW_ADDRESS,
        data: encodeFunctionData({
          abi: slowAbi,
          functionName: "reverse",
          args: [BigInt(transferId)],
        }),
        value: 0n,
      },
    ];

    const walletClient = client.getWalletClient();
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
