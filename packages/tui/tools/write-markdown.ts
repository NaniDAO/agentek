import { writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";

export async function executeWriteMarkdown(args: { filename: string; content: string }): Promise<string> {
  if (!args.filename.endsWith(".md")) {
    return JSON.stringify({ success: false, error: "Filename must end with .md" });
  }

  const resolved = resolve(process.cwd(), args.filename);
  if (basename(resolved) !== args.filename || resolved !== resolve(process.cwd(), basename(args.filename))) {
    return JSON.stringify({ success: false, error: "Path traversal not allowed" });
  }

  const bytes = Buffer.byteLength(args.content, "utf-8");
  writeFileSync(resolved, args.content, "utf-8");
  return JSON.stringify({ success: true, path: resolved, bytes });
}
