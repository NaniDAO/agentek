import { BaseTool, createToolCollection } from '../client.js';
import { getYieldTool, compareYieldTool, getYieldHistoryTool, compareYieldHistoryTool } from './tools.js';

export function yieldTools(): BaseTool[] {
  return createToolCollection([
    getYieldTool,
    compareYieldTool,
    getYieldHistoryTool,
    compareYieldHistoryTool,
  ]);
}