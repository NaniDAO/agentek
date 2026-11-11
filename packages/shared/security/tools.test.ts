import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("domain blacklist canonicalization", () => {
  it("matches input and list entries across case, www, DNS root dots and IDNA", async () => {
    vi.resetModules();
    const { checkMaliciousWebsite } = await import("./tools.js");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(["WWW.EVIL.EXAMPLE.", "www.bücher.example."]), { status: 200 })));
    for (const website of ["https://evil.example./page", "WWW.Evil.Example", "https://www.evil.example./", "https://xn--bcher-kva.example./", "https://BÜCHER.example"]) {
      expect(await checkMaliciousWebsite.execute({} as any, { website })).toMatchObject({ result: "positive", isMalicious: true, freshness: "fresh" });
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains stale canonical positives and reports unmatched stale coverage as unknown", async () => {
    vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T00:00:00Z"));
    const { checkMaliciousWebsite } = await import("./tools.js");
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(["www.evil.example."]), { status: 200 })).mockRejectedValue(new Error("Unavailable"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkMaliciousWebsite.execute({} as any, { website: "evil.example" })).toMatchObject({ result: "positive" });
    vi.setSystemTime(new Date("2026-11-13T00:00:00Z"));
    expect(await checkMaliciousWebsite.execute({} as any, { website: "https://WWW.evil.example./" })).toMatchObject({ result: "positive", freshness: "stale", refreshOutcome: "failure" });
    expect(await checkMaliciousWebsite.execute({} as any, { website: "unlisted.example" })).toMatchObject({ result: "unknown", isMalicious: null, freshness: "stale" });
  });
});
