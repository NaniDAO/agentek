import { ensTools } from "../shared/ens/index.js";
import { erc20Tools } from "../shared/erc20/index.js";
import { rpcTools } from "../shared/rpc/index.js";
import { transferTools } from "../shared/transfer/index.js";
import { blockscoutTools } from "../shared/blockscout/index.js";
import { getAaveReserveData } from "../shared/aave/tools.js";
import { acrossTools } from "../shared/across/index.js";
import { getUniV3Pool, getPoolFeeData } from "../shared/uniV3/tools.js";
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
import { getQuote } from "../shared/zrouter/tools.js";
import { getNativeSwapProposal } from "../shared/zrouter/proposal.js";
import { wnsTools } from "../shared/wns/index.js";
import { resolveTokenTools } from "../shared/resolveToken/index.js";
import { discoverTokenPermissionsTool } from "../shared/approvals/discovery.js";
import { observeTokenPermissionTool, observeNFTOperatorTool, planSelectedRevocationsTool } from "../shared/approvals/observations.js";
import { contractTools } from "../shared/contract/index.js";
import { bitcoinReadOnlyTools } from "../shared/readonlyChains/bitcoin.js";
import { researchCATools } from "../shared/researchCA/index.js";
import type { BaseTool } from "../shared/client.js";

export function iphoneCoreTools(): BaseTool[] {
  return [
    ...ensTools(), ...erc20Tools(), ...rpcTools(), ...transferTools(),
    ...blockscoutTools(), getAaveReserveData, ...acrossTools(), getUniV3Pool, getPoolFeeData,
    ...wethTools(), ...naniTools(), ...securityTools(), webPageExtractor, webPageResult,
    ...fearGreedIndexTools(), ...nftTools(), ...cryptoPriceTools(),
    ...gasEstimatorTools(), ...defillamaTools(), ...dexscreenerTools(),
    ...zammTools(), getQuote, getNativeSwapProposal, ...wnsTools(),
    ...resolveTokenTools(), discoverTokenPermissionsTool, observeTokenPermissionTool, observeNFTOperatorTool, planSelectedRevocationsTool, ...contractTools(),
    ...researchCATools(),
    ...bitcoinReadOnlyTools(),
  ];
}
