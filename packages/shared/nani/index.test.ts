import { describe, it, expect } from "vitest";
import { naniTools } from "./index.js";
import {
  intentStakeNani,
  intentUnstakeNani,
  intentProposeNani,
  intentVoteNaniProposal,
} from "./intents.js";
import { getNaniProposals } from "./tools.js";

describe("Nani Tools Collection", () => {
  const tools = naniTools();

  it("should include all Nani tools", () => {
    const expectedTools = [
      getNaniProposals,
      intentStakeNani,
      intentUnstakeNani,
      intentProposeNani,
      intentVoteNaniProposal,
    ];

    expect(tools).toHaveLength(expectedTools.length);

    expectedTools.forEach((tool) => {
      expect(tools).toContainEqual(
        expect.objectContaining({
          name: tool.name,
          description: tool.description,
        }),
      );
    });
  });

  it("should have unique tool names", () => {
    const toolNames = tools.map((tool) => tool.name);
    const uniqueNames = new Set(toolNames);
    expect(toolNames.length).toBe(uniqueNames.size);
  });

  it("should have valid tool structures", () => {
    tools.forEach((tool) => {
      expect(tool).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        parameters: expect.any(Object),
        execute: expect.any(Function),
        supportedChains: expect.any(Array),
      });
    });
  });
});
