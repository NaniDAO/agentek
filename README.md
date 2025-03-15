# agentek

![agentek-logo-1](https://github.com/user-attachments/assets/c73ccd7b-4c4e-4c90-8ccc-1ed101fa1b0b)

An extensible TypeScript toolkit that simplifies complex EVM blockchain interactions into composable, intent-based tools. Provides a unified, type-safe interface for both on-chain actions and off-chain data services, enabling developers to programmatically execute any blockchain operation across multiple EVM networks.

Interested in contributing? Check out our [CONTRIBUTING.md](CONTRIBUTING.md) guide!

## Packages

The Agentek toolkit is structured as a monorepo with multiple publishable packages:

- `agentek` - The main package containing all tools
- `agentek-ai` - AI SDK integration for Vercel AI SDK
- `agentek-mcp-server` - Model Context Protocol server
- Individual tool packages:
  - `agentek-erc20` - ERC20 token tools
  - `agentek-ens` - ENS tools
  - `agentek-nani` - NaniDAO tools
  - `agentek-aave` - Aave tools
  - `agentek-transfer` - Transfer tools
  - `agentek-security` - Security tools
  - `agentek-uni-v3` - Uniswap V3 tools
  - `agentek-weth` - WETH tools
  - `agentek-tally` - Tally tools

## Requirements

- Node.js >= 18.0.0
- npm, yarn, or pnpm

## Installation

You can install the entire toolkit:

```bash
npm install @agentek/tools
```

AI SDK:

```bash
npm install @agentek/ai-sdk
```

## Usage

### Using the full toolkit

```typescript
import { createAgentekClient, allTools } from 'agentek';
import { http } from 'viem';
import { mainnet } from 'viem/chains';

const client = createAgentekClient({
  accountOrAddress: '0x...',
  chains: [mainnet],
  transports: [http()],
  tools: allTools({})
});

// Execute a tool
const result = await client.execute('getERC20BalanceTool', {
  address: '0x...',
  tokenAddress: '0x...'
});
```

### Using with AI SDK

```typescript
import { createAgentekClient, allTools } from 'agentek';
import { AgentekToolkit } from 'agentek-ai';
import { http } from 'viem';
import { mainnet } from 'viem/chains';

const toolkit = new AgentekToolkit({
  accountOrAddress: '0x...',
  chains: [mainnet],
  transports: [http()],
  tools: allTools({})
});

// Get tools for Vercel AI SDK
const aiTools = toolkit.getTools();
```

### Using the MCP Server

The MCP (Model Context Protocol) server allows you to expose Agentek tools to LLMs via the Model Context Protocol. For more information, see the [MCP Server README](/src/mcp/README.md)

pnpm run list

> agentek@0.1.0 list /Users/shiv/Projects/agentek
> bun run scripts/tool-count.ts

## Tools (111 total)

### Available Tools

1. resolveENS
2. lookupENS
3. getAllowance
4. getBalanceOf
5. getTotalSupply
6. getDecimals
7. getName
8. getSymbol
9. getTokenMetadata
10. intentApprove
11. intentTransfer
12. intentTransferFrom
13. getLatestTokens
14. getBalance
15. getCode
16. getTransactionCount
17. getBlock
18. getBlockNumber
19. getGasPrice
20. estimateGas
21. getFeeHistory
22. getTransaction
23. getTransactionReceipt
24. getUniV3Pool
25. getUserPositions
26. getPoolFeeData
27. getPositionDetails
28. intentMintPosition
29. intentIncreaseLiquidity
30. intentDecreaseLiquidity
31. intentCollectFees
32. intentTransferPosition
33. depositWETH
34. withdrawWETH
35. getNaniProposals
36. intentStakeNani
37. intentUnstakeNani
38. intentProposeNani
39. intentVoteNaniProposal
40. getNativeCoinHolders
41. getAddressInfo
42. getAddressCounters
43. getAddressTransactions
44. getAddressTokenTransfers
45. getAddressInternalTransactions
46. getAddressLogs
47. getAddressBlocksValidated
48. getAddressTokenBalances
49. getAddressTokens
50. getAddressCoinBalanceHistory
51. getAddressCoinBalanceHistoryByDay
52. getAddressWithdrawals
53. getAddressNFTs
54. getAddressNFTCollections
55. getBlockInfo
56. getBlockTransactions
57. getBlockWithdrawals
58. getStats
59. getMarketChart
60. getTransactionsChart
61. getTransactionInfo
62. getTransactionTokenTransfers
63. getTransactionInternalTransactions
64. getTransactionLogs
65. getTransactionRawTrace
66. getTransactionStateChanges
67. getTransactionSummary
68. getSmartContracts
69. getSmartContract
70. getTokenInfo
71. getTokenHolders
72. getTokenTransfers
73. getBlockscoutSearch
74. getAaveUserData
75. getAaveReserveData
76. intentAaveDeposit
77. intentAaveWithdraw
78. intentAaveBorrow
79. intentAaveRepay
80. checkMaliciousAddress
81. checkMaliciousWebsite
82. scrapeWebContent
83. getFearAndGreedIndex
84. getSlowStatus
85. predictTransferId
86. canUnlockSlow
87. getCanReverseSlowTransfer
88. getSlowGuardianInfo
89. getSlowTransferApprovalRequired
90. intentDepositToSlow
91. intentSetSlowGuardian
92. intentWithdrawFromSlow
93. intentApproveSlowTransfer
94. intentUnlockSlow
95. intentReverseSlowTransfer
96. getNFTMetadata
97. getCryptoPrice
98. estimateGasCost
99. getYieldTool
100. compareYieldTool
101. getYieldHistoryTool
102. compareYieldHistoryTool
103. askPerplexitySearch
104. intent0xSwap
105. tallyProposals
106. tallyChains
107. tallyUserDaos
108. intentGovernorVote
109. intentGovernorVoteWithReason
110. getLatestCoindeskNewsTool
111. getMarketEvents
