import {
  type BaseTool,
  createAgentekClient,
  type AgentekClient,
} from "../shared/client.js";
import type { CoreTool } from "ai";
import AgentekTool from "./tool.js";
import { Account, Address, Chain, Transport } from "viem";

class AgentekToolkit {
  private _agent: AgentekClient;
  tools: { [key: string]: CoreTool };

  constructor({
    accountOrAddress,
    chains,
    transports,
    tools,
  }: {
    accountOrAddress: Account | Address;
    chains: Chain[];
    transports: Transport[];
    tools: BaseTool[];
  }) {
    this._agent = createAgentekClient({
      accountOrAddress,
      chains,
      transports,
      tools,
    });

    this.tools = {};
    tools.forEach((tool) => {
      this.tools[tool.name] = AgentekTool(this._agent, tool);
    });
  }

  getTools(): { [key: string]: CoreTool } {
    return this.tools;
  }
}

export default AgentekToolkit;
