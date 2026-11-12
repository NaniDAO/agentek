import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const exact = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const failures = [];
let count = 0;
function check(file) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (!exact.test(version) && !version.startsWith('workspace:')) failures.push(`${file}: ${section}.${name} must be an exact version (${version})`);
    }
  }
  for (const [name, version] of Object.entries(manifest.pnpm?.overrides ?? {})) {
    if (!exact.test(version)) failures.push(`${file}: override ${name} must be an exact version (${version})`);
  }
  count++;
}
function walk(directory) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (['node_modules', 'dist', '.git', '.local', '.build'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name === 'package.json') check(path);
  }
}
check(join(root, 'package.json'));
walk(join(root, 'packages'));
check(join(root, 'examples', 'package.json'));
if (failures.length) throw new Error(failures.join('\n'));
console.log(`Dependency pins checked: ${count} manifests; exact external versions and overrides.`);
