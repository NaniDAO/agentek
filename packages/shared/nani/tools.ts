import { z } from "zod";
import { createTool } from "../client.js";
import { base, mainnet } from "viem/chains";

import { SignalsAbi } from "./abis.js";
import { SIGNALS_ADDRESS } from "./constants.js";

const supportedChains = [mainnet, base];

export const getNaniProposals = createTool({
  name: "getNaniProposals",
  description: "Get proposals for NANIDAO",
  supportedChains,
  parameters: z.object({
    account: z.string(),
    chainId: z.number(),
    dao: z.string(),
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
