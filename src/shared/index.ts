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
import { securityTools } from "./security";
import { webTools } from "./web";
import { coindeskTools } from "./coindesk";
import { fearGreedIndexTools } from "./feargreed";

const allTools = ({
  perplexityApiKey,
  zeroxApiKey,
  tallyApiKey,
  coindeskApiKey,
}: {
  perplexityApiKey?: string;
  zeroxApiKey?: string;
  tallyApiKey?: string;
  coindeskApiKey?: string;
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

  return tools;
};

export { allTools };
