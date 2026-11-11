import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "./constants.js";

// The narrow SPL surface used by transfers. Byte layouts match the SPL Token
// and associated-token program ABIs; no general-purpose native bigint codec.
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const MAX_U64 = (1n << 64n) - 1n;
function canonicalProgram(program: PublicKey): void {
  if (![TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].includes(program.toBase58())) throw new Error("Unsupported SPL token program");
}

/** PDA owners are intentional: treasuries can own an ATA without being a keypair. */
export function associatedTokenAddress(mint: PublicKey, owner: PublicKey, program: PublicKey): PublicKey {
  canonicalProgram(program);
  return PublicKey.findProgramAddressSync([owner.toBuffer(), program.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM)[0];
}

export function createAssociatedTokenInstruction(payer: PublicKey, associated: PublicKey, owner: PublicKey, mint: PublicKey, program: PublicKey): TransactionInstruction {
  canonicalProgram(program);
  if (!associated.equals(associatedTokenAddress(mint, owner, program))) throw new Error("Associated token account does not match owner, mint and program");
  return new TransactionInstruction({programId: ASSOCIATED_TOKEN_PROGRAM, data: Buffer.from([1]), keys: [
    {pubkey: payer, isSigner: true, isWritable: true},
    {pubkey: associated, isSigner: false, isWritable: true},
    {pubkey: owner, isSigner: false, isWritable: false},
    {pubkey: mint, isSigner: false, isWritable: false},
    {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
    {pubkey: program, isSigner: false, isWritable: false},
  ]});
}

/** TransferChecked: discriminator 12, little-endian u64 amount, u8 precision. */
export function createCheckedTransferInstruction(source: PublicKey, mint: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint, decimals: number, program: PublicKey): TransactionInstruction {
  canonicalProgram(program);
  if (typeof amount !== "bigint" || amount < 0n || amount > MAX_U64) throw new Error("SPL transfer amount exceeds u64");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("Invalid SPL token precision");
  const data = Buffer.alloc(10);
  data[0] = 12;
  new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(1, amount, true);
  data[9] = decimals;
  return new TransactionInstruction({programId: program, data, keys: [
    {pubkey: source, isSigner: false, isWritable: true},
    {pubkey: mint, isSigner: false, isWritable: false},
    {pubkey: destination, isSigner: false, isWritable: true},
    {pubkey: owner, isSigner: true, isWritable: false},
  ]});
}

/** Decode precision from the same owner-validated account used for program selection. */
export function mintDecimals(info: {owner: PublicKey; data: Uint8Array}, program: PublicKey): number {
  canonicalProgram(program);
  if (!info || !info.owner.equals(program)) throw new Error("SPL mint owner does not match token program");
  const data = info.data;
  if (!(data instanceof Uint8Array) || data.length < 82) throw new Error("Unreadable SPL mint account size");
  if (data.length > 82 && (program.toBase58() !== TOKEN_2022_PROGRAM_ID || data.length <= 165 || data.length === 355 || data[165] !== 1)) throw new Error("Invalid SPL extended mint account");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) > 1 || view.getUint32(46, true) > 1) throw new Error("Invalid SPL mint authority options");
  if (data[45] !== 1) throw new Error("SPL mint is not initialized");
  return data[44];
}
