import { z } from "zod";
import { createTool } from "../client.js";
import { base, mainnet } from "viem/chains";

import { SignalsAbi } from "./abis.js";
import { SIGNALS_ADDRESS } from "./constants.js";

const supportedChains = [mainnet, base];

export const getNaniProposals = createTool({
  name: "getNaniProposals",
  description: "Get the latest proposals from NANI DAO's Signals contract, including vote counts, proposer, content, and whether each proposal is currently passing. Returns up to 10 most recent proposals.",
  supportedChains,
  parameters: z.object({
    account: z.string().describe("Wallet address of the caller (0x...). Currently unused but reserved for future per-user vote data."),
    chainId: z.number().describe("Chain ID to query (1 for Ethereum, 8453 for Base)"),
    dao: z.string().describe("The DAO name to query. Must contain 'nani' (only NANI DAO is supported currently)."),
  }),
  execute: async (client, args) => {
    if (!args.dao.toLowerCase().includes("nani")) {
      return "Only NANIDAO is supported right now. More soon ✈️";
    }

    const publicClient = client.getPublicClient(args.chainId);
    const votes = await publicClient.readContract({
      address: SIGNALS_ADDRESS,
      abi: SignalsAbi,
      functionName: "getLatestProposals",
    });

    const proposalCount = await publicClient.readContract({
      address: SIGNALS_ADDRESS,
      abi: SignalsAbi,
      functionName: "proposalCount",
    });

    const count = Number(proposalCount);
    const len = count > 10 ? 10 : count;

    const proposalIds = Array.from({ length: len }, (_, i) => count - len + i);
    const isPassingResults = await Promise.all(
      proposalIds.map((id) =>
        publicClient.readContract({
          address: SIGNALS_ADDRESS,
          abi: SignalsAbi,
          functionName: "isPassing",
          args: [BigInt(id)],
        }),
      ),
    );

    return votes.map((vote: any, index: number) => ({
      proposer: vote.proposer,
      yes: vote.yes.toString(),
      no: vote.no.toString(),
      created: new Date(Number(vote.created) * 1000).toLocaleString(),
      content: vote.content,
      id: proposalIds[index],
      isPassing: isPassingResults[index],
    }));
  },
});
