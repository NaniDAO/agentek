import NaniClient from "../shared/client";
import tools from "../shared/tools";
import { isToolAllowed, type Configuration } from "../shared/configuration";
import type { CoreTool } from "ai";
import NaniTool from "./tool";

class NaniAgentToolkit {
  private _nani: NaniClient;

  tools: { [key: string]: CoreTool };

  constructor({
    account,
    transports,
  }: {
    account: Account;
    transports: Transport;
  }) {
    this._nani = new NaniClient(account, transport);
    this.tools = {};

    const filteredTools = tools.filter((tool) =>
      isToolAllowed(tool, configuration),
    );

    filteredTools.forEach((tool) => {
      // @ts-ignore
      this.tools[tool.method] = NaniTool(
        this._nani,
        tool.method,
        tool.description,
        tool.parameters,
      );
    });
  }

  getTools(): { [key: string]: CoreTool } {
    return this.tools;
  }
}

export default NaniAgentToolkit;
