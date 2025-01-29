import {BaseTool, createToolCollection} from "../client";
import {depositWETHIntent, withdrawWETHIntent} from "./intents";

export function wethTools(): BaseTool[] {
  return createToolCollection([depositWETHIntent, withdrawWETHIntent]);
}