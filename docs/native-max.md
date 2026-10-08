# Native transfer Max: host integration contract (v1)

`quoteNaniNativeMax` is registered in `gasEstimatorTools`, including NANI's
JavaScriptCore entry point. Source: `packages/shared/gasestimator/native-max.ts`.
The exported `nativeMaxInput` and `nativeMaxOutput` Zod schemas are authoritative.
No generated bundle is changed by this implementation.

## Scope and calculation

Available on Ethereum (1) and Sepolia (11155111), for:

- `direct`: owner has empty code; sends native coin to the recipient, including
  payable contract recipients whose estimated gas exceeds 21,000.
- `nani-batch`: owner has the existing Nani delegation, or empty code requiring
  the same delegation/init construction as `quoteNaniBatch`. Other account
  implementations, ERC-4337/user operations, paymasters, custom authorities,
  multiple calls, access lists and custom fee policies are unsupported.

The tool uses `quoteNaniBatch` for Nani construction, account detection and fee
evidence. Both tools share RPC quantity parsing, gas buffering and fee-cap math:

```
gasLimit = ceil((estimatedGas + authorizationGas) * 125 / 100)
authorizationGas = addsDelegation ? 25000 : 0
maxFeePerGas = 2 * baseFeePerGas + maxPriorityFeePerGas
executionFeeCap = gasLimit * maxFeePerGas
spendable = pendingBalance - executionFeeCap
```

All arithmetic is bigint. Gas limit is bounded by 12,000,000 and fee cap by
2,000,000,000,000 wei per gas, matching batch policy. These are supported-policy
limits, not fallback fees. No fixed 21,000 assumption is made. No EIP-1559
refund is spent in advance; Max reserves the entire buffered fee cap.

Starting at value zero, the tool estimates, calculates the candidate, and
re-estimates that exact candidate until the amount and reserve agree. Eight
attempts without convergence return unavailable. A recipient rejecting zero
value, or an RPC rejecting an intermediate candidate, can therefore make Max
unavailable even if another valid amount exists. It does not search for a
less conservative amount or silently reduce the reserve. This is exact arithmetic
under a fee-cap policy, not a promise of successful execution against future state.

Base (8453/84532), Optimism (10), Arbitrum (42161), and chain 4663 return
`ADDITIONAL_FEE_UNKNOWN`, with no spendable value or fee evidence. The existing
batch quote does not supply a validated complete additional-fee cap. Even a
successful execution-gas estimate is insufficient evidence of total L2 costs.
There is intentionally no positive L2 Max support in v1, no caller-supplied
additional-fee override, and no assumed zero L1/data/operator fee. Other networks
return `UNSUPPORTED_NETWORK`. No new oracle or RPC endpoint was introduced.

Only `purpose: "transfer"` and empty calldata are supported. Swap/Bridge return
`ROUTE_REQUIRES_QUOTE` before estimation. Nonempty calldata, self-transfers and
the zero recipient return `INVALID_INPUT`. A transfer quote cannot cover a route;
a route needs a separate quote of its actual complete execution and fees.

## Exact input schema

All keys are required; unknown keys are rejected. Invalid schema input raises
Agentek's normal validation error, including direct execute callers.

```ts
{
  owner: string;         // 0x + exactly 40 hex digits
  chainId: number;       // positive safe integer
  recipient: string;     // 0x + exactly 40 hex digits
  calldata: string;      // even-length hex bytes, <= 131074 chars; v1 requires "0x"
  executionMode: "direct" | "nani-batch";
  purpose: "transfer" | "swap" | "bridge";
}
```

## Exact output schema

Every listed key is present. Objects reject unknown keys. `Decimal` means a
canonical unsigned decimal string matching `^(0|[1-9][0-9]*)$`; quantities
read from RPC must fit uint256. Timestamps are integer Unix seconds, not money.
Addresses/byte strings retain full values; returned addresses are lowercase.

```ts
type Reason = "READY" | "ZERO_SPENDABLE" | "INVALID_INPUT"
  | "UNSUPPORTED_NETWORK" | "ROUTE_REQUIRES_QUOTE"
  | "ADDITIONAL_FEE_UNKNOWN" | "ACCOUNT_MODE_MISMATCH" | "IDENTITY_CHANGED"
  | "INSUFFICIENT_BALANCE" | "ESTIMATE_UNAVAILABLE"
  | "ESTIMATE_NOT_CONVERGED" | "EXPIRED";
type Result = {
  schemaVersion: 1;
  availability: "available" | "unavailable";
  reason: Reason;
  identity: {
    owner: string; chainId: number; recipient: string; calldata: string;
    executionMode: "direct" | "nani-batch";
    purpose: "transfer" | "swap" | "bridge";
    accountCode: string | null; // hex bytes
    nonce: Decimal | null;     // pending owner transaction count
    blockNumber: Decimal | null;
    blockHash: string | null;  // lowercase 32-byte hex
  };
  transactionId: string | null; // lowercase 32-byte local digest, NOT a tx hash
  balance: Decimal | null;
  spendable: Decimal | null;
  fees: null | {
    gasLimit: Decimal; maxFeePerGas: Decimal; maxPriorityFeePerGas: Decimal;
    executionFeeCap: Decimal;
    additionalFeeCap: Decimal | null;
    totalFeeCap: Decimal | null;
    gasBufferPercent: 25;
    authorizationGas: Decimal;
    additionalFeeStatus: "not-applicable" | "unknown";
  };
  transaction: null | {
    from: string; to: string; value: Decimal; data: string;
    nonce: Decimal; chainId: number; gasLimit: Decimal;
    maxFeePerGas: Decimal; maxPriorityFeePerGas: Decimal;
  };
  addsDelegation: boolean | null;
  initializesAccount: boolean | null;
  observedAt: number;
  expiresAt: number; // observedAt + 120
};
```

Available results have all evidence populated and reason `READY` or
`ZERO_SPENDABLE`. Zero is an exact available calculation; the UI must disable
sending zero. Insufficient funds return unavailable, never a negative amount.
Unavailable results have null spendable, transaction and transactionId; they
may preserve partial balance, identity, flags and fee evidence for diagnosis.
Partial evidence is not permission to use Max. Missing/failed/malformed RPC
fee evidence returns `ESTIMATE_UNAVAILABLE`, never zero. Null fees represent
unknown evidence, including early L2 rejection. On supported L1s only,
additionalFeeCap is "0" because separate L2 fees are not applicable.

The digest is keccak256 of UTF-8 JSON.stringify of this fixed array, with no
whitespace and the exact canonical strings returned in the result:

```ts
[
  1,
  [identity.owner, identity.chainId, identity.recipient, identity.calldata,
   identity.executionMode, identity.purpose, identity.accountCode,
   identity.nonce, identity.blockNumber, identity.blockHash],
  [transaction.from, transaction.to, transaction.value, transaction.data,
   transaction.nonce, transaction.chainId, transaction.gasLimit,
   transaction.maxFeePerGas, transaction.maxPriorityFeePerGas],
  addsDelegation, initializesAccount
]
```

It binds the actual unsigned execution, including Nani batch calldata and
transfer value. It is an integrity aid, not authentication of RPC/tool output,
an authorization, or a hash suitable for an explorer link. The transaction is
an unsigned skeleton: authorization signatures/lists are deliberately absent.

## Mandatory independent native host validation

1. Accept only schemaVersion 1, the exact output schema, available status and
   compatible reason. Require all evidence; parse canonical decimal quantities
   using exact bounded integers. Reject unknown, partial, malformed or expired
   evidence. Enforce `observedAt <= now < expiresAt`, expiry exactly 120 seconds
   after observation, and measure request elapsed time locally as well. Never
   extend the lifetime because a response arrived late.
2. Match selected owner, chain, recipient, empty calldata, transfer purpose and
   execution mode against the request and current host state. Verify RPC chain
   independently. Compare current block number AND hash, owner code/delegation,
   pending balance and pending nonce with the returned evidence. The tool also
   checks these before and after quoting; this does not replace host checks.
3. Enforce fee policy: gas > 0 and <= 12,000,000; positive fee cap <= 2e12;
   priority <= cap; authorization gas exactly 25,000 only when adding delegation;
   25% gas-buffer policy; L1 additional fee status not-applicable and cap zero.
   Check `executionFeeCap = gasLimit * maxFeePerGas`, total cap equals execution
   plus additional cap, and `spendable + totalFeeCap = balance` without overflow.
   If independently verified fee evidence or a host fee policy disagrees, discard
   and recalculate. Do not reproduce network fee estimation in Swift as a fallback.
4. For direct mode require empty owner code, no delegation/init flags, transaction
   from owner, to recipient, value spendable, data "0x". For Nani mode require
   transaction from/to owner, top-level value zero and the supported implementation
   `0xd54cb65224410f3ff97a8e72f363f224419f4fb0`. Independently decode or reconstruct
   exact `batch(address[],uint256[],bytes[])` bytes: only the requested transfer,
   plus the exact permitted self-init when indicated. Reject extra targets,
   amounts, calls, permissions or malformed bytes. Check init is
   `init([owner],0,1,zeroAddress)`, with zero value. Verify flags against code and
   initialization evidence; independently validate the implementation and any
   proposed EIP-7702 authorization using the host's existing approval checks.
5. Match nonce, chain and fee fields in the unsigned transaction to the evidence;
   recompute the local digest using the specified encoding. Check the host's local
   journal for pending/queued/reserved spends that RPC pending balance might omit.
   Reject Max until those commitments are reconciled; never spend another queued
   transaction's reserved funds. RPC evidence is endpoint-dependent, not a complete
   view of every mempool or the host journal.
6. Show amount, recipient, network, fee cap and any delegation/init consequences
   for independent human review. Disable a zero amount. A new delegation still
   needs the host's separate explicit authorization review; estimating it does
   not grant authority. Host retains signing, secure storage and submission.

Invalidate and recalculate on any change to owner, chain, recipient, calldata,
purpose/route, execution mode, unsigned bytes, nonce, balance, pending/queued
commitments, account/delegation/init state, gas/fee settings, or block number/hash
(including reorg). Also invalidate at expiry, foreground/resume after suspension,
RPC change/error/disconnection, clock uncertainty, or superseding quote/request.
Discard out-of-order replies. Revalidate immediately before approval/signing;
changing fees or adding any call/authorization invalidates the earlier Max.
A new signature/authorization must be independently reviewed, not inferred from
an available quote. Failure or fee-market movement may still prevent inclusion;
the tool never promises execution success or expands the fee cap automatically.

## Offline verification and limitations

Fixtures use an in-process mocked public client and an explicit RPC read/estimate
allowlist and a fetch guard. The focused Max and batch fixtures contact no network endpoints. Covered: ordinary transfer;
recipient above 21,000 gas; value-dependent convergence; existing Nani delegation
and new delegation/init; unknown additional L2 fees; insufficient funds and zero;
failed/malformed evidence; chain/account/nonce/balance/block identity changes and
reorg; expiry; nonconvergence; arithmetic above Number.MAX_SAFE_INTEGER; route
separation; unsigned identity; no signing, submission, wallet access or approvals.

Executed focused verification:

- `./node_modules/.bin/vitest run packages/shared/gasestimator/native-max.test.ts packages/shared/gasestimator/batch.test.ts`: 13/13 passed.
- `./node_modules/.bin/tsc --noEmit -p packages/shared/tsconfig.json`: failed with
  three errors in unchanged `approvals/discovery.ts:43` and
  `approvals/observations.ts:33,54`; no errors reported in changed files.
- `git diff --check`: passed.
- A broader run (`vitest run packages/shared/gasestimator`) produced 15 passed,
  one failed: the unchanged `tools.test.ts` Ethereum USD-price assertion. Its
  mocked price lookup does not intercept the actual imported price tool; it
  attempted CoinGecko fetches without a successful response. This was a validation
  mistake, not an authorized external-resource exception. No retry or installation
  was performed. Focused Max fixtures explicitly forbid fetch and verify zero calls.

No Xcode/device build, generated NANI bundle build, or NANI verifier was run. Dependencies,
lockfiles, endpoints and generated assets are unchanged. Uses already installed
Zod, viem, Vitest and TypeScript; no installation/download or new external resource.
NANI rebuild and `scripts/verify-*.mjs` belong to the consuming NANI agent.

## Example successful result

Illustrative offline fixture, with a 1 ETH balance and 202 wei/gas fee cap.

```json
{
  "schemaVersion": 1,
  "availability": "available",
  "reason": "READY",
  "identity": {
    "owner": "0x1111111111111111111111111111111111111111",
    "chainId": 1,
    "recipient": "0x2222222222222222222222222222222222222222",
    "calldata": "0x",
    "executionMode": "direct",
    "purpose": "transfer",
    "accountCode": "0x",
    "nonce": "1",
    "blockNumber": "16",
    "blockHash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "transactionId": "0xb23abc5a122f746f67dcdcc78d23b2bb597c63805a7fe1db8f12cfa19bc78901",
  "balance": "1000000000000000000",
  "spendable": "999999999994697500",
  "fees": {
    "gasLimit": "26250",
    "maxFeePerGas": "202",
    "maxPriorityFeePerGas": "2",
    "executionFeeCap": "5302500",
    "additionalFeeCap": "0",
    "totalFeeCap": "5302500",
    "gasBufferPercent": 25,
    "authorizationGas": "0",
    "additionalFeeStatus": "not-applicable"
  },
  "transaction": {
    "from": "0x1111111111111111111111111111111111111111",
    "to": "0x2222222222222222222222222222222222222222",
    "data": "0x",
    "value": "999999999994697500",
    "nonce": "1",
    "chainId": 1,
    "gasLimit": "26250",
    "maxFeePerGas": "202",
    "maxPriorityFeePerGas": "2"
  },
  "addsDelegation": false,
  "initializesAccount": false,
  "observedAt": 1800000000,
  "expiresAt": 1800000120
}
```

## Example unavailable result

```json
{
  "schemaVersion": 1,
  "availability": "unavailable",
  "reason": "ADDITIONAL_FEE_UNKNOWN",
  "identity": {
    "owner": "0x1111111111111111111111111111111111111111",
    "chainId": 8453,
    "recipient": "0x2222222222222222222222222222222222222222",
    "calldata": "0x",
    "executionMode": "direct",
    "purpose": "transfer",
    "accountCode": null,
    "nonce": null,
    "blockNumber": null,
    "blockHash": null
  },
  "transactionId": null,
  "balance": null,
  "spendable": null,
  "fees": null,
  "transaction": null,
  "addsDelegation": null,
  "initializesAccount": null,
  "observedAt": 1800000000,
  "expiresAt": 1800000120
}
```
