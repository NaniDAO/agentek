import z from "zod";
import { AgentekClient, createTool, Intent } from "../client.js";
import { Address, encodeFunctionData } from "viem";
import { GovernorBravoDelegateAbi } from "./constants.js";
import { getGovernorBySlug, parseCaip10 } from "./utils.js";

const VoteSupport = z.enum(["against", "for", "abstain"]);
type VoteSupport = z.infer<typeof VoteSupport>;

const voteSupportToNumber = (vote: VoteSupport): number => {
  switch (vote) {
    case "against":
      return 0;
    case "for":
      return 1;
    case "abstain":
      return 2;
  }
};

const createTallyVoteIntentParams = z.object({
  space: z.string().describe("The Tally governance space slug (e.g. 'uniswap', 'compound', 'aave')"),
  vote: VoteSupport.describe("Vote direction: 'for', 'against', or 'abstain'"),
  proposalId: z.number().describe("The numeric proposal ID to vote on"),
});

const createTallyVoteWithReasonIntentParams = z.object({
  space: z.string().describe("The Tally governance space slug (e.g. 'uniswap', 'compound', 'aave')"),
  vote: VoteSupport.describe("Vote direction: 'for', 'against', or 'abstain'"),
  proposalId: z.number().describe("The numeric proposal ID to vote on"),
  reason: z.string().describe("A text explanation for your vote that will be recorded on-chain"),
});

export const createTallyVoteIntent = (tallyApiKey: string) => {
  return createTool({
    name: "intentGovernorVote",
    description: "Cast a vote on a Governor Bravo governance proposal via Tally. Resolves the governor contract address from the space slug automatically.",
    parameters: createTallyVoteIntentParams,
    execute: async (
      client: AgentekClient,
      args: z.infer<typeof createTallyVoteIntentParams>,
    ): Promise<Intent> => {
      let { space, vote, proposalId } = args;
      const from = await client.getAddress();
      const { chainId, address: spaceAddress } = parseCaip10(
        (await getGovernorBySlug(space, tallyApiKey)).id,
      );

      const voteNumber = voteSupportToNumber(vote);

      const ops = [
        {
          target: spaceAddress as Address,
          value: "0",
          data: encodeFunctionData({
            abi: GovernorBravoDelegateAbi,
            functionName: "castVote",
            args: [BigInt(proposalId), voteNumber],
          }),
        },
      ];

      const walletClient = client.getWalletClient(chainId);

      if (!walletClient) {
        return {
          intent: `Vote ${vote} on proposal in space ${space}`,
          ops,
          chain: chainId,
        };
      } else {
        if (!ops[0]) {
          throw new Error("Operations array is empty or undefined");
        }

        const hash = await client.executeOps(ops, chainId);

        return {
          intent: `Vote ${vote.toUpperCase()} on proposal in ${space} from ${from}`,
          ops,
          chain: chainId,
          hash: hash,
        };
      }
    },
  });
};

export const createTallyVoteWithReasonIntent = (tallyApiKey: string) => {
  return createTool({
    name: "intentGovernorVoteWithReason",
    description:
      "Cast a vote with an on-chain reason on a Governor Bravo governance proposal via Tally. Resolves the governor contract address from the space slug automatically.",
    parameters: createTallyVoteWithReasonIntentParams,
    execute: async (
      client: AgentekClient,
      args: z.infer<typeof createTallyVoteWithReasonIntentParams>,
    ): Promise<Intent> => {
      let { space, vote, proposalId, reason } = args;
      const from = await client.getAddress();
      const { chainId, address: spaceAddress } = parseCaip10(
        (await getGovernorBySlug(space, tallyApiKey)).id,
      );

      const voteNumber = voteSupportToNumber(vote);

      const ops = [
        {
          target: spaceAddress as Address,
          value: "0",
          data: encodeFunctionData({
            abi: GovernorBravoDelegateAbi,
            functionName: "castVoteWithReason",
            args: [BigInt(proposalId), voteNumber, reason],
          }),
        },
      ];

      const walletClient = client.getWalletClient(chainId);

      if (!walletClient) {
        return {
          intent: `Vote ${vote} on proposal in space ${space} with reason: "${reason}"`,
          ops,
          chain: chainId,
        };
      } else {
        if (!ops[0]) {
          throw new Error("Operations array is empty or undefined");
        }

        const hash = await client.executeOps(ops, chainId);

        return {
          intent: `Vote ${vote.toUpperCase()} on proposal in ${space} from ${from} with reason: ${reason}`,
          ops,
          chain: chainId,
          hash: hash,
        };
      }
    },
  });
};
