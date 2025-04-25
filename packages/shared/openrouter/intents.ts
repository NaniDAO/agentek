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

export const createIntentTopUpTool = (openrouterApiKey: string): BaseTool =>
  createTool({
    name: "intentTopUp",
    description:
      "Create & simulate a Coinbase on‑chain payment intent to top‑up OpenRouter credits. Executes automatically if a wallet client is connected.",
    supportedChains: [mainnet, polygon, base],
    parameters: z.object({
      amount: z.number().positive().describe("Credit amount in USD"),
      chainId: z.union([z.literal(1), z.literal(137), z.literal(8453)]),
    }),

    execute: async (client: AgentekClient, args) => {
      const { amount, chainId } = args;
      const walletClient = client.getWalletClient(chainId);
      const sender = await client.getAddress();

      if (!sender)
        throw new Error("Sender address required.");

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

      const { data } = (await chargeRes.json()) as Charge;
      const { contract_address } = data.web3_data.transfer_intent.metadata;
      const cd = data.web3_data.transfer_intent.call_data;
      const poolFeesTier = 500;

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

      const valueWei = parseEther("0");
      const publicClient = client.getPublicClient(chainId);

      // const { request, gas } = await publicClient.simulateContract({
      //   abi: coinbasePaymentAbi,
      //   account: sender as Address,
      //   address: contract_address as Address,
      //   functionName: "swapAndTransferUniswapV3Token",
      //   args: [intentStruct, poolFeesTier],
      //   value: valueWei,
      // });

      const intentDescription = describeTopUp(amount, chainId);

      const ops: Op[] = [
        {

        },
        {
          target: simulationResult.request.address as Address,
          value: simulationResult.request.value,
          data: simulationResult.request.data as Hex,
        },
      ];

      /* 3️⃣  Broadcast if wallet available */
      if (walletClient) {
        const hash = await client.executeOps(ops, chainId);
        return {
          intent: intentDescription,
          chain: chainId,
          hash,
        };
      }

      return { intent: intentDescription, chain: chainId, ops };
    },
  });
