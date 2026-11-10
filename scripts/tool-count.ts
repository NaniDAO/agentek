import { allTools } from "../packages/shared";

// Tool registration is local; optional provider authentication happens on use.
const tools = await allTools({
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  zeroxApiKey: process.env.ZEROX_API_KEY,
  tallyApiKey: process.env.TALLY_API_KEY,
  coindeskApiKey: process.env.COINDESK_API_KEY,
  coinMarketCalApiKey: process.env.COINMARKETCAL_API_KEY,
  fireworksApiKey: process.env.FIREWORKS_API_KEY,
  pinataJWT: process.env.PINATA_JWT,
});

const markdown = `## Tools (${tools.length} total)

### Available Tools

${tools.map((tool, i) => `${i + 1}. ${tool.name}`).join("\n")}

`;

console.log(markdown);
