import { mainnet } from "viem/chains";

export const supportedChains = [mainnet]
export const enum SwapSide {
  "EXACT_IN",
  "EXACT_OUT"
}

export const ZROUTER_API_URL = "https://zrouter-api-production.up.railway.app";
