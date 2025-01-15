import {
  type BaseTool,
  createNaniClient,
  type NaniClient,
} from "../shared/client";
import type { CoreTool } from "ai";
import NaniTool from "./tool";

class NaniAgentToolkit {
  private _nani: NaniClient;
  tools: { [key: string]: CoreTool };

  constructor({
    accountOrAddress,
    chain,
    transport,
    tools,
  }: {
    accountOrAddress: Account;
    chain: Chain;
    transport: Transport;
    tools: BaseTool[];
  }) {
    this._nani = createNaniClient({
      accountOrAddress,
      chain,
      transport,
      tools,
    });

    this.tools = {};
    tools.forEach((tool) => {
      this.tools[tool.name] = NaniTool(this._nani, tool);
    });
  }

  getTools(): { [key: string]: CoreTool } {
    return this.tools;
  }
}

export default NaniAgentToolkit;
