import { BaseTool, createToolCollection } from "../client.js";
import { coinchanGetCoins, coinchanGetCoinsCount, coinchanGetVestableAmount } from "./tools.js";
import { intentCoinchanMake, intentCoinchanMakeLocked, intentCoinchanClaimVested, intentCoinchanMakeHold, intentCoinchanAirdrop } from "./intents.js";

export function coinchanTools(): BaseTool[] {
  return createToolCollection([
    // tools
    coinchanGetCoins,
    coinchanGetCoinsCount,
    coinchanGetVestableAmount,

    // intents
    intentCoinchanMake,
    intentCoinchanMakeLocked,
    intentCoinchanClaimVested,
    intentCoinchanMakeHold,
    intentCoinchanAirdrop
  ]);
}
