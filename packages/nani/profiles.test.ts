import { expect, it } from "vitest";
import { embeddedTools as iphoneTools } from "./iphone-tools.js";
import { embeddedTools as macosTools } from "./macos-tools.js";
import { embeddedTools as universalTools } from "./universal-tools.js";
import { toolInputSchema } from "../shared/schema.js";

it("keeps Solana and optional SDK collections out of every embedded profile", () => {
  for (const tools of [iphoneTools(["jupiter.apiKey"]), macosTools(), universalTools([], "macos")]) {
    const names = tools.map(tool => tool.name);
    expect(names).toContain("getBalance");
    expect(names).toContain("getQuote");
    expect(names).toContain("resolveWNS");
    for (const name of names) expect(name).not.toMatch(/solana|^getSolBalance$|^x402|scrapeWebContent/i);
    for (const tool of tools) expect(toolInputSchema(tool.parameters).type, tool.name).toBe("object");
  }
});
it("selects platform collections explicitly and preserves native X credentials", () => {
  expect(universalTools([], "macos").map(tool => tool.name)).toEqual(macosTools().map(tool => tool.name));
  expect(universalTools([], "iphone").map(tool => tool.name)).toEqual(iphoneTools().map(tool => tool.name));
  expect(iphoneTools(["x.bearerToken"]).some(tool => tool.name === "searchRecentTweets")).toBe(true);
  expect(iphoneTools().some(tool => tool.name === "searchRecentTweets")).toBe(false);
});

it("excludes X and Solana from nani-chan even when all legacy credentials are enabled", async () => {
  const {embeddedTools, credentialOrigins} = await import("./nani-chan-tools.js");
  const tools = embeddedTools(["x.bearerToken", "x.apiKey", "x.apiKeySecret", "x.accessToken", "x.accessTokenSecret", "jupiter.apiKey", "perplexity.apiKey", "coindesk.apiKey", "coinmarketcal.apiKey", "tally.apiKey"]);
  const names = tools.map(tool => tool.name);
  for (const name of names) expect(name).not.toMatch(/solana|^getSolBalance$|Tweet|^getXUser|HomeTimeline/);
  for (const name of ["getQuote", "resolveWNS", "askPerplexitySearch", "getMarketEvents", "tallyChains"]) expect(names).toContain(name);
  expect(credentialOrigins).toHaveLength(4);
  expect(credentialOrigins.join(" ")).not.toMatch(/api\.x\.com|jup|solana/);
});
