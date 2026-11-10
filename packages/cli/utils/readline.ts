import { createInterface } from "node:readline";
import { StringDecoder } from "node:string_decoder";

/** Read a line, including pasted input and streams that deliver several characters together. */
export function readLine(prompt: string, hidden = false): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stderr.write(prompt);
    if (!hidden) {
      const rl = createInterface({input: process.stdin, output: process.stderr});
      let answered = false;
      rl.once("close", () => { if (!answered) reject(new Error("Input closed before an answer")); });
      rl.question("", answer => { answered = true; rl.close(); resolve(answer); });
      return;
    }
    const {stdin} = process;
    const decoder = new StringDecoder("utf8");
    let input = "";
    const cleanup = () => {
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      stdin.pause();
    };
    const onEnd = () => { cleanup(); reject(new Error("Input closed before a passphrase")); };
    const onData = (chunk: Buffer) => {
      for (const char of decoder.write(chunk)) {
        if (char === "\n" || char === "\r") { cleanup(); process.stderr.write("\n"); resolve(input); return; }
        if (char === "\u0003") { cleanup(); reject(new Error("Input cancelled")); return; }
        if (char === "\u007f" || char === "\b") input = Array.from(input).slice(0,-1).join("");
        else input += char;
      }
    };
    if (stdin.isTTY) stdin.setRawMode(true);
    stdin.on("data", onData);
    stdin.once("end", onEnd);
    stdin.resume();
  });
}
