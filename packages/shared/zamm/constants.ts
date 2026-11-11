import { providerJSON } from "../utils/fetch.js";

/** Trusted host override; endpoint details never appear in public failures. */
export const ZAMM_API =
  (typeof process !== "undefined" ? process.env?.ZAMM_API_URL : undefined) ??
  "https://coinchan-indexer-production.up.railway.app";
export const ZAMM_TIMEOUT_MS = 15_000;

export async function zammFetch(path: string): Promise<any> {
  const json = await providerJSON(`${ZAMM_API}${path}`, {}, "ZAMM indexer request failed", {timeoutMs: ZAMM_TIMEOUT_MS});
  if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error("Unreadable ZAMM indexer response");
  return json;
}

export async function zammGraphql(query: string, variables?: Record<string, unknown>): Promise<any> {
  if (query.length > 32_768 || JSON.stringify(variables ?? {}).length > 16_384) throw new Error("ZAMM query exceeds request budget");
  const json = await providerJSON(`${ZAMM_API}/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({query, ...(variables ? {variables} : {})}),
  }, "ZAMM GraphQL request failed", {timeoutMs: ZAMM_TIMEOUT_MS});
  if (!json || typeof json !== "object" || Array.isArray(json) || (Object.hasOwn(json, "errors") && (!Array.isArray(json.errors) || json.errors.length > 0)) || !json.data || typeof json.data !== "object" || Array.isArray(json.data)) {
    throw new Error("Unreadable or unsuccessful ZAMM GraphQL response");
  }
  return json.data;
}

export const isCoinchanCoin = (coinId: bigint) => {
  return coinId < 1000000n;
}
