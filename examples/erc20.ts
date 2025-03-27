import { Hex, http } from "viem";
import { base, mainnet, sepolia } from "viem/chains";
import { ensTools } from "../packages/shared/ens";
import AgentekToolkit from "../packages/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { CoreMessage, CoreTool, generateText } from "ai";
import { transferTools } from "../packages/shared/transfer";
import { erc20Tools } from "../packages/shared/erc20";
import { searchTools } from "../packages/shared/search";

async function main() {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  let privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    privateKey = generatePrivateKey();
    console.log("PRIVATE_KEY:", privateKey);
  }

  const account = privateKeyToAccount(privateKey as Hex);

  const chains = [mainnet, base, sepolia];
  console.log("ACCOUNT:", account.address);
  console.log(
    "CHAINS:",
    chains.map((chain) => chain.id),
  );

  const toolkit = new AgentekToolkit({
    transports: [http(), http(), http()],
    chains,
    accountOrAddress: account,
    tools: [
      ...searchTools({ perplexityApiKey: process.env.PERPLEXITY_API_KEY! }),
      ...erc20Tools(),
      ...ensTools(),
      ...transferTools(),
    ],
  });

  const tools = toolkit.getTools();

  console.log("NUMBER OF TOOLS", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  const messages = [
    {
      role: "user",
      content: "Look up latest crypto news and make a summary",
      // "Please revoke the approval for spender shivanshi.eth on the USDC contract (0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8) on the Sepolia network. I want to completely remove their spending allowance.",
      // "Check if vitalik.eth has approved 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D (uniswap v2 router) for 0x6b175474e89094c44da98b954eedeac495271d0f (dai) and also give me all the deets on DAI and if he has a balance or whatevs",
    },
  ] as CoreMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const response = await generateText({
    model: openrouter("openai/gpt-4o-mini"),
    system: `YOUR ADDRESS: ${account.address}`,
    messages,
    maxSteps: 5,
    tools: tools as Record<string, CoreTool<any, any>>,
    experimental_activeTools: Object.keys(tools),
  });

  response.response.messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    if (typeof message.content === "string") {
      console.log(`${message.content}`);
    } else {
      message.content.forEach((content) => {
        if (content.type === "text") {
          console.log(`${content.text}`);
        } else if (content.type === "tool-call") {
          // console.log(`[Tool:${content.toolName}]`);
          // console.log(`${JSON.stringify(content.args, null, 2)}`);
        } else if (content.type === "tool-result") {
          // console.log(`\n---\n${JSON.stringify(content.result, null, 2)}`);
        }
      });
    }
  });
}

main()
  .then((_o) => console.log("--fin--"))
  .catch((e) => console.error(e));
