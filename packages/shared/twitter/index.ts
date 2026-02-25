import {
  createSearchRecentTweetsTool,
  createGetTweetByIdTool,
  createGetUserByUsernameTool,
  createGetUserTweetsTool,
  createGetHomeTimelineTool,
} from "./tools.js";
import { createToolCollection } from "../client.js";
import type { BaseTool } from "../client.js";
import { TwitterApi } from "twitter-api-v2";

async function fetchBearerToken(
  apiKey: string,
  apiKeySecret: string,
): Promise<string> {
  const credentials = btoa(`${apiKey}:${apiKeySecret}`);
  const response = await fetch("https://api.x.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to obtain X Bearer Token (${response.status}): ${body}`,
    );
  }

  const data = await response.json();
  return data.access_token;
}

export type TwitterToolsConfig = (
  | { xBearerToken: string }
  | { xApiKey: string; xApiKeySecret: string }
) & {
  xAccessToken?: string;
  xAccessTokenSecret?: string;
};

export async function twitterTools(
  config: TwitterToolsConfig,
): Promise<BaseTool[]> {
  let bearerToken: string;

  if ("xBearerToken" in config && config.xBearerToken) {
    bearerToken = config.xBearerToken;
  } else if (
    "xApiKey" in config &&
    config.xApiKey &&
    "xApiKeySecret" in config &&
    config.xApiKeySecret
  ) {
    bearerToken = await fetchBearerToken(config.xApiKey, config.xApiKeySecret);
  } else {
    throw new Error(
      "X (Twitter) credentials required: provide either xBearerToken, or xApiKey + xApiKeySecret.",
    );
  }

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
    const userClient = new TwitterApi({
      appKey: config.xApiKey,
      appSecret: config.xApiKeySecret,
      accessToken: config.xAccessToken,
      accessSecret: config.xAccessTokenSecret,
    });
    tools.push(createGetHomeTimelineTool(userClient));
  }

  return createToolCollection(tools);
}
