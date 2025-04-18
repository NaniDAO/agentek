import { Address, Hex } from "viem";
import { mainnet, polygon, base } from "viem/chains";
import { z } from "zod";
import {
  AgentekClient,
  BaseTool,
  Op,
  createTool,
} from "../client.js";

/**
 * Utility: build a human‑readable description for the top‑up intent
 */
function describeTopUp(amount: number, chainId: number) {
  return `Purchase $${amount.toFixed(2)} of OpenRouter credits on chain ${chainId}`;
}

/**
 * intentTopUp
 * --------------------
 * Intent‑style tool that creates a Coinbase on‑chain payment intent via
 * OpenRouter, then (optionally) executes it if the caller already has a
 * wallet client wired up.
 */
export const createIntentTopUpTool = (
  openrouterApiKey: string,
): BaseTool =>
  createTool({
    name: "intentTopUp",
    description:
      "Create (and optionally execute) an on‑chain transaction that purchases additional OpenRouter credits using Coinbase's on‑chain payment protocol.",
    // Ethereum, Polygon, Base mainnets only (per OpenRouter docs)
    supportedChains: [mainnet, polygon, base],
    parameters: z
      .object({
        /** Credit amount in USD */
        amount: z.number().positive(),
        /** Chain ID to send the payment on */
        chainId: z.union([
          z.literal(1),
          z.literal(137),
          z.literal(8453),
        ]),
      })
      .describe("Arguments for intentTopUp"),

    execute: async (client: AgentekClient, args) => {
      const { amount, chainId } = args;

      // Resolve user address (may throw if wallet not connected)
      const userAddress = await client.getAddress();

      // 1️⃣  Create the charge with OpenRouter
      const chargeResp = await fetch(
        "https://openrouter.ai/api/v1/credits/coinbase",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openrouterApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount,
            sender: userAddress,
            chain_id: chainId,
          }),
        },
      );

      if (!chargeResp.ok) {
        throw new Error(
          `OpenRouter /credits/coinbase request failed: ${chargeResp.status} ${chargeResp.statusText}`,
        );
      }

      const chargeJson = (await chargeResp.json()) as {
        data: {
          id: string;
          web3_data: {
            transfer_intent: {
              metadata: {
                chain_id: number;
                contract_address: string;
              };
              call_data: Hex;
            };
          };
        };
      };

      const {
        transfer_intent: {
          metadata: { contract_address },
          call_data,
        },
      } = chargeJson.data.web3_data;

      // 2️⃣  Build the single Operation required to fulfil the charge
      const ops: Op[] = [
        {
          target: contract_address as Address,
          value: "0", // value is encoded within call_data if needed
          data: call_data as Hex,
        },
      ];

      const intentDescription = describeTopUp(amount, chainId);

      // If no wallet client available, return unexecuted intent
      const walletClient = client.getWalletClient(chainId);
      if (!walletClient) {
        return {
          intent: intentDescription,
          ops,
          chain: chainId,
        };
      }

      // 3️⃣  Execute the operation(s)
      const hash = await client.executeOps(ops, chainId);

      return {
        intent: intentDescription,
        ops,
        chain: chainId,
        hash,
      };
    },
  });
