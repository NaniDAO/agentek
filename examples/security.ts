import { Hex, http } from "viem";
import { base, mainnet } from "viem/chains";
import { securityTools } from "../packages/shared/security";
import AgentekToolkit from "../packages/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { CoreMessage, CoreTool, generateText } from "ai";

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
    tools: [...securityTools()],
  });

  const tools = toolkit.getTools();

  console.log("NUMBER OF TOOLS", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  const messages = [
    {
      role: "user",
      content:
        "Check if 0x86c9c3b4989999a0a2e66b00891bbd797a55190d is blacklisted and also if bearnet-chain.xyz is blacklisted",
    },
  ] as CoreMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const response = await generateText({
    model: openrouter("openai/gpt-4o-mini"),
    system: "",
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
          console.log(`\n---\n${content.result}`);
        }
      });
    }
  });
}

main()
  .then((_o) => console.log("--fin--"))
  .catch((e) => console.error(e));
