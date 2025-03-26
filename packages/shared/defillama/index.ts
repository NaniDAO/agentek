import { BaseTool, createToolCollection } from '../client.js';
import { getTokenChartTool, getYieldTool, compareYieldTool, getYieldHistoryTool, compareYieldHistoryTool } from './tools.js';

export function defillamaTools(): BaseTool[] {
  return createToolCollection([
    getTokenChartTool,
    getYieldTool,
    compareYieldTool,
    getYieldHistoryTool,
    compareYieldHistoryTool,
  ]);
}
