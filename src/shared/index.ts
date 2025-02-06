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

const allTools = ({
  perplexityApiKey,
  zeroxApiKey,
}: {
  perplexityApiKey?: string;
  zeroxApiKey?: string;
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
  ];

  if (perplexityApiKey) {
    tools.push(...searchTools({ perplexityApiKey }));
  }

  if (zeroxApiKey) {
    tools.push(...swapTools({ zeroxApiKey }));
  }

  return tools;
};

export { allTools };
