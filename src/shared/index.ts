import { transferTools } from "./transfer";
import { ensTools } from "./ens";
import { dexscreenerTools } from "./dexscreener";
import { rpcTools } from "./rpc";
import { uniV3Tools } from "./uniV3";
import { wethTools } from "./weth";
import { naniTools } from "./nani";
import { erc20Tools } from "./erc20";
import { searchTools } from "./search";
import { swapTools } from "./swap";
import { blockscoutTools } from "./blockscout";
import { tallyTools } from "./tally";
import { aaveTools } from "./aave";
import { securityTools } from "./security";
import { webTools } from "./web";
import { coindeskTools } from "./coindesk";
import { fearGreedIndexTools } from "./feargreed";
import { createCoinMarketCalTools } from "./coinmarketcal";

const allTools = ({
  perplexityApiKey,
  zeroxApiKey,
  tallyApiKey,
  coindeskApiKey,
  coinMarketCalApiKey,
}: {
  perplexityApiKey?: string;
  zeroxApiKey?: string;
  tallyApiKey?: string;
  coindeskApiKey?: string;
  coinMarketCalApiKey?: string;
}) => {
  let tools = [
    ...ensTools(),
    ...erc20Tools(),
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

  return tools;
};

export { allTools };
