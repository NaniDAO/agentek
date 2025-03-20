# Agentek MCP Server

🚧 v0.1.10

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
      "args": [
        "@agentek/mcp-server"
      ],
      "env": {
        "ACCOUNT": "YOUR_ETHEREUM_ADDRESS",
        // or PRIVATE_KEY if you need transactions

        // Optional for added these features
        "PERPLEXITY_API_KEY": "YOUR_PERPLEXITY_KEY",
        "ZEROX_API": "YOUR_ZEROX_API_KEY",
        "BLOCKSCOUT_API_KEY": "BLOCKSCOUT_API_KEY",
        "TALLY_API_KEY": "TALLY_API_KEY",
        "COINDESK_API_KEY": "COINDESK_API_KEY",
        "COINMARKETCAL_API_KEY": "COINMARKETCAL_API_KEY",
      }
    }
  }
}
```

Just use ACCOUNT for read-only if you're trying things out. Only add a PRIVATE_KEY if you actually need to make transactions and if you understand the risks.

### Networks

You get these networks out of the box:
- Ethereum Mainnet
- Optimism
- Arbitrum
- Polygon

We'll make this customizable later.


### Coming Soon

Better wallet connection methods! Currently using plain text keys to keep things simple while in beta.

## License

AGPL-3.0
