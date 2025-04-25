import { Hex, http } from "viem";
import { base, mainnet, polygon } from "viem/chains";
import AgentekToolkit from "../packages/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { CoreMessage, CoreTool, TextStreamPart, streamText } from "ai";

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
    accountOrAddress: account,
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
      content:
        "Check your openrouter balance and fund your account with 3 USD on Base",
    },
  ] as CoreMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const result = await streamText({
    model: openrouter("openai/o4-mini"),
    system: `You are an intelligent crypto analytics agent that employs Step-by-Step Reasoning.

    ADDRESS: ${account.address}`,
    messages,
    maxSteps: 5,
    tools: tools as Record<string, CoreTool<any, any>>,
    experimental_activeTools: Object.keys(tools),
    toolCallStreaming: true,
  });

  // 2) Consume *everything* in order
  for await (const part of result.fullStream) {
    switch ((part as TextStreamPart).type) {
      case "text-delta":
        // the incremental text from the model
        process.stdout.write((part as any).textDelta);
        break;

      case "reasoning":
        process.stdout.write(`[reason] ${(part as any).textDelta}`);
        break;

      case "tool-call":
        console.log(
          `\n[→ TOOL CALL] ${(part as any).toolName}`,
          JSON.stringify((part as any).args, null, 2),
        );
        break;

      case "tool-call-streaming-start":
        console.log(`\n[→ TOOL START] ${(part as any).toolName}`);
        break;

      case "tool-call-delta":
        process.stdout.write((part as any).argsTextDelta);
        break;

      case "tool-result":
        console.log(
          `\n[← TOOL RESULT] ${(part as any).toolName}`,
          JSON.stringify((part as any).result, null, 2),
        );
        break;

      case "source":
        console.log(`\n[source]`, (part as any).source);
        break;

      case "error":
        console.error(`\n[error]`, (part as any).error);
        break;

      // you can handle 'step-start', 'step-finish', 'finish' if you need them
    }
  }

  console.log("\n✅ Done!");
}

main().catch(console.error);
