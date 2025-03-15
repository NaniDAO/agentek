# Agentek MCP Server

🚧 v0.1.3

Hey! This is a basic MCP server that bundles all Agentek tools into one package. Works with Claude Desktop, Cursor, and other MCP-friendly apps.

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

## Requirements

- Node.js >= 18.17.0 (required for Fetch API support)
- npm, yarn, or pnpm

> **⚠️ Important Note for Claude Desktop Users**
>
> Claude Desktop may use an older version of Node.js that isn't compatible with this server. If you see errors like `Request is not defined` or `fetch is not defined`, you'll need to specify a modern Node.js version.
>
> We recommend using Node Version Manager (nvm) or Volta to manage your Node.js versions:
>
> ```bash
> # Using nvm
> nvm install 18.17.0
> nvm use 18.17.0
>
> # Or using volta
> volta install node@18.17.0
> ```

### Claude Desktop Setup

Add this to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentek": {
      "command": "npx",
      "args": [
        "-y",
        "--node-version=18.17.0",  // Specify Node.js version here
        "agentek-mcp-server"
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
