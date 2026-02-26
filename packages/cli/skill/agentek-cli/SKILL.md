---
name: agentek-cli
description: Invoke any of 150+ blockchain and data tools from the shell using
  the agentek CLI. Use this skill when the user wants to query blockchain data,
  check token balances, resolve ENS names, get gas prices, fetch DeFi yields,
  search tweets, or interact with any on-chain protocol across EVM chains
  (Ethereum, Base, Arbitrum, Optimism, Polygon).
license: AGPL-3.0
compatibility: Requires Node.js >= 18.17.0 and npx or global install of @agentek/cli
metadata:
  author: NaniDAO
  version: "1.0"
---

# agentek CLI

## Overview

Agentek is a command-line interface that exposes 150+ blockchain and data tools as simple shell commands. Each tool has a typed schema, accepts flags, and returns structured JSON on stdout.

Install globally or run via npx:

```bash
# Global install
npm install -g @agentek/cli

# Or run directly
npx @agentek/cli <command>
```

## Commands

### Setup and configuration

Check which API keys are configured:

```bash
agentek setup
```

Save a key to the config file (`~/.agentek/config.json`):

```bash
agentek config set PERPLEXITY_API_KEY pplx-xxxxxxxxxxxx
```

View a saved key (redacted by default):

```bash
agentek config get PERPLEXITY_API_KEY
agentek config get PERPLEXITY_API_KEY --reveal
```

List all known keys with their status:

```bash
agentek config list
```

Remove a key from the config:

```bash
agentek config delete PERPLEXITY_API_KEY
```

Environment variables always take precedence over config file values.

### Tool discovery and execution

The CLI follows a three-step discovery workflow: **list** -> **info** -> **exec**.

### 1. List all tools

```bash
agentek list
```

Returns a sorted JSON array of every available tool name.

### 2. Inspect a tool

```bash
agentek info <tool-name>
```

Returns a JSON object with the tool's `name`, `description`, `parameters` (JSON Schema), and `supportedChains`.

### 3. Execute a tool

```bash
agentek exec <tool-name> [--key value ...]
```

Runs the tool with the given parameters and prints the JSON result to stdout.

## Flag syntax

| Form | Meaning |
|------|---------|
| `--key value` | Set parameter `key` to `value` |
| `--key=value` | Same, inline form |
| `--key v1 --key v2` | Repeated flags become an array `[v1, v2]` |
| `--flag` | Boolean `true` (when schema expects boolean) |
| `--json '{"k":"v"}'` | Merge a raw JSON object into the parameters |

Values are automatically coerced to the type expected by the tool's schema (number, boolean, string).

## Output contract

- **stdout** — Always valid JSON (the tool result or a JSON array for `list`).
- **stderr** — JSON object `{"error": "message"}` on failure.
- **Exit codes:**
  - `0` — Success
  - `1` — Runtime error (tool failed, invalid input, timeout)
  - `2` — Usage error (bad command, missing arguments)

## Environment variables

Set these before running commands that need them:

| Variable | Purpose |
|----------|---------|
| `PRIVATE_KEY` | Hex-encoded private key for signing transactions |
| `ACCOUNT` | Hex address to use as the sender (read-only, no signing) |
| `PERPLEXITY_API_KEY` | Perplexity AI search tools |
| `ZEROX_API_KEY` | 0x swap/quote tools |
| `TALLY_API_KEY` | Tally governance tools |
| `COINDESK_API_KEY` | CoinDesk news/data tools |
| `COINMARKETCAL_API_KEY` | CoinMarketCal event tools |
| `FIREWORKS_API_KEY` | Fireworks AI tools |
| `PINATA_JWT` | Pinata IPFS tools |
| `X_BEARER_TOKEN` | X/Twitter read tools |
| `X_API_KEY` | X/Twitter OAuth app key |
| `X_API_KEY_SECRET` | X/Twitter OAuth app secret |
| `X_ACCESS_TOKEN` | X/Twitter OAuth user access token |
| `X_ACCESS_TOKEN_SECRET` | X/Twitter OAuth user access token secret |

## Examples

List all available tools:

```bash
agentek list
# ["getBalance","getBlock","getBlockNumber",...]
```

Inspect a tool before using it:

```bash
agentek info getBalance
# { "name": "getBalance", "description": "...", "parameters": {...}, "supportedChains": [...] }
```

Get the latest block number on Ethereum mainnet:

```bash
agentek exec getBlockNumber --chainId 1
# { "blockNumber": "21547832" }
```

Check an address's ETH balance:

```bash
agentek exec getBalance --address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 --chainId 1
```

Resolve an ENS name:

```bash
agentek exec getEnsAddress --name vitalik.eth --chainId 1
```

## Tips

- Always run `agentek info <tool>` before `exec` to see required parameters and their types.
- Use `--chainId` to target a specific chain. Common chain IDs: `1` (Ethereum), `10` (Optimism), `42161` (Arbitrum), `137` (Polygon), `8453` (Base).
- Tools that write on-chain require `PRIVATE_KEY`. Read-only tools work without it.
- Pipe output to `jq` for filtering: `agentek exec getBalance --address 0x... | jq '.balance'`.
- The CLI times out after 120 seconds per tool execution.
