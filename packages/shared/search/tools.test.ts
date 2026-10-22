import { afterEach, describe, expect, it, vi } from "vitest";
import { createAskPerplexitySearchTool } from "./tools.js";

afterEach(() => vi.unstubAllGlobals());

describe("askPerplexitySearch", () => {
  it("sends the integration header to the Perplexity API", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = createAskPerplexitySearchTool("test-key");
    await tool.execute({} as never, { searchString: "What is Aave?" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.perplexity.ai/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Pplx-Integration"]).toBe("agentek");
    expect(headers.Authorization).toBe("Bearer test-key");
  });
});
