import {BaseTool, createToolCollection} from "../client";
import {intent_withdrawWETH, intent_depositWETH, } from "./intents";

export function wethTools(): BaseTool[] {
  return createToolCollection([intent_depositWETH, intent_withdrawWETH]);
}