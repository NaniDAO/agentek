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
  private accountOrAddress: Account | Address;

  constructor(config: AgentekClientConfig) {
    this.publicClients = new Map();
    this.walletClients = new Map();
    this.chains = config.chains;
    this.accountOrAddress = config.accountOrAddress;

    config.chains.forEach((chain, index) => {
      const transport = config.transports[index] || config.transports[0];

      this.publicClients.set(
        chain.id,
        createPublicClient({
          transport,
          chain,
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

  // Get address
  public async getAddress(): Promise<Address> {
    if (typeof this.accountOrAddress === "string") {
      return this.accountOrAddress;
    }
    return this.accountOrAddress.address;
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

  // Method to filter supported chains
  public filterSupportedChains(
    supportedChains: Chain[],
    chainId?: number,
  ): Chain[] {
    let chains = this.getChains();
    chains = chains.filter((chain) =>
      supportedChains.map((c) => c.id).includes(chain.id),
    );
    if (chainId !== undefined) {
      chains = chains.filter((chain) => chain.id === chainId);
      if (chains.length === 0) {
        throw new Error(`Chain ${chainId} is not supported`);
      }
    }
    return chains;
  }

  // Method to add new tools
  public addTools(tools: BaseTool[]): void {
    tools.forEach((tool) => {
      this.tools.set(tool.name, tool);
    });
  }

  public async execute(method: string, args: any): Promise<any> {
    const tool = this.tools.get(method);
    if (!tool) {
      throw new Error(`Tool ${method} not found`);
    }

    // if (args.chainId && tool.supportedChains) {
    //   if (!tool.supportedChains.includes(args.chainId)) {
    //     throw new Error(
    //       `Chain ${args.chainId} not supported by tool ${method}`,
    //     );
    //   }
    // }

    const validatedArgs = tool.parameters.parse(args);

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
