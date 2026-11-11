import { providerJSON } from "../utils/fetch.js";
import {
  createSearchRecentTweetsTool,
  createGetTweetByIdTool,
  createGetUserByUsernameTool,
  createGetUserTweetsTool,
  createGetHomeTimelineTool,
} from "./tools.js";
import { createToolCollection } from "../client.js";
import type { BaseTool } from "../client.js";
import { boundedHomeTimelineClient } from "./transport.js";

async function fetchBearerToken(
  apiKey: string,
  apiKeySecret: string,
): Promise<string> {
  const credentials = btoa(`${apiKey}:${apiKeySecret}`);
  const data = await providerJSON("https://api.x.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: "grant_type=client_credentials",
  }, "Failed to obtain X Bearer Token", {maximumBytes: 64 * 1024});
  if (!data || typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 4096) throw new Error("Invalid X token response");
  return data.access_token;
}

export type TwitterToolsConfig = {
  xBearerToken?: string; xApiKey?: string; xApiKeySecret?: string;
  xAccessToken?: string; xAccessTokenSecret?: string;
};

export async function twitterTools(
  config: TwitterToolsConfig,
): Promise<BaseTool[]> {
  if (!config.xBearerToken && !(config.xApiKey && config.xApiKeySecret)) throw new Error("X (Twitter) credentials required");
  let pending: Promise<string> | undefined;
  const bearerToken = async () => {
    if (config.xBearerToken) return config.xBearerToken;
    if (!config.xApiKey || !config.xApiKeySecret) throw new Error("X credentials required");
    pending ??= fetchBearerToken(config.xApiKey, config.xApiKeySecret).catch(error => { pending = undefined; throw error; });
    return pending;
  };

  const tools: BaseTool[] = [
    createSearchRecentTweetsTool(bearerToken),
    createGetTweetByIdTool(bearerToken),
    createGetUserByUsernameTool(bearerToken),
    createGetUserTweetsTool(bearerToken),
  ];

  // Home timeline requires user OAuth 1.0a credentials
  if (
    "xApiKey" in config &&
    config.xApiKey &&
    "xApiKeySecret" in config &&
    config.xApiKeySecret &&
    config.xAccessToken &&
    config.xAccessTokenSecret
  ) {
    const userClient = boundedHomeTimelineClient({
      appKey: config.xApiKey,
      appSecret: config.xApiKeySecret,
      accessToken: config.xAccessToken,
      accessSecret: config.xAccessTokenSecret,
    });
    tools.push(createGetHomeTimelineTool(userClient));
  }

  return createToolCollection(tools);
}
