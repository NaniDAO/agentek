import {
  createSearchRecentTweetsTool,
  createGetTweetByIdTool,
  createGetUserByUsernameTool,
  createGetUserTweetsTool,
} from "./tools.js";
import { createToolCollection } from "../client.js";
import type { BaseTool } from "../client.js";

export function twitterTools({
  xBearerToken,
}: {
  xBearerToken: string;
}): BaseTool[] {
  if (!xBearerToken) {
    throw new Error("X (Twitter) Bearer Token is required.");
  }

  return createToolCollection([
    createSearchRecentTweetsTool(xBearerToken),
    createGetTweetByIdTool(xBearerToken),
    createGetUserByUsernameTool(xBearerToken),
    createGetUserTweetsTool(xBearerToken),
  ]);
}
