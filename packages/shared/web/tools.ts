import { z } from "zod";
import { createTool } from "../client";
import * as cheerio from "cheerio";

export const scrapeWebContent = createTool({
  name: "scrapeWebContent",
  description:
    "Given a URL, fetch the page's HTML and return the main text content as accurately as possible. Works for most websites.",
  parameters: z.object({
    website: z.string(),
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
