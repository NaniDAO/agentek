import { watch, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Watch source directories only; builds are queued and always run sequentially.
const buildScript = fileURLToPath(new URL('./build-package.mjs', import.meta.url));
const watched = new Map();
let child;
let queued = false;
let timer;
function rebuild() {
  if (child) { queued = true; return; }
  child = spawn(process.execPath, [buildScript], {stdio: 'inherit'});
  child.once('exit', () => { child = undefined; if (queued) {queued = false; rebuild();} });
}
function scan(directory) {
  if (!watched.has(directory)) watched.set(directory, watch(directory, (_event, file) => {
    if (!file || (!/\.(?:ts|json)$/.test(file) && !file.includes('.'))) {scan(directory); return;}
    if (file.endsWith('.test.ts')) return;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  }));
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (entry.isDirectory() && !['node_modules', 'dist', '.git'].includes(entry.name)) scan(join(directory, entry.name));
  }
}
scan(process.cwd());
rebuild();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  clearTimeout(timer);
  for (const watcher of watched.values()) watcher.close();
  child?.kill(signal);
  process.exit(0);
});
