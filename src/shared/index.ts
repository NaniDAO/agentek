import { transferTools } from "./transfer";
import { ensTools } from "./ens";
import { dexscreenerTools } from "./dexscreener";

const allTools = () => {
  return [...ensTools(), ...transferTools(), ...dexscreenerTools()];
};

export { allTools };
