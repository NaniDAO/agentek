import { transferTools } from "./transfer";
import { ensTools } from "./ens";
import { dexscreenerTools } from "./dexscreener";
import { rpcTools } from "./rpc";
import { uniV3Tools } from "./uniV3";
import { wethTools } from "./weth";
import { naniTools } from "./nani";

const allTools = () => {
  return [
    ...ensTools(),
    ...transferTools(),
    ...dexscreenerTools(),
    ...rpcTools(),
    ...uniV3Tools(),
    ...wethTools(),
    ...naniTools(),
  ];
};

export { allTools };
