import z from "zod";
import { createTool } from "../client.js";
import type { BaseTool, AgentekClient } from "../client.js";

const X_API_BASE = "https://api.x.com/2";

const DEFAULT_TWEET_FIELDS =
  "created_at,author_id,public_metrics,entities,referenced_tweets,conversation_id,lang";
const DEFAULT_USER_FIELDS =
  "created_at,description,public_metrics,profile_image_url,verified,location,url";
const DEFAULT_EXPANSIONS = "author_id";

async function xFetch(url: string, bearerToken: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`X API error ${response.status}: ${body}`);
  }

  return response.json();
}

export function createSearchRecentTweetsTool(
  bearerToken: string,
): BaseTool {
  return createTool({
    name: "searchRecentTweets",
    description:
      "Search recent tweets (last 7 days) on X/Twitter. Supports operators like from:user, #hashtag, $cashtag, -is:retweet, has:media, lang:en, etc. Useful for finding discussions about tokens, projects, trends, and people.",
    supportedChains: [],
    parameters: z.object({
      query: z
        .string()
        .describe(
          'Search query (max 512 chars). Supports operators: from:user, #hashtag, $cashtag, -is:retweet, -is:reply, has:media, has:links, lang:en, "exact phrase", OR, etc.',
        ),
      maxResults: z
        .number()
        .min(10)
        .max(100)
        .optional()
        .describe("Number of results (10-100, default 10)"),
      sortOrder: z
        .enum(["recency", "relevancy"])
        .optional()
        .describe("Sort by recency or relevancy (default recency)"),
    }),
    execute: async (_client: AgentekClient, args) => {
      const params = new URLSearchParams({
        query: args.query,
        "tweet.fields": DEFAULT_TWEET_FIELDS,
        "user.fields": DEFAULT_USER_FIELDS,
        expansions: DEFAULT_EXPANSIONS,
      });

      if (args.maxResults) params.set("max_results", String(args.maxResults));
      if (args.sortOrder) params.set("sort_order", args.sortOrder);

      const data = await xFetch(
        `${X_API_BASE}/tweets/search/recent?${params}`,
        bearerToken,
      );

      return formatTweetResponse(data);
    },
  });
}

export function createGetTweetByIdTool(bearerToken: string): BaseTool {
  return createTool({
    name: "getTweetById",
    description:
      "Get a specific tweet by its ID from X/Twitter. Returns the full tweet with author info and engagement metrics.",
    supportedChains: [],
    parameters: z.object({
      tweetId: z.string().describe("The tweet ID"),
    }),
    execute: async (_client: AgentekClient, args) => {
      const params = new URLSearchParams({
        "tweet.fields": DEFAULT_TWEET_FIELDS,
        "user.fields": DEFAULT_USER_FIELDS,
        expansions: DEFAULT_EXPANSIONS,
      });

      const data = await xFetch(
        `${X_API_BASE}/tweets/${args.tweetId}?${params}`,
        bearerToken,
      );

      return formatSingleTweet(data);
    },
  });
}

export function createGetUserByUsernameTool(
  bearerToken: string,
): BaseTool {
  return createTool({
    name: "getXUserByUsername",
    description:
      "Look up an X/Twitter user by their username/handle. Returns their profile info, follower counts, and bio.",
    supportedChains: [],
    parameters: z.object({
      username: z
        .string()
        .describe("The X/Twitter username (without the @ symbol)"),
    }),
    execute: async (_client: AgentekClient, args) => {
      const params = new URLSearchParams({
        "user.fields": DEFAULT_USER_FIELDS,
        expansions: "pinned_tweet_id",
        "tweet.fields": "created_at,text,public_metrics",
      });

      const data = await xFetch(
        `${X_API_BASE}/users/by/username/${args.username}?${params}`,
        bearerToken,
      );

      return formatUserResponse(data);
    },
  });
}

export function createGetUserTweetsTool(
  bearerToken: string,
): BaseTool {
  return createTool({
    name: "getXUserTweets",
    description:
      "Get recent tweets from a specific X/Twitter user by their user ID. Use getXUserByUsername first to get the user ID from a handle.",
    supportedChains: [],
    parameters: z.object({
      userId: z.string().describe("The numeric X/Twitter user ID"),
      maxResults: z
        .number()
        .min(5)
        .max(100)
        .optional()
        .describe("Number of results (5-100, default 10)"),
      excludeReplies: z
        .boolean()
        .optional()
        .describe("Exclude replies (default false)"),
      excludeRetweets: z
        .boolean()
        .optional()
        .describe("Exclude retweets (default false)"),
    }),
    execute: async (_client: AgentekClient, args) => {
      const params = new URLSearchParams({
        "tweet.fields": DEFAULT_TWEET_FIELDS,
        "user.fields": DEFAULT_USER_FIELDS,
        expansions: DEFAULT_EXPANSIONS,
      });

      if (args.maxResults) params.set("max_results", String(args.maxResults));

      const excludes: string[] = [];
      if (args.excludeReplies) excludes.push("replies");
      if (args.excludeRetweets) excludes.push("retweets");
      if (excludes.length > 0) params.set("exclude", excludes.join(","));

      const data = await xFetch(
        `${X_API_BASE}/users/${args.userId}/tweets?${params}`,
        bearerToken,
      );

      return formatTweetResponse(data);
    },
  });
}

// --- Response formatters ---

function formatTweetResponse(data: any) {
  if (!data.data) return { tweets: [], meta: data.meta };

  const usersMap = new Map<string, any>();
  if (data.includes?.users) {
    for (const user of data.includes.users) {
      usersMap.set(user.id, user);
    }
  }

  const tweets = data.data.map((tweet: any) => {
    const author = usersMap.get(tweet.author_id);
    return {
      id: tweet.id,
      text: tweet.text,
      createdAt: tweet.created_at,
      lang: tweet.lang,
      author: author
        ? {
            id: author.id,
            username: author.username,
            name: author.name,
            followers: author.public_metrics?.followers_count,
          }
        : { id: tweet.author_id },
      metrics: tweet.public_metrics,
      entities: tweet.entities,
      referencedTweets: tweet.referenced_tweets,
    };
  });

  return { tweets, resultCount: data.meta?.result_count };
}

function formatSingleTweet(data: any) {
  if (!data.data) return { error: "Tweet not found" };

  const tweet = data.data;
  const author = data.includes?.users?.[0];

  return {
    id: tweet.id,
    text: tweet.text,
    createdAt: tweet.created_at,
    lang: tweet.lang,
    author: author
      ? {
          id: author.id,
          username: author.username,
          name: author.name,
          followers: author.public_metrics?.followers_count,
        }
      : { id: tweet.author_id },
    metrics: tweet.public_metrics,
    entities: tweet.entities,
    referencedTweets: tweet.referenced_tweets,
    conversationId: tweet.conversation_id,
  };
}

function formatUserResponse(data: any) {
  if (!data.data) return { error: "User not found" };

  const user = data.data;
  const pinnedTweet = data.includes?.tweets?.[0];

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    description: user.description,
    location: user.location,
    url: user.url,
    createdAt: user.created_at,
    verified: user.verified,
    profileImageUrl: user.profile_image_url,
    metrics: user.public_metrics,
    pinnedTweet: pinnedTweet
      ? {
          id: pinnedTweet.id,
          text: pinnedTweet.text,
          createdAt: pinnedTweet.created_at,
          metrics: pinnedTweet.public_metrics,
        }
      : undefined,
  };
}
