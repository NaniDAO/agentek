# Agentek TODO

## Response Compaction

- [x] `getAddressInternalTransactions` — Returns extremely large responses that cause downstream model context issues. Need to add pagination defaults or truncate/summarize the response to a reasonable size (e.g. return only the first N results with a `hasMore` flag).
- [x] `getAddressBlocksValidated` — Same issue, returns massive responses that overflow model context. Needs pagination/compaction.
- [x] `getBlock` — Returns full block data including all transactions, which is way too large for model context. Should return a compact summary (block number, timestamp, gas used, tx count) and omit the full transactions array by default.
- [x] `getAddressNFTCollections` — Returns massive responses for addresses with many NFT collections. Needs pagination/compaction.

## New Tools

- [x] `resolveToken` — Resolve a token symbol (e.g. 'USDC', 'DAI', 'WETH') to its contract address, decimals, and name on a specific chain. Currently mocked in nani-model training data generation. The model needs this to chain symbol→address lookups before calling tools like `getBalanceOf`, `intentApprove`, `intentTransfer`, etc. Should support all major tokens across Ethereum, Base, Arbitrum, and Optimism. Parameters: `symbol` (string), `chainId` (number). Returns: `{ symbol, chainId, address, decimals, name }`.

## Address Validation

- [x] ERC20 tools (`getBalanceOf`, `getAllowance`, etc.) reject addresses with incorrect EIP-55 checksums (e.g. `0x1DB3439a...` vs correct `0x1Db3439a...`) while RPC tools (`getBalance`) accept them fine. Should normalize addresses to lowercase or proper checksum before validation so mixed-case addresses don't fail.

## Chain Support

- [x] `intentTransfer` — Does not support Optimism (chainId 10). Returns "Chain 10 not supported by tool intentTransfer". Should add Optimism support to all intent tools since it's a supported chain in the system.

## Training Data / Tool Schema Mismatches (nani-model)

The following tools in `nani-model/scripts/tool-schemas.json` have interfaces that differ from the actual agentek implementations. Training data needs to be regenerated for these tools or the schemas updated.

### Parameter mismatches

- [ ] `getBlock` — Training data has `blockHash` (string) and `blockTag` (string, "latest"/"earliest"/"pending") parameters that do not exist in the actual tool. Actual tool only accepts `blockNumber` (number, optional) and `chainId` (number, required). Also, the actual tool now returns a compact summary (no `transactions` array, adds `transactionCount`) after the response compaction change, which training data responses don't reflect.

- [ ] `getAcrossFeeQuote` — Training data uses a single `token` parameter. Actual tool uses two separate parameters: `inputToken` (origin chain token address) and `outputToken` (destination chain token address). Training data is also missing the required `recipient` parameter.

- [ ] `intentDecreaseLiquidity` — Training data has `amount0Min` and `amount1Min` parameters (strings, both required). Actual tool uses `slippageTolerance` (number, optional, default 0.5) instead and computes min amounts internally. Training data required params `[tokenId, liquidity, amount0Min, amount1Min, chainId]` vs actual required `[tokenId, liquidity, chainId]`.

- [ ] `intentIncreaseLiquidity` — Training data has `amount0Min` and `amount1Min` parameters (strings). Actual tool uses `slippageTolerance` (number, optional, default 0.5) instead and computes min amounts internally.

- [ ] `intentTransferPosition` — Training data has a `from` parameter (string, required). Actual tool does not accept `from`; it infers the sender via `client.getAddress()`. Training data required params `[tokenId, from, to, chainId]` vs actual `[tokenId, to, chainId]`.

- [ ] `getYieldTool` — Training data is missing parameters that exist in the actual tool: `maxRisk` (enum: low/medium/high), `protocol` (enum of supported protocols), `asset` (string), and `chainId` (number). These are all optional but should be in the schema so the model can use them.

### Pagination parameters missing from training data

- [ ] `getAddressInternalTransactions` — Actual tool now has optional `next_page_params` (string) parameter for pagination. Training data schema does not include it.
- [ ] `getAddressBlocksValidated` — Same: actual tool now has `next_page_params` parameter.
- [ ] `getAddressNFTCollections` — Same: actual tool now has `next_page_params` parameter.

### Missing tool in training data

- [ ] `resolveToken` — The tool was just added to agentek but training data `tool-schemas.json` already has a schema for it. Verify the training examples actually exercise this tool (training data was likely generated with a mock — re-generate with the real tool to ensure response format matches).
