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
