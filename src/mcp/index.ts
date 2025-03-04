#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { http, Address, Hex } from "viem";
import { mainnet, optimism, arbitrum, polygon } from "viem/chains";
import { createAgentekClient } from "../shared/client.js";
import { allTools } from "../shared/index.js";
import { privateKeyToAccount } from "viem/accounts";
import { Account } from "viem";

console.error("Starting Agentek MCP Server...");
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

// Create the MCP server
const server = new Server(
  {
    name: "agentek-mcp-server",
    version: "0.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Configuration from environment variables
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const ACCOUNT = process.env.ACCOUNT;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const ZEROX_API_KEY = process.env.ZEROX_API_KEY;
const TALLY_API_KEY = process.env.TALLY_API_KEY;
const COINDESK_API_KEY = process.env.COINDESK_API_KEY;
const COINMARKETCAL_API_KEY = process.env.COINMARKETCAL_API_KEY;

// Set up Agentek client
const chains = [mainnet, optimism, arbitrum, polygon];
const transports = chains.map(() => http());
// Using a placeholder address - tools that require a wallet will fail in read-only mode
let account: Account | Address = PRIVATE_KEY
  ? privateKeyToAccount(PRIVATE_KEY as Hex)
  : (ACCOUNT as Address);

// Create Agentek client with available tools
// @ts-ignore
const agentekClient = createAgentekClient({
  transports,
  chains,
  // @ts-ignore
  accountOrAddress: account,
  tools: allTools({
    perplexityApiKey: PERPLEXITY_API_KEY,
    zeroxApiKey: ZEROX_API_KEY,
    tallyApiKey: TALLY_API_KEY,
    coindeskApiKey: COINDESK_API_KEY,
    coinMarketCalApiKey: COINMARKETCAL_API_KEY,
  }),
});

// Handle listing available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const toolsList = Array.from(
    agentekClient.getTools ? agentekClient.getTools().values() : [],
  ).map((tool) => {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.parameters),
    };
  });

  return {
    tools: toolsList,
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (!request.params.arguments) {
      throw new Error("Arguments are required");
    }

    const toolName = request.params.name;
    const args = request.params.arguments;

    // Execute the tool
    const result = await agentekClient.execute(toolName, args);

    // Format the result as MCP response
    let formattedResult = result;
    if (typeof result === "object") {
      formattedResult = JSON.stringify(result, null, 2);
    }

    return {
      content: [{ type: "text", text: formattedResult.toString() }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
      );
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    throw new Error(`Tool execution failed: ${errorMessage}`);
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Agentek MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
