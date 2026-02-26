import { z } from "zod";
import { createTool } from "../client.js";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { X402_DISCOVERY_URL, USDC_DECIMALS } from "./constants.js";

export const x402FetchTool = createTool({
  name: "x402Fetch",
  description:
    "Fetch an HTTP resource, automatically paying with USDC via x402 if the server requires payment. Supports any x402-enabled API endpoint.",
  parameters: z.object({
    url: z.string().describe("The URL to fetch"),
    method: z.string().optional().describe("HTTP method (default GET)"),
    headers: z
      .record(z.string())
      .optional()
      .describe("Additional request headers"),
    body: z.string().optional().describe("Request body for POST/PUT"),
    maxPaymentUsd: z
      .number()
      .optional()
      .describe("Maximum payment in USD to allow (default 1.00)"),
  }),
  execute: async (client, args) => {
    const { url, method = "GET", headers = {}, body, maxPaymentUsd = 1.0 } =
      args;

    const walletClient = client.getWalletClient();
    if (!walletClient?.account) {
      throw new Error("No wallet account available for x402 payments");
    }

    const account = walletClient.account;
    if (!account.signTypedData) {
      throw new Error(
        "Wallet account must support signTypedData for x402 payments",
      );
    }
    const publicClient = client.getPublicClient();
    const signer = toClientEvmSigner(
      {
        address: account.address,
        signTypedData: (msg) => account.signTypedData(msg as any),
      },
      publicClient,
    );
    const maxAmountBaseUnits = BigInt(
      Math.floor(maxPaymentUsd * 10 ** USDC_DECIMALS),
    );

    const paymentClient = new x402Client();
    paymentClient.register("eip155:*" as `${string}:${string}`, new ExactEvmScheme(signer));

    paymentClient.registerPolicy((_version, requirements) =>
      requirements.filter((r) => BigInt(r.amount) <= maxAmountBaseUnits),
    );

    let paymentMade = false;
    paymentClient.onAfterPaymentCreation(async () => {
      paymentMade = true;
    });

    const fetchWithPayment = wrapFetchWithPayment(fetch, paymentClient);

    const response = await fetchWithPayment(url, {
      method,
      headers,
      ...(body ? { body } : {}),
    });

    const responseBody = await response.text();

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      status: response.status,
      headers: responseHeaders,
      body: responseBody,
      paymentMade,
    };
  },
});

export const getX402PaymentInfoTool = createTool({
  name: "getX402PaymentInfo",
  description:
    "Check the x402 payment requirements for a URL without making a payment. Returns pricing, accepted networks, and payment details.",
  parameters: z.object({
    url: z.string().describe("The URL to check payment requirements for"),
  }),
  execute: async (_client, args) => {
    const { url } = args;

    const response = await fetch(url);

    if (response.status !== 402) {
      return {
        paymentRequired: false,
        status: response.status,
      };
    }

    // Try v2: parse payment-required header (base64 JSON)
    const paymentHeader = response.headers.get("payment-required");
    if (paymentHeader) {
      try {
        const decoded = JSON.parse(
          Buffer.from(paymentHeader, "base64").toString("utf-8"),
        );
        return {
          paymentRequired: true,
          x402Version: 2,
          ...decoded,
        };
      } catch {
        // Fall through to v1 body parsing
      }
    }

    // Try v1: parse response body as JSON
    try {
      const body = await response.json();
      return {
        paymentRequired: true,
        x402Version: 1,
        ...body,
      };
    } catch {
      return {
        paymentRequired: true,
        error: "Could not parse payment requirements",
      };
    }
  },
});

export const x402DiscoverResourcesTool = createTool({
  name: "x402DiscoverResources",
  description:
    "Discover available x402-enabled paid services and APIs using the Bazaar discovery API. Search by keyword or category.",
  parameters: z.object({
    query: z.string().optional().describe("Search query to filter resources"),
  }),
  execute: async (_client, args) => {
    const { query } = args;

    const url = new URL(X402_DISCOVERY_URL);
    if (query) {
      url.searchParams.set("q", query);
    }

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(
        `Failed to fetch x402 resources: ${response.status} ${response.statusText}`,
      );
    }

    return await response.json();
  },
});
