import { mainnet, base } from "viem/chains";
import { createTool } from "../client.js";
import { z } from "zod";
import { providerJSON } from "../utils/fetch.js";

const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const address = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/i.test(value);
const TIMEOUT = 15_000;
const minimum = { liquidityUSD: 10_000, volume24h: 5_000, trades24h: 20, pairAgeHours: 1 };

/** A relative activity heuristic over latest-profile candidates, not a market-wide ranking. */
export function rankProfile(profile: any, pairs: any[], now: number) {
  const matched = pairs.filter(p => address(p?.baseToken?.address) && p.baseToken.address.toLowerCase() === profile.tokenAddress.toLowerCase());
  matched.sort((a,b) => (finite(b?.liquidity?.usd) ?? -1) - (finite(a?.liquidity?.usd) ?? -1)
    || String(a.pairAddress ?? "").localeCompare(String(b.pairAddress ?? "")));
  const pair = matched[0];
  const liquidityUSD = finite(pair?.liquidity?.usd), volume24h = finite(pair?.volume?.h24), volume1h = finite(pair?.volume?.h1);
  const buys = finite(pair?.txns?.h24?.buys), sells = finite(pair?.txns?.h24?.sells);
  const trades24h = buys !== null && sells !== null && Number.isSafeInteger(buys) && Number.isSafeInteger(sells) && Number.isSafeInteger(buys+sells) ? buys + sells : null;
  const created = finite(pair?.pairCreatedAt);
  const pairAgeHours = created !== null && created <= now ? (now-created)/3_600_000 : null;
  const priceChange24h = typeof pair?.priceChange?.h24 === "number" && Number.isFinite(pair.priceChange.h24) ? pair.priceChange.h24 : null;
  const activityAcceleration = volume24h !== null && volume24h > 0 && volume1h !== null ? Math.min(4, 24*volume1h/volume24h) : null;
  const reasons: string[] = [];
  for (const [key,value] of Object.entries({liquidityUSD,volume24h,trades24h,pairAgeHours})) {
    if (value === null) reasons.push(`${key} unknown`);
    else if (value < minimum[key as keyof typeof minimum]) reasons.push(`${key} below minimum`);
  }
  const eligible = reasons.length === 0;
  // Liquidity and broad activity dominate; capped momentum cannot turn a thin pump into a ranked candidate.
  const trendScore = eligible ? Math.round(1000*(Math.log10(1+liquidityUSD!) + 2*Math.log10(1+volume24h!)
    + Math.log10(1+trades24h!) + (activityAcceleration ?? 0)/4 + Math.max(0,Math.min(25,priceChange24h ?? 0))/100))/1000 : null;
  const rawPrice = pair?.priceUsd;
  const priceUSD = typeof rawPrice === "string" && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(rawPrice) ? rawPrice : null;
  return {tokenAddress:profile.tokenAddress, description:typeof profile.description === "string" ? profile.description.slice(0,512) : null,
    priceUSD,volume24h,volume1h,priceChange24h,liquidityUSD,trades24h,pairAgeHours,activityAcceleration,
    pairAddress:pair?.pairAddress ?? null,dexId:pair?.dexId ?? null,
    paidBoosts:finite(pair?.boosts?.active), trendScore,eligible,exclusionReasons:reasons};
}

export const getLatestTokens = createTool({
  name:"getLatestTokens",
  description:"Rank Ethereum/Base candidates from Dexscreener's latest token profiles using liquidity, volume, trading activity and capped momentum. Returns the relative activity score, missing evidence and exclusions. Profiles can be promotional; this is neither market-wide organic trending nor a safety/recommendation score.",
  parameters:z.object({chainId:z.number().describe("1 for Ethereum or 8453 for Base")}), supportedChains:[mainnet,base],
  execute:async(_client,args)=>{
    const chain = args.chainId===1 ? "ethereum" : args.chainId===8453 ? "base" : null;
    if (!chain) throw new Error("Unsupported Dexscreener network; no fallback network is used");
    const raw=await providerJSON("https://api.dexscreener.com/token-profiles/latest/v1",{},"Profile discovery failed",{maximumBytes:2*1024*1024,timeoutMs:TIMEOUT});
    if (!Array.isArray(raw)) throw new Error("Unreadable profile discovery coverage");
    const matching=raw.filter(p=>p?.chainId===chain && address(p.tokenAddress));
    const unique=[...new Map(matching.map(p=>[p.tokenAddress.toLowerCase(),p])).values()];
    const profiles=unique.slice(0,60);const pairs:any[]=[];const errors:{addresses:string[];message:string}[]=[];
    for(let offset=0;offset<profiles.length;offset+=30){
      const addresses=profiles.slice(offset,offset+30).map(p=>p.tokenAddress);
      try {
        const page=await providerJSON(`https://api.dexscreener.com/tokens/v1/${chain}/${addresses.join(",")}`,{},"Pair evidence failed",{maximumBytes:4*1024*1024,timeoutMs:TIMEOUT});
        if(!Array.isArray(page)||page.length>10000)throw new Error("Unreadable pair evidence");
        pairs.push(...page.filter(p=>p?.chainId===undefined||p.chainId===chain));
      } catch { errors.push({addresses,message:"Pair evidence unavailable; these candidates are not verified empty."}); }
    }
    const now=Date.now();const candidates=profiles.map(p=>rankProfile(p,pairs,now));
    candidates.sort((a,b)=>(b.trendScore??-1)-(a.trendScore??-1)||a.tokenAddress.toLowerCase().localeCompare(b.tokenAddress.toLowerCase()));
    return {schemaVersion:1,chainId:args.chainId,observedAt:new Date(now).toISOString(),rankingVersion:"profile-activity-v1",minimum,
      trending:candidates.filter(p=>p.eligible),candidates,errors,complete:errors.length===0&&unique.length<=60,
      coverage:{source:"Dexscreener latest profiles",observedCandidates:unique.length,examinedCandidates:profiles.length,truncated:unique.length>60},
      note:"Relative activity among the latest-profile sample only. Profiles and boosts may be paid promotion; activity can be manipulated. Missing data excludes a candidate from ranking. No safety or sellability verdict."};
  },
});
