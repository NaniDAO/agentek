import { z } from "zod";
import { createTool } from "../client.js";
import * as cheerio from "cheerio";

export const scrapeWebContent = createTool({
  name: "scrapeWebContent",
  description:
    "Fetch a web page and extract its main text content by stripping HTML tags, scripts, and styles. Works for most public websites.",
  parameters: z.object({
    website: z.string().describe("The full URL to scrape (e.g. 'https://example.com/page')"),
  }),
  execute: async (_client, args) => {
    const { website } = args;

    try {
      const response = await fetch(website);
      if (!response.ok) {
        throw new Error(`Failed to fetch URL (status: ${response.status}).`);
      }
      const html = await response.text();

      const $ = cheerio.load(html);

      $("script, style, noscript").remove();

      const textContent = $("body").text() || "";

      const cleanedText = textContent.replace(/\s+/g, " ").trim();

      return {
        website,
        text: cleanedText,
      };
    } catch (error: any) {
      throw new Error(`Error fetching text: ${error.message}`);
    }
  },
});
