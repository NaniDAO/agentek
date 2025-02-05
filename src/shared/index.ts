import { transferTools } from "./transfer";
import { ensTools } from "./ens";
import { dexscreenerTools } from "./dexscreener";
import { rpcTools } from "./rpc";
import { uniV3Tools } from "./uniV3";
import { wethTools } from "./weth";
import { naniTools } from "./nani";
import { erc20Tools } from "./erc20";
import { erc721Tools } from "./erc721";

const allTools = () => {
  return [
    ...ensTools(),
    ...erc20Tools(),
    ...transferTools(),
    ...erc721Tools(),
    ...dexscreenerTools(),
    ...rpcTools(),
    ...uniV3Tools(),
    ...wethTools(),
    ...naniTools(),
  ];
};

export { allTools };
