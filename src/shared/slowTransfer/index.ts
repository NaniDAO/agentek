import { BaseTool, createToolCollection } from "../client";
import {
  getSlowStatus,
  predictTransferId,
  unlockSlow,
  reverseSlowTransfer,
  getSlowGuardianInfo,
  approveSlowTransfer,
} from "./tools";
import {
  intentDepositToSlow,
  intentSetSlowGuardian,
  intentWithdrawFromSlow,
  intentApproveSlowTransfer,
  intentUnlockSlow,
  intentReverseSlowTransfer,
} from "./intents";

/**
 * Export an array of tools for slow transfer protocol.
 * LINK: https://github.com/z0r0z/slow
 * SLOW is a protocol that adds safety mechanisms to token transfers through two powerful features:
 *
 * Timelock: Enforces a waiting period before recipients can access transferred tokens
 * Guardian: Optional trusted party that can approve or block transfers
 * Think of it as a security-enhanced way to transfer ETH and ERC20 tokens with built-in protection mechanisms.
 *
 */
export function slowTransferTools(): BaseTool[] {
  return createToolCollection([
    // tools
    depositToSlow,
    getSlowStatus,
    predictTransferId,
    unlockSlow,
    reverseSlowTransfer,
    getSlowGuardianInfo,
    approveSlowTransfer,
    // intents
    intentDepositToSlow,
    intentSetSlowGuardian,
    intentWithdrawFromSlow,
    intentApproveSlowTransfer,
    intentUnlockSlow,
    intentReverseSlowTransfer,
  ]);
}
