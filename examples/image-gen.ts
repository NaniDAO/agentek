import { Hex, http } from "viem";
import { base, mainnet, arbitrum, sepolia, mode } from "viem/chains";
import AgentekToolkit from "../packages/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { CoreMessage, CoreTool, generateText } from "ai";

import { createImageGenTools } from "../packages/shared/imagegen/index.js";

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
      http(
        `https://lb.drpc.org/ogrpc?network=ethereum&dkey=${process.env.DRPC_KEY}`,
      ),
    ],
    chains,
    accountOrAddress: account,
    tools: [
      ...createImageGenTools({
        fireworksApiKey: process.env.FIREWORKS_API_KEY!,
        pinataJWT: process.env.PINATA_JWT!,
      }),
    ],
  });

  const tools = toolkit.getTools();

  console.log("NUMBER OF TOOLS", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  const messages = [
    {
      role: "user",
      content:
        "Create an image of 2. Plakṣa Dvīpa – 🌳 The island of the Cosmic Fig Tree\n\nNamed after a massive Plaksha tree (sacred fig), 100 yojanas tall.\n\nInhabited by people who live for thousands of years, are beautiful and righteous.\n\n7 varshas with kings devoted to Vayu (wind god).\n\nSurrounded by the Ikshu Ocean (SUGAR CANE JUICE 🍭)\n\nImagine: syrupy rivers, rustling fig forests, barefoot sages with honeyed voices.\n\n",
    },
  ] as CoreMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const response = await generateText({
    model: openrouter("anthropic/claude-3.5-sonnet"),
    system: `Create an image you want to generate using the tools available.`,
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
