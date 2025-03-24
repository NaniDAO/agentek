import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import { Hex, http, isHex, zeroAddress } from "viem";
import { mainnet, optimism, arbitrum, polygon, base } from "viem/chains";
import { createAgentekClient, type BaseTool } from "@agentek/tools/client";
import { allTools } from "@agentek/tools";
import { privateKeyToAccount } from "viem/accounts";

const preServerLog = (message) => console.error(message);

async function main() {
  preServerLog("Starting Agentek MCP Server...");
  const version = require("./package.json").version;
  const server = new Server(
    {
      name: "agentek-mcp-server",
      version,
    },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    },
  );
  preServerLog("MCP server instance created successfully");

  preServerLog("Setting up uncaught exception handler...");
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

  preServerLog("Setting up unhandled rejection handler...");
  process.on('unhandledRejection', (reason, promise) => {
     console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });

  preServerLog("Loading environment variables...");
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const ACCOUNT = process.env.ACCOUNT;
  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
  const ZEROX_API_KEY = process.env.ZEROX_API_KEY;
  const TALLY_API_KEY = process.env.TALLY_API_KEY;
  const COINDESK_API_KEY = process.env.COINDESK_API_KEY;
  const COINMARKETCAL_API_KEY = process.env.COINMARKETCAL_API_KEY;

  if (PRIVATE_KEY && !isHex(PRIVATE_KEY)) {
    throw new Error("Invalid PRIVATE_KEY format, must be hex");
  }

  preServerLog(`PRIVATE_KEY set: ${!!PRIVATE_KEY}`);
  preServerLog(`ACCOUNT set: ${!!ACCOUNT}`);
  preServerLog(`PERPLEXITY_API_KEY set: ${!!PERPLEXITY_API_KEY}`);
  preServerLog(`ZEROX_API_KEY set: ${!!ZEROX_API_KEY}`);
  preServerLog(`TALLY_API_KEY set: ${!!TALLY_API_KEY}`);
  preServerLog(`COINDESK_API_KEY set: ${!!COINDESK_API_KEY}`);
  preServerLog(`COINMARKETCAL_API_KEY set: ${!!COINMARKETCAL_API_KEY}`);

  const chains = [mainnet, optimism, arbitrum, polygon, base];
  const transports = chains.map(() => http());
  preServerLog(`Configured chains: ${chains.map(chain => chain.name).join(', ')}`);

  preServerLog("Setting up blockchain account...");
  let account = PRIVATE_KEY
    ? privateKeyToAccount(PRIVATE_KEY as Hex)
    : (ACCOUNT && isHex(ACCOUNT) ? ACCOUNT as Hex : zeroAddress);
  preServerLog(`Account configured: ${typeof account === 'object' ? 'Account object' : account}`);

  preServerLog("Creating Agentek client...");
  try {
    const agentekClient = createAgentekClient({
      transports,
      chains,
      accountOrAddress: account,
      tools: allTools({
        perplexityApiKey: PERPLEXITY_API_KEY,
        zeroxApiKey: ZEROX_API_KEY,
        tallyApiKey: TALLY_API_KEY,
        coindeskApiKey: COINDESK_API_KEY,
        coinMarketCalApiKey: COINMARKETCAL_API_KEY,
      }),
    });
    preServerLog("Agentek client created successfully");
    preServerLog(`Tools available: ${agentekClient.getTools().size}`);

    // Handle listing available tools
    preServerLog("Setting up ListToolsRequestSchema handler...");
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      server.sendLoggingMessage({
        level: "info",
        data: "Listing available tools - request received"
      });

      server.sendLoggingMessage({
        level: "debug",
        data: `agentekClient.getTools exists: ${typeof agentekClient.getTools === 'function'}`
      });

      let toolsCollection;
      if (agentekClient.getTools) {
        toolsCollection = agentekClient.getTools() as Map<string, BaseTool>;
        server.sendLoggingMessage({
          level: "debug",
          data: `Raw tools collection size: ${toolsCollection.size}`
        });
      } else {
        server.sendLoggingMessage({
          level: "warning",
          data: "agentekClient.getTools is not available"
        });
        toolsCollection = new Map();
      }

      const toolsArray = Array.from(toolsCollection.values());
      server.sendLoggingMessage({
        level: "debug",
        data: `Tools array length: ${toolsArray.length}`
      });

      const toolsList = toolsArray.map((tool: BaseTool) => {
        server.sendLoggingMessage({
          level: "debug",
          data: `Processing tool: ${tool.name}`
        });

        try {
          const schema = zodToJsonSchema(tool.parameters);
          server.sendLoggingMessage({
            level: "debug",
            data: `Successfully generated schema for tool: ${tool.name}`
          });

          return {
            name: tool.name,
            description: tool.description,
            inputSchema: schema,
          };
        } catch (err) {
          server.sendLoggingMessage({
            level: "error",
            data: `Error generating schema for tool ${tool.name}: ${err.message}`
          });
          return {
            name: tool.name,
            description: tool.description || "No description available",
            inputSchema: { type: "object", properties: {} },
          };
        }
      });

      server.sendLoggingMessage({
        level: "info",
        data: `Found ${toolsList.length} tools available`
      });

      toolsList.forEach((tool, index) => {
        server.sendLoggingMessage({
          level: "debug",
          data: `Tool ${index+1}: ${tool.name} - ${tool.description?.substring(0, 30)}...`
        });
      });

      return {
        tools: toolsList,
      };
    });
    preServerLog("ListToolsRequestSchema handler setup complete");

    preServerLog("Setting up CallToolRequestSchema handler...");
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        server.sendLoggingMessage({
          level: "info",
          data: `Received tool execution request`
        });

        server.sendLoggingMessage({
          level: "debug",
          data: `Request params: ${JSON.stringify(request.params)}`
        });

        if (!request.params.arguments) {
          server.sendLoggingMessage({
            level: "error",
            data: "Arguments are missing in the request"
          });
          throw new Error("Arguments are required");
        }

        const toolName = request.params.name;
        const args = request.params.arguments;

        server.sendLoggingMessage({
          level: "info",
          data: `Executing tool: ${toolName}`
        });

        server.sendLoggingMessage({
          level: "debug",
          data: `Tool arguments: ${JSON.stringify(args)}`
        });

        // Execute the tool
        server.sendLoggingMessage({
          level: "debug",
          data: `Starting tool execution for: ${toolName}`
        });

        const result = await agentekClient.execute(toolName, args);

        server.sendLoggingMessage({
          level: "debug",
          data: `Raw result type: ${typeof result}`
        });

        // Format the result as MCP response
        let formattedResult = result;
        if (typeof result === "object") {
          server.sendLoggingMessage({
            level: "debug",
            data: "Result is an object, converting to JSON string"
          });
          formattedResult = JSON.stringify(result, null, 2);
        }

        server.sendLoggingMessage({
          level: "info",
          data: `Tool execution completed: ${toolName}`
        });

        server.sendLoggingMessage({
          level: "debug",
          data: `Result length: ${formattedResult.toString().length} characters`
        });

        if (formattedResult.toString().length > 100) {
          server.sendLoggingMessage({
            level: "debug",
            data: `Result preview: ${formattedResult.toString().substring(0, 100)}...`
          });
        } else {
          server.sendLoggingMessage({
            level: "debug",
            data: `Full result: ${formattedResult.toString()}`
          });
        }

        return {
          content: [{ type: "text", text: formattedResult.toString() }],
        };
      } catch (error) {
        server.sendLoggingMessage({
          level: "error",
          data: `Exception during tool execution: ${error}`
        });

        if (error instanceof z.ZodError) {
          server.sendLoggingMessage({
            level: "debug",
            data: `ZodError details: ${JSON.stringify(error.errors)}`
          });

          const errorMsg = `Invalid arguments: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`;

          server.sendLoggingMessage({
            level: "error",
            data: errorMsg
          });

          throw new Error(errorMsg);
        }

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error occurred";

        if (error instanceof Error && error.stack) {
          server.sendLoggingMessage({
            level: "debug",
            data: `Error stack: ${error.stack}`
          });
        }

        server.sendLoggingMessage({
          level: "error",
          data: `Tool execution failed: ${errorMessage}`
        });

        throw new Error(`Tool execution failed: ${errorMessage}`);
      }
    });
    preServerLog("CallToolRequestSchema handler setup complete");

    preServerLog("Creating stdio transport...");
    const transport = new StdioServerTransport();
    preServerLog("Transport created, connecting to server...");

    try {
      await server.connect(transport);
      preServerLog("Server connected to transport successfully");
    } catch (err) {
      preServerLog(`Failed to connect server to transport: ${err}`);
      throw err;
    }

    server.sendLoggingMessage({
      level: "info",
      data: "Agentek MCP Server running on stdio"
    });

    preServerLog("Setting up stdin close handler...");
    process.stdin.on("close", () => {
      preServerLog("stdin closed, shutting down server...");
      server.sendLoggingMessage({
        level: "info",
        data: "Received close signal, shutting down"
      });
      preServerLog("Agentek MCP Server closed");
      server.close();
    });
    preServerLog("stdin close handler setup complete");

    preServerLog("Server initialization complete, ready to handle requests");
  } catch (initError) {
    preServerLog(`Failed to initialize Agentek client: ${initError}`);
    if (initError instanceof Error && initError.stack) {
      preServerLog(`Initialization error stack: ${initError.stack}`);
    }
    throw initError;
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  if (error instanceof Error && error.stack) {
    console.error("Error stack:", error.stack);
  }
  console.error("Server exiting due to fatal error");
  process.exit(1);
});
