import { mainnet, base } from "viem/chains";

export const supportedChains = [mainnet, base];
export const enum SwapSide {
  "EXACT_IN",
  "EXACT_OUT"
}

/**
 * Route API. The Railway deployment this used to point at now answers 404
 * "Application not found" for every request.
 *
 * That failure was invisible: `fetchApiRoutes` swallows a non-OK response and
 * returns null, so every swap silently fell through to the on-chain SDK
 * `findRoute` — losing Matcha/0x aggregation, and failing outright for pairs
 * the SDK can't route on its own. A dead URL looked like "no route found".
 *
 * Overridable so a future move doesn't need a rebuild of the bundled tools.
 */
export const ZROUTER_API_URL =
  (typeof process !== "undefined" ? process.env?.ZROUTER_API_URL : undefined) ??
  "https://zrouter-api.onrender.com";
