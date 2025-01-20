import { Hex, http } from "viem";
import { base, mainnet, arbitrum, sepolia, mode } from "viem/chains";
import { ensTools } from "../src/shared/ens";
import AgentekToolkit from "../src/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { CoreMessage, CoreTool, generateText } from "ai";
import { transferTools } from "../src/shared/transfer";
import { dexscreenerTools } from "../src/shared/dexscreener";
import { rpcTools } from "../src/shared/rpc";

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

  const chains = [mainnet, mode, arbitrum, base, sepolia];
  console.log("ACCOUNT:", account.address);
  console.log(
    "CHAINS:",
    chains.map((chain) => chain.id),
  );

  const toolkit = new AgentekToolkit({
    transports: [
      http(),
      http("https://mainnet.mode.network"),
      http(),
      http(),
      http(),
    ],
    chains,
    accountOrAddress: account,
    tools: [...rpcTools(), ...ensTools()],
  });

  const tools = toolkit.getTools();

  console.log("NUMBER OF TOOLS", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  const messages = [
    {
      role: "user",
      content:
        "Get receipt for 0xa8d2e7503b44041cea85c310a25f6eca3d7ef57980d1bd54c771e456fd972fe9 on base",
    },
  ] as CoreMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const response = await generateText({
    model: openrouter("openai/gpt-4o-mini"),
    system: `You are an intelligent crypto analytics agent that employs Step-by-Step Reasoning.

Approach problems by:
1. Understanding the goal of the user's request
2. Breaking down the problem into discrete analysis steps
3. Using available tools and data to gather relevant information
4. Comparing and evaluating the data logically
5. Drawing data-backed conclusions

Available chains: ${chains.map((chain) => `name:${chain.name} and id:${chain.id}, `)}

Let's solve this problem through careful analysis and reasoning.`,
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
          console.log(`[Tool:${content.toolName}]`);
          console.log(`${JSON.stringify(content.args, null, 2)}`);
        } else if (content.type === "tool-result") {
          console.log(`\n---\n${JSON.stringify(content.result)}`);
        }
      });
    }
  });
}

main()
  .then((_o) => console.log("--fin--"))
  .catch((e) => console.error(e));
