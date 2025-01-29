import { mainnet, optimism, arbitrum, polygon, base } from "viem/chains";

export const supportedChains = [mainnet, optimism, arbitrum, polygon, base];

export const WETH_ADDRESS = {
  [mainnet.id]: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  [optimism.id]: "0x4200000000000000000000000000000000000006",
  [arbitrum.id]: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  [polygon.id]: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  [base.id]: "0x4200000000000000000000000000000000000006",
} as const;

export const wethAbi = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    outputs: [],
    inputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    outputs: [],
    inputs: [
      {
        name: "_amount",
        type: "uint256",
      },
    ],
  },
];
