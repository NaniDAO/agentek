import { z } from "zod";
import type { BaseTool } from "../client.js";
import { createTool } from "../client.js";
import { Mppx, tempo, stripe } from "mppx/client";
import { Challenge, Receipt } from "mppx";
import { STABLECOIN_DECIMALS } from "./constants.js";
import { assertOkResponse } from "../utils/fetch.js";

export interface MppConfig {
  stripeSecretKey?: string;
  stripePaymentMethod?: string;
}

/**
 * Helper: create an SPT (Shared Payment Token) via the Stripe API.
 * This runs server-side using the secret key — no Stripe.js needed.
 */
async function createStripeSpt(
  secretKey: string,
  params: {
    amount: string;
    currency: string;
    networkId: string | undefined;
    expiresAt: number;
    metadata?: Record<string, string>;
    paymentMethod?: string;
  },
): Promise<string> {
  const body = new URLSearchParams();
  body.set("amount", params.amount);
  body.set("currency", params.currency);
  if (params.paymentMethod) {
    body.set("payment_method", params.paymentMethod);
  }
  if (params.networkId) {
    body.set("network_id", params.networkId);
  }
  body.set("expires_at", String(params.expiresAt));
  if (params.metadata) {
    for (const [k, v] of Object.entries(params.metadata)) {
      body.set(`metadata[${k}]`, v);
    }
  }

  const response = await fetch(
    "https://api.stripe.com/v1/shared_payment_tokens",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Stripe-Version": "2026-03-04.preview",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    },
  );

  await assertOkResponse(response, "Failed to create Stripe SPT");

  const data = (await response.json()) as { id: string };
  return data.id;
}

/**
 * Build the mppx client methods array based on available config.
 */
function buildMethods(
  account: any,
  config: MppConfig,
): any[] {
  const methods: any[] = [tempo({ account })];

  if (config.stripeSecretKey) {
    const secretKey = config.stripeSecretKey;
    const defaultPaymentMethod = config.stripePaymentMethod;
    methods.push(
      stripe({
        paymentMethod: defaultPaymentMethod,
        createToken: async (params: any) => {
          return createStripeSpt(secretKey, {
            amount: params.amount,
            currency: params.currency,
            networkId: params.networkId,
            expiresAt: params.expiresAt,
            metadata: params.metadata,
            paymentMethod: params.paymentMethod ?? defaultPaymentMethod,
          });
        },
      }),
    );
  }

  return methods;
}

/**
 * Create the mppFetch tool with optional Stripe support.
 */
export function createMppFetchTool(config: MppConfig): BaseTool {
  const hasStripe = !!config.stripeSecretKey;
  return createTool({
    name: "mppFetch",
    description: hasStripe
      ? "Fetch an HTTP resource, automatically paying via MPP (Machine Payments Protocol) if the server requires payment. Supports Tempo crypto (stablecoins) and Stripe (cards/wallets) payment methods."
      : "Fetch an HTTP resource, automatically paying via MPP (Machine Payments Protocol) if the server requires payment. Uses Tempo for crypto payments with stablecoins. Supports any MPP-enabled API endpoint.",
    parameters: z.object({
      url: z.string().describe("The URL to fetch"),
      method: z.string().optional().describe("HTTP method (default GET)"),
      headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Additional request headers"),
      body: z.string().optional().describe("Request body for POST/PUT"),
      maxPaymentUsd: z
        .number()
        .optional()
        .describe("Maximum payment in USD to allow (default 1.00)"),
    }),
    execute: async (client, args) => {
      const {
        url,
        method = "GET",
        headers = {},
        body,
        maxPaymentUsd = 1.0,
      } = args;

      const walletClient = client.getWalletClient();
      if (!walletClient?.account) {
        throw new Error("No wallet account available for MPP payments");
      }

      const account = walletClient.account;
      const maxAmountBaseUnits = BigInt(
        Math.floor(maxPaymentUsd * 10 ** STABLECOIN_DECIMALS),
      );

      let paymentMade = false;
      let receiptData: Record<string, unknown> | undefined;

      const methods = buildMethods(account, config);

      const mppx = Mppx.create({
        methods,
        polyfill: false,
        onChallenge: async (challenge: any, { createCredential }: any) => {
          const requestAmount = BigInt(
            (challenge.request as Record<string, string>).amount ?? "0",
          );
          if (requestAmount > maxAmountBaseUnits) {
            throw new Error(
              `Payment of ${requestAmount} base units exceeds max allowed ${maxAmountBaseUnits} (${maxPaymentUsd} USD)`,
            );
          }
          paymentMade = true;
          return createCredential();
        },
      });

      const response = await (mppx as any).fetch(url, {
        method,
        headers: headers as Record<string, string>,
        ...(body ? { body } : {}),
      });

      const responseBody = await response.text();

      try {
        receiptData = Receipt.fromResponse(response) as unknown as Record<
          string,
          unknown
        >;
      } catch {
        // No receipt header — that's fine
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value: string, key: string) => {
        responseHeaders[key] = value;
      });

      return {
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
        paymentMade,
        ...(receiptData ? { receipt: receiptData } : {}),
      };
    },
  });
}

/**
 * Probe an endpoint to check its MPP payment requirements without making a payment.
 */
export const getMppPaymentInfoTool = createTool({
  name: "getMppPaymentInfo",
  description:
    "Check the MPP (Machine Payments Protocol) payment requirements for a URL without making a payment. Returns pricing, accepted methods, intent type, and payment details.",
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

    // Parse WWW-Authenticate header for MPP challenge(s)
    const wwwAuth = response.headers.get("www-authenticate");
    if (!wwwAuth) {
      return {
        paymentRequired: true,
        error: "402 response has no WWW-Authenticate header",
      };
    }

    try {
      const challenges = Challenge.deserializeList(wwwAuth) as Array<{
        id: string;
        realm: string;
        method: string;
        intent: string;
        request: Record<string, unknown>;
        expires?: string;
        description?: string;
      }>;
      return {
        paymentRequired: true,
        challenges: challenges.map((c) => ({
          id: c.id,
          realm: c.realm,
          method: c.method,
          intent: c.intent,
          request: c.request,
          expires: c.expires,
          description: c.description,
        })),
      };
    } catch {
      return {
        paymentRequired: true,
        rawHeader: wwwAuth,
        error: "Could not parse MPP challenge from WWW-Authenticate header",
      };
    }
  },
});

/**
 * Discover MPP-enabled services by fetching and parsing their OpenAPI documents.
 */
export const mppDiscoverServicesTool = createTool({
  name: "mppDiscoverServices",
  description:
    "Discover payment-enabled operations from an MPP service by fetching its OpenAPI document. MPP services expose an openapi.json with x-payment-info per operation and x-service-info at the top level.",
  parameters: z.object({
    url: z
      .string()
      .describe(
        "The base URL of the MPP service (e.g. https://api.example.com). Will fetch /openapi.json from this URL.",
      ),
  }),
  execute: async (_client, args) => {
    const { url } = args;

    const openapiUrl = url.replace(/\/$/, "") + "/openapi.json";
    const response = await fetch(openapiUrl);

    await assertOkResponse(
      response,
      `Failed to fetch OpenAPI document from ${openapiUrl}`,
    );

    const doc = (await response.json()) as Record<string, unknown>;

    const serviceInfo = doc["x-service-info"] as
      | Record<string, unknown>
      | undefined;

    const paths = doc.paths as
      | Record<string, Record<string, Record<string, unknown>>>
      | undefined;

    const payableOperations: Array<{
      path: string;
      method: string;
      summary?: string;
      paymentInfo: Record<string, unknown>;
    }> = [];

    if (paths) {
      for (const [path, methods] of Object.entries(paths)) {
        for (const [httpMethod, operation] of Object.entries(methods)) {
          const paymentInfo = operation["x-payment-info"] as
            | Record<string, unknown>
            | undefined;
          if (paymentInfo) {
            payableOperations.push({
              path,
              method: httpMethod.toUpperCase(),
              summary: operation.summary as string | undefined,
              paymentInfo,
            });
          }
        }
      }
    }

    return {
      serviceInfo,
      payableOperations,
      totalPayableOperations: payableOperations.length,
    };
  },
});
