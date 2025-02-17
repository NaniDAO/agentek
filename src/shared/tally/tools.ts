import z from "zod";
import { createTool } from "../client";
import type { BaseTool, AgentekClient } from "../client";

const TALLY_API_URL = "https://api.tally.xyz/query";

export function createTallyProposalsTool(tallyApiKey: string): BaseTool {
  return createTool({
    name: "tallyProposals",
    description:
      "Fetch proposals from the Tally governance API for a specified DAO/space.",
    supportedChains: [],
    parameters: z.object({
      space: z
        .string()
        .describe("The DAO or space identifier e.g. uniswap, hai, nounsdao"),
      limit: z
        .number()
        .optional()
        .default(10)
        .describe("Maximum number of proposals to fetch"),
    }),
    execute: async (_client: AgentekClient, args) => {
      // First get governor ID from slug
      const getGovernorQuery = `
        query GetGovernorBySlug($slug: String!) {
          governor(input: { slug: $slug }) {
            id
            name
          }
        }
      `;

      const governorResponse = await fetch(TALLY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": tallyApiKey,
        },
        body: JSON.stringify({
          query: getGovernorQuery,
          variables: { slug: args.space },
        }),
      });

      const governorResult = await governorResponse.json();
      if (governorResult.errors || !governorResult.data?.governor?.id) {
        throw new Error("DAO not supported");
      }

      const governorId = governorResult.data.governor.id;

      console.log("governorId", governorId);

      // Then get proposals using governor ID
      const getProposalsQuery = `
        query GetProposals($governorId: AccountID!, $limit: Int!) {
          proposals(
            input: {
              filters: { governorId: $governorId }
              page: { limit: $limit }
              sort: { isDescending: true, sortBy: id }
            }
          ) {
            nodes {
              ... on Proposal {
                id
                onchainId
                metadata {
                  title
                  description
                }
                status
                start {
                  ... on Block {
                    number
                    timestamp
                  }
                  ... on BlocklessTimestamp {
                    timestamp
                  }
                }
                end {
                  ... on Block {
                    number
                    timestamp
                  }
                  ... on BlocklessTimestamp {
                    timestamp
                  }
                }
                voteStats {
                  type
                  votesCount
                  votersCount
                  percent
                }
              }
            }
            pageInfo {
              firstCursor
              lastCursor
              count
            }
          }
        }
      `;

      const proposalsResponse = await fetch(TALLY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": tallyApiKey,
        },
        body: JSON.stringify({
          query: getProposalsQuery,
          variables: {
            governorId,
            limit: args.limit || 10,
          },
        }),
      });

      const result = await proposalsResponse.json();
      if (result.errors) {
        throw new Error(`Tally API Error: ${JSON.stringify(result.errors)}`);
      }
      return result.data;
    },
  });
}

export function createTallyChainsTool(tallyApiKey: string): BaseTool {
  return createTool({
    name: "tallyChains",
    description: "Fetch all chains supported by the Tally governance API.",
    supportedChains: [],
    parameters: z.object({}),
    execute: async (_client: AgentekClient, _args) => {
      const query = `
        query Chains {
          chains {
            id
            layer1Id
            name
            mediumName
            shortName
            blockTime
            isTestnet
            nativeCurrency {
              name
              symbol
              decimals
            }
            chain
            useLayer1VotingPeriod
          }
        }
      `;

      const response = await fetch(TALLY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Api-Key": tallyApiKey,
        },
        body: JSON.stringify({ query }),
      });

      const result = await response.json();
      if (result.errors) {
        throw new Error(`Tally API Error: ${JSON.stringify(result.errors)}`);
      }
      return result.data;
    },
  });
}
