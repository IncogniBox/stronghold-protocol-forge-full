// test/content/recon-sargon.test.js — 萨尔贡三名新干员（业主 2026-10-30）在重构模拟里的特质：
//   娜仁图亚 `RECON_NARANT_SHARE`  技能开启 → 携带装备的效果共享给相邻 4 / 8 格【萨尔贡】干员 60 s
//   森蚺     `RECON_ZUMAMA_LAYERS` 【萨尔贡】每开启 1 次技能 → 已激活的【萨尔贡】【坚守】+6 层（≥20 次给休整期标记）
//   狮蝎     `RECON_MANTIC_STEALTH` 战斗开始给自身与相邻 4 / 8 格干员隐匿，敌人攻击命中后解除（战斗结束标记持有数）
// 另有休整期那一半（`meta/main.mjs` 的 sargonPrepRewards）：黄沙罗盘 / 盟约之币的发放。
//
// 机制在包模块里（`workshop/mode-recon/battle/main.mjs`）；测试走与 `server/battlePack.js` 同一条装载路径
// （白名单说明符 → `data:` 模块）。
//
// 跑法：node --test test/content/recon-sargon.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';
import { setGameData, gameData } from '../../server/sim/content/support/index.js';
import { itemGrants } from '../../server/sim/content/items/battle.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = path.join(ROOT, 'workshop/mode-recon');
const GARRISONS = JSON.parse(fs.readFileSync(path.join(PACK, 'garrisons.json'), 'utf8'));
const SARGON = 'sargonShip';
const STEAD = 'steadShip';
const SHIELD = 'chess_item_1_02_e_a'; // 1 阶装备（坚守盾牌）：属性 buff，可被 lendItemEffects 借出

/** 与 `server/battlePack.js` 同一条装载路径（改白名单说明符 → data: 模块；模块顶层完成注册）。 */
async function loadPack() {
  const src = fs.readFileSync(path.join(PACK, 'battle/main.mjs'), 'utf8');
  const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
  await import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
}

/** 一名干员的记录（bonds 决定它算不算萨尔贡；特质记录由 garrisonIds 挂上）。 */
function rec(id, { bonds = [SARGON], garrison = null, skill = null } = {}) {
  const r = chessRec({
    id, bonds, rangeGrid: [[0, 0], [0, 1]], skill,
    stats: { atk: 100, maxHp: 5000, def: 0, res: 0, bat: 1, blockCnt: 1 },
  });
  if (garrison) r.garrisonIds = [garrison];
  return r;
}

/** 只开一次：SP 拉满后 `SP_FULL` 立刻开（不依赖攻击/射程内有敌人），之后按技力自然回复在测试时长内不会再满。 */
const ONE_CAST = { spCost: 100, initSp: 100, duration: 10, spType: 'INCREASE_WITH_TIME', trigger: { rule: 'SP_FULL' } };

after(() => setGameData(null));

test('娜仁图亚·重构：技能开启时携带装备共享给相邻的【萨尔贡】干员（60 s 后收回）', async () => {
  await loadPack();
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
  const CASTER = 'recon_chess_ws_recon_narant_a';
  const ALLY = 'ws_sargon_ally_a';
  const OTHER = 'ws_non_sargon_a';
  try {
    const h = makeBattle({
      defs: {
        chess: {
          // 特质的主人：自己也是萨尔贡，带一件装备
          [CASTER]: rec(CASTER, { garrison: 'recon_garrison_narant_a', skill: ONE_CAST }),
          [ALLY]: rec(ALLY),
          [OTHER]: rec(OTHER, { bonds: [] }),
        },
        enemies: {},
      },
      units: [
        { chessId: CASTER, row: 10, col: 5, items: [SHIELD] },
        { chessId: ALLY, row: 10, col: 4 },
        { chessId: OTHER, row: 10, col: 6 },
      ],
      modeId: 'mode_recon_abyss', timeLimit: 90, autoFinish: false,
    });
    h.runUntil(() => h.hooksOf('skillStart').length >= 1, 5);
    const caster = h.unit(CASTER), ally = h.unit(ALLY), other = h.unit(OTHER);
    assert.ok(caster && ally && other, '三名干员都在场上');
    const lent = itemGrants(h.b, ally).filter((g) => g.lent && g.id === SHIELD);
    assert.equal(lent.length, 1, '相邻的【萨尔贡】干员借到了那件装备');
    assert.ok(lent[0].until > 0, '带的是一段时限（60 s）');
    assert.equal(itemGrants(h.b, other).filter((g) => g.lent).length, 0, '非【萨尔贡】的相邻干员借不到');
    assert.equal(itemGrants(h.b, caster).filter((g) => g.lent).length, 0, '携带者自己不会被「共享」一遍');
    h.run(62);
    assert.equal(itemGrants(h.b, ally).filter((g) => g.lent).length, 0, '60 s 后收回');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('森蚺·重构：【萨尔贡】每开启 1 次技能，已激活的【萨尔贡】【坚守】+6 层', async () => {
  await loadPack();
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
  const ZUMAMA = 'recon_chess_ws_recon_zumama_a';
  const CASTER = 'ws_sargon_caster_a';
  const bonds = { [SARGON]: { count: 3, active: true, tier: 1, layers: 0 }, [STEAD]: { count: 2, active: true, tier: 1, layers: 0 } };
  try {
    const h = makeBattle({
      defs: {
        chess: { [ZUMAMA]: rec(ZUMAMA, { garrison: 'recon_garrison_zumama_a' }), [CASTER]: rec(CASTER, { skill: ONE_CAST }) },
        enemies: {},
      },
      units: [{ chessId: ZUMAMA, row: 10, col: 5 }, { chessId: CASTER, row: 10, col: 4 }],
      bonds, modeId: 'mode_recon_abyss', timeLimit: 4, autoFinish: false,
    });
    h.runUntil(() => h.hooksOf('skillStart').length >= 1, 5);
    const ps = h.b.getPlayer('p1');
    assert.equal(ps.bonds[SARGON].layers, 6, '【萨尔贡】+6 层');
    assert.equal(ps.bonds[STEAD].layers, 6, '【坚守】+6 层');
    h.runToEnd(10);
    assert.equal(h.invariants(), true);
    const marks = h.b._perPlayer.p1.marks || {};
    assert.equal(marks.reconSargonCasts, 1, '本场开启次数交给休整期');
  } finally {
    setGameData(null);
  }
});

test('森蚺·重构：森蚺不在场上时，技能开启不加层', async () => {
  await loadPack();
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
  const CASTER = 'ws_sargon_caster_a';
  const bonds = { [SARGON]: { count: 3, active: true, tier: 1, layers: 0 }, [STEAD]: { count: 2, active: true, tier: 1, layers: 0 } };
  try {
    const h = makeBattle({
      defs: { chess: { [CASTER]: rec(CASTER, { skill: ONE_CAST }) }, enemies: {} },
      units: [{ chessId: CASTER, row: 10, col: 4 }],
      bonds, modeId: 'mode_recon_abyss', timeLimit: 4, autoFinish: false,
    });
    h.run(3);
    const ps = h.b.getPlayer('p1');
    assert.equal(ps.bonds[SARGON].layers, 0, '没有森蚺 ⇒ 不加层');
    assert.equal(ps.bonds[STEAD].layers, 0);
  } finally {
    setGameData(null);
  }
});

test('狮蝎·重构：战斗开始给自身与相邻干员隐匿；被敌人攻击后解除；结束时交持有数', async () => {
  await loadPack();
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
  const MANTIC = 'recon_chess_ws_recon_mantic_a';
  const NEAR = 'ws_stealth_near_a';
  const FAR = 'ws_stealth_far_a';
  try {
    const h = makeBattle({
      defs: {
        chess: {
          [MANTIC]: rec(MANTIC, { garrison: 'recon_garrison_mantic_a', bonds: [SARGON, 'soloShip'] }),
          [NEAR]: rec(NEAR, { bonds: [] }),
          [FAR]: rec(FAR, { bonds: [] }),
        },
        enemies: { e_hit: enemyRec({ key: 'e_hit', hp: 1e7, atk: 200, speed: 1 }) },
      },
      units: [
        { chessId: MANTIC, row: 9, col: 6 },
        { chessId: NEAR, row: 9, col: 5 },
        { chessId: FAR, row: 12, col: 5 },
      ],
      enemies: [{ key: 'e_hit', time: 0 }],
      modeId: 'mode_recon_abyss', timeLimit: 12, autoFinish: false,
    });
    h.run(0.5);
    const mantic = h.unit(MANTIC), near = h.unit(NEAR), far = h.unit(FAR);
    assert.equal(!!(mantic.s.flags && mantic.s.flags.stealth), true, '狮蝎自己隐匿');
    assert.equal(!!(near.s.flags && near.s.flags.stealth), true, '相邻干员隐匿');
    assert.equal(!!(far.s.flags && far.s.flags.stealth), false, '不相邻的干员没有');
    h.runUntil(() => !(mantic.s.flags && mantic.s.flags.stealth) || h.b.time > 10, 12);
    assert.equal(!!(mantic.s.flags && mantic.s.flags.stealth), false, '被敌人攻击后解除');
    assert.equal(!!(near.s.flags && near.s.flags.stealth), true, '没被攻击的那名还在隐匿');
    h.runToEnd(20);
    const marks = h.b._perPlayer.p1.marks || {};
    assert.ok(marks.reconStealthHolders >= 1, '战斗结束交给休整期「持有隐匿的干员数」');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('休整期：森蚺 ≥20 次给黄沙罗盘（精锐 2 件），狮蝎按隐匿持有数给盟约之币（最多 2 / 4 件）', async () => {
  const mod = await import(pathToFileURL(path.join(PACK, 'meta/main.mjs')).href);
  let handler = null;
  mod.registerMeta({ global(name, h) { if (name === 'recon') handler = h; }, garrison() {}, item() {} });
  assert.equal(typeof handler.onRoundStart, 'function');

  const run = (gid, marks) => {
    const granted = [];
    const ctx = {
      gd: { isRecon: true, garrison: (id) => GARRISONS[id] },
      board: () => [{ kind: 'chess', uid: 1, id: 'x_a', area: 'board' }],
      hand: () => [],
      garrisonsOf: () => [{ garrisonId: gid }],
      mark: (k) => (Object.prototype.hasOwnProperty.call(marks, k) ? marks[k] : null),
      grantItem: (id, opts) => granted.push({ id, opts }),
      // onRoundStart 的其余三条规则（预重构选择 / 装备负载 / 重构决策）：这一局都没交，空转即可
      recon: () => null,
      addEffect() {},
      removeEffect() {},
      bonds: () => ({}),
      bondActive: () => false,
      layers: () => 0,
      counter: () => 0,
      setCounter: () => 0,
      incCounter: () => 0,
      shopLevel: () => 1,
    };
    handler.onRoundStart(ctx);
    return granted.map((g) => g.id);
  };

  const COMPASS = 'chess_item_6_07_e_a';
  const COIN = 'chess_item_1_03_e_a';
  assert.deepEqual(run('recon_garrison_zumama_a', { reconSargonCasts: 20 }), [COMPASS], '普通：1 件');
  assert.deepEqual(run('recon_garrison_zumama_b', { reconSargonCasts: 20 }), [COMPASS, COMPASS], '精锐：2 件');
  assert.deepEqual(run('recon_garrison_zumama_a', { reconSargonCasts: 19 }), [], '不到 20 次：没有');
  assert.deepEqual(run('recon_garrison_mantic_a', { reconStealthHolders: 3 }), [COIN, COIN], '普通：最多 2 件');
  assert.deepEqual(run('recon_garrison_mantic_b', { reconStealthHolders: 3 }), [COIN, COIN, COIN], '精锐：按持有数 3 件');
  assert.deepEqual(run('recon_garrison_mantic_b', { reconStealthHolders: 9 }), [COIN, COIN, COIN, COIN], '精锐：最多 4 件');
  assert.deepEqual(run('recon_garrison_mantic_a', {}), [], '没有标记：没有');
});
