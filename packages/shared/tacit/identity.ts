import type { SignableMessage } from "viem";

/** The fixed identity signature is a spending secret, not a signature tool result. */
export function isTacitIdentityMessage(message: SignableMessage): boolean {
  let text: string;
  try {
    if (typeof message === "string") text = message;
    else if (message.raw instanceof Uint8Array) text = new TextDecoder().decode(message.raw);
    else {
      const hex = message.raw.replace(/^0x/, "");
      if (hex.length > 2048 || hex.length % 2 || !/^[0-9a-fA-F]*$/.test(hex)) return false;
      text = new TextDecoder().decode(Uint8Array.from(hex.match(/../g) ?? [], v => parseInt(v, 16)));
    }
  } catch { return false; }
  return text.startsWith("Tacit identity\n\nSigning this creates your Tacit private key.");
}
