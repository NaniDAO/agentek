import { transferTools } from "./transfer";
import { ensTools } from "./ens";
import { dexscreenerTools } from "./dexscreener";
import { rpcTools } from "./rpc";

const allTools = () => {
  return [
    ...ensTools(),
    ...transferTools(),
    ...dexscreenerTools(),
    ...rpcTools(),
  ];
};

export { allTools };
