# agentek

![agentek-logo-1](https://github.com/user-attachments/assets/c73ccd7b-4c4e-4c90-8ccc-1ed101fa1b0b)

An extensible TypeScript toolkit for EVM and Solana blockchain interactions. Up to 209 registered tools (195 without optional API credentials) covering on-chain actions, DeFi protocols, market data, and off-chain services — designed for AI agents, MCP clients, and developers.

## Quick Start

Requires Node.js 20.18.1 or newer.

**CLI** (fastest way to try it):
```bash
npx @agentek/cli list          # browse up to 209 tools
npx @agentek/cli info getBalance  # inspect a specific tool
npx @agentek/cli exec getBalance --json '{"chainId":1,"address":"0x0000000000000000000000000000000000000000"}'
```

**MCP Server** (for Claude Desktop, Cursor, etc.):
```bash
pnpx @agentek/mcp-server
```

**TypeScript SDK**:
```bash
pnpm add @agentek/tools
```

## Packages

| Package | Description | Version |
|---------|-------------|---------|
| [`@agentek/tools`](packages/shared) | Core toolkit — up to 209 tools | 0.1.26 |
| [`@agentek/ai-sdk`](packages/ai-sdk) | Vercel AI SDK integration | 0.1.26 |
| [`@agentek/mcp-server`](packages/mcp) | Model Context Protocol server | 0.1.26 |
| [`@agentek/cli`](packages/cli) | Command-line interface | 0.0.2 |
| [`@agentek/gym`](packages/gym) | Agent evaluation on disposable Anvil forks | 0.0.1 |
| [`@agentek/nani`](packages/nani) | Private host-integrated Nani bundle | 0.1.0 |

Versions above are workspace manifest versions; they do not establish npm publication status.

## Requirements

- Node.js >= 20.18.1
- pnpm (for development)
- Bun for the private Nani bundle build
- Foundry/Anvil for Gym fork environments and integration tests

## Installation

```bash
# Core tools
pnpm add @agentek/tools viem zod

# Vercel AI SDK integration
pnpm add @agentek/ai-sdk @agentek/tools viem zod
```

## Optional integrations and smaller bundles

The default catalogue contains EVM tools and dependency-free page extraction.
Solana, x402 payments, server-side HTML scraping, and X tools are explicit opt-ins:

| Integration | Import | Additional packages to install |
|---|---|---|
| Solana | `@agentek/tools/solana` | `@solana/web3.js@1.98.4` |
| x402 payments | `@agentek/tools/x402` | `@x402/evm@2.4.0`, `@x402/fetch@2.4.0` |
| HTML scraping | `@agentek/tools/web` | `cheerio@1.1.2` |
| X/Twitter | `@agentek/tools/twitter` | None |

```typescript
import { allTools } from '@agentek/tools';
import { solanaTools, createSolanaConfig } from '@agentek/tools/solana';

const tools = await allTools({ additionalTools: solanaTools() });
// Pass both tools and solana to createAgentekClient / AgentekToolkit:
const solana = createSolanaConfig({ address: 'YOUR_BASE58_ADDRESS' });
```

Import collections from their individual entry points so bundlers can exclude
unused integrations. `allTools({})` does not load them, and their SDK packages are
optional peers. `zrouter-sdk` and `wns-utils` remain supported core dependencies.
Existing consumers importing optional collections from the package root must
switch to the entry points above; Solana transaction clients must wrap settings
with `createSolanaConfig`. Add X tools with `await twitterTools(config)` and
`additionalTools`; credentials alone no longer enable them in `allTools`.

For CLI and MCP, set `AGENTEK_INTEGRATIONS=solana,x402,web,twitter` to select the
integrations you installed. Leave it empty for the core catalogue. Missing SDKs
produce an installation error when the corresponding integration is selected.
X still requires its existing credential environment variables.

The embedded Nani bundle excludes all Solana tools, payment SDKs, and the HTML
scraper. `pnpm --filter @agentek/nani build` builds the iPhone profile;
`build:macos` and `build:universal` select Mac or combined tool profiles.
`build:minimal` includes only RPC reads, ERC20 tools and transfer preparation.
For an app-owned tool set, run `bun build.mjs iphone ./my-tools.ts` from
`packages/nani`; export `embeddedTools` and `embeddedProfile` as in
`minimal-tools.ts`. Only the selected collection enters the bundle. The build
rejects imports of unsupported integrations rather than leaving unresolved SDK
imports in the artifact. The legacy third `__naniInit` argument is ignored.

The `build:nani-chan` profile excludes X and Solana even with legacy credentials.
External dependency and override versions are exact pins; `pnpm check:pins` and
the native builder enforce them. Bun is pinned by `.bun-version` and pnpm by
`packageManager`.

Gym loads JSON tasks without YAML. Install `yaml@2.8.4` to use YAML tasks.
AI examples have their own private workspace under `examples`; OpenRouter and AI
SDK dependencies are development/example dependencies, not core requirements.
Package builds use TypeScript directly, with no tsup dependency.

## Usage

### Using with Vercel AI SDK

```typescript
import { allTools } from '@agentek/tools';
import { AgentekToolkit } from '@agentek/ai-sdk';
import { http } from 'viem';
import { mainnet } from 'viem/chains';

const tools = await allTools({
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  zeroxApiKey: process.env.ZEROX_API_KEY,
});

const toolkit = new AgentekToolkit({
  accountOrAddress: '0x...',
  chains: [mainnet],
  transports: [http()],
  tools,
});

// Pass to Vercel AI SDK
const aiTools = toolkit.getTools();
```

### Using the toolkit directly

```typescript
import { createAgentekClient } from '@agentek/tools/client';
import { allTools } from '@agentek/tools';
import { http } from 'viem';
import { mainnet } from 'viem/chains';

const tools = await allTools({});

const client = createAgentekClient({
  accountOrAddress: '0x...',
  chains: [mainnet],
  transports: [http()],
  tools,
});

const result = await client.execute('getBalance', {
  address: '0x...',
  chainId: 1,
});
```

### Using the MCP Server

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentek": {
      "command": "pnpx",
      "args": ["@agentek/mcp-server"],
      "env": {
        "ACCOUNT": "YOUR_ETHEREUM_ADDRESS",
        "PERPLEXITY_API_KEY": "...",
        "TALLY_API_KEY": "..."
      }
    }
  }
}
```

Use `ACCOUNT` for address context and unsigned EVM intents. Configure a signer
or `PRIVATE_KEY` and set `AGENTEK_EXECUTION_MODE=execute` to submit EVM transactions; Solana signing is configured separately. CLI and MCP default to `prepare`, which returns unsigned operations even when a signer is configured.

See the [MCP Server README](packages/mcp/README.md) for full configuration details.

### Using the CLI

```bash
# List all available tools
npx @agentek/cli list

# Search for tools by keyword
npx @agentek/cli search "swap"

# Get detailed info about a tool
npx @agentek/cli info intentApprove

# Execute a tool
npx @agentek/cli exec getCryptoPrice --symbol ethereum
```

See the [CLI Guide](packages/cli/GUIDE.md) for complete documentation.

### Composing a custom tool set

You don't have to use all 209 tools. Import only what you need:

```typescript
import { rpcTools, erc20Tools, defillamaTools } from '@agentek/tools';

const tools = [
  ...rpcTools(),
  ...erc20Tools(),
  ...defillamaTools(),
];
```

### Transaction execution and recovery

CLI, MCP and `AgentekToolkit` default to preparation. Set `AGENTEK_EXECUTION_MODE=execute`
for CLI/MCP, or `executionMode: "execute"` for the toolkit, when submission is intended.
The low-level client retains its existing `execute` default; set its mode explicitly.
Transfer and approval tools require `chainId` when multiple supported chains are configured.
Amounts reject excess precision instead of rounding. Zero allowances remain valid for revocation.

CLI/MCP atomically persist EVM operations, their hashes and confirmation states under
`AGENTEK_CONFIG_DIR/executions` (default `~/.agentek/executions`) before broadcasting.
An ambiguous or partially completed execution locks the chain across processes.
`agentek executions` lists the records. Reconcile every recorded hash and completed operation
on-chain before stopping any long-running MCP client and using `agentek executions acknowledge <id>` to release its lock; acknowledgment
never resubmits a transaction. Restart a long-running client after acknowledgement. Library consumers can persist the same state using
`createExecutionJournal` from `@agentek/tools/journal` and `onExecutionUpdated`.
Do not apply wrapper timeouts to irreversible operations; inspect their recorded outcomes.

x402 authorizes only the configured chain's pinned USDC asset, with an exact amount under
the requested cap and EIP-3009 signing. `authorizationCreated` reports a signature;
`settlement: "unverified"` does not assert that a payment settled.

### Untrusted URLs and optional native integration

The core library, CLI, MCP server and AI SDK integration run independently on Node.js/Bun.
They do not require macOS or a native application. The host-specific requirements below
apply only when using the optional `packages/nani` WKWebView adapter.

Untrusted NFT metadata, scraped pages and x402 URLs use a bounded public HTTP transport.
It rejects private/reserved destinations and redirects, pins validated DNS answers to the
connection, and limits streamed bodies and request duration. NFT on-chain fields remain
available when off-chain metadata cannot be fetched; inspect `metadataError`.

In the optional Nani bundle, WKWebView cannot pin DNS through ordinary browser fetch.
The app injects `__agentekHostCapabilities = {schemaVersion:1, platform:"iphone"|"macos",
publicFetch:1, credentials:0|1}` before loading it. The bundle installs
`__agentekPublicFetch` over the `agentekPublicFetch` message handler only when advertised.
Requests use `{type:"request", requestId, url, method:"GET", timeoutMs,
maximumResponseBytes}`; cancellation uses `{type:"cancel", requestId}`. Native apps
independently enforce existing approved HTTPS origins, public DNS, connection pinning,
no redirects, a 15-second deadline and a 1,000,000-byte response cap. Without a native
transport, HTTP metadata fails closed; on-chain fields remain available.

The iPhone credential bridge negotiates the same request/cancel envelope, with
`headers` and base64 `body`, a 30-second deadline and an 8 MiB JS response cap.
The native handler retains provider-specific limits, endpoint validation, approvals,
credential attachment and redaction. Hosts without the versioned credential capability
receive the legacy `{url, method, headers, body}` shape. The Mac profile registers no
credential-backed tools. `__naniCapabilities()` reports the selected profile and protocol
for app validation. Native enforcement requires app tests as well as bundle tests;
neither native app is a dependency of the standalone library.

## Tools (up to 209)

`allTools({})` returns 195 tools. Optional service credentials add up to 14
more; availability depends on configuration. The registered `intent0xSwap` is explicitly unavailable and requires no API key. The optional `thinkTools()` echo is excluded from the default catalogue. Host-integrated Nani tool sets
may expose a different selection. Tool support also varies by chain.

### Blockchain Core

| Module | Tools | Description |
|--------|-------|-------------|
| **rpc** | 11 | `getBalance`, `getBlock`, `getBlockNumber`, `getGasPrice`, `getTransaction`, `getTransactionReceipt`, `getCode`, `getTransactionCount`, `estimateGas`, `getFeeHistory`, `intentSendTransaction` |
| **erc20** | 8 | `getBalanceOf`, `getAllowance`, `getTotalSupply`, `getDecimals`, `getName`, `getSymbol`, `getTokenMetadata`, `intentApprove` |
| **transfer** | 2 | `intentTransfer`, `intentTransferFrom` |
| **erc721** | 1 | `getNFTMetadata` |
| **erc6909** | 3 | Token balance, metadata, and transfer intents |
| **ens** | 2 | `resolveENS`, `lookupENS` |
| **resolveToken** | 1 | `resolveToken` — token address and metadata resolution |
| **contract** | 2 | `readContract`, `intentWriteContract` — generic contract interaction |
| **approvals** | 7 | Permission discovery/observations, selected revocation plans, and approval revocation intents |
| **wns** | 19 | `resolveWNS`, `isAvailableWNS`, `intentRegisterWNS`, and 16 more naming tools |

### DeFi

| Module | Tools | Description |
|--------|-------|-------------|
| **aave** | 7 | Account observations and lending/borrowing: `getAaveUserData`, `getAaveReserveData`, deposit, withdraw, borrow, repay intents |
| **uniV3** | 11 | Position discovery/observations and liquidity: `getUniV3Pool`, `getUserPositions`, `getPoolFeeData`, mint/increase/decrease/collect/transfer intents |
| **swap** | 1 | `intent0xSwap` — unavailable until local execution proof is supported |
| **weth** | 2 | `depositWETH`, `withdrawWETH` |
| **zamm** | 5 | `getCoin`, `getHolders`, `getAccountPortfolio`, `getPool`, `getSwaps` |
| **zrouter** | 2 | `getQuote`, `intentSwap` — cross-DEX routing |
| **x402** | 3 | `x402Fetch`, `getX402PaymentInfo`, `x402DiscoverResources` — HTTP 402 payments |
| **defillama** | 6 | `getYieldTool`, `getYieldPoolEvidence`, `compareYieldTool`, `getYieldHistoryTool`, `compareYieldHistoryTool`, `getTokenChart` |

### Cross-Chain

| Module | Tools | Description |
|--------|-------|-------------|
| **across** | 3 | `getAcrossRoutes`, `getAcrossFeeQuote`, `intentDepositAcross` |
| **slowTransfer** | 12 | Slow-release transfers with guardian controls |

### Market Data

| Module | Tools | Description |
|--------|-------|-------------|
| **dexscreener** | 1 | `getLatestTokens` — trending token discovery |
| **researchCA** | 1 | `researchCA` — aggregate EVM contract, token/NFT, holder, mint-history, privilege, and pool diligence with explicit data-completeness qualifiers |
| **cryptoprices** | 1 | `getCryptoPrice` — current prices via CoinGecko |
| **coindesk** | 1 | `getLatestCoindeskNewsTool` — crypto news |
| **coinmarketcal** | 1 | `getMarketEvents` — upcoming market events |
| **feargreed** | 1 | `getFearAndGreedIndex` |
| **gasestimator** | 3 | `estimateGasCost`, `quoteNaniBatch`, `quoteNaniNativeMax` — gas estimates and unsigned execution quotes |

### Block Explorer (Blockscout)

33 tools covering addresses, transactions, blocks, tokens, smart contracts, and search across supported networks.

### Governance

| Module | Tools | Description |
|--------|-------|-------------|
| **tally** | 5 | `tallyProposals`, `tallyChains`, `tallyUserDaos`, `intentGovernorVote`, `intentGovernorVoteWithReason` |
| **nani** | 5 | `getNaniProposals`, `intentStakeNani`, `intentUnstakeNani`, `intentProposeNani`, `intentVoteNaniProposal` |
| **coinchan** | 8 | Coin creation, vesting, airdrops |

### Social & Web

| Module | Tools | Description |
|--------|-------|-------------|
| **twitter** | 5 | `searchRecentTweets`, `getTweetById`, `getXUserByUsername`, `getXUserTweets`, `getHomeTimeline` |
| **web** | 3 | `scrapeWebContent`, `webPageExtractor`, `webPageResult` — scraping and host-integrated page observations |
| **search** | 1 | `askPerplexitySearch` |
| **imagegen** | 1 | `generateAndPinImage` — AI image generation + IPFS pinning |

### Security & Utility

| Module | Tools | Description |
|--------|-------|-------------|
| **security** | 2 | `checkMaliciousAddress`, `checkMaliciousWebsite` |
| **btc-rpc** | 4 | `getBtcAddressInfo`, `getBtcTxDetails`, `getBtcBlockTxids`, `getLatestBtcBlock` |
| **think** | 1 | Reasoning step for multi-step agent workflows |

### Solana

| Module | Tools | Description |
|--------|-------|-------------|
| **solana** | 21 | `getSolBalance`, `getSolanaAccountInfo`, `getSolanaTokenBalances`, `getSolanaTokenBalance`, `getSolanaTokenSupply`, `getSolanaTransaction`, `getSolanaTransactionHistory`, `getSolanaBlock`, `getSolanaNetworkStatus`, `getSolanaPriorityFees`, `intentTransferSol`, `intentTransferSplToken`, `searchSolanaTokens`, `getSolanaTrendingTokens`, `getSolanaRecentTokens`, `getSolanaTokenMarketData`, `getSolanaLatestProfiles`, `getSolanaPromotedTokens`, `getSolanaTokenPairs`, `getSolanaSwapQuote`, `intentSwapSolana` |

## Supported Networks

**EVM**

- Ethereum Mainnet
- Optimism
- Arbitrum
- Polygon
- Base
- Mode
- Sepolia

These are the default CLI/MCP EVM client networks; individual tools declare
their own supported chains.

**Solana**

- Mainnet-beta by default. Tools take a `cluster` parameter (`mainnet-beta`, `devnet`,
  `testnet`) to switch cluster; a private or self-hosted endpoint is configured once
  via `SOLANA_RPC_URL` or `solana.rpcUrl` rather than passed per call.

## Solana

Solana tools sit alongside the EVM ones and share the same client. Reads work
with no configuration at all. Writes need a key, which lives in its own
`solana` config block because Solana uses ed25519 keys rather than secp256k1:

```typescript
import { createAgentekClient } from '@agentek/tools/client';
import { allTools } from '@agentek/tools';
import { http } from 'viem';
import { mainnet } from 'viem/chains';

const client = createAgentekClient({
  accountOrAddress: '0x...',
  chains: [mainnet],
  transports: [http()],
  tools: await allTools({}),
  solana: {
    // A base58 secret key (Phantom export), a JSON byte array
    // (solana-keygen), or the raw 64 bytes.
    privateKey: process.env.SOLANA_PRIVATE_KEY,
    rpcUrl: process.env.SOLANA_RPC_URL,
    jupiterApiKey: process.env.JUPITER_API_KEY,
  },
});

await client.execute('getSolBalance', {
  address: '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9',
});
```

SOL and SPL transfer intent tools mirror the EVM ones: with a key configured
they sign and submit, returning the signature and `confirmationStatus`.
A submitted or unknown outcome is not confirmation; reconcile the signature
before retrying. Without a key, pass
`solana.address` instead and they return the unsigned transaction as base64
for you to sign elsewhere. `intentSwapSolana` always returns Jupiter's
untrusted transaction and request ID for an external wallet to decode,
validate, simulate, approve, sign, and execute; agentek never signs or submits
a Jupiter swap intent:

```json
{
  "intent": "send 0.25 SOL to 5tzFki...",
  "chain": "solana",
  "transaction": "AQAAAAAA...",
  "signature": "4pF2s...",
  "confirmationStatus": "confirmed"
}
```

The public mainnet-beta endpoint is heavily rate limited — set
`SOLANA_RPC_URL` to your own endpoint for anything beyond casual use.

## Environment Variables

Most tools work without any API keys. Optional keys unlock additional features.

EVM tools fall back to public RPC endpoints, which are shared and rate limited —
point `RPC_URLS` (or the per-chain variables) at your own provider for anything
beyond casual use.

| Variable | Required for |
|----------|-------------|
| `AGENTEK_EXECUTION_MODE` | CLI/MCP: `prepare` (default) or `execute` |
| `PRIVATE_KEY` | Local EVM transaction signing (unsigned intents work with an address; the CLI can also use its signer daemon) |
| `ACCOUNT` | EVM address context and unsigned intents (alternative to PRIVATE_KEY) |
| `SOLANA_PRIVATE_KEY` | Signing Solana transactions (base58 or JSON byte array) |
| `SOLANA_ACCOUNT` | Read-only Solana address (alternative to SOLANA_PRIVATE_KEY) |
| `SOLANA_RPC_URL` | Solana JSON-RPC endpoint (defaults to public mainnet-beta) |
| `RPC_URLS` | EVM endpoints as a `chainId=url` list, e.g. `1=https://…,8453=https://…` |
| `RPC_URL_<chainId>` | EVM endpoint for one chain, e.g. `RPC_URL_1` |
| `ETHEREUM_RPC_URL` and friends | Per-chain aliases: `OPTIMISM_`, `ARBITRUM_`, `POLYGON_`, `BASE_`, `MODE_`, `SEPOLIA_` |
| `JUPITER_API_KEY` | Higher Jupiter Tokens V2 and Swap V2 rate limits and analytics (keyless access is supported) |
| `OPENROUTER_API_KEY` | Model-powered examples and Gym OpenRouter evaluations |
| `ANVIL_BINARY` | Optional Anvil executable path for Gym (defaults to `anvil` on PATH) |
| `PERPLEXITY_API_KEY` | AI-powered search |
| `ZEROX_API_KEY` | Deprecated; 0x execution is unavailable |
| `TALLY_API_KEY` | Governance data |
| `COINDESK_API_KEY` | Crypto news |
| `COINMARKETCAL_API_KEY` | Market events calendar |
| `FIREWORKS_API_KEY` | AI image generation |
| `PINATA_JWT` | IPFS pinning (paired with FIREWORKS_API_KEY) |
| `X_BEARER_TOKEN` | Twitter/X read-only access |
| `X_API_KEY` + `X_API_KEY_SECRET` | Twitter/X OAuth (full access) |

Copy the example to get started:
```bash
cp -n .env.example .env
```

## Agent evaluations (Gym)

`@agentek/gym` runs agents against disposable, pinned Anvil forks using a
public development account, restricted Agentek tools, and separate correctness,
safety, and cost reports. It supports resumable suites and saved-report
comparisons. Across destination settlement is simulated with an Anvil state
override, rather than a destination bridge fill transaction. The included
smoke fixtures are development tests, not a canonical benchmark.

See the [Gym guide](packages/gym/README.md) for setup and examples.

## Development

```bash
git clone https://github.com/NaniDAO/agentek.git
cd agentek
pnpm i
pnpm run build
pnpm test:offline
pnpm test:release
pnpm check:packages
```

`pnpm release:check` runs the build and all checks above in order. CI runs this
on Node 22 and 24. Local Gym integration tests require Anvil and skip without it.
`pnpm test:live` selects the tests that call public RPCs or external APIs;
`pnpm test` retains the full suite in watch mode. A `.env` file is not automatically loaded by every command;
pass it explicitly where needed, for example `node --env-file=.env ...`.

`pnpm release 0.2.0` previews version changes; adding `--prepare` verifies them
and updates manifests. It does not publish.

Interested in contributing? Check out our [CONTRIBUTING.md](CONTRIBUTING.md) guide.

## License

[AGPL-3.0](LICENSE)

## Nani host catalogue

The iPhone entry point resolves the shared client directly from committed source,
never a workspace package's compiled dist. Its scoped catalogue retains WNS,
NANI staking/governance, ZAMM, contract/yield research and read-only chain research.
It excludes Tacit, paid HTTP/image publishing, the echo-only think tool, the
superseded scraper/swap intent, legacy approval scans and protocol position
management. The Mac profile pins its existing broader catalogue to explicit tool names; new
registrations require matching app support. The injected platform selects the profile. The general SDK retains its separate collections.

WNS registration returns `workflow: {schemaVersion:1, mode:"sequential", steps}`
without top-level ops. Each stage contains `id`, `title`, `ops`,
`minimumDelaySeconds`, and (after the first) `dependsOn` plus
`waitFor:"confirmation"`. Hosts persist the stages independently, validate the
prerequisite's canonical receipt and chain time, and freshly simulate/price/review
and approve every stage. Never flatten delayed stages into a batch. Tools do not
sign, submit, retry or grant later-stage approval. The existing secret parameter
is a registration commitment secret, never a wallet key.

`resolveToken` returns ambiguous same-symbol contracts as bounded candidates;
ask the user to choose the exact contract/provider ID. Provider order is not
identity. Resolved metadata never authorizes construction.

Dexscreener ranks activity only among up to 60 latest-profile candidates, with
30-address requests and explicit missing/truncated/failed evidence. The activity
heuristic requires $10,000 liquidity, $5,000 daily volume, 20 daily trades and a
one-hour pair age. Its capped momentum is not a safety or organic-trending score.

Fee estimates return exact wei components and a nullable total. Supply exact
transaction identity on OP/Base/Arbitrum; failed or absent extra-fee evidence
leaves the total unknown. OP/Base use the existing GasPriceOracle's
getL1FeeUpperBound and getOperatorFee with a conservative envelope and reserve.
Arbitrum/Nitro RPC estimates (including Robinhood Chain 4663) include posting cost; no second L1 fee is added. This applies the Nitro fee model documented by Arbitrum to Robinhood's documented Nitro chain; it is not live deployment acceptance.
Testnet assets receive no USD valuation. Quotes are estimates/reserves, not
protocol-enforceable final-charge caps. Other networks stay explicitly unknown
unless a fee model is configured. Native hosts independently recheck before signing.

Protocol references: [OP fees](https://docs.optimism.io/op-stack/transactions/fees),
[Base fees](https://docs.base.org/specifications/transactions/network-fees),
[Arbitrum gas estimates](https://developer.arbitrum.io/arbitrum-essentials/how-to-estimate-gas).
Offline source fixtures: `packages/shared/catalogue-readiness.test.ts`.

Robinhood protocol reference: [Nitro chain](https://docs.robinhood.com/chain/run-a-full-node/).
