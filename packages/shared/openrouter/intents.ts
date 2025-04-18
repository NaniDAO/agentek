import { Address, Hex, parseEther } from "viem";
import { mainnet, polygon, base } from "viem/chains";
import { z } from "zod";
import {
  AgentekClient,
  BaseTool,
  Op,
  createTool,
} from "../client.js";
import { coinbasePaymentAbi } from "./constants.js";

/**
 * Utility: build a human‑readable description for the top‑up intent
 */
function describeTopUp(amount: number, chainId: number) {
  return `Purchase $${amount.toFixed(2)} of OpenRouter credits on chain ${chainId}`;
}

export const createIntentTopUpTool = (openrouterApiKey: string): BaseTool =>
  createTool({
    name: "intentTopUp",
    description:
      "Create & simulate a Coinbase on‑chain payment intent to top‑up OpenRouter credits. Executes automatically if a wallet client is connected.",
    supportedChains: [mainnet, polygon, base],
    parameters: z.object({
      amount: z.number().positive().describe("Credit amount in USD"),
      chainId: z.union([z.literal(1), z.literal(137), z.literal(8453)]),
      sender: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .optional()
        .describe("Sender EOA (optional if wallet connected)"),
      poolFeesTier: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Uniswap pool fee tier; default 500"),
    }),

    execute: async (client: AgentekClient, args) => {
      const { amount, chainId, poolFeesTier = 500 } = args;
      const walletClient = client.getWalletClient(chainId);
      const sender = args.sender ?? (walletClient && (await client.getAddress()));
      if (!sender)
        throw new Error("Sender address required when no wallet client is connected.");

      /* 1️⃣  Request charge from OpenRouter */
      const chargeRes = await fetch("https://openrouter.ai/api/v1/credits/coinbase", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openrouterApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount, sender, chain_id: chainId }),
      });
      if (!chargeRes.ok)
        throw new Error(`OpenRouter /credits/coinbase failed: ${chargeRes.status}`);
      type Charge = {
        data: {
          web3_data: {
            transfer_intent: {
              metadata: { chain_id: number; contract_address: string };
              call_data: {
                recipient_amount: string;
                deadline: string;
                recipient: string;
                recipient_currency: string;
                refund_destination: string;
                fee_amount: string;
                id: string;
                operator: string;
                signature: string;
                prefix: string;
              };
            };
          };
        };
      };
      const { data } = (await chargeRes.json()) as Charge;
      const { contract_address } = data.web3_data.transfer_intent.metadata;
      const cd = data.web3_data.transfer_intent.call_data;

      const intentStruct = {
        recipientAmount: BigInt(cd.recipient_amount),
        deadline: BigInt(Math.floor(new Date(cd.deadline).getTime() / 1000)),
        recipient: cd.recipient as Address,
        recipientCurrency: cd.recipient_currency as Address,
        refundDestination: cd.refund_destination as Address,
        feeAmount: BigInt(cd.fee_amount),
        id: cd.id as Hex,
        operator: cd.operator as Address,
        signature: cd.signature as Hex,
        prefix: cd.prefix as Hex,
      } as const;

      const valueWei = parseEther("0.004");
      const publicClient = client.getPublicClient(chainId);

      /* 2️⃣  Simulation */
      let simulationResult: {
        success: boolean;
        gasUsed?: bigint;
        error?: string;
        request?: any;
      };
      try {
        const { request, gas } = await publicClient.simulateContract({
          abi: coinbasePaymentAbi,
          account: sender as Address,
          address: contract_address as Address,
          functionName: "swapAndTransferUniswapV3Native",
          args: [intentStruct, poolFeesTier],
          value: valueWei,
        });
        simulationResult = { success: true, gasUsed: gas, request };
      } catch (err: any) {
        simulationResult = { success: false, error: err?.message ?? "Simulation failed" };
      }

      const intentDescription = describeTopUp(amount, chainId);

      /* If simulation failed, just return the intent & error */
      if (!simulationResult.success) {
        return { intent: intentDescription, chain: chainId, simulation: simulationResult };
      }

      /* 3️⃣  Broadcast if wallet available */
      if (walletClient) {
        const hash = await walletClient.writeContract(simulationResult.request);
        return {
          intent: intentDescription,
          chain: chainId,
          hash,
        };
      }

      /* Wallet not connected => user executes later */
      const ops: Op[] = [
        {
          target: contract_address as Address,
          value: valueWei.toString(),
          data: simulationResult.request.data as Hex,
        },
      ];
      return { intent: intentDescription, chain: chainId, ops };
    },
  });
