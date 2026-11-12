import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'agentek-packages-'));
const modules = join(temp, 'node_modules');
const dirs = ['shared', 'ai-sdk', 'mcp', 'cli', 'gym'];
const packages = [];
const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', timeout: 60_000, stdio: 'pipe', ...options,
});

function targets(value) {
  if (typeof value === 'string') return [value];
  return Object.values(value ?? {}).flatMap(targets);
}

try {
  mkdirSync(modules);
  for (const dir of dirs) {
    const source = resolve(root, 'packages', dir);
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
    const archive = `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;
    run('pnpm', ['pack', '--pack-destination', temp], { cwd: source });
    const destination = join(modules, manifest.name);
    mkdirSync(destination, { recursive: true });
    run('tar', ['-xzf', join(temp, archive), '--strip-components=1', '-C', destination]);
    const packed = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'));
    for (const [name, range] of Object.entries({ ...packed.dependencies, ...packed.peerDependencies })) {
      assert.ok(!range.startsWith('workspace:'), `${packed.name}: unresolved ${name} dependency`);
    }
    const paths = [packed.main, packed.module, packed.types, packed.man, ...Object.values(packed.bin ?? {}), ...targets(packed.exports)].filter(Boolean);
    for (const path of paths) assert.ok(existsSync(join(destination, path)), `${packed.name}: missing ${path} in tarball`);
    for (const condition of Object.values(packed.exports ?? {})) {
      const required = typeof condition === 'object' ? condition.require : undefined;
      const path = typeof required === 'string' ? required : required?.default;
      if (packed.type === 'module' && path) {
        assert.ok(!path.endsWith('.js') || dir === 'shared', `${packed.name}: CommonJS entry needs .cjs or a nested CommonJS package scope`);
      }
    }
    packages.push({ source, destination, packed });
  }

  const shared = packages.find(p => p.packed.name === '@agentek/tools');
  assert.equal(shared.packed.peerDependencies.zod, '4.6.6', 'Packed tools must require the fixed, pinned Zod release');
  assert.ok(!shared.packed.files.includes('patches'), 'Consumers must not need a package-manager backport');

  // Use installed external dependencies, but resolve all @agentek packages to
  // the extracted tarballs so workspace links cannot hide packaging failures.
  for (const { source, packed } of packages) {
    for (const name of Object.keys({ ...packed.dependencies, ...packed.peerDependencies })) {
      if (packed.peerDependenciesMeta?.[name]?.optional) continue;
      const target = join(modules, name);
      if (existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(realpathSync(join(source, 'node_modules', name)), target, 'dir');
    }
  }
  for (const name of ['@agentek/tools', '@agentek/ai-sdk']) {
    const { packed } = packages.find(p => p.packed.name === name);
    for (const subpath of Object.keys(packed.exports)) {
      if (name === "@agentek/tools" && ["./solana", "./solana/market", "./x402", "./web"].includes(subpath)) continue;
      const specifier = name + (subpath === '.' ? '' : subpath.slice(1));
      run(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`], { cwd: temp });
      run(process.execPath, ['-e', `require(${JSON.stringify(specifier)})`], { cwd: temp });
    }
  }
  const cli = packages.find(p => p.packed.name === '@agentek/cli');
  const cliPath = join(cli.destination, cli.packed.bin.agentek);
  assert.equal(run(process.execPath, [cliPath, '--version']).trim(), cli.packed.version);
  const env = { PATH: process.env.PATH, AGENTEK_CONFIG_DIR: join(temp, 'config') };
  const tools = JSON.parse(run(process.execPath, [cliPath, 'list'], { env }));
  assert.ok(JSON.stringify(tools).includes('getBalance'), 'Packed CLI must load the core tools');

  const mcp = packages.find(p => p.packed.name === '@agentek/mcp-server');
  const request = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'package-check', version: '1.0.0' },
  } }) + '\n';
  for (const condition of ['import', 'require']) {
    const path = mcp.packed.exports['.'][condition];
    const output = run(process.execPath, [join(mcp.destination, path)], { env, input: request });
    const response = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).find(message => message.id === 1);
    assert.equal(response?.result?.serverInfo?.version, mcp.packed.version, `Packed MCP ${condition} must initialize with manifest version`);
  }
  // Only after proving that core/CLI/MCP work without optional peers, verify
  // the installed integrations and their ESM/CommonJS exports separately.
  for (const {source, packed} of packages) {
    for (const name of Object.keys(packed.peerDependenciesMeta ?? {})) {
      const target = join(modules, name);
      if (existsSync(target)) continue;
      mkdirSync(dirname(target), {recursive: true});
      symlinkSync(realpathSync(join(source, 'node_modules', name)), target, 'dir');
    }
  }
  for (const subpath of ['./solana', './solana/market', './x402', './web']) {
    const specifier = '@agentek/tools' + subpath.slice(1);
    run(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`], {cwd: temp});
    run(process.execPath, ['-e', `require(${JSON.stringify(specifier)})`], {cwd: temp});
  }
  console.log('Package checks passed: five tarballs, core/CLI/MCP without optional peers, and optional ESM/CommonJS exports.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
