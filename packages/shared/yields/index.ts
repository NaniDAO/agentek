import { BaseTool, createToolCollection } from '../client';
import { getYieldTool, compareYieldTool, getYieldHistoryTool, compareYieldHistoryTool } from './tools';

export function yieldTools(): BaseTool[] {
  return createToolCollection([
    getYieldTool,
    compareYieldTool,
    getYieldHistoryTool,
    compareYieldHistoryTool,
  ]);
}