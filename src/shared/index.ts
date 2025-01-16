import { transferTools } from "./transfer";
import { ensTools } from "./ens";

const allTools = () => {
  return [...ensTools(), ...transferTools()];
};
export { allTools };
