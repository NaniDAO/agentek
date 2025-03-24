import { BaseTool, createToolCollection } from "../client.js";
import {
  intentStakeNani,
  intentUnstakeNani,
  intentProposeNani,
  intentVoteNaniProposal,
} from "./intents.js";
import { getNaniProposals } from "./tools.js";

export function naniTools(): BaseTool[] {
  return createToolCollection([
    getNaniProposals,
    // intents
    intentStakeNani,
    intentUnstakeNani,
    intentProposeNani,
    intentVoteNaniProposal,
  ]);
}
