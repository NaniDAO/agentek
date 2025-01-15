import { Hex, http } from "viem";
import { base } from "viem/chains";
import { ensTools } from "../src/shared/ens";
import NaniAgentToolkit from "../src/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

let privateKey = process.env.PRIVATE_KEY;

if (!privateKey) {
  privateKey = generatePrivateKey();
  console.log("PRIVATE_KEY:", privateKey);
}

const account = privateKeyToAccount(privateKey as Hex);

const toolkit = new NaniAgentToolkit({
  transport: http(),
  chain: base,
  accountOrAddress: account,
  tools: [...ensTools()],
});

const tools = toolkit.getTools();

console.log("tools", tools);
