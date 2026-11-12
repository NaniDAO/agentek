export { allCredentialOrigins as credentialOrigins } from "../shared/credentialTools/origins.js";
import type { BaseTool } from "../shared/client.js";
import { rpcTools } from "../shared/rpc/index.js";
import { erc20Tools } from "../shared/erc20/index.js";
import { transferTools } from "../shared/transfer/index.js";

/** Small opt-in profile: balances, RPC reads, ERC20 and transfer preparation.
 * App-specific profiles can follow this pattern and import only their tools.
 */
export const embeddedProfile = "minimal";
export function embeddedTools(_enabled: string[] = [], _platform?: string): BaseTool[] {
  return [...rpcTools(), ...erc20Tools(), ...transferTools()];
}
