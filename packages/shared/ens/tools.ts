import { z } from "zod";
import { createTool } from "../client.js";
import { Address } from "viem";
import { normalize } from 'viem/ens'

export const resolveENSTool = createTool({
  name: "resolveENS",
  description: "Resolves an ENS name to an Ethereum address",
  parameters: z.object({
    name: z.string().describe("The ENS name to resolve"),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(1);
    const ensName = args.name.includes(".") ? args.name : `${args.name}.eth`;
    const address = await publicClient.getEnsAddress({
      name: normalize(ensName),
    });

    if (address === null) {
      throw new Error(`No address found for ENS name: ${args.name}`);
    }

    return address;
  },
});

export const lookupENSTool = createTool({
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

export const checkNameAvailabilityTool = createTool({
  name: "checkNameAvailability",
  description: "Checks if an ENS name is available for registration",
  parameters: z.object({
    name: z.string().describe("The ENS name to check availability for"),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(1);
    const ensName = args.name.includes(".") ? args.name : `${args.name}.eth`;
    const address = await publicClient.getEnsAddress({
      name: normalize(ensName),
    });

    return address === null;
  },
});

const GRACE_PERIOD_SECONDS = 60 * 60 * 24 * 90; // ~90 days

export const checkENSNameStatusTool = createTool({
  name: "checkENSNameStatus",
  description: "Checks if an ENS name is active, expired, or in the grace period.",
  parameters: z.object({
    name: z.string().describe("The ENS name to check, e.g., vitalik.eth"),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(1);
    const name = normalize(args.name);
    const namehash = await publicClient.getEnsNamehash({ name });

    const baseRegistrarAddress = "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85"; // Mainnet ENS .eth registrar
    const abi = [
      "function nameExpires(uint256 id) external view returns (uint256)"
    ];

    const id = BigInt(namehash); // For .eth names, token ID = namehash
    const expires = await publicClient.readContract({
      address: baseRegistrarAddress,
      abi,
      functionName: "nameExpires",
      args: [id],
    });

    const now = Math.floor(Date.now() / 1000);

    if (expires === 0n) {
      return { status: "available", expires: null };
    }

    if (now < Number(expires)) {
      return { status: "active", expires: Number(expires) };
    }

    if (now < Number(expires) + GRACE_PERIOD_SECONDS) {
      return { status: "gracePeriod", expires: Number(expires) };
    }

    return { status: "expired", expires: Number(expires) };
  },
});

export const getENSMetaTool = createTool({
  name: "getENSMeta",
  description: "Fetches text metadata records (email, URL, avatar, etc.) associated with an ENS name.",
  parameters: z.object({
    name: z.string().describe("ENS name to fetch metadata for"),
    keys: z
      .array(z.string())
      .optional()
      .describe("Optional list of keys to retrieve (e.g., email, url, twitter)"),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(1);
    const name = normalize(args.name);

    const resolver = await publicClient.getEnsResolver({ name });

    if (!resolver) {
      throw new Error(`No resolver found for ENS name: ${name}`);
    }

    const keysToFetch = args.keys ?? ["email", "url", "avatar", "description", "com.discord"];

    const records: Record<string, string | null> = {};
    for (const key of keysToFetch) {
      const value = await resolver.getText({ key });
      records[key] = value;
    }

    return records;
  },
});
