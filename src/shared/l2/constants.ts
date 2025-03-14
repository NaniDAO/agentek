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

// Standard L2 deposit/withdrawal events
export const L2_DEPOSIT_EVENT = "DepositInitiated";
export const L2_WITHDRAWAL_EVENT = "WithdrawalInitiated";