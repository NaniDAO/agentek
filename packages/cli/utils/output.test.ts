import { afterEach, describe, expect, it, vi } from "vitest";
import { outputJson, scrubSecrets } from "./output.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("CLI nested output redaction", () => {
  it("redacts parsed RPC_URLS components from successful JSON output", () => {
    vi.stubEnv("AGENTEK_CONFIG_DIR", "/tmp/agentek-output-redaction-fixture");
    vi.stubEnv("RPC_URLS", "1=https://rpc.example/v2/cli%2Fpath-token?api_key=cli%2Fquery-token,8453=https://other.example/second-cli-token");
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit-fixture"); });
    const hash = `0x${"b".repeat(64)}`;
    expect(() => outputJson({ result: { amountRaw: "8453", hash, partial: [{ error: "cli/path-token cli%2Fquery-token second-cli-token" }] } })).toThrow("exit-fixture");
    const output = String(write.mock.calls[0][0]);
    expect(JSON.parse(output).result).toMatchObject({ amountRaw: "8453", hash });
    for (const secret of ["path-token", "query-token", "second-cli-token"]) expect(output).not.toContain(secret);
  });

  it("scrubs individual endpoint URLs rather than only the full RPC_URLS value", () => {
    vi.stubEnv("RPC_URLS", "1=https://rpc.example/first-cli-key,8453=https://other.example/second-cli-key");
    expect(scrubSecrets("Failed at https://rpc.example/first-cli-key and decoded second-cli-key")).not.toContain("cli-key");
  });
});
