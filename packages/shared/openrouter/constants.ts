export const coinbasePaymentAbi = [
  {
    inputs: [
      {
        components: [
          { internalType: "uint256", name: "recipientAmount", type: "uint256" },
          { internalType: "uint256", name: "deadline", type: "uint256" },
          { internalType: "address payable", name: "recipient", type: "address" },
          { internalType: "address", name: "recipientCurrency", type: "address" },
          { internalType: "address", name: "refundDestination", type: "address" },
          { internalType: "uint256", name: "feeAmount", type: "uint256" },
          { internalType: "bytes16", name: "id", type: "bytes16" },
          { internalType: "address", name: "operator", type: "address" },
          { internalType: "bytes", name: "signature", type: "bytes" },
          { internalType: "bytes", name: "prefix", type: "bytes" },
        ],
        internalType: "struct TransferIntent",
        name: "_intent",
        type: "tuple",
      },
      { internalType: "uint24", name: "poolFeesTier", type: "uint24" },
    ],
    name: "swapAndTransferUniswapV3Native",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const;
