import { describe, expect, it, vi } from "vitest";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { AgentekClient } from "../client.js";
import { intentTransferSplTokenTool } from "./intents.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants.js";
import { associatedTokenAddress, createAssociatedTokenInstruction, createCheckedTransferInstruction, mintDecimals } from "./spl.js";

const key = (start: number) => new PublicKey(Uint8Array.from({length: 32}, (_, i) => i + start));
const owner = key(1), mint = key(2), payer = key(3), recipient = key(4);
const classic = new PublicKey(TOKEN_PROGRAM_ID), token2022 = new PublicKey(TOKEN_2022_PROGRAM_ID);
const baseMintHex = "01000000" + "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20" + "0807060504030201" + "0601" + "00000000" + "00".repeat(32);
const account = (program = classic, bytes = Buffer.from(baseMintHex, "hex")) => ({owner: program, data: bytes});

// Fixed wire bytes come from SPL TransferChecked's public ABI, independently
// of the new encoder; the amount exercises integers above Number.MAX_SAFE_INTEGER.
describe("narrow SPL encoding guards", () => {
  it("writes exact u64 transfer amounts and bounded u8 decimals", () => {
    const instruction = createCheckedTransferInstruction(key(5), mint, key(6), owner, 0x0102030405060708n, 6, classic);
    expect(instruction.data.toString("hex")).toBe("0c080706050403020106");
    expect(createCheckedTransferInstruction(key(5), mint, key(6), owner, (1n << 64n) - 1n, 255, token2022).data.toString("hex")).toBe("0cffffffffffffffffff");
    for (const amount of [-1n, 1n << 64n]) expect(() => createCheckedTransferInstruction(key(5), mint, key(6), owner, amount, 6, classic)).toThrow(/u64/);
    for (const decimals of [-1, 256, 1.5, NaN]) expect(() => createCheckedTransferInstruction(key(5), mint, key(6), owner, 1n, decimals, classic)).toThrow(/precision/);
  });

  it("binds ATA creation to the exact owner, mint and canonical token program", () => {
    const ata = associatedTokenAddress(mint, recipient, classic);
    expect(() => createAssociatedTokenInstruction(payer, ata, owner, mint, classic)).toThrow(/does not match/);
    expect(() => createAssociatedTokenInstruction(payer, ata, recipient, mint, token2022)).toThrow(/does not match/);
    const unsupported = key(9);
    expect(() => associatedTokenAddress(mint, owner, unsupported)).toThrow(/Unsupported/);
    expect(() => createCheckedTransferInstruction(key(5), mint, key(6), owner, 1n, 6, unsupported)).toThrow(/Unsupported/);
  });

  it("preserves off-curve treasury owners and separates Token-2022 ATAs", () => {
    const treasury = associatedTokenAddress(mint, owner, classic);
    expect(PublicKey.isOnCurve(treasury.toBytes())).toBe(false);
    const ata = associatedTokenAddress(mint, treasury, classic);
    expect(() => createAssociatedTokenInstruction(payer, ata, treasury, mint, classic)).not.toThrow();
    expect(associatedTokenAddress(mint, owner, token2022).equals(treasury)).toBe(false);
  });
});

describe("initialized owner-bound SPL mint precision", () => {
  it("reads the classic mint precision from fixed ABI bytes and respects byte offsets", () => {
    expect(mintDecimals(account(), classic)).toBe(6);
    const padded = Buffer.concat([Buffer.alloc(5, 255), Buffer.from(baseMintHex, "hex"), Buffer.alloc(5, 255)]);
    expect(mintDecimals(account(classic, padded.subarray(5, 87)), classic)).toBe(6);
    const zero = Buffer.from(baseMintHex, "hex"); zero[44] = 0;
    expect(mintDecimals(account(classic, zero), classic)).toBe(0);
  });

  it("accepts Token-2022 mint layout while rejecting token-account/multisig impostors", () => {
    const extended = Buffer.concat([Buffer.from(baseMintHex, "hex"), Buffer.alloc(83), Buffer.from([1, 0, 0, 0, 0])]);
    expect(mintDecimals(account(token2022, extended), token2022)).toBe(6);
    for (const size of [0, 81, 83, 165, 355]) {
      expect(() => mintDecimals(account(token2022, Buffer.alloc(size)), token2022)).toThrow();
    }
    extended[165] = 2;
    expect(() => mintDecimals(account(token2022, extended), token2022)).toThrow(/extended mint/);
  });

  it("rejects owner substitutions, uninitialized mints and malformed authority flags", () => {
    expect(() => mintDecimals(account(token2022), classic)).toThrow(/owner/);
    const uninitialized = Buffer.from(baseMintHex, "hex"); uninitialized[45] = 0;
    expect(() => mintDecimals(account(classic, uninitialized), classic)).toThrow(/not initialized/);
    const authority = Buffer.from(baseMintHex, "hex"); authority[0] = 2;
    expect(() => mintDecimals(account(classic, authority), classic)).toThrow(/authority/);
    const freeze = Buffer.from(baseMintHex, "hex"); freeze[46] = 2;
    expect(() => mintDecimals(account(classic, freeze), classic)).toThrow(/authority/);
  });
});

// Independent fixtures generated from installed @solana/spl-token 0.4.15 before
// dependency removal, with synthetic fixed public-key bytes and no network.
// These lock both PDA seeds and full instruction account order/authority flags.
describe("legacy SPL compatibility vectors", () => {
  const inputs = {
    owner: new PublicKey("4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw"),
    mint: new PublicKey("8rUz82MkFsfqjpVjjgWEM66Brr1sm1R7VKZ991fF41e"),
    payer: new PublicKey("Cmn8RVNLZAtyq51B31RXDrrS24DYphEftzDCX4FzPLM"),
    recipient: new PublicKey("Gh5GixNvrU87vKWcLLLp6dcgBGRDtP4EJesFu6rjif4"),
  };
  const vectors = [
    {name: "Token", program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", source: "BGCGP69abqve5BEUcwzpTcAf98rEdcrpAHDWzATp9npx", destination: "D4hrgZH2tmg9MraZXMDzBRRFqG69hWAxERVUEXyV5t98"},
    {name: "Token-2022", program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", source: "4gvHVgWhqV6BcfwhmBRCc2VjW9m1R13zrQbbCUqm4FUC", destination: "7LhY8WjcNJ3Jf1XXBMPmyNpCJ7jQDgHhggqL96i2M7VG"},
  ];
  const encoded = (instruction: ReturnType<typeof createCheckedTransferInstruction>) => ({
    program: instruction.programId.toBase58(), data: instruction.data.toString("hex"),
    keys: instruction.keys.map(meta => ({pubkey: meta.pubkey.toBase58(), signer: meta.isSigner, writable: meta.isWritable})),
  });

  it.each(vectors)("matches independent $name ATAs and complete instruction payloads", vector => {
    const program = new PublicKey(vector.program);
    expect(associatedTokenAddress(inputs.mint, inputs.owner, program).toBase58()).toBe(vector.source);
    expect(associatedTokenAddress(inputs.mint, inputs.recipient, program).toBase58()).toBe(vector.destination);
    expect(encoded(createAssociatedTokenInstruction(inputs.payer, new PublicKey(vector.destination), inputs.recipient, inputs.mint, program))).toEqual({
      program: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", data: "01", keys: [
        {pubkey: "Cmn8RVNLZAtyq51B31RXDrrS24DYphEftzDCX4FzPLM", signer: true, writable: true},
        {pubkey: vector.destination, signer: false, writable: true},
        {pubkey: "Gh5GixNvrU87vKWcLLLp6dcgBGRDtP4EJesFu6rjif4", signer: false, writable: false},
        {pubkey: "8rUz82MkFsfqjpVjjgWEM66Brr1sm1R7VKZ991fF41e", signer: false, writable: false},
        {pubkey: "11111111111111111111111111111111", signer: false, writable: false},
        {pubkey: vector.program, signer: false, writable: false},
      ],
    });
    expect(encoded(createCheckedTransferInstruction(new PublicKey(vector.source), inputs.mint, new PublicKey(vector.destination), inputs.owner, 72623859790382856n, 6, program))).toEqual({
      program: vector.program, data: "0c080706050403020106", keys: [
        {pubkey: vector.source, signer: false, writable: true},
        {pubkey: "8rUz82MkFsfqjpVjjgWEM66Brr1sm1R7VKZ991fF41e", signer: false, writable: false},
        {pubkey: vector.destination, signer: false, writable: true},
        {pubkey: "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw", signer: true, writable: false},
      ],
    });
  });

  it.each(vectors)("prepares an exact $name transfer using one owner-bound mint read", async vector => {
    const program = new PublicKey(vector.program);
    const bytes = vector.name === "Token" ? Buffer.from(baseMintHex, "hex") : Buffer.concat([Buffer.from(baseMintHex, "hex"), Buffer.alloc(83), Buffer.from([1, 0, 0, 0, 0])]);
    const getAccountInfo = vi.fn(async (address: PublicKey) => address.equals(inputs.mint)
      ? {owner: program, data: bytes}
      : {owner: new PublicKey("11111111111111111111111111111111"), data: Buffer.alloc(0)});
    const getTokenAccountBalance = vi.fn(async (address: PublicKey) => {
      expect(address.toBase58()).toBe(vector.source);
      return {value: {amount: "72623859790382856", decimals: 6, uiAmountString: "72623859790.382856"}};
    });
    const build = vi.fn(async instructions => ({
      transaction: new VersionedTransaction(new TransactionMessage({payerKey: inputs.owner, recentBlockhash: "11111111111111111111111111111111", instructions}).compileToV0Message()),
      blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 1,
    }));
    const sign = vi.fn(() => {throw new Error("Prepare must not access a signer");});
    const client = {
      getSolanaAddress: async () => inputs.owner.toBase58(),
      getSolanaConnection: async () => ({getAccountInfo, getTokenAccountBalance}),
      awaitSolanaPreSubmission: async promise => promise,
      getExecutionMode: () => "prepare", getSolanaKeypair: sign,
      buildSolanaTransaction: build, executeSolanaTransaction: sign,
    } as unknown as AgentekClient;
    const result = await intentTransferSplTokenTool.execute(client, {token: inputs.mint.toBase58(), to: inputs.recipient.toBase58(), amount: "72623859790.382856"});
    expect(result.signature).toBeUndefined();
    expect(VersionedTransaction.deserialize(Buffer.from(result.transaction, "base64")).signatures.every(signature => signature.every(byte => byte === 0))).toBe(true);
    expect(getAccountInfo).toHaveBeenCalledTimes(2); // Mint and recipient; no second mint RPC.
    expect(getTokenAccountBalance).toHaveBeenCalledOnce();
    const instructions = build.mock.calls[0][0];
    expect(instructions).toHaveLength(2);
    expect(encoded(instructions[1])).toMatchObject({program: vector.program, data: "0c080706050403020106", keys: [
      {pubkey: vector.source, signer: false, writable: true},
      {pubkey: inputs.mint.toBase58(), signer: false, writable: false},
      {pubkey: vector.destination, signer: false, writable: true},
      {pubkey: inputs.owner.toBase58(), signer: true, writable: false},
    ]});
    expect(sign).not.toHaveBeenCalled();
  });

});
