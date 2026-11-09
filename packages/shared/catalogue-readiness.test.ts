import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {getActiveApprovalsTool,intentRevokeAllApprovalsTool} from './approvals/tools.js';
import {resolveTokenTool} from './resolveToken/tools.js';
import {rankProfile} from './dexscreener/tools.js';
import {estimateGasCostTool} from './gasestimator/tools.js';
import {getCryptoPriceTool} from './cryptoprices/tools.js';
import {intentStakeNani} from './nani/intents.js';
import {decodeFunctionData,erc20Abi} from 'viem';
vi.mock('wns-utils',()=>({createWnsClient:()=>({makeCommitment:vi.fn(async()=>`0x${'a'.repeat(64)}`),encodeCommit:()=>({to:'0x1111111111111111111111111111111111111111',data:'0x1234'}),encodeReveal:()=>({to:'0x1111111111111111111111111111111111111111',data:'0xabcd',value:1n})})}));
import {intentRegisterWNSTool} from './wns/tools.js';
const owner='0x1111111111111111111111111111111111111111',token='0x2222222222222222222222222222222222222222';
const call=(tool:any,client:any,args:any)=>tool.execute(client,tool.parameters.parse(args));
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('Network forbidden')})));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('catalogue evidence and workflow contracts',()=>{
 it('rejects failed scans and preserves unreadable allowances',async()=>{
  const fetch=vi.fn(async()=>Response.json({status:'0',message:'NOTOK',result:null}));vi.stubGlobal('fetch',fetch);
  await expect(call(getActiveApprovalsTool,{}, {owner,chainId:1})).rejects.toThrow(/unknown/);
  fetch.mockImplementation(async()=>Response.json({status:'1',result:[{address:token,topics:['0x','0x','0x'+'0'.repeat(24)+owner.slice(2)]}]}));
  const client:any={getPublicClient:()=>({multicall:async()=>[{status:'failure'},{status:'success',result:18},{status:'success',result:'TEST'},{status:'success',result:'Test'}]})};
  const result=await call(getActiveApprovalsTool,client,{owner,chainId:1});
  expect(result.approvals).toEqual([]);expect(result.complete).toBe(false);expect(result.unknownAllowances[0].allowance).toBeNull();
  await expect(call(intentRevokeAllApprovalsTool,client,{chainId:1})).rejects.toThrow();
 });
 it('returns explicit token choices rather than first provider order',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json([
   {id:'two',symbol:'REVIEWCOLLISION',name:'Second',platforms:{ethereum:token}},
   {id:'one',symbol:'REVIEWCOLLISION',name:'First',platforms:{ethereum:owner}},
  ])));
  const rpc=vi.fn(async()=>6);const client:any={getPublicClient:()=>({readContract:rpc})};
  const result=await call(resolveTokenTool,client,{symbol:'REVIEWCOLLISION',chainId:1});
  expect(result.status).toBe('ambiguous');expect(result.address).toBeNull();expect(result.authorizesConstruction).toBe(false);expect(result.candidates).toHaveLength(2);expect(rpc).not.toHaveBeenCalled();
  const selected=await call(resolveTokenTool,client,{symbol:'REVIEWCOLLISION',chainId:1,coingeckoId:'two'});
  expect(selected.address).toBe(token);expect(selected.decimals).toBe(6);expect(selected.authorizesConstruction).toBe(false);
 });
 it('ranks real activity above a thin price pump, excluding unknown metrics',()=>{
  const now=1800000000000;const profile={tokenAddress:token};
  const pair={baseToken:{address:token},liquidity:{usd:100000},volume:{h24:100000,h1:10000},txns:{h24:{buys:100,sells:100}},pairCreatedAt:now-86400000,priceChange:{h24:10}};
  const active=rankProfile(profile,[pair],now);expect(active.eligible).toBe(true);expect(rankProfile(profile,[{...pair,baseToken:{address:token.toUpperCase()}}],now).eligible).toBe(true);expect(active.trendScore).toBeGreaterThan(0);
  expect(rankProfile(profile,[{...pair,liquidity:{usd:1},priceChange:{h24:10000}}],now).eligible).toBe(false);
  const unknown=rankProfile(profile,[{baseToken:{address:token}}],now);expect(unknown.trendScore).toBeNull();expect(unknown.exclusionReasons).toContain('liquidityUSD unknown');
  expect(rankProfile(profile,[{...pair,pairCreatedAt:now+1}],now).eligible).toBe(false);
 });
 it('returns separate confirmed WNS steps, without asking for signing authority',async()=>{
  const result=await call(intentRegisterWNSTool,{getAddress:async()=>owner},{label:'review',secret:'0x'+'a'.repeat(64),value:'1'});
  expect(result.ops).toBeUndefined();expect(result.owner).toBe(owner);expect(result.workflow.steps).toHaveLength(2);
  expect(result.workflow.steps[1]).toMatchObject({dependsOn:'commit',waitFor:'confirmation',minimumDelaySeconds:60});
 });
 it('uses an exact NANI allowance for the requested stake',async()=>{
  const client:any={getPublicClient:()=>({readContract:async()=>0n}),getAddress:async()=>owner,getWalletClient:()=>undefined};
  const result=await call(intentStakeNani,client,{amount:'2',chainId:1});
  expect(decodeFunctionData({abi:erc20Abi,data:result.ops[0].data}).args?.[1]).toBe(2000000000000000000n);
 });
});
describe('complete fee evidence',()=>{
 const tx={from:owner,to:token,data:'0x1234',value:'0'};
 const fixture=(chainId:number)=>{
  const readContract=vi.fn(async({functionName}:any)=>functionName==='getL1FeeUpperBound'?100n:20n);
  const estimateGas=vi.fn(async()=>21000n);
  const rpc:any={getChainId:async()=>chainId,estimateGas,readContract,estimateFeesPerGas:async()=>({maxFeePerGas:2_000_000_000n,maxPriorityFeePerGas:1_000_000_000n})};
  return {rpc,client:{getPublicClient:()=>rpc} as any,readContract,estimateGas};
 };
 for(const chainId of [10,8453])it(`includes data and operator charges on ${chainId}`,async()=>{
  vi.spyOn(getCryptoPriceTool,'execute').mockResolvedValue({price:3000} as any);
  const f=fixture(chainId);const result=await call(estimateGasCostTool,f.client,{chainId,gasUnits:1,transaction:tx});
  expect(result.coverage).toBe('complete-estimate');expect(result.gasUnits).toBe(21000);expect(result.additionalFeeWei).toBe('240');
  expect(BigInt(result.totalFeeWei)).toBe(BigInt(result.executionFeeWei)+240n);expect(f.readContract).toHaveBeenCalledTimes(2);
 });
 it('never invents zero additional fees after oracle failure or incomplete input',async()=>{
  const f=fixture(8453);const absent=await call(estimateGasCostTool,f.client,{chainId:8453,gasUnits:21000});expect(absent.totalFeeWei).toBeNull();
  f.readContract.mockRejectedValue(new Error('oracle unavailable'));
  const failed=await call(estimateGasCostTool,f.client,{chainId:8453,gasUnits:21000,transaction:tx});expect(failed.totalFeeWei).toBeNull();expect(failed.coverage).toBe('incomplete');
 });
 for(const chainId of [42161,4663])it(`uses Nitro ${chainId} estimate including posting, without a second L1 charge`,async()=>{
  vi.spyOn(getCryptoPriceTool,'execute').mockResolvedValue({price:3000} as any);
  const f=fixture(chainId);const result=await call(estimateGasCostTool,f.client,{chainId,gasUnits:1,transaction:tx});
  expect(result.gasUnits).toBe(21000);expect(result.additionalFeeWei).toBe('0');expect(f.readContract).not.toHaveBeenCalled();
 });
 it('keeps testnet USD and mismatched network totals unknown',async()=>{
  const price=vi.spyOn(getCryptoPriceTool,'execute');const f=fixture(11155111);
  const testnet=await call(estimateGasCostTool,f.client,{chainId:11155111,gasUnits:21000});expect(testnet.usdCost).toBeNull();expect(price).not.toHaveBeenCalled();
  const mismatch=await call(estimateGasCostTool,f.client,{chainId:8453,gasUnits:21000,transaction:tx});expect(mismatch.totalCost).toBeNull();
 });
});
