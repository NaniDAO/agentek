import {
  type PublicClient,
  type WalletClient,
  type Transport,
  type Chain,
  type Account,
  createPublicClient,
  createWalletClient,
  Address,
  Hex,
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

interface Op {
  target: Address;
  value: string; // wei encoded
  data: Hex;
}

// RequestIntent - this structure matches what we consume on nani.ooo
// You can extend it to include hash when saving if approved by user
interface RequestIntent {
  intent: string;
  ops: Op[];
  chain: number;
}

interface CompletedIntent {
  intent: string;
  ops: Op[];
  chain: number;
  hash: string;
}

export type Intent = RequestIntent | CompletedIntent;

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
      const defaultClient = this.publicClients.values().next().value;
      if (!defaultClient) throw new Error("No public clients available");
      return defaultClient;
    }
    const specificClient = this.publicClients.get(chainId);
    if (!specificClient)
      throw new Error(`No public client for chain ${chainId}`);
    return specificClient;
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

  // Get all tools
  public getTools(): Map<string, BaseTool> {
    return this.tools;
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

  public async executeOps(ops: Op[], chainId: number): Promise<string> {
    const walletClient = this.getWalletClient(chainId);
    const publicClient = this.getPublicClient(chainId);

    if (!walletClient) {
      throw new Error(`No wallet client available for chain ${chainId}`);
    }

    if (!publicClient) {
      throw new Error(`No public client available for chain ${chainId}`);
    }

    let hash = "";
    for (const op of ops) {
      // Remove the explicit account parameter as it's already set in the wallet client
      // @ts-expect-error
      const txHash = await walletClient.sendTransaction({
        to: op.target,
        value: BigInt(op.value),
        data: op.data,
      });

      await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (ops.length > 1) {
        hash = hash + txHash + ";";
      } else {
        hash = txHash;
      }
    }

    return hash;
  }

  public async execute(method: string, args: any): Promise<any> {
    const tool = this.tools.get(method);
    if (!tool) {
      throw new Error(`Tool ${method} not found`);
    }

    if (args.chainId && tool.supportedChains) {
      if (!tool.supportedChains.map((c) => c.id).includes(args.chainId)) {
        throw new Error(
          `Chain ${args.chainId} not supported by tool ${method}`,
        );
      }
    }

    const validatedArgs = tool.parameters.safeParse(args);

    if (!validatedArgs.success) {
      throw new Error(JSON.stringify(validatedArgs.error));
    }

    return tool.execute(this, validatedArgs.data);
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
