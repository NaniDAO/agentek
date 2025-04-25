import { Address } from "viem";
import { base, mainnet } from "viem/chains";

export const supportedChains = [mainnet, base];

export const CoinchanAbi = [
  { inputs: [], stateMutability: "payable", type: "constructor" },
  { inputs: [], name: "InvalidArrays", type: "error" },
  { inputs: [], name: "NothingToVest", type: "error" },
  { inputs: [], name: "Pending", type: "error" },
  { inputs: [], name: "Unauthorized", type: "error" },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "coinId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "address",
        name: "creator",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "liquidity",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "unlock",
        type: "uint256",
      },
      { indexed: false, internalType: "bool", name: "vesting", type: "bool" },
    ],
    name: "Locked",
    type: "event",
  },
  {
    inputs: [
      { internalType: "uint256", name: "coinId", type: "uint256" },
      { internalType: "address[]", name: "tos", type: "address[]" },
      { internalType: "uint256[]", name: "amounts", type: "uint256[]" },
      { internalType: "uint256", name: "sum", type: "uint256" },
    ],
    name: "airdrop",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "coinId", type: "uint256" }],
    name: "claimVested",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "coins",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "start", type: "uint256" },
      { internalType: "uint256", name: "finish", type: "uint256" },
    ],
    name: "getCoins",
    outputs: [{ internalType: "uint256[]", name: "", type: "uint256[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getCoinsCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "coinId", type: "uint256" }],
    name: "getVestableAmount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "coinId", type: "uint256" }],
    name: "lockups",
    outputs: [
      { internalType: "address", name: "owner", type: "address" },
      { internalType: "uint40", name: "creation", type: "uint40" },
      { internalType: "uint48", name: "unlock", type: "uint48" },
      { internalType: "bool", name: "vesting", type: "bool" },
      { internalType: "uint96", name: "swapFee", type: "uint96" },
      { internalType: "uint256", name: "claimed", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "name", type: "string" },
      { internalType: "string", name: "symbol", type: "string" },
      { internalType: "string", name: "tokenURI", type: "string" },
      { internalType: "uint256", name: "poolSupply", type: "uint256" },
      { internalType: "uint256", name: "ownerSupply", type: "uint256" },
      { internalType: "uint96", name: "swapFee", type: "uint96" },
      { internalType: "address", name: "owner", type: "address" },
    ],
    name: "make",
    outputs: [
      { internalType: "uint256", name: "coinId", type: "uint256" },
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "name", type: "string" },
      { internalType: "string", name: "symbol", type: "string" },
      { internalType: "string", name: "tokenURI", type: "string" },
      { internalType: "uint256", name: "poolSupply", type: "uint256" },
      { internalType: "uint256", name: "creatorSupply", type: "uint256" },
      { internalType: "uint96", name: "swapFee", type: "uint96" },
      { internalType: "address", name: "creator", type: "address" },
    ],
    name: "makeHold",
    outputs: [
      { internalType: "uint256", name: "coinId", type: "uint256" },
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "string", name: "name", type: "string" },
      { internalType: "string", name: "symbol", type: "string" },
      { internalType: "string", name: "tokenURI", type: "string" },
      { internalType: "uint256", name: "poolSupply", type: "uint256" },
      { internalType: "uint256", name: "creatorSupply", type: "uint256" },
      { internalType: "uint96", name: "swapFee", type: "uint96" },
      { internalType: "address", name: "creator", type: "address" },
      { internalType: "uint256", name: "_unlock", type: "uint256" },
      { internalType: "bool", name: "vesting", type: "bool" },
    ],
    name: "makeLocked",
    outputs: [
      { internalType: "uint256", name: "coinId", type: "uint256" },
      { internalType: "uint256", name: "amount0", type: "uint256" },
      { internalType: "uint256", name: "amount1", type: "uint256" },
      { internalType: "uint256", name: "liquidity", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes[]", name: "data", type: "bytes[]" }],
    name: "multicall",
    outputs: [{ internalType: "bytes[]", name: "results", type: "bytes[]" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;
export const CoinchanAddress =
  "0x00000000001018D31a8DAFC886363CfB0bF78768" as Address;
