import { createInterface } from "node:readline";

/** Read a line from stdin, optionally hiding input for passphrases. */
export function readLine(prompt: string, hidden = false): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    if (hidden) {
      // Disable echo for passphrase entry
      const { stdin } = process;
      if (stdin.isTTY) stdin.setRawMode(true);
      let input = "";
      const onData = (ch: Buffer) => {
        const c = ch.toString();
        if (c === "\n" || c === "\r") {
          if (stdin.isTTY) stdin.setRawMode(false);
          stdin.removeListener("data", onData);
          stdin.pause();
          process.stderr.write("\n");
          resolve(input);
        } else if (c === "\u0003") {
          // Ctrl+C
          if (stdin.isTTY) stdin.setRawMode(false);
          process.exit(1);
        } else if (c === "\u007f" || c === "\b") {
          // Backspace
          input = input.slice(0, -1);
        } else {
          input += c;
        }
      };
      stdin.resume();
      stdin.on("data", onData);
    } else {
      const rl = createInterface({
        input: process.stdin,
        output: process.stderr,
      });
      rl.question("", (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}
