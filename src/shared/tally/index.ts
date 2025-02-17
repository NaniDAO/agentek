import { createToolCollection } from "../client";
import type { BaseTool } from "../client";
import {
  createTallyProposalsTool,
  createTallyVotesTool,
  createTallyDelegationsTool,
  createTallyChainsTool,
} from "./tools";

export function tallyTools({
  tallyApiKey,
}: {
  tallyApiKey: string;
}): BaseTool[] {
  if (!tallyApiKey) {
    throw new Error("Tally API key is required for using these tools.");
  }

  return createToolCollection([
    createTallyProposalsTool(tallyApiKey),
    createTallyChainsTool(tallyApiKey),
  ]);
}
