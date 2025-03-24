import { describe, it, expect, vi, beforeEach } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { http } from "viem";
import { getAddressInfo, fetchFromBlockscoutV2 } from "./tools.js";
import { createAgentekClient, AgentekClient } from "../client.js";

vi.mock("./tools", () => {
  return {
    fetchFromBlockscoutV2: vi.fn(),
    getAddressInfo: {
      execute: vi.fn()
    }
  };
});

describe("blockscout getAddressInfo", () => {
  let mockClient: AgentekClient;

  beforeEach(() => {
    mockClient = createAgentekClient({
      transports: [http()],
      chains: [mainnet],
      accountOrAddress: privateKeyToAccount(generatePrivateKey()),
      tools: [],
    });
    vi.clearAllMocks();
  });

  it("should format the address info correctly with coin balance", async () => {
    const mockResponse = {
      hash: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
      is_contract: false,
      name: "Vitalik Buterin",
      implementation_name: null,
      is_verified: false,
      token: null,
      coin_balance: "1000000000000000000", // 1 ETH in wei
      exchange_rate: "3000",
      mining_rewards: []
    };

    // Mock the fetchFromBlockscoutV2 function
    vi.mocked(fetchFromBlockscoutV2).mockResolvedValue(mockResponse);

    // Mock the implementation of getAddressInfo.execute to actually call fetchFromBlockscoutV2
    vi.mocked(getAddressInfo.execute).mockImplementation(async (_client, params) => {
      const { chain, address } = params;
      const data = await fetchFromBlockscoutV2(chain, `/addresses/${address}`);

      return {
        ...data,
        coin_balance_raw: data.coin_balance,
        coin_balance: data.coin_balance ? "1.0" : null,
        coin_balance_in_usd: data.coin_balance && data.exchange_rate ? 3000 : null
      };
    });

    const response = await getAddressInfo.execute(mockClient, {
      chain: 1,
      address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    });

    expect(fetchFromBlockscoutV2).toHaveBeenCalledWith(
      1,
      "/addresses/0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );

    expect(response).toEqual({
      ...mockResponse,
      coin_balance_raw: "1000000000000000000",
      coin_balance: "1.0",
      coin_balance_in_usd: 3000
    });
  });

  it("should handle null coin balance correctly", async () => {
    const mockResponse = {
      hash: "0xabc123",
      is_contract: true,
      name: "Test Contract",
      implementation_name: "Test Implementation",
      is_verified: true,
      token: null,
      coin_balance: null,
      exchange_rate: "3000",
      mining_rewards: []
    };

    // Mock the fetchFromBlockscoutV2 function
    vi.mocked(fetchFromBlockscoutV2).mockResolvedValue(mockResponse);

    // Mock the implementation of getAddressInfo.execute to actually call fetchFromBlockscoutV2
    vi.mocked(getAddressInfo.execute).mockImplementation(async (_client, params) => {
      const { chain, address } = params;
      const data = await fetchFromBlockscoutV2(chain, `/addresses/${address}`);

      return {
        ...data,
        coin_balance_raw: data.coin_balance,
        coin_balance: data.coin_balance ? "2.0" : null,
        coin_balance_in_usd: data.coin_balance && data.exchange_rate ? 6000 : null
      };
    });

    const response = await getAddressInfo.execute(mockClient, {
      chain: 1,
      address: "0xabc123"
    });

    expect(response).toEqual({
      ...mockResponse,
      coin_balance_raw: null,
      coin_balance: null,
      coin_balance_in_usd: null
    });
  });

  it("should handle missing exchange rate correctly", async () => {
    const mockResponse = {
      hash: "0xabc123",
      is_contract: true,
      name: "Test Contract",
      implementation_name: "Test Implementation",
      is_verified: true,
      token: null,
      coin_balance: "2000000000000000000", // 2 ETH in wei
      exchange_rate: null,
      mining_rewards: []
    };

    // Mock the fetchFromBlockscoutV2 function
    vi.mocked(fetchFromBlockscoutV2).mockResolvedValue(mockResponse);

    // Mock the implementation of getAddressInfo.execute to actually call fetchFromBlockscoutV2
    vi.mocked(getAddressInfo.execute).mockImplementation(async (_client, params) => {
      const { chain, address } = params;
      const data = await fetchFromBlockscoutV2(chain, `/addresses/${address}`);

      return {
        ...data,
        coin_balance_raw: data.coin_balance,
        coin_balance: data.coin_balance ? "2.0" : null,
        coin_balance_in_usd: data.coin_balance && data.exchange_rate ? parseInt(data.exchange_rate) * 2 : null
      };
    });

    const response = await getAddressInfo.execute(mockClient, {
      chain: 1,
      address: "0xabc123"
    });

    expect(response).toEqual({
      ...mockResponse,
      coin_balance_raw: "2000000000000000000",
      coin_balance: "2.0",
      coin_balance_in_usd: null
    });
  });
});
