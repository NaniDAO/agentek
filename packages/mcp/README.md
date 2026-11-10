# Agentek MCP Server

A Model Context Protocol server offering tools for cryptocurrency research and Ethereum-based automation.

Works with Claude Desktop, Cursor, and other MCP-friendly apps.

## ✨ Features

- Connect to Ethereum, Optimism, Arbitrum & Polygon
- Play with DeFi (Aave, DEXs, etc.)
- Look up ENS domains, transfer tokens, check security
- Get crypto news and market data

## 🧰 Tools

- Tokens (ERC20, WETH)
- DeFi (trading, lending)
- Block explorers
- Governance tools
- Security checks
- Basic web tools
- All Agentek tools based on keys you provide.

### Claude Desktop Setup

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentek": {
      "command": "pnpx",
      "args": ["@agentek/mcp-server"],
      "env": {
        "ACCOUNT": "YOUR_ETHEREUM_ADDRESS",
        "AGENTEK_EXECUTION_MODE": "prepare"
      }
    }
  }
}
```

Just use ACCOUNT for read-only if you're trying things out. To submit transactions, configure a signer and set `AGENTEK_EXECUTION_MODE=execute`. The default `prepare` mode returns unsigned operations. EVM outcomes are persisted under `AGENTEK_CONFIG_DIR/executions` (default `~/.agentek/executions`); reconcile ambiguous or partial executions before acknowledging their chain lock with the CLI.

### Networks

The shared registry configures Ethereum, Optimism, Arbitrum, Polygon, Base,
Mode, Sepolia and Robinhood Chain. Individual tools declare their supported subset.
Override endpoints with `RPC_URLS` (`chainId=url` pairs), `RPC_URL_<chainId>`, or
friendly aliases such as `ETHEREUM_RPC_URL` and `BASE_RPC_URL`, in that precedence order.
Requests use bounded transports. Solana uses `SOLANA_RPC_URL`; omitting a tool's
cluster parameter preserves the configured endpoint.


### Coming Soon

Better wallet connection methods! Currently using plain text keys to keep things simple while in beta.

## License

AGPL-3.0
