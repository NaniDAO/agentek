import { BaseTool, createToolCollection } from "../client";
import { z } from "zod";
import { createTool } from "../client";
import { Address } from "viem";

const resolveENSTool = createTool({
  name: "resolveENS",
  description: "Resolves an ENS name to an Ethereum address",
  parameters: z.object({
    name: z.string().describe("The ENS name to resolve"),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(1);
    const address = await publicClient.getEnsAddress({
      name: args.name,
    });

    if (address === null) {
      throw new Error(`No address found for ENS name: ${args.name}`);
    }

    return address;
  },
});

const lookupENSTool = createTool({
  name: "lookupENS",
  description: "Looks up the ENS name for an Ethereum address",
  parameters: z.object({
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/)
      .describe("The Ethereum address to lookup"),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(1);
    const name = await publicClient.getEnsName({
      address: args.address as Address,
    });

    if (name === null) {
      throw new Error(`No ENS name found for ${args.address}`);
    }

    return name;
  },
});

export function ensTools(): BaseTool[] {
  return createToolCollection([resolveENSTool, lookupENSTool]);
}
