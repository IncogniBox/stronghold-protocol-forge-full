// test/content/recon-chen3.test.js — 赤刃明霄陈·重构的特质（`recon_garrison_chen3_a/b`，IN_BATTLE）：
// 每次命中追加一笔「已激活【炎】层数 × 当前生命百分比」的固定真实伤害（0.001% / 精锐 0.002%）。
//
// 机制在包模块里（`workshop/mode-recon/battle/main.mjs` 的 `RECON_CHEN3_TRUE_DMG` installer）；测试走与
// `server/battlePack.js` 同一条装载路径（白名单说明符 → `data:` 模块），配合同一条 `setGameData` 注入的特质记录。
//
// 跑法：node --test test/content/recon-chen3.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';
import { setGameData, gameData } from '../../server/sim/content/support/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = path.join(ROOT, 'workshop/mode-recon');
const GARRISONS = JSON.parse(fs.readFileSync(path.join(PACK, 'garrisons.json'), 'utf8'));
const YAN = 'yanShip';
const CHEN = 'recon_chess_ws_recon_chen3_a';

/** 与 `server/battlePack.js` 同一条装载路径（改白名单说明符 → data: 模块；模块顶层完成注册）。 */
async function loadPack() {
  const src = fs.readFileSync(path.join(PACK, 'battle/main.mjs'), 'utf8');
  const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
  await import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
}

/** 该玩家的【炎】盟约：`count` 决定激活，`layers` 是「每层」那一轴。 */
const bondOn = (layers) => ({ count: 3, active: true, tier: 1, layers });

function chenRec(gid) {
  const rec = chessRec({
    id: CHEN, bonds: [YAN], rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]], skill: null,
    stats: { atk: 100, maxHp: 5000, def: 0, res: 0, bat: 1, blockCnt: 1 },
  });
  rec.garrisonIds = [gid];
  return rec;
}

test('赤刃明霄陈·重构：攻击附带「炎层数 × 当前生命 × 0.001%」的固定真实伤害（精锐 0.002%）', async () => {
  await loadPack();
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
  try {
    const run = (gid, pct) => {
      const extra = [];
      const h = makeBattle({
        defs: { chess: { [CHEN]: chenRec(gid) }, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0, def: 0 }) } },
        units: [{ chessId: CHEN, row: 10, col: 3 }],
        enemies: [{ key: 'e_dummy', time: 0, pos: [10, 6], mods: { speedMul: 0 } }],
        bonds: { [YAN]: bondOn(100) }, modeId: 'mode_recon_abyss', timeLimit: 10, autoFinish: false,
        setup: (b) => b.on('damaged', ({ target, dmg }) => {
          if (!dmg || !Array.isArray(dmg.tags) || !dmg.tags.includes('garrison')) return;
          extra.push({ amount: dmg.amount, before: target.hp + dmg.amount, type: dmg.type });
        }),
      });
      h.runUntil(() => extra.length >= 3 || h.b.time > 8, 10);
      assert.ok(extra.length >= 1, `${gid}：攻击命中了，就应该有追加的那一笔`);
      for (const x of extra) {
        assert.equal(x.type, 'true', '固定真实伤害');
        const want = 100 * pct * x.before;
        assert.ok(Math.abs(x.amount - want) < 1e-6, `${gid}: ${x.amount} ≠ 100 层 × ${pct * 100}% × ${x.before}`);
      }
      assert.equal(h.invariants(), true);
    };
    run('recon_garrison_chen3_a', 0.00001);
    run('recon_garrison_chen3_b', 0.00002);
  } finally {
    setGameData(null);
  }
});

test('没有激活【炎】：层数为 0 ⇒ 不追加任何伤害', async () => {
  await loadPack();
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
  try {
    const extra = [];
    const h = makeBattle({
      defs: { chess: { [CHEN]: chenRec('recon_garrison_chen3_a') }, enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0, def: 0 }) } },
      units: [{ chessId: CHEN, row: 10, col: 3 }],
      enemies: [{ key: 'e_dummy', time: 0, pos: [10, 6], mods: { speedMul: 0 } }],
      bonds: { [YAN]: { count: 0, active: false, tier: 0, layers: 0 } }, modeId: 'mode_recon_abyss', timeLimit: 10, autoFinish: false,
      setup: (b) => b.on('damaged', ({ dmg }) => { if (dmg && dmg.tags && dmg.tags.includes('garrison')) extra.push(dmg.amount); }),
    });
    h.run(8);
    assert.ok(h.hooksOf('attack').length > 0, '她真的攻击了（否则这条断言什么也没证明）');
    assert.equal(extra.length, 0, '盟约没激活 ⇒ 0 层 ⇒ 没有附加真实伤害');
  } finally {
    setGameData(null);
  }
});
after(() => setGameData(null));
