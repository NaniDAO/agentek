// Core client exports
export {
  type BaseTool,
  type AgentekClient,
  type AgentekClientConfig,
  type Intent,
  createAgentekClient,
  createTool,
  createToolCollection,
} from "./shared/client.js";

// AI SDK integration
export { default as AgentekTool } from "./ai-sdk/tool.js";
export { default as AgentekToolkit } from "./ai-sdk/toolkit.js";

// All tools
export { allTools } from "./shared/index.js";

// Re-export all individual tool collections
export * from "./shared/index.js";