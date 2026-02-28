import { z } from "zod";
import { createTool, AgentekClient } from "../client.js";

const getMarketEventsParams = z.object({
  showOnly: z
    .enum([
      "trending_events",
      "popular_events",
      "firmed_date",
      "confirmed_by_representatives",
    ])
    .optional()
    .describe("Filter events by category: 'trending_events', 'popular_events', 'firmed_date', or 'confirmed_by_representatives'. Omit to return all events."),
});

type Coin = {
  id: number;
  name: string;
  symbol: string;
};

type Category = {
  id: number;
  name: string;
};

export type MarketEvent = {
  id: number;
  title: object;
  coins: Coin[];
  date_event: string;
  displayed_date: string;
  can_occur_before: boolean;
  categories: Category[];
  proof: string;
  source: string;
  created_date: string;
  description: object;
  percentage: number;
  vote_count: number;
  is_trending: boolean;
  is_popular: boolean;
  trending_index: number;
  popular_index: number;
  influential_score: number;
  catalyst_score: number;
  confirmed_by_officials: boolean;
  alert_count: number;
  original_source: string;
  vote_history: any;
  view_history: any;
};

export type GetMarketEventsResponse = Omit<
  MarketEvent,
  "vote_history" | "view_history"
>[];

const BASE_URL = "https://developers.coinmarketcal.com/v1";

export const createMarketEventsTool = (apiKey: string) => {
  return createTool({
    name: "getMarketEvents",
    description:
      "Fetches upcoming cryptocurrency market events from CoinMarketCal (e.g. token launches, airdrops, listings, forks). Optionally filter by event category. Returns up to 50 events with dates, coins, proof links, and community votes.",
    parameters: getMarketEventsParams,
    execute: async (
      _client: AgentekClient,
      args: z.infer<typeof getMarketEventsParams>,
    ): Promise<GetMarketEventsResponse> => {
      const url = new URL(`${BASE_URL}/events`);

      Object.entries(args).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.append(key, value.toString());
        }
      });

      url.searchParams.append("lang", "en");
      url.searchParams.append("showViews", "true");
      url.searchParams.append("showVotes", "true");
      url.searchParams.append("max", "50"); // hardcoded, allow choice ?

      const options = {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Encoding": "deflate, gzip",
          "x-api-key": apiKey,
        },
      };

      try {
        const response = await fetch(url.toString(), options);

        if (!response.ok) {
          switch (response.status) {
            case 400:
              throw new Error("Bad Request: Invalid parameters");
            case 403:
              throw new Error("Invalid API key");
            case 429:
              throw new Error("Quota exceeded or too many requests");
            default:
              throw new Error(
                `API error: ${response.status} ${response.statusText}`,
              );
          }
        }

        const json: MarketEvent[] = (await response.json()).body;
        const filteredEvents = json.map((event) => {
          const { vote_history, view_history, ...rest } = event;
          return rest;
        });

        return filteredEvents;
      } catch (err) {
        throw new Error(
          `Failed to fetch market events: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  });
};
