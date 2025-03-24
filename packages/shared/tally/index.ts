import { createToolCollection } from "../client.js";
import type { BaseTool } from "../client.js";
import {
  createTallyProposalsTool,
  createTallyChainsTool,
  createTallyUserDaosTool,
} from "./tools.js";
import {
  createTallyVoteIntent,
  createTallyVoteWithReasonIntent,
} from "./intents.js";

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
