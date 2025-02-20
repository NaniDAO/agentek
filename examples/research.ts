import { Hex, http } from "viem";
import { base, mainnet } from "viem/chains";
import { webTools } from "../src/shared/web";
import AgentekToolkit from "../src/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { CoreMessage, generateText } from "ai";
import { coindeskTools } from "../src/shared/coindesk";

async function main() {
  // Get command line arguments
  const args = process.argv.slice(2);
  const promptIndex = args.indexOf("--prompt");
  const userPrompt =
    promptIndex !== -1
      ? args[promptIndex + 1]
      : "Get the latest proposal for uniswap and suggest what I should vote on it";

  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  if (!process.env.COINDESK_API_KEY) {
    throw new Error("COINDESK_API_KEY environment variable is required");
  }

  let privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    privateKey = generatePrivateKey();
    console.log("PRIVATE_KEY:", privateKey);
  }

  const account = privateKeyToAccount(privateKey as Hex);

  const chains = [mainnet, base];
  console.log("ACCOUNT:", account.address);
  console.log(
    "CHAINS:",
    chains.map((chain) => chain.id),
  );

  const toolkit = new AgentekToolkit({
    transports: [http(), http()],
    chains,
    accountOrAddress: account,
    tools: [
      ...webTools(),
      ...coindeskTools({ coindeskApiKey: process.env.COINDESK_API_KEY }),
    ],
  });

  const tools = toolkit.getTools();

  console.log("NUMBER OF TOOLS", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  const messages = [
    {
      role: "user",
      content: userPrompt,
    },
  ] as CoreMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const response = await generateText({
    model: openrouter("anthropic/claude-3.5-sonnet"),
    system: "RISK TOLERANCE: HIGH",
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
          console.log(`\n---\n${JSON.stringify(content.result, null, 2)}`);
        }
      });
    }
  });
}

main()
  .then((_o) => console.log("--fin--"))
  .catch((e) => console.error(e));
