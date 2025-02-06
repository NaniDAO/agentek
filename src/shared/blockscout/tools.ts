// blockscout/tools.ts
import { z } from "zod";
import { createTool } from "../client";
import {
  mainnet,
  bsc,
  polygon,
  arbitrum,
  optimism,
  avalanche,
  gnosis,
  fantom,
} from "viem/chains";

const popularChains = [
  mainnet,
  bsc,
  polygon,
  arbitrum,
  optimism,
  avalanche,
  gnosis,
  fantom,
];

// Map each chain to its Blockscout API endpoint
const BLOCKSCOUT_API_ENDPOINTS = new Map([
  [mainnet.id, "https://blockscout.com/eth/mainnet"],
  [bsc.id, "https://blockscout.com/bsc/mainnet"],
  [polygon.id, "https://blockscout.com/matic/mainnet"],
  [arbitrum.id, "https://blockscout.com/arbitrum/mainnet"],
  [optimism.id, "https://blockscout.com/optimism/mainnet"],
  [avalanche.id, "https://blockscout.com/avalanche/mainnet"],
  [gnosis.id, "https://blockscout.com/poa/xdai"],
  [fantom.id, "https://blockscout.com/fantom/mainnet"],
]);

// Helper function to fetch data from Blockscout
async function fetchFromBlockscout(
  chain: (typeof popularChains)[number]["id"],
  query: Record<string, string>,
) {
  const baseUrl = BLOCKSCOUT_API_ENDPOINTS.get(chain);
  if (!baseUrl) {
    throw new Error(`Chain ${chain} is not supported.`);
  }

  const queryParams = new URLSearchParams(query);
  const url = `${baseUrl}/api?${queryParams.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP error ${res.status}`);
  const json = await res.json();
  return json;
}

// 2. getMultiBalance
export const getMultiBalance = createTool({
  name: "getMultiBalance",
  description: "Fetch balances for multiple addresses using Blockscout API.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    addresses: z
      .array(z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"))
      .min(1, "At least one address is required"),
  }),
  execute: async (_, args) => {
    const { chain, addresses } = args;
    const addressParam = addresses.join(",");
    const result = await fetchFromBlockscout(chain, {
      module: "account",
      action: "balancemulti",
      address: addressParam,
    });
    return result;
  },
});

// 3. getTokenBalance
export const getTokenBalance = createTool({
  name: "getTokenBalance",
  description:
    "Get the balance of an ERC-20 token for a given address using Blockscout API.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address"),
  }),
  execute: async (_, args) => {
    const { chain, address, tokenContract } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "account",
      action: "tokenbalance",
      address,
      contractaddress: tokenContract,
    });
    return result;
  },
});

// 4. getTokenList (filters out ERC-20 tokens with null exchange rate)
export const getTokenList = createTool({
  name: "getTokenList",
  description:
    "Retrieve a list of tokens held by an address, filtering out ERC-20 tokens with null exchange rates.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "account",
      action: "tokenlist",
      address,
    });
    // Filter out ERC-20 tokens with null exchangeRate
    if (result && Array.isArray(result.result)) {
      result.result = result.result.filter((token: any) => {
        if (token.tokenType && token.tokenType.toUpperCase() === "ERC20") {
          return (
            token.exchangeRate !== null && token.exchangeRate !== undefined
          );
        }
        return true;
      });
    }
    return result;
  },
});

// 5. getTransactions
export const getTransactions = createTool({
  name: "getTransactions",
  description:
    "Retrieve normal transactions for an address with optional pagination and sorting.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
    page: z.number().optional(),
    offset: z.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
    startBlock: z.number().optional(),
    endBlock: z.number().optional(),
  }),
  execute: async (_, args) => {
    const { chain, address, page, offset, sort, startBlock, endBlock } = args;
    const query: Record<string, string> = {
      module: "account",
      action: "txlist",
      address,
    };
    if (page !== undefined) query.page = String(page);
    if (offset !== undefined) query.offset = String(offset);
    if (sort !== undefined) query.sort = sort;
    if (startBlock !== undefined) query.startblock = String(startBlock);
    if (endBlock !== undefined) query.endblock = String(endBlock);
    const result = await fetchFromBlockscout(chain, query);
    return result;
  },
});

// 6. getInternalTransactions
export const getInternalTransactions = createTool({
  name: "getInternalTransactions",
  description:
    "Retrieve internal transactions for an address with optional pagination.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
    page: z.number().optional(),
    offset: z.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
    startBlock: z.number().optional(),
    endBlock: z.number().optional(),
  }),
  execute: async (_, args) => {
    const { chain, address, page, offset, sort, startBlock, endBlock } = args;
    const query: Record<string, string> = {
      module: "account",
      action: "txlistinternal",
      address,
    };
    if (page !== undefined) query.page = String(page);
    if (offset !== undefined) query.offset = String(offset);
    if (sort !== undefined) query.sort = sort;
    if (startBlock !== undefined) query.startblock = String(startBlock);
    if (endBlock !== undefined) query.endblock = String(endBlock);
    const result = await fetchFromBlockscout(chain, query);
    return result;
  },
});

// 7. getPendingTransactions
export const getPendingTransactions = createTool({
  name: "getPendingTransactions",
  description: "Retrieve pending (unconfirmed) transactions for an address.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "account",
      action: "pendingtxlist",
      address,
    });
    return result;
  },
});

// 8. getTokenTransfers
export const getTokenTransfers = createTool({
  name: "getTokenTransfers",
  description:
    "List ERC-20 token transfer events for an address, optionally filtered by token contract.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address")
      .optional(),
    page: z.number().optional(),
    offset: z.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
    startBlock: z.number().optional(),
    endBlock: z.number().optional(),
  }),
  execute: async (_, args) => {
    const {
      chain,
      address,
      tokenContract,
      page,
      offset,
      sort,
      startBlock,
      endBlock,
    } = args;
    const query: Record<string, string> = {
      module: "account",
      action: "tokentx",
      address,
    };
    if (tokenContract) query.contractaddress = tokenContract;
    if (page !== undefined) query.page = String(page);
    if (offset !== undefined) query.offset = String(offset);
    if (sort !== undefined) query.sort = sort;
    if (startBlock !== undefined) query.startblock = String(startBlock);
    if (endBlock !== undefined) query.endblock = String(endBlock);
    const result = await fetchFromBlockscout(chain, query);
    return result;
  },
});

// 9. getNftTransfers
export const getNftTransfers = createTool({
  name: "getNftTransfers",
  description:
    "List ERC-721 NFT transfer events for an address, optionally filtered by contract.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address format"),
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address")
      .optional(),
    page: z.number().optional(),
    offset: z.number().optional(),
    sort: z.enum(["asc", "desc"]).optional(),
    startBlock: z.number().optional(),
    endBlock: z.number().optional(),
  }),
  execute: async (_, args) => {
    const {
      chain,
      address,
      tokenContract,
      page,
      offset,
      sort,
      startBlock,
      endBlock,
    } = args;
    const query: Record<string, string> = {
      module: "account",
      action: "tokennfttx",
      address,
    };
    if (tokenContract) query.contractaddress = tokenContract;
    if (page !== undefined) query.page = String(page);
    if (offset !== undefined) query.offset = String(offset);
    if (sort !== undefined) query.sort = sort;
    if (startBlock !== undefined) query.startblock = String(startBlock);
    if (endBlock !== undefined) query.endblock = String(endBlock);
    const result = await fetchFromBlockscout(chain, query);
    return result;
  },
});

// 10. getBlockReward
export const getBlockReward = createTool({
  name: "getBlockReward",
  description: "Get block reward details for a specific block number.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    blockNumber: z.union([z.string(), z.number()]),
  }),
  execute: async (_, args) => {
    const { chain, blockNumber } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "block",
      action: "getblockreward",
      blockno: String(blockNumber),
    });
    return result;
  },
});

// 11. getBlockCountdown
export const getBlockCountdown = createTool({
  name: "getBlockCountdown",
  description: "Get countdown info to an upcoming block.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    blockNumber: z.union([z.string(), z.number()]),
  }),
  execute: async (_, args) => {
    const { chain, blockNumber } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "block",
      action: "getblockcountdown",
      blockno: String(blockNumber),
    });
    return result;
  },
});

// 12. getBlockNumberByTime
export const getBlockNumberByTime = createTool({
  name: "getBlockNumberByTime",
  description: "Get the block number closest to a given Unix timestamp.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    timestamp: z.number(),
    closest: z.enum(["before", "after"]),
  }),
  execute: async (_, args) => {
    const { chain, timestamp, closest } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "block",
      action: "getblocknobytime",
      timestamp: String(timestamp),
      closest,
    });
    return result;
  },
});

// 13. getLatestBlockNumber
export const getLatestBlockNumber = createTool({
  name: "getLatestBlockNumber",
  description: "Get the latest block number on the chain.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
  }),
  execute: async (_, args) => {
    const { chain } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "block",
      action: "eth_block_number",
    });
    return result;
  },
});

// 14. getTransactionInfo
export const getTransactionInfo = createTool({
  name: "getTransactionInfo",
  description: "Retrieve detailed information for a given transaction hash.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    txhash: z.string(),
    index: z.number().optional(),
  }),
  execute: async (_, args) => {
    const { chain, txhash, index } = args;
    const query: Record<string, string> = {
      module: "transaction",
      action: "gettxinfo",
      txhash,
    };
    if (index !== undefined) query.index = String(index);
    const result = await fetchFromBlockscout(chain, query);
    return result;
  },
});

// 15. getTransactionReceiptStatus
export const getTransactionReceiptStatus = createTool({
  name: "getTransactionReceiptStatus",
  description:
    "Retrieve the receipt status of a transaction (success or failure).",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    txhash: z.string(),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "transaction",
      action: "gettxreceiptstatus",
      txhash,
    });
    return result;
  },
});

// 16. getTransactionError
export const getTransactionError = createTool({
  name: "getTransactionError",
  description: "Retrieve error details for a failed transaction.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    txhash: z.string(),
  }),
  execute: async (_, args) => {
    const { chain, txhash } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "transaction",
      action: "getstatus",
      txhash,
    });
    return result;
  },
});

// 17. getContractABI
export const getContractABI = createTool({
  name: "getContractABI",
  description: "Fetch the ABI for a verified smart contract.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "contract",
      action: "getabi",
      address,
    });
    return result;
  },
});

// 18. getContractSource
export const getContractSource = createTool({
  name: "getContractSource",
  description: "Retrieve the source code of a verified contract.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address"),
  }),
  execute: async (_, args) => {
    const { chain, address } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "contract",
      action: "getsourcecode",
      address,
    });
    return result;
  },
});

// 19. getContractCreation
export const getContractCreation = createTool({
  name: "getContractCreation",
  description: "Get the creation transaction info for one or more contracts.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    contractAddresses: z
      .array(
        z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address"),
      )
      .min(1, "At least one contract address is required"),
  }),
  execute: async (_, args) => {
    const { chain, contractAddresses } = args;
    const addressesParam = contractAddresses.join(",");
    const result = await fetchFromBlockscout(chain, {
      module: "contract",
      action: "getcontractcreation",
      contractaddresses: addressesParam,
    });
    return result;
  },
});

// 20. getContracts
export const getContracts = createTool({
  name: "getContracts",
  description:
    "List contract addresses known to the explorer with optional pagination.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    page: z.number().optional(),
    offset: z.number().optional(),
  }),
  execute: async (_, args) => {
    const { chain, page, offset } = args;
    const query: Record<string, string> = {
      module: "contract",
      action: "listcontracts",
    };
    if (page !== undefined) query.page = String(page);
    if (offset !== undefined) query.offset = String(offset);
    const result = await fetchFromBlockscout(chain, query);
    return result;
  },
});

// 21. getLogs
export const getLogs = createTool({
  name: "getLogs",
  description: "Retrieve event logs based on filter criteria.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    fromBlock: z.string().optional(),
    toBlock: z.string().optional(),
    address: z.string().optional(),
    topic0: z.string().optional(),
    topic1: z.string().optional(),
    topic2: z.string().optional(),
    topic3: z.string().optional(),
  }),
  execute: async (_, args) => {
    const {
      chain,
      fromBlock,
      toBlock,
      address,
      topic0,
      topic1,
      topic2,
      topic3,
    } = args;
    const query: Record<string, string> = {
      module: "logs",
      action: "getLogs",
    };
    if (fromBlock) query.fromBlock = fromBlock;
    if (toBlock) query.toBlock = toBlock;
    if (address) query.address = address;
    if (topic0) query.topic0 = topic0;
    if (topic1) query.topic1 = topic1;
    if (topic2) query.topic2 = topic2;
    if (topic3) query.topic3 = topic3;
    const result = await fetchFromBlockscout(chain, query);
    return result;
  },
});

// 22. getTokenInfo
export const getTokenInfo = createTool({
  name: "getTokenInfo",
  description: "Fetch metadata for a token contract.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address"),
  }),
  execute: async (_, args) => {
    const { chain, tokenContract } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "token",
      action: "getToken",
      contractaddress: tokenContract,
    });
    return result;
  },
});

// 23. getTokenHolders
export const getTokenHolders = createTool({
  name: "getTokenHolders",
  description: "Retrieve token holders and their balances for a given token.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address"),
    page: z.number().optional(),
    offset: z.number().optional(),
  }),
  execute: async (_, args) => {
    const { chain, tokenContract, page, offset } = args;
    const query: Record<string, string> = {
      module: "token",
      action: "getTokenHolders",
      contractaddress: tokenContract,
    };
    if (page !== undefined) query.page = String(page);
    if (offset !== undefined) query.offset = String(offset);
    const result = await fetchFromBlockscout(chain, query);
    return result;
  },
});

// 24. getTokenSupply
export const getTokenSupply = createTool({
  name: "getTokenSupply",
  description: "Get the total supply of an ERC-20 or ERC-721 token.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
    tokenContract: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token contract address"),
  }),
  execute: async (_, args) => {
    const { chain, tokenContract } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "stats",
      action: "tokensupply",
      contractaddress: tokenContract,
    });
    return result;
  },
});

// 25. getNativeSupply
export const getNativeSupply = createTool({
  name: "getNativeSupply",
  description: "Get the total native coin supply from the explorer's database.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
  }),
  execute: async (_, args) => {
    const { chain } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "stats",
      action: "ethsupply",
    });
    return result;
  },
});

// 26. getNativePrice
export const getNativePrice = createTool({
  name: "getNativePrice",
  description: "Fetch the latest price of the native coin in USD and BTC.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
  }),
  execute: async (_, args) => {
    const { chain } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "stats",
      action: "ethprice",
    });
    return result;
  },
});

// 27. getTotalFees
export const getTotalFees = createTool({
  name: "getTotalFees",
  description: "Retrieve the total transaction fees paid on the network.",
  supportedChains: popularChains,
  parameters: z.object({
    chain: z.number().describe("Chain for getting data on"),
  }),
  execute: async (_, args) => {
    const { chain } = args;
    const result = await fetchFromBlockscout(chain, {
      module: "stats",
      action: "totalfees",
    });
    return result;
  },
});
