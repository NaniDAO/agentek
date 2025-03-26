# agentek

![agentek-logo-1](https://github.com/user-attachments/assets/c73ccd7b-4c4e-4c90-8ccc-1ed101fa1b0b)

An extensible TypeScript toolkit that simplifies complex EVM blockchain interactions into composable, intent-based tools. Provides a unified, type-safe interface for both on-chain actions and off-chain data services, enabling developers to programmatically execute any blockchain operation across multiple EVM networks.

Interested in contributing? Check out our [CONTRIBUTING.md](CONTRIBUTING.md) guide!

## Packages

The Agentek toolkit is structured as a monorepo with multiple publishable packages:

- `@agentek/tools` - The main package containing all tools
- `@agentek/ai-sdk` - AI SDK integration for Vercel AI SDK
- `@agentek/mcp-server` - Model Context Protocol server
-
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
import { createAgentekClient, allTools } from '@agentek/tools';
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
import { createAgentekClient, allTools } from '@agentek/tools';
import { AgentekToolkit } from '@agentek/ai-sdk';
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

## Tools (113 total)

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
11. getAcrossFeeQuote
12. intentDepositAcross
13. intentTransfer
14. intentTransferFrom
15. getLatestTokens
16. getBalance
17. getCode
18. getTransactionCount
19. getBlock
20. getBlockNumber
21. getGasPrice
22. estimateGas
23. getFeeHistory
24. getTransaction
25. getTransactionReceipt
26. getUniV3Pool
27. getUserPositions
28. getPoolFeeData
29. getPositionDetails
30. intentMintPosition
31. intentIncreaseLiquidity
32. intentDecreaseLiquidity
33. intentCollectFees
34. intentTransferPosition
35. depositWETH
36. withdrawWETH
37. getNaniProposals
38. intentStakeNani
39. intentUnstakeNani
40. intentProposeNani
41. intentVoteNaniProposal
42. getNativeCoinHolders
43. getAddressInfo
44. getAddressCounters
45. getAddressTransactions
46. getAddressTokenTransfers
47. getAddressInternalTransactions
48. getAddressLogs
49. getAddressBlocksValidated
50. getAddressTokenBalances
51. getAddressTokens
52. getAddressCoinBalanceHistory
53. getAddressCoinBalanceHistoryByDay
54. getAddressWithdrawals
55. getAddressNFTs
56. getAddressNFTCollections
57. getBlockInfo
58. getBlockTransactions
59. getBlockWithdrawals
60. getStats
61. getTransactionsChart
62. getTransactionInfo
63. getTransactionTokenTransfers
64. getTransactionInternalTransactions
65. getTransactionLogs
66. getTransactionRawTrace
67. getTransactionStateChanges
68. getTransactionSummary
69. getSmartContracts
70. getSmartContract
71. getTokenInfo
72. getTokenHolders
73. getTokenTransfers
74. getBlockscoutSearch
75. getAaveUserData
76. getAaveReserveData
77. intentAaveDeposit
78. intentAaveWithdraw
79. intentAaveBorrow
80. intentAaveRepay
81. checkMaliciousAddress
82. checkMaliciousWebsite
83. scrapeWebContent
84. getFearAndGreedIndex
85. getSlowStatus
86. predictTransferId
87. canUnlockSlow
88. getCanReverseSlowTransfer
89. getSlowGuardianInfo
90. getSlowTransferApprovalRequired
91. intentDepositToSlow
92. intentSetSlowGuardian
93. intentWithdrawFromSlow
94. intentApproveSlowTransfer
95. intentUnlockSlow
96. intentReverseSlowTransfer
97. getNFTMetadata
98. getCryptoPrice
99. estimateGasCost
100. getTokenChart
101. getYieldTool
102. compareYieldTool
103. getYieldHistoryTool
104. compareYieldHistoryTool
105. askPerplexitySearch
106. intent0xSwap
107. tallyProposals
108. tallyChains
109. tallyUserDaos
110. intentGovernorVote
111. intentGovernorVoteWithReason
112. getLatestCoindeskNewsTool
113. getMarketEvents
