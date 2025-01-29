import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client"; 
import { Address, encodeFunctionData, Hex, parseEther, SendTransactionParameters } from "viem";
import { supportedChains, WETH_ADDRESS, wethAbi } from "./constants";

const depositWETHParameters = z.object({
  chainId: z.number().describe("Chain ID to deposit on"),
  amount: z.bigint().describe("Amount of ETH to deposit (as a bigint)"),
});

const withdrawWETHParameters = z.object({
  chainId: z.number().describe("Chain ID to withdraw on"),
  amount: z.bigint().describe("Amount of WETH to withdraw (as a bigint)"),
});

const depositWETHChains = supportedChains;
const withdrawWETHChains = supportedChains;

export const intent_depositWETH = createTool({
  name: "depositWETH",
  description: "Deposit ETH into the WETH contract, receiving WETH in return",
  supportedChains: depositWETHChains,
  parameters: depositWETHParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof depositWETHParameters>,
  ): Promise<Intent> => {
    const { chainId, amount } = args;
    const walletClient = client.getWalletClient(chainId);

    const valueToDeposit = parseEther(amount.toString());

    const data = encodeFunctionData({
      abi: wethAbi,
      functionName: "deposit",
      args: [],
    });

    const ops = [
      {
        target: WETH_ADDRESS[chainId as keyof typeof WETH_ADDRESS] as Address,
        value: valueToDeposit.toString(),
        data: data,
      },
    ];

    if (!walletClient) {
      return {
        intent: `Deposit ${amount} ETH into WETH`,
        ops,
        chain: chainId,
      };
    } else {
        const hash = await walletClient.sendTransaction({
          to: ops[0]!.target as Address,
          value: BigInt(ops[0]!.value),
          data: ops[0]!.data as Hex,
        } as SendTransactionParameters);
    
    return {
      intent: `Deposit ${amount} ETH into WETH`,
      ops,
      chain: chainId,
      hash,
    };
  }
  },
});

export const intent_withdrawWETH = createTool({
  name: "withdrawWETH",
  description: "Withdraw WETH back to native ETH",
  supportedChains: withdrawWETHChains,
  parameters: withdrawWETHParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof withdrawWETHParameters>,
  ): Promise<Intent> => {
    const { chainId, amount } = args;

    const walletClient = client.getWalletClient(chainId);

    const valueToWithdraw = parseEther(amount.toString());

    const data = encodeFunctionData({
      abi: wethAbi,
      functionName: "withdraw",
      args: [valueToWithdraw],
    });

    const ops = [
      {
        target: WETH_ADDRESS[chainId as keyof typeof WETH_ADDRESS] as Address,
        value: "0",
        data,
      },
    ];

    if (!walletClient) {
      return {
        intent: `Withdraw ${amount} WETH to native ETH`,
        ops,
        chain: chainId,
      };
    } else {
      const hash = await walletClient.sendTransaction({
        to: ops[0]!.target as Address,
        value: BigInt(ops[0]!.value),
        data: ops[0]!.data as Hex,
      } as SendTransactionParameters);

      return {
        intent: `Withdraw ${amount} WETH to native ETH`,
        ops,
        chain: chainId,
        hash,
      };
    }
  },
});
