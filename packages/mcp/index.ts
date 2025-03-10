#!/usr/bin/env node

// Check Node.js version at runtime
const [major, minor] = process.versions.node.split('.').map(Number);
const isOldNode = major < 18 || (major === 18 && minor < 17);
if (isOldNode) {
  console.error('\x1b[33m%s\x1b[0m', 'Warning: This application works best with Node.js version 18.17.0 or higher');
  console.error(`Current version: ${process.versions.node}`);
  console.error('Attempting to polyfill required functionality for older Node.js versions...');
}

// Add web-streams-polyfill before any other imports
import { ReadableStream, WritableStream, TransformStream } from "web-streams-polyfill";

// Make the polyfill available globally
if (!globalThis.ReadableStream) {
  globalThis.ReadableStream = ReadableStream;
  globalThis.WritableStream = WritableStream;
  globalThis.TransformStream = TransformStream;
}

// Polyfill fetch API for Node.js < 18
// Using dynamic import in a function instead of top-level await
function setupFetchPolyfill() {
  if (!globalThis.fetch) {
    import('node-fetch').then(nodeFetch => {
      globalThis.fetch = nodeFetch.default;
      globalThis.Headers = nodeFetch.Headers;
      globalThis.Request = nodeFetch.Request;
      globalThis.Response = nodeFetch.Response;
      preServerLog('Successfully polyfilled fetch API with node-fetch');
    }).catch(error => {
      preServerLog(`Failed to polyfill fetch API: ${error}`);
      process.exit(1);
    });
  }
}

setupFetchPolyfill();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { http, Address, Hex, zeroAddress } from "viem";
import { mainnet, optimism, arbitrum, polygon, base } from "viem/chains";
import { createAgentekClient } from "@agentek/tools/client";
import { allTools } from "@agentek/tools";
import { privateKeyToAccount } from "viem/accounts";

// We'll use this for logging until server is initialized
const preServerLog = (message: string) => console.error(message);

preServerLog("Starting Agentek MCP Server...");
process.on("uncaughtException", (err) => {
  if (server) {
    server.sendLoggingMessage({
      level: "error",
      data: `Uncaught exception: ${err}`
    });
  } else {
    preServerLog(`Uncaught exception: ${err}`);
  }
});

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

// Load Environment
const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex;
const ACCOUNT = process.env.ACCOUNT as Address;
const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const ZEROX_API_KEY = process.env.ZEROX_API_KEY;
const TALLY_API_KEY = process.env.TALLY_API_KEY;
const COINDESK_API_KEY = process.env.COINDESK_API_KEY;
const COINMARKETCAL_API_KEY = process.env.COINMARKETCAL_API_KEY;

const chains = [mainnet, optimism, arbitrum, polygon, base]; // should this be through the CLI?
const transports = chains.map(() => http());

let account = PRIVATE_KEY
  ? privateKeyToAccount(PRIVATE_KEY)
  : ACCOUNT || zeroAddress;

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
  server.sendLoggingMessage({
    level: "info",
    data: "Listing available tools"
  });
  
  const toolsList = Array.from(
    agentekClient.getTools ? agentekClient.getTools().values() : [],
  ).map((tool) => {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.parameters),
    };
  });

  server.sendLoggingMessage({
    level: "info",
    data: `Found ${toolsList.length} tools available`
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

    // Log tool execution
    server.sendLoggingMessage({
      level: "info",
      data: `Executing tool: ${toolName}`
    });

    // Execute the tool
    const result = await agentekClient.execute(toolName, args);

    // Format the result as MCP response
    let formattedResult = result;
    if (typeof result === "object") {
      formattedResult = JSON.stringify(result, null, 2);
    }

    server.sendLoggingMessage({
      level: "info",
      data: `Tool execution completed: ${toolName}`
    });

    return {
      content: [{ type: "text", text: formattedResult.toString() }],
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMsg = `Invalid arguments: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`;
      
      server.sendLoggingMessage({
        level: "error",
        data: errorMsg
      });
      
      throw new Error(errorMsg);
    }

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    server.sendLoggingMessage({
      level: "error",
      data: `Tool execution failed: ${errorMessage}`
    });

    throw new Error(`Tool execution failed: ${errorMessage}`);
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  server.sendLoggingMessage({
    level: "info",
    data: "Agentek MCP Server running on stdio"
  });
  
  // Send the Node.js version warning through MCP after the server is initialized
  if (isOldNode) {
    server.sendLoggingMessage({
      level: "warning",
      data: `This application works best with Node.js version 18.17.0 or higher. Current version: ${process.versions.node}. Polyfills are being used which may affect performance.`
    });
  }
}

runServer().catch((error) => {
  if (server) {
    server.sendLoggingMessage({
      level: "error",
      data: `Fatal error in main(): ${error}`
    });
  } else {
    preServerLog(`Fatal error in main(): ${error}`);
  }
  process.exit(1);
});

process.stdin.on("close", () => {
  preServerLog("Agentek MCP Server closed");
  server.close();
});