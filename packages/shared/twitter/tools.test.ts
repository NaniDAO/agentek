import { describe, it, expect, beforeAll } from "vitest";
import {
  createSearchRecentTweetsTool,
  createGetTweetByIdTool,
  createGetUserByUsernameTool,
  createGetUserTweetsTool,
  createGetHomeTimelineTool,
} from "./tools.js";
import { twitterTools } from "./index.js";
import {
  createTestClient,
  validateToolStructure,
  hasEnvVar,
  withRetry,
} from "../test-helpers.js";
import type { BaseTool, AgentekClient } from "../client.js";

import { TwitterApi } from "twitter-api-v2";

const BEARER_TOKEN = process.env.X_BEARER_TOKEN || "test-token";
const HAS_TOKEN = hasEnvVar("X_BEARER_TOKEN");

const HAS_USER_KEYS =
  hasEnvVar("X_API_KEY") &&
  hasEnvVar("X_API_KEY_SECRET") &&
  hasEnvVar("X_ACCESS_TOKEN") &&
  hasEnvVar("X_ACCESS_TOKEN_SECRET");

// Tools created directly (sync, for structure/param tests)
const searchTool = createSearchRecentTweetsTool(BEARER_TOKEN);
const getTweetTool = createGetTweetByIdTool(BEARER_TOKEN);
const getUserTool = createGetUserByUsernameTool(BEARER_TOKEN);
const getUserTweetsTool = createGetUserTweetsTool(BEARER_TOKEN);

// Home timeline tool requires a TwitterApi instance (use dummy for structure tests)
const dummyTwitterClient = new TwitterApi({
  appKey: "test",
  appSecret: "test",
  accessToken: "test",
  accessSecret: "test",
});
const homeTimelineTool = createGetHomeTimelineTool(dummyTwitterClient);

// Tools from async factory (tested in its own describe)
let tools: BaseTool[];
let client: AgentekClient;

beforeAll(async () => {
  tools = await twitterTools({ xBearerToken: BEARER_TOKEN });
  client = createTestClient(tools);
});

describe("Twitter Tools", () => {
  describe("Tool Collection", () => {
    it("twitterTools() with bearer token should return 4 tools", () => {
      expect(tools).toHaveLength(4);
      const names = tools.map((t) => t.name);
      expect(names).toContain("searchRecentTweets");
      expect(names).toContain("getTweetById");
      expect(names).toContain("getXUserByUsername");
      expect(names).toContain("getXUserTweets");
    });

    it("twitterTools() should reject empty bearer token", async () => {
      await expect(twitterTools({ xBearerToken: "" })).rejects.toThrow(
        "X (Twitter) credentials required",
      );
    });

    it("twitterTools() should reject empty api key + secret", async () => {
      await expect(
        twitterTools({ xApiKey: "", xApiKeySecret: "" }),
      ).rejects.toThrow("X (Twitter) credentials required");
    });

    it.skipIf(!HAS_USER_KEYS)(
      "twitterTools() with user keys should return 5 tools including getHomeTimeline",
      async () => {
        const userTools = await twitterTools({
          xApiKey: process.env.X_API_KEY!,
          xApiKeySecret: process.env.X_API_KEY_SECRET!,
          xAccessToken: process.env.X_ACCESS_TOKEN!,
          xAccessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET!,
        });
        expect(userTools).toHaveLength(5);
        const names = userTools.map((t) => t.name);
        expect(names).toContain("getHomeTimeline");
      },
    );
  });

  describe("Tool Structure", () => {
    it("searchRecentTweets should have valid tool structure", () => {
      const result = validateToolStructure(searchTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("getTweetById should have valid tool structure", () => {
      const result = validateToolStructure(getTweetTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("getXUserByUsername should have valid tool structure", () => {
      const result = validateToolStructure(getUserTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("getXUserTweets should have valid tool structure", () => {
      const result = validateToolStructure(getUserTweetsTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("getHomeTimeline should have valid tool structure", () => {
      const result = validateToolStructure(homeTimelineTool);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("all tools should have empty supportedChains", () => {
      for (const tool of [searchTool, getTweetTool, getUserTool, getUserTweetsTool, homeTimelineTool]) {
        expect(tool.supportedChains).toEqual([]);
      }
    });
  });

  describe("Parameter Validation", () => {
    it("searchRecentTweets should require query", () => {
      const result = searchTool.parameters.safeParse({});
      expect(result.success).toBe(false);
    });

    it("searchRecentTweets should accept valid params", () => {
      const result = searchTool.parameters.safeParse({
        query: "bitcoin",
        maxResults: 25,
        sortOrder: "recency",
      });
      expect(result.success).toBe(true);
    });

    it("searchRecentTweets should reject maxResults below 10", () => {
      const result = searchTool.parameters.safeParse({
        query: "bitcoin",
        maxResults: 5,
      });
      expect(result.success).toBe(false);
    });

    it("searchRecentTweets should reject maxResults above 100", () => {
      const result = searchTool.parameters.safeParse({
        query: "bitcoin",
        maxResults: 200,
      });
      expect(result.success).toBe(false);
    });

    it("searchRecentTweets should reject invalid sortOrder", () => {
      const result = searchTool.parameters.safeParse({
        query: "bitcoin",
        sortOrder: "invalid",
      });
      expect(result.success).toBe(false);
    });

    it("getTweetById should require tweetId", () => {
      const result = getTweetTool.parameters.safeParse({});
      expect(result.success).toBe(false);
    });

    it("getXUserByUsername should require username", () => {
      const result = getUserTool.parameters.safeParse({});
      expect(result.success).toBe(false);
    });

    it("getXUserTweets should require userId", () => {
      const result = getUserTweetsTool.parameters.safeParse({});
      expect(result.success).toBe(false);
    });

    it("getXUserTweets should accept optional filters", () => {
      const result = getUserTweetsTool.parameters.safeParse({
        userId: "12345",
        maxResults: 20,
        excludeReplies: true,
        excludeRetweets: true,
      });
      expect(result.success).toBe(true);
    });

    it("getXUserTweets should reject maxResults below 5", () => {
      const result = getUserTweetsTool.parameters.safeParse({
        userId: "12345",
        maxResults: 2,
      });
      expect(result.success).toBe(false);
    });

    it("getHomeTimeline should accept empty params", () => {
      const result = homeTimelineTool.parameters.safeParse({});
      expect(result.success).toBe(true);
    });

    it("getHomeTimeline should accept optional filters", () => {
      const result = homeTimelineTool.parameters.safeParse({
        maxResults: 25,
        excludeReplies: true,
        excludeRetweets: false,
      });
      expect(result.success).toBe(true);
    });

    it("getHomeTimeline should reject maxResults above 100", () => {
      const result = homeTimelineTool.parameters.safeParse({
        maxResults: 200,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Real API Calls", () => {
    it.skipIf(!HAS_TOKEN)(
      "searchRecentTweets should search for tweets",
      async () => {
        const result = await withRetry(() =>
          searchTool.execute(client, { query: "bitcoin lang:en -is:retweet", maxResults: 10 }),
        );

        expect(result).toHaveProperty("tweets");
        expect(Array.isArray(result.tweets)).toBe(true);
        expect(result).toHaveProperty("resultCount");

        if (result.tweets.length > 0) {
          const tweet = result.tweets[0];
          expect(tweet).toHaveProperty("id");
          expect(tweet).toHaveProperty("text");
          expect(tweet).toHaveProperty("createdAt");
          expect(tweet).toHaveProperty("author");
          expect(tweet).toHaveProperty("metrics");
          expect(tweet.author).toHaveProperty("username");
          expect(tweet.metrics).toHaveProperty("like_count");
        }
      },
      30000,
    );

    it.skipIf(!HAS_TOKEN)(
      "searchRecentTweets should support cashtag queries",
      async () => {
        const result = await withRetry(() =>
          searchTool.execute(client, { query: "$ETH -is:retweet", maxResults: 10 }),
        );

        expect(result).toHaveProperty("tweets");
        expect(Array.isArray(result.tweets)).toBe(true);
      },
      30000,
    );

    it.skipIf(!HAS_TOKEN)(
      "getXUserByUsername should look up a user",
      async () => {
        const result = await withRetry(() =>
          getUserTool.execute(client, { username: "elonmusk" }),
        );

        expect(result).toHaveProperty("id");
        expect(result).toHaveProperty("username");
        expect(result.username).toBe("elonmusk");
        expect(result).toHaveProperty("name");
        expect(result).toHaveProperty("description");
        expect(result).toHaveProperty("metrics");
        expect(result.metrics).toHaveProperty("followers_count");
        expect(result.metrics.followers_count).toBeGreaterThan(0);
      },
      30000,
    );

    it.skipIf(!HAS_TOKEN)(
      "getXUserByUsername should return error for nonexistent user",
      async () => {
        const result = await withRetry(() =>
          getUserTool.execute(client, {
            username: "thisisnotarealuserxyz123456789abc",
          }),
        );

        expect(result).toHaveProperty("error");
      },
      30000,
    );

    it.skipIf(!HAS_TOKEN)(
      "getXUserTweets should fetch user timeline",
      async () => {
        // First look up a user to get their ID
        const user = await withRetry(() =>
          getUserTool.execute(client, { username: "elonmusk" }),
        );
        expect(user).toHaveProperty("id");

        const result = await withRetry(() =>
          getUserTweetsTool.execute(client, {
            userId: user.id,
            maxResults: 5,
            excludeRetweets: true,
          }),
        );

        expect(result).toHaveProperty("tweets");
        expect(Array.isArray(result.tweets)).toBe(true);

        if (result.tweets.length > 0) {
          const tweet = result.tweets[0];
          expect(tweet).toHaveProperty("id");
          expect(tweet).toHaveProperty("text");
          expect(tweet).toHaveProperty("author");
        }
      },
      30000,
    );

    it.skipIf(!HAS_USER_KEYS)(
      "getHomeTimeline should fetch the authenticated user's feed",
      async () => {
        const userClient = new TwitterApi({
          appKey: process.env.X_API_KEY!,
          appSecret: process.env.X_API_KEY_SECRET!,
          accessToken: process.env.X_ACCESS_TOKEN!,
          accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
        });
        const tool = createGetHomeTimelineTool(userClient);
        const testClient = createTestClient([tool]);

        const result = await withRetry(() =>
          tool.execute(testClient, { maxResults: 5 }),
        );

        expect(result).toHaveProperty("tweets");
        expect(Array.isArray(result.tweets)).toBe(true);

        if (result.tweets.length > 0) {
          const tweet = result.tweets[0];
          expect(tweet).toHaveProperty("id");
          expect(tweet).toHaveProperty("text");
          expect(tweet).toHaveProperty("author");
        }
      },
      30000,
    );

    it.skipIf(!HAS_TOKEN)(
      "getTweetById should fetch a specific tweet",
      async () => {
        // First search for a tweet to get a valid ID
        const searchResult = await withRetry(() =>
          searchTool.execute(client, { query: "bitcoin lang:en", maxResults: 10 }),
        );

        expect(searchResult.tweets.length).toBeGreaterThan(0);
        const tweetId = searchResult.tweets[0].id;

        const result = await withRetry(() =>
          getTweetTool.execute(client, { tweetId }),
        );

        expect(result).toHaveProperty("id");
        expect(result.id).toBe(tweetId);
        expect(result).toHaveProperty("text");
        expect(result).toHaveProperty("author");
        expect(result).toHaveProperty("conversationId");
        expect(result).toHaveProperty("metrics");
      },
      30000,
    );
  });
});
