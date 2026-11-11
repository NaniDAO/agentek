import {
  BaseTool,
  createAgentekClient,
  AgentekClient,
  type SolanaConfig,
  type AgentekClientConfig,
} from "@agentek/tools/client";
import type { Tool } from "ai";
import AgentekTool from "./tool.js";
import { Account, Address, Chain, Transport } from "viem";

class AgentekToolkit {
  private _agent: AgentekClient;
  tools: { [key: string]: Tool };

  constructor({
    accountOrAddress,
    chains,
    transports,
    tools,
    solana,
    executionMode = "prepare",
    onExecutionUpdated,
    authorizeAction,
    requestStore,
    onSolanaExecutionUpdated,
    paymentBudgetUsd,
    publicationBudget,
  }: {
    accountOrAddress: Account | Address;
    chains: Chain[];
    transports: Transport[];
    tools: BaseTool[];
    /** Solana settings. Without this the twelve Solana tools have no account. */
    solana?: SolanaConfig;
    executionMode?: "prepare" | "execute";
    onExecutionUpdated?: AgentekClientConfig["onExecutionUpdated"];
    authorizeAction?: AgentekClientConfig["authorizeAction"];
    requestStore?: AgentekClientConfig["requestStore"];
    onSolanaExecutionUpdated?: AgentekClientConfig["onSolanaExecutionUpdated"];
    paymentBudgetUsd?: AgentekClientConfig["paymentBudgetUsd"];
    publicationBudget?: AgentekClientConfig["publicationBudget"];
  }) {
    this._agent = createAgentekClient({
      executionMode,
      onExecutionUpdated,
      authorizeAction,
      requestStore,
      onSolanaExecutionUpdated,
      paymentBudgetUsd,
      publicationBudget,
      accountOrAddress,
      chains,
      transports,
      tools,
      solana,
    });

    this.tools = {};
    tools.forEach((tool) => {
      this.tools[tool.name] = AgentekTool(this._agent, tool);
    });
  }

  getTools(): { [key: string]: Tool } {
    return this.tools;
  }
}

export default AgentekToolkit;
