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
  execute: (client: NaniClient, args: any) => Promise<any>;
}

// Configuration for creating a NaniClient
export interface NaniClientConfig {
  transport: Transport;
  chain: Chain;
  accountOrAddress?: Account | Address;
  tools?: BaseTool[];
}

export class NaniClient {
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  private tools: Map<string, BaseTool>;

  constructor(config: NaniClientConfig) {
    this.publicClient = createPublicClient({
      transport: config.transport,
      chain: config.chain,
    });

    if (config.accountOrAddress && "address" in config.accountOrAddress) {
      this.walletClient = createWalletClient({
        transport: config.transport,
        chain: config.chain,
        account: config.accountOrAddress,
      });
    }

    // Initialize tools map
    this.tools = new Map();
    if (config.tools) {
      config.tools.forEach((tool) => {
        this.tools.set(tool.name, tool);
      });
    }
  }

  // Getter for public client
  public getPublicClient(): PublicClient {
    return this.publicClient;
  }

  // Getter for wallet client
  public getWalletClient(): WalletClient | undefined {
    return this.walletClient;
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

    // Validate args against tool's schema
    const validatedArgs = tool.parameters.parse(args);

    // Execute the tool
    return tool.execute(this, validatedArgs);
  }
}

export function createNaniClient(config: NaniClientConfig): NaniClient {
  return new NaniClient(config);
}

export function createTool<T extends z.ZodObject<any, any, any, any>>({
  name,
  description,
  parameters,
  execute,
}: {
  name: string;
  description: string;
  parameters: T;
  execute: (client: NaniClient, args: z.infer<T>) => Promise<any>;
}): BaseTool {
  return {
    name,
    description,
    parameters,
    execute,
  };
}

export function createToolCollection(tools: BaseTool[]): BaseTool[] {
  return tools;
}
