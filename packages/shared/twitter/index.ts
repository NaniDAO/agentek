import {
  createSearchRecentTweetsTool,
  createGetTweetByIdTool,
  createGetUserByUsernameTool,
  createGetUserTweetsTool,
} from "./tools.js";
import { createToolCollection } from "../client.js";
import type { BaseTool } from "../client.js";

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

export type TwitterToolsConfig =
  | { xBearerToken: string }
  | { xApiKey: string; xApiKeySecret: string };

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

  return createToolCollection([
    createSearchRecentTweetsTool(bearerToken),
    createGetTweetByIdTool(bearerToken),
    createGetUserByUsernameTool(bearerToken),
    createGetUserTweetsTool(bearerToken),
  ]);
}
