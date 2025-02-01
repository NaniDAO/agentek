import { BaseTool, createToolCollection } from "../client";
import {
  intentStakeNani,
  intentUnstakeNani,
  intentProposeNani,
  intentVoteNaniProposal,
} from "./intents";
import { getNaniProposals } from "./tools";

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
