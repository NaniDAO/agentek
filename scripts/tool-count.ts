import { allTools } from "../src/shared";

const tools = allTools({
  perplexityApiKey: process.env.PERPLEXITY_API_KEY,
  zeroxApiKey: process.env.ZEROX_API_KEY,
  tallyApiKey: process.env.TALLY_API_KEY,
});

console.log(`${tools.length} tools`);
console.log("list of tools:");

tools.forEach((tool, i) => console.log(`${i + 1} ${tool.name}`));
