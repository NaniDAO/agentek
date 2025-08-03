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
  SignableMessage,
  TypedData
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

export interface Op {
  target: Address;
  value: string; // wei encoded
  data: Hex;
}

// EIP-191 Personal Sign operation
export interface PersonalSign {
  type: 'personal_sign';
  message: SignableMessage;
}

// EIP-712 Typed Data Sign operation
export interface TypedDataSign {
  type: 'typed_data_sign';
  domain: TypedData['domain'];
  types: TypedData['types'];
  primaryType: string;
  message: TypedData['message'];
}

// Union type for all signing operations
export type Sign = PersonalSign | TypedDataSign;

// Extended operation that can be either a transaction or a signature
export type Operation = Op | Sign;

// RequestIntent - this structure matches what we consume on nani.ooo
// You can extend it to include hash when saving if approved by user
interface RequestIntent {
  intent: string;
  ops: Operation[];
  chain: number;
}

interface CompletedIntent {
  intent: string;
  ops: Operation[];
  chain: number;
  hash?: string;
  signatures?: string[];
}

export type Intent = RequestIntent | CompletedIntent;

export interface AgentekClientConfig {
  transports: Transport[];
  chains: Chain[];
  accountOrAddress: Account | Address;
  tools: BaseTool[];
}

// Type guards for runtime checking
export const isTransactionOp = (op: Operation): op is Op => {
  return 'target' in op && 'value' in op && 'data' in op;
};

export const isPersonalSign = (op: Operation): op is PersonalSign => {
  return 'type' in op && op.type === 'personal_sign';
};

export const isTypedDataSign = (op: Operation): op is TypedDataSign => {
  return 'type' in op && op.type === 'typed_data_sign';
};

export const isSignOperation = (op: Operation): op is Sign => {
  return isPersonalSign(op) || isTypedDataSign(op);
};

export class AgentekClient {
  private publicClients: Map<number, PublicClient<Transport, Chain>>;
  private walletClients: Map<number, WalletClient<Transport, Chain, Account>>;
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

      // Create public client with simple configuration to avoid type issues
      const publicClient = createPublicClient({
        transport,
        chain,
      });

      this.publicClients.set(chain.id, publicClient as PublicClient<Transport, Chain>);

      // Create wallet client separately if account is provided as an object
      // client.ts (inside constructor)
      if (typeof config.accountOrAddress === "object") {
        const raw = createWalletClient({
          transport,
          chain,
          account: config.accountOrAddress,
        });

        // Force‐cast so TS doesn't expand the full generic return type.
        const walletClient = raw as unknown as WalletClient<Transport, Chain, Account>;

        this.walletClients.set(chain.id, walletClient);
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
  public getPublicClient(chainId?: number): any { // Use any to avoid type issues
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
  public getPublicClients(): Map<number, any> {
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

  public async executeSign(signs: Sign[], chainId: number): Promise<string[]> {
    const walletClient = this.getWalletClient(chainId);

    if (!walletClient) {
      throw new Error(`No wallet client available for chain ${chainId}`);
    }

    const signatures: string[] = [];

    for (const sign of signs) {
      let signature: string;

      if (isPersonalSign(sign)) {
        // EIP-191 Personal Sign
        // @ts-expect-error - viem type casting issues
        signature = await walletClient.signMessage({
          message: sign.message,
        });
      } else if (isTypedDataSign(sign)) {
        // EIP-712 Typed Data Sign
        // @ts-expect-error - viem type casting issues
        signature = await walletClient.signTypedData({
          domain: sign.domain,
          types: sign.types,
          primaryType: sign.primaryType,
          message: sign.message,
        });
      } else {
        throw new Error(`Unsupported sign operation type`);
      }

      signatures.push(signature);
    }

    return signatures;
  }

  // Execute mixed operations (both transactions and signatures)
  public async executeOperations(operations: Operation[], chainId: number): Promise<{
    hash?: string;
    signatures?: string[];
  }> {
    const transactionOps = operations.filter(isTransactionOp);
    const signOps = operations.filter(isSignOperation);

    const results: { hash?: string; signatures?: string[] } = {};

    // Execute transaction operations
    if (transactionOps.length > 0) {
      results.hash = await this.executeOps(transactionOps, chainId);
    }

    // Execute signing operations
    if (signOps.length > 0) {
      results.signatures = await this.executeSign(signOps, chainId);
    }

    return results;
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
