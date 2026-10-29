// 预重构屏 ↔ 工坊包的「id 即接口」契约（`specs/pre-recon-polish` T8）。
//
// 六个选项 id 是**同一个命名空间**的三处拼写：屏上的 ASSIST_OPTS / LOAD_OPTS、`g.reconChoice` 交上去的值、
// `workshop/mode-recon` 里 meta / battle 按 id 生效的分支。任何一侧改名而另侧没跟上，就是一条静默失效
// （选择交上去了、机制不认识它）。这条测试只读源码文本，把六者钉在一起。
//
// 跑法：node --test test/match/recon-copy.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('预重构屏的六个选项 id 都在包内 meta / battle 源码里（id 即接口）', () => {
  const screen = read('public/js/screens/preRecon.js');
  const ids = [...new Set([...screen.matchAll(/id: '(recon_(?:assist|load)_[a-z]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(ids, [
    'recon_assist_bond', 'recon_assist_data', 'recon_assist_equip',
    'recon_load_bond', 'recon_load_data', 'recon_load_equip',
  ], '屏上恰好六条（id 拼写就是协议与包共用的那一份）');

  const meta = read('workshop/mode-recon/meta/main.mjs');
  const battle = read('workshop/mode-recon/battle/main.mjs');
  for (const id of ids) {
    assert.ok(meta.includes(id) || battle.includes(id), `${id} 没有在包内出现（两侧改名就会漂移）`);
  }
});

// 服务端在没人选的时候要**随机补 1 个**（Match.fillReconChoices），那两份 id 列表在 shared/reconModes.js ——
// 与屏上两张表必须逐字一致（否则补出来的 id 会是包不认识的，静默失效）。
test('shared 的 RECON_ASSIST_IDS / RECON_LOAD_IDS 与屏上六条逐字一致', async () => {
  const { RECON_ASSIST_IDS, RECON_LOAD_IDS } = await import('../../shared/reconModes.js');
  const screen = read('public/js/screens/preRecon.js');
  const onScreen = [...new Set([...screen.matchAll(/id: '(recon_(?:assist|load)_[a-z]+)'/g)].map((m) => m[1]))];
  assert.deepEqual([...RECON_ASSIST_IDS].sort(), onScreen.filter((id) => id.startsWith('recon_assist_')).sort());
  assert.deepEqual([...RECON_LOAD_IDS].sort(), onScreen.filter((id) => id.startsWith('recon_load_')).sort());
});

// 局内「策略效果」下面那一列（screens/game.js 的 gm__effects → ui/effectsList.js 的 ReconProtocolList）读的行：
// 只认本局交上去的两个 id，未知 id 与没交的座位都画不出来。
test('reconProtocolRows 按已交的选择给出协助 / 负载两行', async () => {
  const { reconProtocolRows } = await import('../../public/js/screens/preRecon.js');
  const rows = reconProtocolRows({
    p1: { assist: 'recon_assist_equip', load: 'recon_load_data' },
    p2: { assist: 'recon_assist_bond' },
    p3: { assist: 'nope', load: 'nope' },
  }, 'p1');
  assert.deepEqual(rows.map((r) => [r.id, r.key]), [
    ['recon_assist_equip', 'assist'],
    ['recon_load_data', 'load'],
  ]);
  assert.equal(rows[0].kind, '重构协助');
  assert.equal(rows[1].kind, '熔芯负载');
  assert.ok(rows.every((r) => r.name && r.desc), '名称与说明直接取自屏上的那两张表');

  assert.deepEqual(reconProtocolRows({ p2: { assist: 'recon_assist_bond' } }, 'p1'), [], '没交的座位没有行');
  assert.deepEqual(reconProtocolRows({ p3: { assist: 'nope' } }, 'p3'), [], '未知 id 一行都不画');
  assert.deepEqual(reconProtocolRows(null, 'p1'), [], '非重构对局（没有 pub.recon）不画');
  assert.deepEqual(reconProtocolRows({ p1: {} }, null), [], '观战席（没有自己）不画');
});

test('八条核心盟约的重构记录与八张图标都在包里（不覆盖官方记录）', () => {
  const ids = ['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'lateranoShip', 'egirShip', 'siracusaShip', 'kazimierzShip'];
  const pack = JSON.parse(read('workshop/mode-recon/pack.json'));
  const bonds = JSON.parse(read('workshop/mode-recon/bonds.json'));
  assert.equal(pack.overrides, undefined, '不用 overrides（官方记录一个字节都不改）');
  for (const id of ids) {
    assert.ok(bonds[`recon_${id}`], `recon_${id} 记录`);
    assert.equal(bonds[`recon_${id}`].bondId, `recon_${id}`);
    assert.deepEqual(bonds[`recon_${id}`].thresholds, [3, 6, 9], `${id}: 3/6/9 档`);
    assert.ok(bonds[`recon_${id}`].bb && bonds[`recon_${id}`].bb.recon, `${id}: bb.recon`);
    assert.equal(pack.bondIcons && pack.bondIcons[id], undefined, `${id}: 不再单独换图标（叠层用底图 + 官方图标）`);
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'workshop/mode-recon/assets/bond/recon_base.png')), true, '叠层底图');
});

test('game.js 把这两行挂在 EFFECTS 列下面', () => {
  const game = read('public/js/screens/game.js');
  assert.match(game, /<div class="gm__effects">[\s\S]*?<\$\{EffectsList\}[\s\S]*?<\$\{ReconProtocolList\}[\s\S]*?reconProtocolRows\(pub\?\.recon\?\.choices/,
    'gm__effects 里 EffectsList 之后要渲染 ReconProtocolList（局内能看到已选的协助 / 负载）');
});
