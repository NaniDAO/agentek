import { mainnet, polygon, arbitrum, optimism, base } from "viem/chains";

export const supportedChains = [mainnet, polygon, arbitrum, optimism, base];

export const aavePoolAbi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "asset",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "onBehalfOf",
        type: "address",
      },
      {
        internalType: "uint16",
        name: "referralCode",
        type: "uint16",
      },
    ],
    name: "supply",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "asset",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "onBehalfOf",
        type: "address",
      },
      {
        internalType: "uint16",
        name: "referralCode",
        type: "uint16",
      },
    ],
    name: "borrow",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export const getAavePoolAddress = (chainId: number): string => {
  switch (chainId) {
    case mainnet.id: // Ethereum mainnet
      return "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2";
    case polygon.id: // Polygon
      return "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
    case arbitrum.id: // Arbitrum
      return "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
    case optimism.id: // Optimism
      return "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
    case base.id: // Base
      return "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
    default:
      throw new Error(`Aave pool not supported on chain ${chainId}`);
  }
};
