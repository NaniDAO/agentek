import { BaseTool, createToolCollection } from "../client";
import {
  getUniV3Pool,
  intentMintPosition,
  intentIncreaseLiquidity,
  intentDecreaseLiquidity,
  intentCollectFees,
  intentTransferPosition,
} from "./tools";

export function uniV3Tools(): BaseTool[] {
  return createToolCollection([
    getUniV3Pool,
    intentMintPosition,
    intentIncreaseLiquidity,
    intentDecreaseLiquidity,
    intentCollectFees,
    intentTransferPosition,
  ]);
}
