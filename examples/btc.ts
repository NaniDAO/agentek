import { Hex, http } from "viem";
import { base, mainnet, arbitrum, sepolia, mode } from "viem/chains";
import { ensTools } from "@agentek/tools";
import AgentekToolkit from "@agentek/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ModelMessage, Tool, stepCountIs, generateText } from "ai";

import { btcRpcTools } from "@agentek/tools";

async function main() {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  let privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    privateKey = generatePrivateKey();
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
      http(
        `https://lb.drpc.org/ogrpc?network=ethereum&dkey=${process.env.DRPC_KEY}`,
      ),
      http(
        `https://lb.drpc.org/ogrpc?network=mode&dkey=${process.env.DRPC_KEY}`,
      ),
      http(
        `https://lb.drpc.org/ogrpc?network=arbitrum&dkey=${process.env.DRPC_KEY}`,
      ),
      http(
        `https://lb.drpc.org/ogrpc?network=base&dkey=${process.env.DRPC_KEY}`,
      ),
      http(
        `https://lb.drpc.org/ogrpc?network=sepolia&dkey=${process.env.DRPC_KEY}`,
      ),
    ],
    chains,
    accountOrAddress: account,
    tools: [...btcRpcTools()],
  });

  const tools = toolkit.getTools();

  console.log("NUMBER OF TOOLS", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  const messages = [
    {
      role: "user",
      content: "What's the balance and tx count of Satoshi's genesis address?",
    },
  ] as ModelMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const response = await generateText({
    model: openrouter("anthropic/claude-3.5-sonnet"),
    system: `You are an intelligent crypto analytics agent that employs Step-by-Step Reasoning.`,
    messages,
    stopWhen: stepCountIs(5),
    tools,
    activeTools: Object.keys(tools),
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
          console.log(`${JSON.stringify(content.input, null, 2)}`);
        } else if (content.type === "tool-result") {
          console.log(`\n---\n${JSON.stringify(content.output)}`);
        }
      });
    }
  });
}

main().catch(console.error);
