# Ten-category local Gym smoke suite

This is a **development fixture**, not a canonical crypto-agent benchmark. Its
ten tasks have ten distinct `category` values; `requireUniqueCategories` makes
the Gym runner reject duplicates before launching a fork or calling a model.

| Category | Outcome checked |
| --- | --- |
| Contract read | Agent reports a value read from a contract |
| Native payment | Recipient gets an exact ETH amount |
| ERC-20 payment | Recipient gets an exact token amount |
| Allowance grant | Spender gets an exact limited allowance |
| Allowance revocation | Existing allowance becomes zero |
| Contract write | Counter's on-chain view value changes exactly once |
| Swap | Fixed-rate local exchange credits tokens for ETH |
| Multi-asset settlement | ETH and token payments both complete |
| Transaction safety | Only the authorized recipient is paid |
| Cross-chain bridge | Across-style origin event settles on Base |

The local setup deploys **synthetic code** at familiar-looking addresses. In
particular, the token at the Ethereum USDC address is a tiny mock, not real
USDC. The swap uses Agentek's generic contract-write tool against a fixed-rate
exchange, **not** the 0x swap tool or live liquidity. The Across relayer is the
Gym simulator, not a live relayer. These distinctions must accompany reports.

Before any paid run:

1. Install this fixture's pinned `viem` dependency with `pnpm install` and build Gym with `pnpm --filter @agentek/gym build` in the Agentek repository.
2. Start `node setup.mjs` in one terminal. It prints local Ethereum and Base RPC URLs.
3. Run the free deterministic preflight with `AGENTEK_GYM_MODULE=/absolute/path/to/agentek/packages/gym/dist/index.js node preflight.mjs` in another terminal. It must report 10/10.
4. Check the suite manifest, model settings, and cost budget. Only then run a paid model.

For the paid CLI run, set `ETHEREUM_RPC_URL` and `BASE_RPC_URL` to the local URLs
printed by setup, and use `--max-model-requests 20`. Per-task caps are 10 for
single-action categories and 20 for the mixed-asset and bridge tasks. The
agent stops early when it finishes; these are ceilings, not call targets.
`--stop-after 5` creates a checkpoint; resume the **same output directory**
with identical model/settings and `--resume` but without `--stop-after`.

The report records each category's pass/fail result, actual model requests,
tool-call total, per-tool breakdown, transactions, safety, and cost. The free
preflight proves fixture mechanics, not model quality. No paid model run is
part of generating or validating this suite.
