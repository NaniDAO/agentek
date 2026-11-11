import {afterEach, describe, expect, it, vi} from "vitest";
import {http, parseAbi, encodeFunctionData} from "viem";
import {sepolia} from "viem/chains";
import {createAgentekClient} from "../client.js";
import {intentWriteContractTool, readContractTool} from "./tools.js";
import {getSmartContract} from "../blockscout/tools.js";
import {researchCA} from "../researchCA/tools.js";

const address = "0x6ff0a5b8ae3cfb24f4f47c28baa8140983acf118";
const abi = parseAbi(["function mint() payable", "function name() view returns (string)"]);
const make = () => createAgentekClient({chains:[sepolia], transports:[http()], accountOrAddress:address, tools:[intentWriteContractTool,readContractTool,getSmartContract,researchCA]});
afterEach(() => {vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("Sepolia contract workflows", () => {
  it("constructs exact unsigned mint calldata with explicit ABI without explorer access", async () => {
    const fetch = vi.fn();vi.stubGlobal("fetch",fetch);
    const result = await make().execute("intentWriteContract",{address,chainId:sepolia.id,functionName:"mint",abi,value:"123"});
    expect(result).toMatchObject({chain:sepolia.id,ops:[{target:address,value:"123",data:encodeFunctionData({abi,functionName:"mint"})}]});
    expect(result.hash).toBeUndefined();expect(fetch).not.toHaveBeenCalled();
  });
  it("auto-fetches the Sepolia ABI for reads and unsigned writes", async () => {
    const fetch = vi.fn(async input => {expect(String(input)).toBe(`https://eth-sepolia.blockscout.com/api/v2/smart-contracts/${address}`);return Response.json({abi});});
    vi.stubGlobal("fetch",fetch);
    const client = make();vi.spyOn(client.getPublicClient(sepolia.id),"readContract").mockResolvedValue("Test NFT");
    expect(await client.execute("readContract",{address,chainId:sepolia.id,functionName:"name"})).toBe("Test NFT");
    expect(await client.execute("intentWriteContract",{address,chainId:sepolia.id,functionName:"mint"})).toMatchObject({chain:sepolia.id,ops:[{data:"0x1249c58b"}]});
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("accepts numeric and string Sepolia explorer chain IDs", async () => {
    vi.stubGlobal("fetch",vi.fn(async input => {expect(String(input)).toContain("https://eth-sepolia.blockscout.com/api/v2/");return Response.json({abi});}));
    for(const chain of [sepolia.id,String(sepolia.id)]) expect(await make().execute("getSmartContract",{chain,address})).toMatchObject({abi});
  });
  it("researches Sepolia without fetching testnet USD market data", async () => {
    const fetch = vi.fn(async input => {expect(String(input)).toContain("https://eth-sepolia.blockscout.com/api/v2/");return Response.json({items:[],abi,is_verified:true});});vi.stubGlobal("fetch",fetch);
    const client=make(), rpc=client.getPublicClient(sepolia.id);
    vi.spyOn(rpc,"getCode").mockResolvedValue("0x1234");vi.spyOn(rpc,"readContract").mockRejectedValue(new Error("unavailable"));
    const result=await client.execute("researchCA",{address,chainId:sepolia.id});
    expect(result.chain).toEqual({id:sepolia.id,name:"Sepolia"});expect(result.market.pairCount).toBe(0);
    expect(result.sources.some(source=>source.error==="Testnet trading-market data is unsupported")).toBe(true);
  });
});
