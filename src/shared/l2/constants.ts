import {
  arbitrum,
  base,
  optimism,
} from "viem/chains";

export const supportedChains = [
  arbitrum,
  base,
  optimism,
];

// L2 bridge contract addresses
export const L2_BRIDGE_ADDRESSES = {
  // Optimism - Standard Bridge
  [optimism.id]: "0x4200000000000000000000000000000000000010",
  // Arbitrum - Standard Bridge
  [arbitrum.id]: "0x0000000000000000000000000000000000000064",
  // Base - Standard Bridge
  [base.id]: "0x4200000000000000000000000000000000000010",
};

// L1 bridge contract addresses (for withdrawals)
export const L1_BRIDGE_ADDRESSES = {
  // Optimism - Standard Bridge
  [optimism.id]: "0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1",
  // Arbitrum - Standard Bridge
  [arbitrum.id]: "0x8315177aB297bA92A06054cE80a67Ed4DBd7ed3a",
  // Base - Standard Bridge
  [base.id]: "0x3154Cf16ccdb4C6d922629664174b904d80F2C35",
};

// Standard L2 deposit/withdrawal events
export const L2_EVENTS = {
  // Optimism events
  [optimism.id]: {
    DEPOSIT: "DepositInitiated",
    WITHDRAWAL: "WithdrawalInitiated",
  },
  // Arbitrum events
  [arbitrum.id]: {
    DEPOSIT: "DepositInitiated",
    WITHDRAWAL: "WithdrawalInitiated",
  },
  // Base events (same as Optimism)
  [base.id]: {
    DEPOSIT: "DepositInitiated",
    WITHDRAWAL: "WithdrawalInitiated",
  },
};

// Standard ABIs for events
export const L2_BRIDGE_ABI = [
  // Optimism-style bridges
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "extraData", type: "bytes" },
    ],
    name: "DepositInitiated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "extraData", type: "bytes" },
    ],
    name: "WithdrawalInitiated",
    type: "event",
  },
];