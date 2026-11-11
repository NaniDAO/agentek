import { TwitterApi, type TwitterApiTokens } from "twitter-api-v2";
import { providerJSON } from "../utils/fetch.js";

/** Private control flow: signed credentials never enter a model-visible error. */
class SignedGet extends Error {
  constructor(readonly url: string, readonly headers: Record<string, string>) {
    super("Signed request ready");
  }
}

/**
 * twitter-api-v2 1.29 signs in getHttpRequestArgs, then invokes onBeforeRequest
 * before constructing its HTTP request. Capture that signed GET and stop SDK
 * execution at that hook: providerJSON owns redirects, decoded byte limits,
 * deadlines and cancellation. Keep OAuth implementation entirely in the SDK.
 */
async function signedJSON(tokens: TwitterApiTokens, path: string, query: Record<string, any> = {}): Promise<any> {
  const sdk = new TwitterApi(tokens, {plugins: [{
    onBeforeRequest({computedParams}) {
      const url = computedParams.url;
      if (computedParams.method !== "GET" || computedParams.body !== undefined ||
          url.origin !== "https://api.x.com" || !url.pathname.startsWith("/2/") || url.username || url.password) {
        throw new Error("Unsupported X timeline request");
      }
      throw new SignedGet(url.toString(), {...computedParams.headers});
    },
  }]});
  let signed: SignedGet;
  try {
    await sdk.get(`https://api.x.com/2/${path}`, query);
    throw new Error("X request signing hook was not invoked");
  } catch (error) {
    if (!(error instanceof SignedGet)) throw new Error("Unable to authorize X timeline request");
    signed = error;
  }
  return providerJSON(signed.url, {headers: signed.headers}, "X timeline request failed", {maximumBytes: 2 * 1024 * 1024});
}

/** The same minimal v2 interface used by the native credential transport. */
export function boundedHomeTimelineClient(tokens: TwitterApiTokens): TwitterApi {
  let userId: string | undefined;
  const me = async () => {
    const result = await signedJSON(tokens, "users/me");
    if (!result?.data || typeof result.data.id !== "string" || !/^[0-9]{1,30}$/.test(result.data.id)) throw new Error("Malformed X account response");
    userId = result.data.id;
    return result;
  };
  return {v2: {
    me,
    homeTimeline: async (query: Record<string, any>) => {
      if (!userId) await me();
      const result = await signedJSON(tokens, `users/${userId}/timelines/reverse_chronological`, query);
      return {data: result};
    },
  }} as unknown as TwitterApi;
}
