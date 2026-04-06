import {
  mainnet,
  arbitrum,
  base,
  optimism,
  polygon,
} from "viem/chains";
import type { Address } from "viem";

export const resolveTokenChains = [mainnet, arbitrum, base, optimism, polygon];

type TokenEntry = {
  address: Address;
  decimals: number;
  name: string;
};

type TokenMap = Record<number, TokenEntry>;

/**
 * Well-known tokens indexed by upper-cased symbol, then by chainId.
 *
 * Only tokens that are widely referenced in LLM tool-calling flows are
 * included here. The list is intentionally small so the mapping stays
 * accurate and easy to audit.
 */
export const TOKEN_REGISTRY: Record<string, TokenMap> = {
  USDC: {
    [mainnet.id]: { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, name: "USD Coin" },
    [arbitrum.id]: { address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6, name: "USD Coin" },
    [base.id]: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6, name: "USD Coin" },
    [optimism.id]: { address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6, name: "USD Coin" },
    [polygon.id]: { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6, name: "USD Coin" },
  },
  USDT: {
    [mainnet.id]: { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6, name: "Tether USD" },
    [arbitrum.id]: { address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6, name: "Tether USD" },
    [base.id]: { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6, name: "Tether USD" },
    [optimism.id]: { address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6, name: "Tether USD" },
    [polygon.id]: { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6, name: "Tether USD" },
  },
  DAI: {
    [mainnet.id]: { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, name: "Dai Stablecoin" },
    [arbitrum.id]: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, name: "Dai Stablecoin" },
    [base.id]: { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, name: "Dai Stablecoin" },
    [optimism.id]: { address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, name: "Dai Stablecoin" },
    [polygon.id]: { address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, name: "Dai Stablecoin" },
  },
  WETH: {
    [mainnet.id]: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, name: "Wrapped Ether" },
    [arbitrum.id]: { address: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", decimals: 18, name: "Wrapped Ether" },
    [base.id]: { address: "0x4200000000000000000000000000000000000006", decimals: 18, name: "Wrapped Ether" },
    [optimism.id]: { address: "0x4200000000000000000000000000000000000006", decimals: 18, name: "Wrapped Ether" },
    [polygon.id]: { address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619", decimals: 18, name: "Wrapped Ether" },
  },
  WBTC: {
    [mainnet.id]: { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8, name: "Wrapped BTC" },
    [arbitrum.id]: { address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8, name: "Wrapped BTC" },
    [base.id]: { address: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", decimals: 8, name: "Wrapped BTC" },
    [optimism.id]: { address: "0x68f180fcCe6836688e9084f035309E29Bf0A2095", decimals: 8, name: "Wrapped BTC" },
  },
  LINK: {
    [mainnet.id]: { address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, name: "ChainLink Token" },
    [arbitrum.id]: { address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18, name: "ChainLink Token" },
    [base.id]: { address: "0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196", decimals: 18, name: "ChainLink Token" },
    [optimism.id]: { address: "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6", decimals: 18, name: "ChainLink Token" },
  },
  UNI: {
    [mainnet.id]: { address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18, name: "Uniswap" },
    [arbitrum.id]: { address: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", decimals: 18, name: "Uniswap" },
    [optimism.id]: { address: "0x6fd9d7AD17242c41f7131d257212c54A0e816691", decimals: 18, name: "Uniswap" },
  },
  AAVE: {
    [mainnet.id]: { address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, name: "Aave Token" },
    [arbitrum.id]: { address: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196", decimals: 18, name: "Aave Token" },
    [optimism.id]: { address: "0x76FB31fb4af56892A25e32cFC43De717950c9278", decimals: 18, name: "Aave Token" },
  },
  cbBTC: {
    [mainnet.id]: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, name: "Coinbase Wrapped BTC" },
    [base.id]: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, name: "Coinbase Wrapped BTC" },
  },
  cbETH: {
    [mainnet.id]: { address: "0xBe9895146f7AF43049ca1c1AE358B0541Ea49704", decimals: 18, name: "Coinbase Wrapped Staked ETH" },
    [base.id]: { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", decimals: 18, name: "Coinbase Wrapped Staked ETH" },
    [optimism.id]: { address: "0xadDb6A0412DE1BA0F936DCaeb8Aaa24578dcF3B2", decimals: 18, name: "Coinbase Wrapped Staked ETH" },
  },
  stETH: {
    [mainnet.id]: { address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", decimals: 18, name: "Lido Staked Ether" },
  },
  wstETH: {
    [mainnet.id]: { address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", decimals: 18, name: "Wrapped liquid staked Ether 2.0" },
    [arbitrum.id]: { address: "0x5979D7b546E38E9Ab8304709A1645468b2494aA4", decimals: 18, name: "Wrapped liquid staked Ether 2.0" },
    [base.id]: { address: "0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452", decimals: 18, name: "Wrapped liquid staked Ether 2.0" },
    [optimism.id]: { address: "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb", decimals: 18, name: "Wrapped liquid staked Ether 2.0" },
  },
  rETH: {
    [mainnet.id]: { address: "0xae78736Cd615f374D3085123A210448E74Fc6393", decimals: 18, name: "Rocket Pool ETH" },
    [arbitrum.id]: { address: "0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8", decimals: 18, name: "Rocket Pool ETH" },
    [base.id]: { address: "0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c", decimals: 18, name: "Rocket Pool ETH" },
    [optimism.id]: { address: "0x9Bcef72be871e61ED4fBbc7630889beE758eb81D", decimals: 18, name: "Rocket Pool ETH" },
  },
  GRT: {
    [mainnet.id]: { address: "0xc944E90C64B2c07662A292be6244BDf05Cda44a7", decimals: 18, name: "Graph Token" },
    [arbitrum.id]: { address: "0x9623063377AD1B27544C965cCd7342f7EA7e88C7", decimals: 18, name: "Graph Token" },
  },
  ARB: {
    [arbitrum.id]: { address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, name: "Arbitrum" },
  },
  OP: {
    [optimism.id]: { address: "0x4200000000000000000000000000000000000042", decimals: 18, name: "Optimism" },
  },
  MATIC: {
    [polygon.id]: { address: "0x0000000000000000000000000000000000001010", decimals: 18, name: "Polygon" },
  },
  POL: {
    [mainnet.id]: { address: "0x455e53CBB86018Ac2B8092FdCd39d8444aFFC3F6", decimals: 18, name: "Polygon Ecosystem Token" },
    [polygon.id]: { address: "0x0000000000000000000000000000000000001010", decimals: 18, name: "Polygon Ecosystem Token" },
  },
};

/**
 * Map CoinGecko platform IDs to viem chain IDs.
 */
export const COINGECKO_PLATFORM_TO_CHAIN: Record<string, number> = {
  ethereum: mainnet.id,
  "arbitrum-one": arbitrum.id,
  base: base.id,
  "optimistic-ethereum": optimism.id,
  "polygon-pos": polygon.id,
};

export const CHAIN_TO_COINGECKO_PLATFORM: Record<number, string> = Object.fromEntries(
  Object.entries(COINGECKO_PLATFORM_TO_CHAIN).map(([k, v]) => [v, k]),
);
