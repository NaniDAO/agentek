import { BaseTool, createToolCollection } from "../client";
import {
  intentMintPosition,
  intentIncreaseLiquidity,
  intentDecreaseLiquidity,
  intentCollectFees,
  intentTransferPosition,
} from "./intents";
import {
  getUniV3Pool,
  getUserPositions,
  getPoolFeeData,
  getPositionDetails,
} from "./tools";

export function uniV3Tools(): BaseTool[] {
  return createToolCollection([
    // read
    getUniV3Pool,
    getUserPositions,
    getPoolFeeData,
    getPositionDetails,

    // write
    intentMintPosition,
    intentIncreaseLiquidity,
    intentDecreaseLiquidity,
    intentCollectFees,
    intentTransferPosition,
  ]);
}
