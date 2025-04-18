import { Hex, http } from "viem";
import { base, mainnet, polygon } from "viem/chains";
import AgentekToolkit from "../packages/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { CoreMessage, CoreTool, generateText } from "ai";

import { createOpenRouterTools } from "../packages/shared/openrouter";

async function main() {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const openrouter = createOpenRouter({
    apiKey: OPENROUTER_API_KEY,
  });

  let privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    privateKey = generatePrivateKey();
    console.log("PRIVATE_KEY:", privateKey);
  }

  const account = privateKeyToAccount(privateKey as Hex);

  const chains = [mainnet, base, polygon];
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
        `https://lb.drpc.org/ogrpc?network=base&dkey=${process.env.DRPC_KEY}`,
      ),
      http(
        `https://lb.drpc.org/ogrpc?network=polygon&dkey=${process.env.DRPC_KEY}`,
      ),
    ],
    chains,
    accountOrAddress: account.address,
    tools: [
      ...createOpenRouterTools({
        openrouterApiKey: OPENROUTER_API_KEY,
      }),
    ],
  });

  const tools = toolkit.getTools();

  console.log("NUMBER OF TOOLS", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  const messages = [
    {
      role: "user",
      content: "What's your openrouter balance?",
    },
  ] as CoreMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const response = await generateText({
    model: openrouter("anthropic/claude-3.5-sonnet"),
    system: `You are an intelligent crypto analytics agent that employs Step-by-Step Reasoning.`,
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

main().catch(console.error);
