import { providerJSON } from "../utils/fetch.js";

export interface TwitterTokens {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
}
export interface HomeTimelineClient {
  v2: {
    me(): Promise<{data: {id: string}}>;
    homeTimeline(query: Record<string, unknown>): Promise<{data: any}>;
  };
}
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/** RFC 5849 HMAC-SHA1 signing for GET requests, with no SDK HTTP path. */
export async function signOAuthGet(url: URL, tokens: TwitterTokens, nonce: string, timestamp: string): Promise<string> {
  const oauth: Record<string, string> = {oauth_consumer_key: tokens.appKey, oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1", oauth_timestamp: timestamp, oauth_token: tokens.accessToken, oauth_version: "1.0"};
  const pairs = [...url.searchParams.entries(), ...Object.entries(oauth)]
    .map(([key, value]) => [encode(key), encode(value)])
    .sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  const base = ["GET", encode(`${url.origin}${url.pathname}`), encode(pairs.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(`${encode(tokens.appSecret)}&${encode(tokens.accessSecret)}`), {name: "HMAC", hash: "SHA-1"}, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(base)));
  oauth.oauth_signature = btoa(String.fromCharCode(...signature));
  return "OAuth " + Object.entries(oauth).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${encode(k)}="${encode(v)}"`).join(", ");
}

async function signedJSON(tokens: TwitterTokens, path: string, query: Record<string, unknown> = {}): Promise<any> {
  const url = new URL(`https://api.x.com/2/${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  const authorization = await signOAuthGet(url, tokens, nonce, Math.floor(Date.now() / 1000).toString());
  return providerJSON(url.toString(), {headers: {Authorization: authorization}}, "X timeline request failed", {maximumBytes: 2 * 1024 * 1024});
}

export function boundedHomeTimelineClient(tokens: TwitterTokens): HomeTimelineClient {
  let userId: string | undefined;
  const me = async () => {
    const result = await signedJSON(tokens, "users/me");
    if (!result?.data || typeof result.data.id !== "string" || !/^[0-9]{1,30}$/.test(result.data.id)) throw new Error("Malformed X account response");
    userId = result.data.id;
    return result;
  };
  return {v2: {
    me,
    homeTimeline: async query => {
      if (!userId) await me();
      return {data: await signedJSON(tokens, `users/${userId}/timelines/reverse_chronological`, query)};
    },
  }};
}
