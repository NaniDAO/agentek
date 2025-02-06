import { Hex, http } from "viem";
import { base } from "viem/chains";
import AgentekToolkit from "../src/ai-sdk/toolkit";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { CoreMessage, CoreTool, generateText } from "ai";
import { dexscreenerTools } from "../src/shared/dexscreener";
import { swapTools } from "../src/shared/swap";
import { searchTools } from "../src/shared/search";
import { erc20Tools } from "../src/shared/erc20";

// 1) Setup
async function main() {
  const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    privateKey = generatePrivateKey();
    console.log("Generated PRIVATE_KEY:", privateKey);
  }

  const account = privateKeyToAccount(privateKey as Hex);

  const chains = [base];
  console.log("ACCOUNT:", account.address);
  console.log(
    "CHAINS:",
    chains.map((chain) => chain.id),
  );

  // 2) Initialize Toolkit (with your Tools)
  const toolkit = new AgentekToolkit({
    transports: [http()],
    chains,
    accountOrAddress: account,
    tools: [
      ...dexscreenerTools(),
      ...searchTools({
        perplexityApiKey: process.env.PERPLEXITY_API_KEY!,
      }),
      ...erc20Tools(),
      ...swapTools({
        zeroxApiKey: process.env.ZEROX_API_KEY!,
      }),
    ],
  });

  const tools = toolkit.getTools();
  console.log("NUMBER OF TOOLS:", Object.keys(tools).length);
  console.log("AVAILABLE TOOLS:", Object.keys(tools));

  // 3) Conversation Setup
  // We provide an in-depth system message to guide the agent to
  // (a) research on-chain opportunities
  // (b) plan a strategy
  // (c) trade if feasible, etc.
  //
  // Then we store the entire conversation in `conversationHistory` so
  // we can repeatedly feed it back to the AI in each iteration.
  const systemPrompt = `
You are an autonomous crypto trading agent.
Your objectives:
1. Identify new or existing tokens with potential for profit on the Base chain (chainId = 8453).
2. Research each token's price action, trading volume, recent momentum, and contract details.
3. If you discover a viable opportunity (e.g. short-term momentum), plan and execute a buy using the tools:
   - You can call \`intentApprove\` (if you need to approve a token for swapping).
   - You can call \`intent0xSwap\` to actually swap tokens.
4. Target maximum profit, but also avoid scam tokens or extremely low liquidity.
5. Do not exceed 20 steps or calls to the tools.
6. At each step, explain your reasoning.
7. If no more profitable trades are found, conclude by saying "No viable trades found. Stopping."

Important: Always reason about the data you get back from each tool call to determine next steps.

Available Tools:
- askPerplexitySearch: search about crypto topics
- getLatestTokens: get trending tokens
- getAllowance, getBalanceOf, getTotalSupply, getDecimals, getName, getSymbol, getTokenMetadata
- intentApprove, intent0xSwap
- And others from Dexscreener

You are on chain "Base" with id=8453.

Remember:
- Think step by step before making a trade.
- Use data from Dexscreener or Perplexity to confirm daily volume and price action.
- You can call multiple tools in one response if needed.
`;

  // Conversation starts with the system instructions, plus an initial "user" prompt.
  // The user prompt can be short, or you can omit it if you prefer the agent to just do its job.
  let conversationHistory: CoreMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content:
        "Swap into Toshi on base with 0.1 Ether using 0x tool. No research required. Just get the address and go.",
    },
  ];

  // 4) Agentic Loop: we call generateText repeatedly
  // so the agent can do multiple tool calls over time.
  const maxIterations = 10;
  for (let i = 0; i < maxIterations; i++) {
    console.log(`\n--- Iteration ${i + 1} ---`);

    const response = await generateText({
      model: openrouter("anthropic/claude-3.5-sonnet"),
      system: systemPrompt,
      messages: conversationHistory,
      maxSteps: 5, // let the agent do up to 20 tool calls in a single turn
      tools: tools as Record<string, CoreTool<any, any>>,
      // Let the agent call any tool it wants:
      experimental_activeTools: Object.keys(tools),
    });

    // 5) Print out the AI's new messages
    response.response.messages.forEach((msg) => {
      console.log(`\n[${msg.role.toUpperCase()}]`);
      if (typeof msg.content === "string") {
        console.log(msg.content);
      } else {
        // The content can be an array of segments (text or tool calls/results).
        msg.content.forEach((segment) => {
          if (segment.type === "text") {
            console.log(segment.text);
          } else if (segment.type === "tool-call") {
            console.log(`[Tool call: ${segment.toolName}]`);
            console.log(JSON.stringify(segment.args, null, 2));
          } else if (segment.type === "tool-result") {
            console.log(
              `Tool returned:\n${JSON.stringify(segment.result, null, 2)}`,
            );
          }
        });
      }
    });

    // 6) Add the AI's new messages into conversation history
    // so the next iteration is fully up-to-date.
    conversationHistory.push(...response.response.messages);

    // 7) Optional: check if the agent signaled it is "done"
    // e.g., if it said "No viable trades found. Stopping." or "done" or "exit".
    const lastAssistantMessage = response.response.messages
      .filter((m) => m.role === "assistant")
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : m.content.map((s) => (s.type === "text" ? s.text : "")).join(""),
      )
      .join("\n");

    if (lastAssistantMessage.includes("Stopping")) {
      console.log("\nAgent indicated it is finished. Exiting loop.");
      break;
    }
  }

  console.log("\n-- Finished the agentic loop --");
}

main().catch(console.error);
