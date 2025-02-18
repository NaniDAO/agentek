import { createToolCollection } from "../client";
import type { BaseTool } from "../client";
import {
  createTallyProposalsTool,
  createTallyChainsTool,
  createTallyUserDaosTool,
} from "./tools";
import {
  createTallyVoteIntent,
  createTallyVoteWithReasonIntent,
} from "./intents";

export function tallyTools({
  tallyApiKey,
}: {
  tallyApiKey: string;
}): BaseTool[] {
  if (!tallyApiKey) {
    throw new Error("Tally API key is required for using these tools.");
  }

  return createToolCollection([
    // tools
    createTallyProposalsTool(tallyApiKey),
    createTallyChainsTool(tallyApiKey),
    createTallyUserDaosTool(tallyApiKey),

    // intents
    createTallyVoteIntent(tallyApiKey),
    createTallyVoteWithReasonIntent(tallyApiKey),
  ]);
}
