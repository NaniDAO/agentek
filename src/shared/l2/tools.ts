import { z } from "zod";
import { createTool } from "../client";
import { supportedChains, L2_BRIDGE_ADDRESSES, L2_BRIDGE_ABI, L2_EVENTS } from "./constants";
import { addressSchema, clean } from "../utils";
import { type Address, type Hex, getAddress } from "viem";

export const getL2DepositsInput = z.object({
  chainId: z.number().describe("The L2 chain ID to query deposits for"),
  address: addressSchema.describe("The address to query deposits for"),
  limit: z.number().optional().describe("Maximum number of deposits to return"),
  fromBlock: z.number().optional().describe("Starting block number for the query"),
});

export type GetL2DepositsInput = z.infer<typeof getL2DepositsInput>;

export const getL2DepositsOutput = z.array(
  z.object({
    timestamp: z.number().describe("Timestamp of the deposit"),
    blockNumber: z.number().describe("Block number of the deposit"),
    txHash: z.string().describe("Transaction hash of the deposit"),
    fromAddress: z.string().describe("Source address"),
    toAddress: z.string().describe("Destination address"),
    tokenAddress: z.string().describe("Token address (0xEeeee... for ETH)"),
    amount: z.string().describe("Amount deposited as a string"),
    status: z.string().describe("Status of the deposit"),
  })
);

export type GetL2DepositsOutput = z.infer<typeof getL2DepositsOutput>;

export const getL2DepositsTool = createTool({
  name: "getL2Deposits",
  description: "Get L2 deposits for a specific address (sent from L1 to L2)",
  supportedChains,
  parameters: getL2DepositsInput,
  execute: async (client, args) => {
    const { chainId, address, limit = 10, fromBlock } = args;
    
    // Get the public client for the chain
    const publicClient = client.getPublicClient(chainId);
    
    // Default from block (last 10000 blocks if not specified)
    const latestBlock = await publicClient.getBlockNumber();
    const defaultFromBlock = latestBlock - BigInt(10000);
    const fromBlockToUse = fromBlock ? BigInt(fromBlock) : defaultFromBlock;
    
    // Get the bridge address for the chain
    const bridgeAddress = L2_BRIDGE_ADDRESSES[chainId];
    if (!bridgeAddress) {
      throw new Error(`Bridge address not found for chain ID ${chainId}`);
    }
    
    // Get the event name for the chain
    const depositEvent = L2_EVENTS[chainId]?.DEPOSIT;
    if (!depositEvent) {
      throw new Error(`Deposit event not found for chain ID ${chainId}`);
    }
    
    try {
      // Get logs for deposit events
      const logs = await publicClient.getLogs({
        address: bridgeAddress as Address,
        event: {
          type: 'event',
          name: depositEvent,
          inputs: [
            { indexed: true, name: 'from', type: 'address' },
            { indexed: true, name: 'to', type: 'address' },
            { indexed: false, name: 'amount', type: 'uint256' },
            { indexed: false, name: 'extraData', type: 'bytes' },
          ],
        },
        args: {
          to: address,
        },
        fromBlock: fromBlockToUse,
        toBlock: latestBlock,
      });
      
      // Process logs into the expected output format
      const deposits = await Promise.all(
        logs.slice(0, limit).map(async (log) => {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          
          return {
            timestamp: Number(block.timestamp),
            blockNumber: Number(log.blockNumber),
            txHash: log.transactionHash,
            fromAddress: log.args.from as string,
            toAddress: log.args.to as string,
            // L2 deposits are typically ETH
            tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            amount: log.args.amount.toString(),
            status: "Completed", // Deposits are completed once they're indexed
          };
        })
      );
      
      return clean(deposits);
    } catch (error) {
      console.error(`Error fetching L2 deposits: ${error}`);
      throw new Error(`Failed to fetch L2 deposits: ${error}`);
    }
  },
});

export const getL2WithdrawalsInput = z.object({
  chainId: z.number().describe("The L2 chain ID to query withdrawals from"),
  address: addressSchema.describe("The address to query withdrawals for"),
  limit: z.number().optional().describe("Maximum number of withdrawals to return"),
  fromBlock: z.number().optional().describe("Starting block number for the query"),
});

export type GetL2WithdrawalsInput = z.infer<typeof getL2WithdrawalsInput>;

export const getL2WithdrawalsOutput = z.array(
  z.object({
    timestamp: z.number().describe("Timestamp of the withdrawal"),
    blockNumber: z.number().describe("Block number of the withdrawal"),
    txHash: z.string().describe("Transaction hash of the withdrawal"),
    fromAddress: z.string().describe("Source address"),
    toAddress: z.string().describe("Destination address"),
    tokenAddress: z.string().describe("Token address (0xEeeee... for ETH)"),
    amount: z.string().describe("Amount withdrawn as a string"),
    status: z.string().describe("Status of the withdrawal"),
  })
);

export type GetL2WithdrawalsOutput = z.infer<typeof getL2WithdrawalsOutput>;

export const getL2WithdrawalsTool = createTool({
  name: "getL2Withdrawals",
  description: "Get L2 withdrawals for a specific address (sent from L2 to L1)",
  parameters: getL2WithdrawalsInput,
  supportedChains,
  execute: async (client, args) => {
    const { chainId, address, limit = 10, fromBlock } = args;
    
    // Get the public client for the chain
    const publicClient = client.getPublicClient(chainId);
    
    // Default from block (last 10000 blocks if not specified)
    const latestBlock = await publicClient.getBlockNumber();
    const defaultFromBlock = latestBlock - BigInt(10000);
    const fromBlockToUse = fromBlock ? BigInt(fromBlock) : defaultFromBlock;
    
    // Get the bridge address for the chain
    const bridgeAddress = L2_BRIDGE_ADDRESSES[chainId];
    if (!bridgeAddress) {
      throw new Error(`Bridge address not found for chain ID ${chainId}`);
    }
    
    // Get the event name for the chain
    const withdrawalEvent = L2_EVENTS[chainId]?.WITHDRAWAL;
    if (!withdrawalEvent) {
      throw new Error(`Withdrawal event not found for chain ID ${chainId}`);
    }
    
    try {
      // Get logs for withdrawal events
      const logs = await publicClient.getLogs({
        address: bridgeAddress as Address,
        event: {
          type: 'event',
          name: withdrawalEvent,
          inputs: [
            { indexed: true, name: 'from', type: 'address' },
            { indexed: true, name: 'to', type: 'address' },
            { indexed: false, name: 'amount', type: 'uint256' },
            { indexed: false, name: 'extraData', type: 'bytes' },
          ],
        },
        args: {
          from: address,
        },
        fromBlock: fromBlockToUse,
        toBlock: latestBlock,
      });
      
      // Process logs into the expected output format
      const withdrawals = await Promise.all(
        logs.slice(0, limit).map(async (log) => {
          const block = await publicClient.getBlock({ blockNumber: log.blockNumber });
          
          // For L2 withdrawals, we need to check if they've been finalized on L1
          // This is a simplification - in reality, you'd need to check the L1 for finalization status
          const status = "Pending"; // Default to pending, as withdrawals take time to finalize
          
          return {
            timestamp: Number(block.timestamp),
            blockNumber: Number(log.blockNumber),
            txHash: log.transactionHash,
            fromAddress: log.args.from as string,
            toAddress: log.args.to as string,
            // L2 withdrawals are typically ETH
            tokenAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            amount: log.args.amount.toString(),
            status,
          };
        })
      );
      
      return clean(withdrawals);
    } catch (error) {
      console.error(`Error fetching L2 withdrawals: ${error}`);
      throw new Error(`Failed to fetch L2 withdrawals: ${error}`);
    }
  },
});