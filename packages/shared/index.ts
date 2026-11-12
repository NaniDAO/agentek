import type { BaseTool } from "./client.js";
import { transferTools } from "./transfer/index.js";
import { ensTools } from "./ens/index.js";
import { dexscreenerTools } from "./dexscreener/index.js";
import { rpcTools } from "./rpc/index.js";
import { uniV3Tools } from "./uniV3/index.js";
import { wethTools } from "./weth/index.js";
import { naniTools } from "./nani/index.js";
import { erc20Tools } from "./erc20/index.js";
import { searchTools } from "./search/index.js";
import { swapTools } from "./swap/index.js";
import { blockscoutTools } from "./blockscout/index.js";
import { tallyTools } from "./tally/index.js";
import { aaveTools } from "./aave/index.js";
import { securityTools } from "./security/index.js";
import { coindeskTools } from "./coindesk/index.js";
import { fearGreedIndexTools } from "./feargreed/index.js";
import { createCoinMarketCalTools } from "./coinmarketcal/index.js";
import { slowTransferTools } from "./slowTransfer/index.js";
import { nftTools } from "./erc721/index.js";
import { cryptoPriceTools } from "./cryptoprices/index.js";
import { gasEstimatorTools } from "./gasestimator/index.js";
import { defillamaTools } from "./defillama/index.js";
import { acrossTools } from "./across/index.js";
import { thinkTools } from "./think/index.js";
import { btcRpcTools } from "./btc-rpc/index.js";
import { erc6909Tools } from "./erc6909/index.js";
import { createImageGenTools } from './imagegen/index.js';
import { coinchanTools } from "./coinchan/index.js";
import { zammTools } from "./zamm/index.js";
import { zrouterTools } from "./zrouter/index.js";
import { wnsTools } from "./wns/index.js";
import { resolveTokenTools } from "./resolveToken/index.js";
import { approvalTools } from "./approvals/index.js";
import { contractTools } from "./contract/index.js";
import { researchCATools } from "./researchCA/index.js";
import { assertOkResponse } from "./utils/fetch.js";
import {
  DEFAULT_CHAINS,
  resolveRpcUrl,
  resolveTransports,
  parseRpcUrlsEnv,
} from "./chains/config.js";

import { webPageExtractor, webPageResult } from "./web/page.js";

const allTools = async ({
  perplexityApiKey,
  zeroxApiKey,
  tallyApiKey,
  coindeskApiKey,
  coinMarketCalApiKey,
  fireworksApiKey,
  pinataJWT,
  additionalTools = [],
}: {
  perplexityApiKey?: string;
  zeroxApiKey?: string;
  tallyApiKey?: string;
  coindeskApiKey?: string;
  coinMarketCalApiKey?: string;
  fireworksApiKey?: string;
  pinataJWT?: string;
  /** Explicitly imported optional integrations. Core never loads them implicitly. */
  additionalTools?: readonly BaseTool[];
}) => {
  let tools = [
    ...ensTools(),
    ...erc20Tools(),
    ...acrossTools(),
    ...transferTools(),
    ...dexscreenerTools(),
    ...rpcTools(),
    ...uniV3Tools(),
    ...wethTools(),
    ...naniTools(),
    ...blockscoutTools(),
    ...aaveTools(),
    ...securityTools(),
    webPageExtractor, webPageResult,
    ...fearGreedIndexTools(),
    ...slowTransferTools(),
    ...nftTools(),
    ...cryptoPriceTools(),
    ...gasEstimatorTools(),
    ...defillamaTools(),
    ...btcRpcTools(),
    ...erc6909Tools(),
    ...coinchanTools(),
    ...zammTools(),
    ...zrouterTools(),
    ...wnsTools(),
    ...resolveTokenTools(),
    ...approvalTools(),
    ...contractTools(),
    ...researchCATools(),
  ];

  if (perplexityApiKey) {
    tools.push(...searchTools({ perplexityApiKey }));
  }

  tools.push(...swapTools({}));

  if (tallyApiKey) {
    tools.push(
      ...tallyTools({
        tallyApiKey,
      }),
    );
  }

  if (coindeskApiKey) {
    tools.push(...coindeskTools({ coindeskApiKey }));
  }

  if (coinMarketCalApiKey) {
    tools.push(...createCoinMarketCalTools({ coinMarketCalApiKey }));
  }

  if (fireworksApiKey && pinataJWT) {
    tools.push(...createImageGenTools({
      fireworksApiKey,
      pinataJWT,
    }))
  }

  tools.push(...additionalTools);

  return tools;
};

export {
  allTools,

  // Exporting all tool collections for easier composition
  transferTools,
  ensTools,
  dexscreenerTools,
  rpcTools,
  uniV3Tools,
  wethTools,
  naniTools,
  erc20Tools,
  searchTools,
  swapTools,
  blockscoutTools,
  tallyTools,
  aaveTools,
  securityTools,
  coindeskTools,
  fearGreedIndexTools,
  createCoinMarketCalTools,
  slowTransferTools,
  nftTools,
  cryptoPriceTools,
  gasEstimatorTools,
  defillamaTools,
  acrossTools,
  thinkTools,
  btcRpcTools,
  erc6909Tools,
  createImageGenTools,
  coinchanTools,
  zammTools,
  zrouterTools,
  wnsTools,
  resolveTokenTools,
  approvalTools,
  contractTools,
  researchCATools,
  assertOkResponse,

  // Chain/RPC configuration shared by the CLI, the MCP server and tests
  DEFAULT_CHAINS,
  resolveRpcUrl,
  resolveTransports,
  parseRpcUrlsEnv,
};

export { getNativeSwapProposal, buildNativeSwapProposal, swapRequestSchema, validateSwapCall, validateSwapOps } from "./zrouter/proposal.js";
export type { SwapRequest } from "./zrouter/proposal.js";
export { observeWalletAsset, observeAsset } from "./erc20/observations.js";
export { observeGuardianQueue, queueStateSchema } from "./nani/queue.js";
export { dnsEncode, readENSBytes, validateENSName } from "./ens/bounds.js";
