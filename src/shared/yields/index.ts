import { BaseTool, createToolCollection } from '../client';
import { getYieldTool, compareYieldTool, defiLlamaYieldTool, getYieldHistoryTool, compareYieldHistoryTool } from './tools';

export function yieldTools(): BaseTool[] {
  return createToolCollection([
    getYieldTool,
    compareYieldTool,
    defiLlamaYieldTool,
    getYieldHistoryTool,
    compareYieldHistoryTool,
  ]);
}

export * from './constants';
export * from './tools';
export * from './utils';