export { allCredentialOrigins as credentialOrigins } from "../shared/credentialTools/origins.js";
import { aaveTools } from "../shared/aave/index.js";
import { uniV3Tools } from "../shared/uniV3/index.js";
import { thinkTools } from "../shared/think/index.js";
import { zrouterTools } from "../shared/zrouter/index.js";
import { approvalTools } from "../shared/approvals/index.js";
import { macosToolNames } from "./profiles.js";
import { ensTools } from "../shared/ens/index.js";
import { erc20Tools } from "../shared/erc20/index.js";
import { rpcTools } from "../shared/rpc/index.js";
import { transferTools } from "../shared/transfer/index.js";
import { blockscoutTools } from "../shared/blockscout/index.js";
import { acrossTools } from "../shared/across/index.js";
import { wethTools } from "../shared/weth/index.js";
import { naniTools } from "../shared/nani/index.js";
import { securityTools } from "../shared/security/index.js";
import { webPageExtractor, webPageResult } from "../shared/web/page.js";
import { fearGreedIndexTools } from "../shared/feargreed/index.js";
import { nftTools } from "../shared/erc721/index.js";
import { cryptoPriceTools } from "../shared/cryptoprices/index.js";
import { gasEstimatorTools } from "../shared/gasestimator/index.js";
import { defillamaTools } from "../shared/defillama/index.js";
import { dexscreenerTools } from "../shared/dexscreener/index.js";
import { zammTools } from "../shared/zamm/index.js";
import { wnsTools } from "../shared/wns/index.js";
import { resolveTokenTools } from "../shared/resolveToken/index.js";
import { contractTools } from "../shared/contract/index.js";
import { researchCATools } from "../shared/researchCA/index.js";
import type { BaseTool } from "../shared/client.js";

export const embeddedProfile = "macos";
export function embeddedTools(enabledCredentials: string[] = [], _platform?: string): BaseTool[] {
  return [
    ...ensTools(), ...erc20Tools(), ...rpcTools(), ...transferTools(),
    ...blockscoutTools(), ...aaveTools(), ...acrossTools(), ...uniV3Tools(),
    ...wethTools(), ...naniTools(), ...securityTools(), webPageExtractor, webPageResult,
    ...fearGreedIndexTools(), ...nftTools(), ...cryptoPriceTools(),
    ...gasEstimatorTools(), ...defillamaTools(), ...dexscreenerTools(),
    ...thinkTools(), ...zammTools(), ...zrouterTools(), ...wnsTools(),
    ...resolveTokenTools(), ...approvalTools(), ...contractTools(), ...researchCATools(),
  ].filter(tool => macosToolNames.has(tool.name));
}
