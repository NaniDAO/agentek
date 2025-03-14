import { BaseTool, createToolCollection } from '../client';
import { getYieldTool, compareYieldTool, defiLlamaYieldTool, getYieldHistoryTool } from './tools';

export function yieldTools(): BaseTool[] {
  return createToolCollection([
    getYieldTool,
    compareYieldTool,
    defiLlamaYieldTool,
    getYieldHistoryTool,
  ]);
}

export * from './constants';
export * from './tools';