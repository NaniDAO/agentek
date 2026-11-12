import { assertToolInput } from "../utils/tool-input.js";
import type { BaseTool } from '../client.js';
import { searchTools } from '../search/index.js';
import { coindeskTools } from '../coindesk/index.js';
import { createCoinMarketCalTools } from '../coinmarketcal/index.js';
import { createTallyProposalsTool, createTallyChainsTool, createTallyUserDaosTool } from '../tally/tools.js';


// Configuration contains presence flags only. The native host attaches secrets to
// pinned requests. Registering tools never authenticates or contacts a provider.
export function credentialTools(enabled: string[] = []): BaseTool[] {
  const has = (id: string) => enabled.includes(id);
  const reference = 'nani-native-credential';
  const tools: BaseTool[] = [];
  if (has('perplexity.apiKey')) tools.push(...searchTools({ perplexityApiKey: reference }));
  if (has('coindesk.apiKey')) tools.push(...coindeskTools({ coindeskApiKey: reference }));
  if (has('coinmarketcal.apiKey')) tools.push(...createCoinMarketCalTools({ coinMarketCalApiKey: reference }));
  if (has('tally.apiKey')) tools.push(createTallyProposalsTool(reference), createTallyChainsTool(reference), createTallyUserDaosTool(reference));
  return tools.map(tool => ({...tool, execute: async (client, args) => { assertToolInput(args); return tool.execute(client, tool.parameters.parse(args)); }}));
}
