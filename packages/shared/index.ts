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
import { webTools } from "./web/index.js";
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

const allTools = ({
  perplexityApiKey,
  zeroxApiKey,
  tallyApiKey,
  coindeskApiKey,
  coinMarketCalApiKey,
  fireworksApiKey,
  pinataJWT,
}: {
  perplexityApiKey?: string;
  zeroxApiKey?: string;
  tallyApiKey?: string;
  coindeskApiKey?: string;
  coinMarketCalApiKey?: string;
  fireworksApiKey?: string;
  pinataJWT?: string;
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
    ...webTools(),
    ...fearGreedIndexTools(),
    ...slowTransferTools(),
    ...nftTools(),
    ...cryptoPriceTools(),
    ...gasEstimatorTools(),
    ...defillamaTools(),
    ...thinkTools(),
    ...btcRpcTools(),
    ...erc6909Tools(),
    ...coinchanTools(),
    ...zammTools(),
  ];

  if (perplexityApiKey) {
    tools.push(...searchTools({ perplexityApiKey }));
  }

  if (zeroxApiKey) {
    tools.push(...swapTools({ zeroxApiKey }));
  }

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
  webTools,
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
};
