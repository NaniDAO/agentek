// These files contain real RPC/API calls, sometimes alongside local assertions.
// Keep them visible in test:live rather than treating service outages as unit failures.
export const liveFiles = [
  "packages/shared/approvals/tools.test.ts",
  "packages/shared/blockscout/tools.test.ts",
  "packages/shared/contract/tools.test.ts",
  "packages/shared/cryptoprices/tools.test.ts",
  "packages/shared/defillama/tools.test.ts",
  "packages/shared/dexscreener/tools.test.ts",
  "packages/shared/ens/tools.test.ts",
  "packages/shared/erc20/intents.test.ts",
  "packages/shared/erc20/tools.test.ts",
  "packages/shared/erc721/tools.test.ts",
  "packages/shared/resolveToken/tools.test.ts",
  "packages/shared/rpc/intents.test.ts",
  "packages/shared/rpc/tools.test.ts",
  "packages/shared/solana/signing.test.ts",
  "packages/shared/solana/tools.test.ts",
  "packages/shared/twitter/tools.test.ts",
  "packages/shared/weth/tools.test.ts",
];
