import { BaseTool, createToolCollection } from "../client.js";
import {
  intentStakeNani,
  intentUnstakeNani,
  intentProposeNani,
  intentVoteNaniProposal,
} from "./intents.js";
import { observeGuardianQueue } from "./queue.js";
import { getNaniProposals } from "./tools.js";

export function naniTools(): BaseTool[] {
  return createToolCollection([
    getNaniProposals,
    observeGuardianQueue,
    // intents
    intentStakeNani,
    intentUnstakeNani,
    intentProposeNani,
    intentVoteNaniProposal,
  ]);
}

export { observeGuardianQueue, queueStateSchema } from "./queue.js";
