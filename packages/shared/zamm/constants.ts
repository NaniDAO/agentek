export const ZAMM_API = "https://coinchan-indexer-production.up.railway.app";

export const isCoinchanCoin = (coinId: bigint) => {
  return coinId < 1000000n;
}
