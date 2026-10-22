import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const releasePaths = ['shared', 'ai-sdk', 'mcp', 'cli'];

export function compareVersions(a, b) {
  const parse = (value) => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
      throw new Error(`Expected an explicit stable version such as 0.2.0; received ${JSON.stringify(value)}`);
    }
    const parts = value.split('.').map(Number);
    if (!parts.every(Number.isSafeInteger)) throw new Error('Version components are too large');
    return parts;
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  }
  return 0;
}

function run(command, args, capture = false) {
  return execFileSync(command, args, {
    cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    timeout: capture ? 60_000 : undefined,
  });
}

export function main(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    console.log('Usage: pnpm release <version> [--prepare]\n\nPreview is read-only. --prepare verifies the registry and release checks, then updates\nthe four release manifests. Nothing is committed, tagged, pushed, or published.\nReview and commit the prepared manifests before publishing separately.');
    return;
  }
  const [version, ...flags] = args;
  if (flags.length > 1 || flags.some(flag => flag !== '--prepare')) throw new Error('Unknown arguments; use --help');
  compareVersions(version, version);
  const packages = releasePaths.map(dir => {
    const path = resolve(root, 'packages', dir, 'package.json');
    return { path, manifest: JSON.parse(readFileSync(path, 'utf8')) };
  });
  for (const { manifest } of packages) {
    if (compareVersions(version, manifest.version) <= 0) {
      throw new Error(`${version} must be newer than ${manifest.name}@${manifest.version}`);
    }
    console.log(`${manifest.name}: ${manifest.version} -> ${version}`);
  }
  if (!flags.includes('--prepare')) {
    console.log('\nPreview only. Registry availability has not been checked.\nUse --prepare after committing your changes to verify and update these manifests.');
    return;
  }
  if (run('git', ['status', '--porcelain'], true).trim()) throw new Error('Commit or stash working-tree changes before preparing a release');

  // Read every published version, not just latest: a release may already exist
  // under another dist-tag. Fail closed on registry/network errors.
  for (const { manifest } of packages) {
    const versions = JSON.parse(run('npm', [
      'view', manifest.name, 'versions', '--json', '--registry=https://registry.npmjs.org',
      '--fetch-retries=0', '--fetch-timeout=15000',
    ], true));
    const published = Array.isArray(versions) ? versions : [versions];
    if (published.includes(version)) throw new Error(`${manifest.name}@${version} is already published`);
    for (const existing of published.filter(v => /^\d+\.\d+\.\d+$/.test(v))) {
      if (compareVersions(version, existing) <= 0) throw new Error(`${manifest.name} already has newer version ${existing}`);
    }
  }
  run('pnpm', ['release:check']);
  if (run('git', ['status', '--porcelain'], true).trim()) throw new Error('Release checks changed tracked or untracked source files');
  for (const { path, manifest } of packages) {
    writeFileSync(path, JSON.stringify({ ...manifest, version }, null, 2) + '\n');
  }
  console.log('\nManifests prepared. Review the diff, update release notes, commit, and rerun release:check.\nNothing has been published.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
