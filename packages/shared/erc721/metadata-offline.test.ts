import { expect, it } from "vitest";
import { getNFTMetadataTool } from "./tools.js";
const address = `0x${"1".repeat(40)}`;
it.each(["data:application/json;base64," + btoa('{"name":"Inline NFT"}'), "data:application/json," + encodeURIComponent('{"name":"Inline NFT"}')])("preserves bounded inline NFT metadata without a network transport", async tokenURI => {
  const client: any = {getPublicClient: () => ({readContract: async ({functionName}) => functionName === "tokenURI" ? tokenURI : functionName === "ownerOf" ? address : "NFT"})};
  const result = await getNFTMetadataTool.execute(client, {contractAddress: address, tokenId: "1", chainId: 1});
  expect(result.metadata).toEqual({name: "Inline NFT"}); expect(result.owner).toBe(address);
});
