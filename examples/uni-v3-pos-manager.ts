import { Hex, http } from "viem";
import { base, mainnet, arbitrum } from "viem/chains";
import { uniV3Tools } from "@agentek/tools";
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

  const chains = [mainnet, arbitrum, base];
  console.log("ACCOUNT:", account.address);
  console.log(
    "CHAINS:",
    chains.map((chain) => chain.id),
  );

  const toolkit = new AgentekToolkit({
    transports: chains.map(() => http()),
    chains,
    accountOrAddress: account,
    tools: [...uniV3Tools()],
  });

  const tools = toolkit.getTools();

  console.log("NUMBER OF TOOLS", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  const messages = [
    {
      role: "user",
      content: `Get me user positions of 0xCB0592589602B841BE035e1e64C2A5b1Ef006aa2 on mainnet n base

      # SUPPORTED CHAINS
      ${chains.map((c) => `${c.name} [ ${c.id} ]\n`)}
          `,
      // "Tell me info of pool 0x58cf91c080f7052f6da209bf605d6cf1cefd65f3 on mainnet and fee ? And also tell me about position 1723108 on base. And tell me whether I should LP more in my base position.",
    },
  ] as ModelMessage[];

  messages.forEach((message) => {
    console.log(`\n[${message.role.toUpperCase()}]`);
    console.log(message.content);
  });

  const response = await generateText({
    model: openrouter("openai/gpt-4o-mini"),
    system: "",
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
          console.log(`\n---\n${JSON.stringify(content.output, null, 2)}`);
        }
      });
    }
  });
}

main()
  .then((_o) => console.log("--fin--"))
  .catch((e) => console.error(e));
