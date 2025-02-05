import { transferTools } from "./transfer";
import { ensTools } from "./ens";
import { dexscreenerTools } from "./dexscreener";
import { rpcTools } from "./rpc";
import { uniV3Tools } from "./uniV3";
import { wethTools } from "./weth";
import { naniTools } from "./nani";
import { erc20Tools } from "./erc20";
import { searchTools } from "./search";

const allTools = ({ perplexityApiKey }: { perplexityApiKey?: string }) => {
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

  return tools;
};

export { allTools };
