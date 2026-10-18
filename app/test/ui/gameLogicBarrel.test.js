// test/ui/gameLogicBarrel.test.js — the contract of public/js/ui/gameLogic.js: it re-exports the names its
// `gameLogic/*.js` modules hold, and every module that imports from it may only name those. A named import of a name
// a module does not provide is a **link-time** error in ES modules: the whole script graph fails to link and the page
// never leaves its boot overlay (`public/index.html` shows 游戏脚本加载失败 for exactly that case) — while
// `node --check`, eslint and the render engine's browser checks all stay green, because none of them links the whole
// UI graph. So the barrel is checked here on both sides, statically (no UI module is executed):
//   * every name the barrel lists must exist in the module it re-exports from;
//   * every name an importer names must be one the barrel really exports.
// (The real miss that brought this in: 设置「帧率」's FRAME_RATES was added to gameLogic/settings.js and imported by
// ui/settings.js, but the barrel's list was not updated — the boot overlay stuck on 游戏脚本加载失败.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BARREL = path.join(ROOT, 'public/js/ui/gameLogic.js');
const posix = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
/** Every .js under `dir`. */
function jsFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) jsFiles(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
/** { names, spec } of every `import { … } from '…'` in `src` (a name's `as` alias is dropped: the source name is the one that must exist). */
function braceImports(src) {
  const out = [];
  for (const [, body, spec] of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    out.push({ spec, names: body.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean) });
  }
  return out;
}
/** The names the barrel's own `export { … } from '…'` lists name. */
function barrelLists(src) {
  const out = [];
  for (const [, body, spec] of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const name of body.split(',').map((s) => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean)) out.push({ name, spec });
  }
  return out;
}

test('the barrel lists every name it re-exports, and every importer names one of them (a miss is a blank boot screen)', async () => {
  const src = readFileSync(BARREL, 'utf8');
  const listed = barrelLists(src);
  assert.ok(listed.length > 100, `${listed.length} re-exported names listed`);

  // 1) barrel → module: a listed name its module does not export is a link error as well
  for (const { name, spec } of listed) {
    if (!spec.startsWith('.')) continue;
    const mod = await import(new URL(spec, pathToFileURL(BARREL)).href);
    assert.ok(name in mod, `gameLogic.js re-exports ${name} from ${spec}, which does not export it`);
  }

  // 2) importer → barrel: the miss that took the client down (ui/settings.js's FRAME_RATES)
  const exported = new Set(Object.keys(await import(pathToFileURL(BARREL).href)));
  let checked = 0;
  for (const file of jsFiles(path.join(ROOT, 'public'))) {
    for (const { spec, names } of braceImports(readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.') || path.resolve(path.dirname(file), spec) !== BARREL) continue;
      for (const name of names) {
        assert.ok(exported.has(name), `${posix(file)} imports ${name} from ui/gameLogic.js, which does not re-export it (the module graph then fails to link: 游戏脚本加载失败)`);
        checked++;
      }
    }
  }
  assert.ok(checked > 30, `${checked} names imported from the barrel`);
});
