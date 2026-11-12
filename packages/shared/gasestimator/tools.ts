import * as z from "zod";
import { createTool } from "../client.js";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { getCryptoPriceTool } from "../cryptoprices/tools.js";
import { additionalFeeReserve,opFeeChains,arbitrumFeeChains,ordinaryFeeChains } from "./network-fees.js";
const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const transaction=z.object({from:address,to:address,data:z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).max(262146),value:z.string().regex(/^(0|[1-9][0-9]*)$/).max(78)}).strict();
const testnets=new Set([11155111,84532,11155420,421614,80002]);
const symbols:Record<number,string>={1:"ETH",11155111:"ETH",10:"ETH",8453:"ETH",84532:"ETH",11155420:"ETH",42161:"ETH",421614:"ETH",137:"POL",80002:"POL",4663:"ETH"};
export const estimateGasCostTool=createTool({
 name:"estimateGasCost",
 description:"Estimate a transaction fee reserve with exact wei components and explicit coverage. Supply the complete from/to/value/data on rollups. OP/Base include data and operator reserves; Arbitrum re-estimates the exact transaction because posting cost is included in RPC gas. Missing evidence leaves total cost unknown. Testnet assets have no USD value; this never authorizes signing.",
 parameters:z.object({chainId:z.number().int().positive().safe(),gasUnits:z.number().int().positive().max(12000000),maxFeePerGas:z.string().optional(),maxPriorityFeePerGas:z.string().optional(),transaction:transaction.optional()}),
 execute:async(client,args)=>{
  const rpc=client.getPublicClient(args.chainId);
  const nativeSymbol=symbols[args.chainId]??rpc.chain?.nativeCurrency.symbol??null;
  let fees;
  if(!args.maxFeePerGas||!args.maxPriorityFeePerGas){try{fees=await rpc.estimateFeesPerGas();}catch{fees={maxFeePerGas:await rpc.getGasPrice(),maxPriorityFeePerGas:0n};}}
  const price=args.maxFeePerGas?parseUnits(args.maxFeePerGas,9):fees?.maxFeePerGas;
  const tip=args.maxPriorityFeePerGas?parseUnits(args.maxPriorityFeePerGas,9):fees?.maxPriorityFeePerGas;
  if(typeof price!=="bigint"||typeof tip!=="bigint"||price<=0n||tip<0n||tip>price||price>2000000000000n)throw new Error("Invalid fee price evidence");
  let gas=BigInt(args.gasUnits),additional:Awaited<ReturnType<typeof additionalFeeReserve>>|null=null;
  let complete=ordinaryFeeChains.has(args.chainId),reason:string|null=complete?null:"Complete fee model unavailable for this network";
  if(opFeeChains.has(args.chainId)||arbitrumFeeChains.has(args.chainId)){
    if(!args.transaction){complete=false;reason="Supply the exact transaction to estimate all network charges";}
    else {
      try{
        const chain=await rpc.getChainId();if(chain!==args.chainId)throw new Error("RPC network mismatch");
        const tx=args.transaction;
        gas=await rpc.estimateGas({account:tx.from as Address,to:tx.to as Address,data:tx.data as Hex,value:BigInt(tx.value)});
        if(gas<=0n||gas>12000000n)throw new Error("Invalid gas estimate");
        if(opFeeChains.has(args.chainId))additional=await additionalFeeReserve(rpc,args.chainId,tx.data as Hex,gas);
        complete=true;reason=null;
      }catch{complete=false;reason="Exact transaction or additional fee evidence unavailable; no total fee is known";}
    }
  }
  const execution=gas*price;
  const extra=complete?BigInt(additional?.additionalReserveWei??"0"):null;
  const total=extra===null?null:execution+extra;
  if(execution>=(1n<<256n)||total!==null&&total>=(1n<<256n))throw new Error("Fee overflow");
  let usdPrice:number|null=null,usdCost:string|null=null;
  if(!testnets.has(args.chainId)&&total!==null&&nativeSymbol){try{
    const quote=await getCryptoPriceTool.execute(client,{symbol:nativeSymbol==="POL"?"polygon-ecosystem-token":nativeSymbol});
    if(typeof quote.price==="number"&&Number.isFinite(quote.price)&&quote.price>0){usdPrice=quote.price;const cost=Number(formatUnits(total,18))*usdPrice;if(Number.isFinite(cost))usdCost=cost.toFixed(2);}
  }catch{}}
  return {schemaVersion:1,chainId:args.chainId,gasUnits:Number(gas),maxFeePerGas:formatUnits(price,9),maxPriorityFeePerGas:formatUnits(tip,9),nativeSymbol,
    executionFeeWei:execution.toString(),additionalFeeWei:extra?.toString()??null,totalFeeWei:total?.toString()??null,
    totalCost:total===null?null:formatUnits(total,18),executionCost:formatUnits(execution,18),additionalFees:additional,
    coverage:complete?"complete-estimate":"incomplete",reason,feeModel:opFeeChains.has(args.chainId)?"op-data-and-operator":arbitrumFeeChains.has(args.chainId)?"arbitrum-posting-in-gas":ordinaryFeeChains.has(args.chainId)?"ordinary-evm":"unknown",
    isReserve:true,additionalFeeEnforceableCap:false,usdPrice,usdCost,timestamp:new Date().toISOString(),
    nextStep:"Re-estimate the complete transaction during native review before approval. A reserve is not a guaranteed final charge."};
 }
});
