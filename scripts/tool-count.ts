import { allTools } from "../src/shared";

const tools = allTools({
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  zeroxApiKey: process.env.ZEROX_API_KEY,
  tallyApiKey: process.env.TALLY_API_KEY,
  coindeskApiKey: process.env.COINDESK_API_KEY,
});

const markdown = `## Tools (${tools.length} total)

### Available Tools

${tools.map((tool, i) => `${i + 1}. ${tool.name}`).join("\n")}

`;

console.log(markdown);
