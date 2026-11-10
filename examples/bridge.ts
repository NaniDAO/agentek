import { Hex, http } from "viem";
import { base, optimism } from "viem/chains";
import { acrossTools } from "@agentek/tools";
import AgentekToolkit from "@agentek/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { ModelMessage, Tool, stepCountIs, generateText } from "ai";

async function main() {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  let privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    privateKey = generatePrivateKey();
  }

  const account = privateKeyToAccount(privateKey as Hex);

  const chains = [base, optimism];
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
      // getBlockscoutSearch,
      // ...searchTools({
      //   perplexityApiKey: process.env.PERPLEXITY_API_KEY!,
      // }),
      ...acrossTools(),
    ],
  });

  const tools = toolkit.getTools();

  console.log("NUMBER OF TOOLS", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  const messages = [
    {
      role: "user",
      content:
        "Bridge 2 USDC from base (0x833589fcd6edb6e08f4c7c32d4f71b54bda02913) to optimism (0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85)", // need an address book
    },
  ] as ModelMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const response = await generateText({
    model: openrouter("anthropic/claude-3.5-sonnet"),
    system: `YOUR ADDRESS: ${account.address}, CHAINS: ${chains.map((chain) => `${chain.name} (${chain.id})`).join(", ")}`,
    messages,
    stopWhen: stepCountIs(10),
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
          console.log(`\n---\n${JSON.stringify(content.output, null, 2)}`);
        }
      });
    }
  });
}

main()
  .then((_o) => console.log("--fin--"))
  .catch((e) => console.error(e));
