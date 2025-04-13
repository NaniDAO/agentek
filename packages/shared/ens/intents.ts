import { z } from "zod";
import { createTool } from "../client.js";
import { Address, encodeFunctionData } from "viem";
import { namehash, normalize } from "viem/ens";

export const intentRegisterENSName = createTool({
  name: "intentRegisterENSName",
  description: "Registers an available ENS name via the ETHRegistrarController.",
  supportedChains: [1],
  parameters: z.object({
    name: z.string().describe("ENS name to register (without .eth)"),
    owner: z.string().describe("Ethereum address to own the name"),
    duration: z.number().describe("How long to register the name for (in seconds)"),
    secret: z.string().describe("Commitment secret used during commit phase (bytes32)"),
    value: z.string().describe("ETH value in wei to send with registration"),
  }),
  execute: async (client, args) => {
    const publicClient = client.getPublicClient(1);
    const walletClient = client.getWalletClient(1);
    const controller = "0x253553366Da8546fC250F225fe3d25d0C782303b" as Address; // ETHRegistrarController

    const fullName = `${args.name}.eth`;
    const label = args.name;
    const labelHash = namehash(fullName);

    const data = encodeFunctionData({
      abi: [
        "function register(string name, address owner, uint duration, bytes32 secret) external payable"
      ],
      functionName: "register",
      args: [label, args.owner, args.duration, args.secret],
    });

    const op = {
      target: controller,
      value: args.value,
      data,
    };

    const intent = `Register ENS name ${fullName} for ${args.duration} seconds to ${args.owner}`;

    if (!walletClient) {
      return {
        intent,
        ops: [op],
        chain: 1,
      };
    }

    const hash = await client.executeOps([op], 1);

    return {
      intent,
      ops: [op],
      chain: 1,
      hash,
    };
  },
});
