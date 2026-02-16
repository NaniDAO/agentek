import { z } from "zod";
import { AgentekClient, createTool, Intent } from "../client.js";
import {
  Address,
  encodeFunctionData,
  parseEther,
  parseAbi,
  Hex,
} from "viem";
import {
  arbitrum,
  base,
  mainnet,
  mode,
  optimism,
  polygon,
  sepolia,
} from "viem/chains";
import { addressSchema } from "../utils.js";

const supportedChains = [
  mainnet,
  base,
  arbitrum,
  polygon,
  optimism,
  mode,
  sepolia,
];

const intentSendTransactionParameters = z.object({
  to: addressSchema.describe("The target contract or recipient address"),
  value: z
    .string()
    .optional()
    .default("0")
    .describe("ETH value to send in ether (e.g. '0.1' for 0.1 ETH)"),
  abi: z
    .array(z.string())
    .optional()
    .describe(
      "Human-readable ABI signatures for the function to call, e.g. ['function transfer(address to, uint256 amount) returns (bool)']"
    ),
  functionName: z
    .string()
    .optional()
    .describe("The function name to call, e.g. 'transfer'"),
  args: z
    .array(z.any())
    .optional()
    .describe(
      "The arguments to pass to the function, e.g. ['0x1234...', '1000000000000000000']"
    ),
  data: z
    .string()
    .optional()
    .describe(
      "Raw hex calldata. Use this only if abi/functionName/args are not provided."
    ),
  chainId: z.number().describe("Chain ID to send the transaction on"),
});

export const intentSendTransaction = createTool({
  name: "intentSendTransaction",
  description:
    "Send an arbitrary transaction to any address. Specify a human-readable ABI signature with function name and arguments to encode calldata automatically, or provide raw hex data. Use this for any contract interaction not covered by other tools.",
  supportedChains,
  parameters: intentSendTransactionParameters,
  execute: async (
    client: AgentekClient,
    args: z.infer<typeof intentSendTransactionParameters>
  ): Promise<Intent> => {
    const { to, value, abi, functionName, args: fnArgs, data, chainId } = args;

    let calldata: Hex = "0x";

    if (abi && functionName) {
      const parsedAbi = parseAbi(abi as readonly string[]);
      calldata = encodeFunctionData({
        abi: parsedAbi,
        functionName,
        args: fnArgs || [],
      });
    } else if (data) {
      if (!data.startsWith("0x")) {
        throw new Error("Raw data must be a hex string starting with 0x");
      }
      calldata = data as Hex;
    }

    const weiValue = parseEther(value || "0").toString();

    const ops = [
      {
        target: to as Address,
        value: weiValue,
        data: calldata,
      },
    ];

    const fnDesc = functionName
      ? `${functionName}(${(fnArgs || []).join(", ")})`
      : calldata === "0x"
        ? "transfer ETH"
        : "raw call";

    const intent = `Send tx to ${to}: ${fnDesc}`;

    const walletClient = client.getWalletClient(chainId);

    if (!walletClient) {
      return {
        intent,
        ops,
        chain: chainId,
      };
    } else {
      const hash = await client.executeOps(ops, chainId);

      return {
        intent,
        ops,
        chain: chainId,
        hash,
      };
    }
  },
});
