// Boundary checker: fixture rules, plus the real tree's current violation list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSpecifiers, scan } from '../tools/check-imports.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'sp-imp-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

test('comments are not imports, and a multiline import is', () => {
  const specs = findSpecifiers(`
    // import fs from 'node:fs'
    /* require('node:path') */
    import {
      a,
      b,
    } from './tier1.js';
    export function fromThing() { return 1; }
  `);
  assert.deepEqual(specs.map((s) => s.spec), ['./tier1.js']);
});

test('sim and match rules on a fixture tree', () => {
  const root = fixture({
    'server/sim/clean.js': `
      // import fs from 'node:fs'
      import { a } from './other.js';
      export function load() { return 1; }
      export { a };
    `,
    'server/sim/bad.js': `
      import '../match/Match.js';
      import '../lobby.js';
      import '../index.js';
      import '../net.js';
      import '../../public/js/main.js';
      import fs from 'node:fs';
      import 'fs';
      export { z } from '../match/board.js';
      const p = await import('node:path');
    `,
    'server/match/ok.js': `
      import '../sim/rng.js';
      import 'node:fs';
      import '../data.js';
    `,
    'server/match/bad.js': `
      import '../../public/js/main.js';
      import 'node:http';
      import 'ws';
      import '../net.js';
      import '../index.js';
    `,
  });
  try {
    const keys = scan(root).violations.map((v) => `${v.file} ${v.spec} ${v.code}`).sort();
    assert.deepEqual(keys, [
      'server/match/bad.js ../../public/js/main.js match-client',
      'server/match/bad.js ../index.js match-http',
      'server/match/bad.js ../net.js match-http',
      'server/match/bad.js node:http match-http',
      'server/match/bad.js ws match-http',
      'server/sim/bad.js ../../public/js/main.js sim-client',
      'server/sim/bad.js ../index.js sim-entry',
      'server/sim/bad.js ../lobby.js sim-lobby',
      'server/sim/bad.js ../match/Match.js sim-match',
      'server/sim/bad.js ../match/board.js sim-match',
      'server/sim/bad.js ../net.js sim-http',
      'server/sim/bad.js fs sim-node',
      'server/sim/bad.js node:fs sim-node',
      'server/sim/bad.js node:path sim-node',
    ]);
    assert.equal(scan(root).notes.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('this repo: only the Node data loader crosses the sim boundary — and it is a note', () => {
  const { violations, notes } = scan(ROOT);
  // 契约多了一条点名豁免：`server/sim/nodeData.js` 自己的 `node:*` 也算 note（它就是「把 Node API 关在这一个文件里」
  // 的那一个，浏览器从不加载它；理由写在 tools/check-imports.mjs 的那一处注释）⇒ 真实树的 violation 列表是空的。
  assert.deepEqual(violations.map((v) => `${v.file}:${v.line}: ${v.spec} [${v.code}]`), []);
  assert.deepEqual(notes.map((n) => `${n.file}:${n.line}: ${n.spec}`), [
    'server/sim/content/support/index.js:20: ../../../data.js',
    'server/sim/nodeData.js:11: node:fs',
    'server/sim/nodeData.js:12: node:path',
    'server/sim/nodeData.js:13: node:url',
    'server/sim/nodeData.js:23: ../data.js',
    'server/sim/nodeData.js:33: ../data.js',
  ]);
  // 豁免**只**给这一个文件：其余 note 仍然只能是 `server/data.js`（那个 Node 加载器的数据源）
  assert.ok(notes.every((n) => n.file === 'server/sim/nodeData.js' || n.resolved === 'server/data.js'));
});

test('the CLI lists hits and fails only with --strict', () => {
  const loose = spawnSync(process.execPath, ['tools/check-imports.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(loose.status, 0);
  assert.match(loose.stdout, /no import-boundary violations/);
  assert.match(loose.stdout, /note server\/sim\/nodeData\.js:11: node:fs -> node:fs/);
  // 点名豁免之后这条路上只剩 note 了：--strict 也不再退出 1（真正的 violation 由上面的 fixture 用例钉着）
  const strict = spawnSync(process.execPath, ['tools/check-imports.mjs', '--strict'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(strict.status, 0);
  assert.match(strict.stdout, /6 allowed note\(s\)/);
});
