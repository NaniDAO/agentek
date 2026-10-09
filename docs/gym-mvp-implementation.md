# Agentek Gym MVP implementation note

## Repository fit

Agentek is a pnpm TypeScript monorepo. The reusable blockchain interface lives
in `@agentek/tools`: `AgentekClient` is constructed from explicit viem chains,
transports, an account, and a list of `BaseTool` objects. This makes the gym a
separate package (`@agentek/gym`) rather than a mode inside the existing client.
The gym will supply a localhost Anvil transport and a deterministic test-only
account while continuing to use ordinary Agentek tools.

The existing EVM tools relevant to the MVP are:

- `getBalanceOf` and `getAllowance` in the ERC-20 collection;
- `intentTransfer` in the transfer collection;
- `intentApprove` in the ERC-20 collection;
- `intentSwap` in the optional 0x-backed swap collection.

These tools execute against the clients and transports passed to
`AgentekClient`, so no benchmark-specific blockchain tools are needed.

Tests use Vitest. The repository already depends on viem and Foundry is not a
package dependency; the environment therefore discovers and validates an
external `anvil` binary and reports a clear error when it is unavailable.

## Initial boundary

The first implementation slice contains:

1. an independently importable `@agentek/gym` package;
2. an `AnvilForkEnvironment` that pins an Ethereum fork, owns its child
   process, supports snapshot/reset/revert, and exposes only a localhost RPC;
3. one fixed, publicly documented, test-only wallet;
4. native ETH and ERC-20 balance provisioning with on-chain verification.

The package also implements Agentek tool selection, tracing, grading, limits,
JSON and Markdown reports, a suite CLI, checkpoint/resume, and comparisons.
OpenRouter is the reference model adapter; callers may supply their own adapter.

## Phase 4 task format

The public `loadTask` API reads strict JSON, YAML, and YML task files and
validates task definitions before any environment is started. Single-chain
tasks use Ethereum; multi-chain tasks declare pinned Ethereum, Base, Arbitrum,
Optimism, or Polygon forks. Graders include `balance`, `allowance`,
`contractView`, `outputContains`, and simulated `acrossSettlement`. Unknown properties—including RPC URLs and
credentials—are rejected, as are unsupported grader types, duplicate tool
names, unsafe block numbers, numeric token amounts, and invalid Ethereum
addresses.

Task files are limited to one MiB. YAML loading requires one document, rejects
duplicate keys and aliases, disables merge keys, and preserves unquoted
40-hex-character Ethereum addresses as strings. Amounts remain decimal
strings until token metadata is available, avoiding JavaScript floating-point
arithmetic. Multi-chain declarations require matching fork and Across configuration plus
wallet funding for every chain. Graders and safety rules must reference
configured chains.

## Phase 5 Agentek harness

`createGymAgentekClient` constructs the repository's normal `AgentekClient`
with the deterministic Gym account, the Ethereum chain definition, and an HTTP
transport pointing at the running fork. Tool names are not aliased: the MVP
registry exposes only `getBalance`, `getBalanceOf`, `getAllowance`,
`readContract`, `intentTransfer`, `intentApprove`, `intent0xSwap`, and
`intentWriteContract`.
Selections preserve task order and fail closed for unknown or duplicate names.
In particular, selecting `readContract` never exposes `intentWriteContract`.

The swap tool is registered only when the runner supplies a 0x API key through
process configuration; the key is never part of a task. Client creation checks
that the environment is a Gym-owned Ethereum Anvil instance served over an
uncredentialed numeric loopback URL. Transaction-producing Agentek calls repeat
that ownership, endpoint, client, and chain check immediately before submitting
operations. This keeps upstream fork URLs entirely outside the signer-facing
transport.

## Cross-chain simulation extension

The gym also provides a coordinated multi-fork environment and an opt-in
Across V3 relayer simulator. The adapter observes real `V3FundsDeposited`
events on origin forks and deterministically applies the exact `outputAmount`
to the recipient on the configured destination fork. Settlements are
idempotent and traceable, and expired deposits, unknown destinations,
zero-address token resolution, and non-empty Across messages fail closed.

This deliberately models the bridge outcome rather than Across repayment
bundles or relayer economics. Destination settlement is labelled
`anvil_state_override` in the relay trace so benchmark consumers cannot confuse
it with a production `fillV3Relay` transaction.

## Provisioning choice

Native balance provisioning uses Anvil's `anvil_setBalance`. ERC-20
provisioning writes the token's balance mapping with `anvil_setStorageAt` and
then calls `balanceOf` to prove the requested state exists. A task or asset
registry may provide a known storage slot; otherwise the MVP performs a
snapshot-isolated bounded slot search. Tokens with non-standard balance
storage fail closed and require an explicit supported provisioning strategy.

RPC provider credentials remain process configuration. They are accepted only
as the upstream fork source and are never exposed by the environment API.
