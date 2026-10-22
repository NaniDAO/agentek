import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions } from './release.mjs';

test('release versions compare numerically and reject shell text and malformed versions', () => {
  assert.equal(compareVersions('0.2.0', '0.1.27'), 1);
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  for (const version of ['patch', '01.2.3', '0.2', '0.2.0; echo bad', '0.2.0-rc.1']) {
    assert.throws(() => compareVersions(version, '0.1.27'));
  }
});

test('preparation refuses published versions and failed checks before editing manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentek-release-test-'));
  try {
    mkdirSync(join(root, 'scripts'));
    cpSync(new URL('./release.mjs', import.meta.url), join(root, 'scripts/release.mjs'));
    const dirs = ['shared', 'ai-sdk', 'mcp', 'cli'];
    const names = ['tools', 'ai-sdk', 'mcp-server', 'cli'];
    for (const [index, dir] of dirs.entries()) {
      mkdirSync(join(root, 'packages', dir), { recursive: true });
      writeFileSync(join(root, 'packages', dir, 'package.json'), JSON.stringify({ name: `@agentek/${names[index]}`, version: '0.1.26' }));
    }
    mkdirSync(join(root, 'bin'));
    writeFileSync(join(root, 'bin/npm'), '#!/bin/sh\nprintf \'["0.1.26","0.1.27"]\\n\'\n', { mode: 0o755 });
    writeFileSync(join(root, 'bin/pnpm'), '#!/bin/sh\nexit "${RELEASE_CHECK_STATUS:-0}"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, GIT_AUTHOR_NAME: 'Release Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Release Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
    const git = (...args) => execFileSync('git', args, { cwd: root, env, stdio: 'pipe' });
    const run = (args, overrides = {}) => spawnSync(process.execPath, ['scripts/release.mjs', ...args], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
    const versions = () => dirs.map(dir => JSON.parse(readFileSync(join(root, 'packages', dir, 'package.json'))).version);
    git('init'); git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'fixture');
    assert.equal(run(['0.2.0']).status, 0);
    assert.deepEqual(versions(), Array(4).fill('0.1.26'));
    const published = run(['0.1.27', '--prepare']);
    assert.equal(published.status, 1);
    assert.match(published.stderr, /already published/);
    assert.deepEqual(versions(), Array(4).fill('0.1.26'));
    assert.equal(run(['0.2.0', '--prepare'], { RELEASE_CHECK_STATUS: '1' }).status, 1);
    assert.deepEqual(versions(), Array(4).fill('0.1.26'));
    assert.equal(run(['0.2.0', '--prepare']).status, 0);
    assert.deepEqual(versions(), Array(4).fill('0.2.0'));
    const dirty = run(['0.3.0', '--prepare']);
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /working-tree changes/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
