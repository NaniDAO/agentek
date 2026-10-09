import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { createPublicClient, http, parseEther } from "viem";
import { AnvilForkEnvironment, createGymAgentekClient } from "../dist/index.js";

const require = createRequire(import.meta.url);
const { zodToJsonSchema } = require("../../cli/node_modules/zod-to-json-schema");

const MODEL = "google/gemini-3.8-flash";
const RECIPIENT = "0x000000000000000000000000000000000000bEEF";
const AMOUNT = "0.25";
const INITIAL_ETH = "2";

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local test port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(`Local RPC ${method} failed: ${body.error?.message ?? response.status}`);
  }
  return body.result;
}

async function waitForRpc(url, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Upstream Anvil exited before it became healthy");
    }
    try {
      await rpc(url, "eth_chainId");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error("Upstream Anvil did not become healthy");
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function runModel(client, key) {
  const selected = [...client.getTools().values()];
  const tools = selected.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.parameters, { target: "openApi3" }),
    },
  }));
  const messages = [
    {
      role: "system",
      content:
        "You are controlling a disposable Ethereum Anvil fork through Agentek tools. " +
        "Use only the provided tools. Tool amounts are human-readable ETH. " +
        "The wallet has 2 ETH. Complete the user's objective and report what happened.",
    },
    {
      role: "user",
      content:
        `Check your wallet's ETH balance, then transfer exactly ${AMOUNT} ETH ` +
        `to ${RECIPIENT} on Ethereum chain ID 1.`,
    },
  ];
  const calls = [];
  let finalText = "";
  let modelRequests = 0;

  for (let step = 0; step < 4; step += 1) {
    modelRequests += 1;
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json();
    if (!response.ok) {
      const details = JSON.stringify({
        code: body.error?.code,
        message: body.error?.message,
        metadata: body.error?.metadata,
      }).replaceAll(key, "[redacted]");
      throw new Error(`OpenRouter request failed with HTTP ${response.status}: ${details}`);
    }
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter returned no assistant message");
    messages.push(message);
    finalText = message.content ?? "";

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) break;
    for (const call of toolCalls) {
      if (calls.length >= 4) throw new Error("Demo tool call limit exceeded");
      const name = call.function?.name;
      if (!client.getTools().has(name)) throw new Error(`Model requested unavailable tool ${name}`);
      let args;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        throw new Error(`Model supplied invalid JSON for ${name}`);
      }
      const record = { tool: name, arguments: args };
      try {
        const result = await client.execute(name, args);
        record.result = result;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } catch (error) {
        record.error = error instanceof Error ? error.message : String(error);
        messages.push({ role: "tool", tool_call_id: call.id, content: record.error });
      }
      calls.push(record);
    }
  }
  return { modelRequests, calls, finalText };
}

async function main() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is required in .env");

  const port = await freePort();
  const upstreamUrl = `http://127.0.0.1:${port}`;
  const upstream = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "1", "--hardfork", "cancun", "--silent"],
    { stdio: "ignore" },
  );
  let environment;
  try {
    await waitForRpc(upstreamUrl, upstream);
    await rpc(upstreamUrl, "anvil_mine", ["0x1"]);
    environment = new AnvilForkEnvironment({
      chain: "ethereum",
      upstreamRpcUrl: upstreamUrl,
      blockNumber: 1n,
      hardfork: "cancun",
    });
    await environment.start();
    await environment.provisionWallet({ balances: { ETH: INITIAL_ETH } });

    const client = await createGymAgentekClient({
      environment,
      tools: ["getBalance", "intentTransfer"],
    });
    const rpcUrl = environment.getRpcUrl(1);
    const publicClient = createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });
    const wallet = await client.getAddress();
    const initialWallet = await publicClient.getBalance({ address: wallet });
    const initialRecipient = await publicClient.getBalance({ address: RECIPIENT });

    const modelResult = await runModel(client, key);
    const finalWallet = await publicClient.getBalance({ address: wallet });
    const finalRecipient = await publicClient.getBalance({ address: RECIPIENT });
    const hashes = modelResult.calls.flatMap((call) =>
      typeof call.result?.hash === "string" ? call.result.hash.split(";").filter(Boolean) : [],
    );
    const receipts = await Promise.all(hashes.map(async (hash) => {
      const receipt = await publicClient.getTransactionReceipt({ hash });
      return {
        hash,
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
      };
    }));
    const passed = finalRecipient - initialRecipient === parseEther(AMOUNT);

    console.log(JSON.stringify({
      model: MODEL,
      environment: { chainId: 1, forkBlock: "1", upstream: "local-anvil" },
      objective: `Transfer exactly ${AMOUNT} ETH to ${RECIPIENT}`,
      wallet,
      initial: { walletWei: initialWallet.toString(), recipientWei: initialRecipient.toString() },
      final: { walletWei: finalWallet.toString(), recipientWei: finalRecipient.toString() },
      passed,
      modelRequests: modelResult.modelRequests,
      toolCalls: modelResult.calls,
      receipts,
      modelFinalText: modelResult.finalText,
    }, null, 2));
  } finally {
    await environment?.stop();
    await stop(upstream);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
