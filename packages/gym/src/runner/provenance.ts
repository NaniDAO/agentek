import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | undefined;
/** Hash the installed implementation, including workspace source when present. */
export function implementationFingerprint(): string {
  if (cached) return cached;
  let root = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(root, "package.json"))) {
    const parent = dirname(root);
    if (parent === root) throw new Error("Cannot identify Gym implementation");
    root = parent;
  }
  const hash = createHash("sha256");
  const walk = (path: string, label: string) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, {withFileTypes: true}).sort((a,b) => a.name.localeCompare(b.name))) {
      if (["node_modules", ".git", "artifacts", "fixtures", "test", "tests"].includes(entry.name)) continue;
      const full = join(path, entry.name), name = `${label}/${entry.name}`;
      if (entry.isDirectory()) walk(full, name);
      else if (/\.(ts|js|cjs|mjs)$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) hash.update(name).update(readFileSync(full));
    }
  };
  walk(root, "gym");
  walk(join(dirname(root), "shared"), "tools");
  cached = hash.digest("hex");
  return cached;
}
