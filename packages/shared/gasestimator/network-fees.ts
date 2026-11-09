import { parseAbi, type Hex } from "viem";
const oracle="0x420000000000000000000000000000000000000f" as const;
const abi=parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)","function getOperatorFee(uint256) view returns (uint256)"]);
export const opFeeChains=new Set([10,8453,84532,11155420]);
export const arbitrumFeeChains=new Set([42161,421614,4663]);
export const ordinaryFeeChains=new Set([1,11155111,137,80002]);
const uint=(value:unknown):bigint=>{if(typeof value!=="bigint"||value<0n||value>=(1n<<256n))throw new Error("Unreadable fee component");return value;};
/** Same predeploy strategy as native NetworkAdditionalFees. No inferred zero fees. */
export async function additionalFeeReserve(rpc:any,chainId:number,data:Hex,gas:bigint){
  if(!opFeeChains.has(chainId))throw new Error("No separate-fee model configured");
  if(!/^0x(?:[0-9a-fA-F]{2})*$/.test(data)||data.length>262146||gas<=0n||gas>12000000n)throw new Error("Invalid fee envelope");
  const size=BigInt((data.length-2)/2+1024);
  const l1=uint(await rpc.readContract({address:oracle,abi,functionName:"getL1FeeUpperBound",args:[size]}));
  const operator=uint(await rpc.readContract({address:oracle,abi,functionName:"getOperatorFee",args:[gas]}));
  const reserve=(l1+operator)*2n;
  if(reserve>=(1n<<256n))throw new Error("Fee overflow");
  return {l1DataFeeWei:l1.toString(),operatorFeeWei:operator.toString(),additionalReserveWei:reserve.toString(),envelopeBytes:size.toString()};
}
