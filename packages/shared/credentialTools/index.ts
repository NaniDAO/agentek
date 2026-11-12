import { assertToolInput } from "../utils/tool-input.js";
import { providerJSON } from "../utils/fetch.js";
import type { BaseTool } from "../client.js";
import { credentialTools as baseCredentialTools } from "./base.js";
import { allCredentialOrigins } from "./origins.js";
import { installCredentialTransport as installTransport } from "./transport.js";
import { createSearchRecentTweetsTool, createGetTweetByIdTool, createGetUserByUsernameTool, createGetUserTweetsTool, createGetHomeTimelineTool } from "../twitter/tools.js";

export function credentialTools(enabled: string[] = []): BaseTool[] {
  const has = (id: string) => enabled.includes(id);
  const reference = "nani-native-credential";
  const tools: BaseTool[] = [];
  if (has('x.bearerToken') || (has('x.apiKey') && has('x.apiKeySecret'))) {
    tools.push(createSearchRecentTweetsTool(reference), createGetTweetByIdTool(reference), createGetUserByUsernameTool(reference), createGetUserTweetsTool(reference));
  }
  if (['x.apiKey', 'x.apiKeySecret', 'x.accessToken', 'x.accessTokenSecret'].every(has)) {
    // Shared tools keep timeline formatting; native host handles OAuth signatures.
    const get = async (path: string, params = {}) => {
      const query = new URLSearchParams(Object.entries(params).map(([k,v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]));
      return providerJSON(`https://api.x.com/2/${path}?${query}`, {headers: {'x-nani-private': 'true'}}, 'X timeline request failed', {maximumBytes: 2 * 1024 * 1024});
    };
    tools.push(createGetHomeTimelineTool({v2: {
      me: () => get('users/me'),
      homeTimeline: async (params: any) => {
        const me = await get('users/me');
        const result = await get(`users/${encodeURIComponent(me.data.id)}/timelines/reverse_chronological`, params);
        return {data: result};
      },
    }} as any));
  }
  return [...baseCredentialTools(enabled), ...tools.map(tool => ({...tool, execute: async (client, args) => { assertToolInput(args); return tool.execute(client, tool.parameters.parse(args)); }}))];
}
export function installCredentialTransport(host: (request: unknown) => Promise<any>, protocol: 0 | 1 = 1) {
  return installTransport(host, protocol, allCredentialOrigins);
}
