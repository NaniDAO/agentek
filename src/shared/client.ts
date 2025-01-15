import {
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
  createPublicClient,
  createWalletClient,
  Address,
} from "viem";
import { z } from "zod";

// Base interface for all tools
export interface BaseTool {
  name: string;
  description: string;
  parameters: z.ZodObject<any, any, any, any>;
  execute: (client: AgentekClient, args: any) => Promise<any>;
  supportedChains?: Chain[];
}

export interface AgentekClientConfig {
  transports: Transport[];
  chains: Chain[];
  accountOrAddress: Account | Address;
  tools: BaseTool[];
}

export class AgentekClient {
  private publicClients: Map<number, PublicClient>;
  private walletClients: Map<number, WalletClient>;
  private tools: Map<string, BaseTool>;
  private chains: Chain[];

  constructor(config: AgentekClientConfig) {
    this.publicClients = new Map();
    this.walletClients = new Map();
    this.chains = config.chains;

    config.chains.forEach((chain, index) => {
      const transport = config.transports[index] || config.transports[0];

      this.publicClients.set(
        chain.id,
        createPublicClient({
          transport,
          chain,
          account: config.accountOrAddress,
          batch: {
            multicall: true,
          },
        }),
      );

      if (typeof config.accountOrAddress === "object") {
        this.walletClients.set(
          chain.id,
          createWalletClient({
            transport,
            chain,
            account: config.accountOrAddress,
          }),
        );
      }
    });

    this.tools = new Map(config.tools.map((tool) => [tool.name, tool]));
  }

  // Get public client for specific chain
  public getPublicClient(chainId?: number): PublicClient {
    if (!chainId) {
      return this.publicClients.values().next().value;
    }
    const client = this.publicClients.get(chainId);
    if (!client) throw new Error(`No public client for chain ${chainId}`);
    return client;
  }

  // Get all public clients
  public getPublicClients(): Map<number, PublicClient> {
    return this.publicClients;
  }

  // Get wallet client for specific chain
  public getWalletClient(chainId?: number): WalletClient | undefined {
    if (!chainId) {
      return this.walletClients.values().next().value;
    }
    return this.walletClients.get(chainId);
  }

  // Get all wallet clients
  public getWalletClients(): Map<number, WalletClient> {
    return this.walletClients;
  }

  // Get all available chains
  public getChains(): Chain[] {
    return this.chains;
  }

  // Method to add new tools
  public addTools(tools: BaseTool[]): void {
    tools.forEach((tool) => {
      this.tools.set(tool.name, tool);
    });
  }

  // Method to execute a tool
  public async execute(method: string, args: any): Promise<any> {
    const tool = this.tools.get(method);
    if (!tool) {
      throw new Error(`Tool ${method} not found`);
    }

    // If chainId is specified, validate it's supported
    if (args.chainId && tool.supportedChains) {
      if (!tool.supportedChains.includes(args.chainId)) {
        throw new Error(
          `Chain ${args.chainId} not supported by tool ${method}`,
        );
      }
    }

    // Validate args against tool's schema
    const validatedArgs = tool.parameters.parse(args);

    // Execute the tool - letting it handle its own chain selection logic
    return tool.execute(this, validatedArgs);
  }
}

export function createAgentekClient(
  config: AgentekClientConfig,
): AgentekClient {
  return new AgentekClient(config);
}

// Tool creation helper remains the same but includes supportedChains
export function createTool<T extends z.ZodObject<any, any, any, any>>({
  name,
  description,
  parameters,
  execute,
  supportedChains,
}: {
  name: string;
  description: string;
  parameters: T;
  execute: (client: AgentekClient, args: z.infer<T>) => Promise<any>;
  supportedChains?: Chain[];
}): BaseTool {
  return {
    name,
    description,
    parameters,
    execute,
    supportedChains,
  };
}

export function createToolCollection(tools: BaseTool[]): BaseTool[] {
  return tools;
}
