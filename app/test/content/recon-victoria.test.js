// test/content/recon-victoria.test.js — 维多利亚三名新干员（业主 2026-10-30）在重构模拟里的特质：
//   澄闪 `RECON_GDGLOW_DRONES`  已激活的【维多利亚】每 200 / 100 层 → 技能开启时浮游单元 +1
//   死芒 `RECON_NECRAS_FIELD`   自身与召唤物伤害 +【维多利亚】层数 ×0.5% / 1%；攻击范围 = 场上【维多利亚】干员范围的并集
//   傀影 `RECON_PHATOM_DEPLOY`  <部署时>自身已激活盟约 +4 / +8 层（最多 5 次）；本场部署 ≥3 次 → 休整期维式重锤
// 另有休整期那一半（`meta/main.mjs` 的 victoriaPrepRewards）：维式重锤的发放。
//
// 三名干员的技能本体来自官方自选 kit（棋子记录的 `kitRef` = 官方 charId），测试走同一条装载路径：
// 白名单说明符 → `data:` 模块。
//
// 跑法：node --test test/content/recon-victoria.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';
import { setGameData, gameData } from '../../server/sim/content/support/index.js';
import { COLS } from '../../server/sim/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = path.join(ROOT, 'workshop/mode-recon');
const GARRISONS = JSON.parse(fs.readFileSync(path.join(PACK, 'garrisons.json'), 'utf8'));
const VICTORIA = 'victoriaShip';
const RAID = 'raidShip';

/** 只开一次：SP 拉满后 `SP_FULL` 立刻开（不依赖攻击/射程内有敌人），之后按技力自然回复在测试时长内不会再满。 */
const ONE_CAST = { spCost: 100, initSp: 100, duration: 10, spType: 'INCREASE_WITH_TIME', trigger: { rule: 'SP_FULL' } };

let packLoad = null;
/** 与 `server/battlePack.js` 同一条装载路径（改白名单说明符 → data: 模块；模块顶层完成注册）。 */
function loadPack() {
  packLoad ??= (async () => {
    const src = fs.readFileSync(path.join(PACK, 'battle/main.mjs'), 'utf8');
    const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
    await import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  })();
  return packLoad;
}

/** 一名干员的记录（garrisonIds 决定它挂哪条特质；`kitRef` 借官方自选 kit）。 */
function rec(id, { bonds = [VICTORIA], garrison = null, skill = null, kitRef = null, rangeGrid = [[0, 0], [0, 1]], stats = null } = {}) {
  const r = chessRec({
    id, bonds, rangeGrid, skill,
    stats: { atk: 100, maxHp: 5000, def: 0, res: 0, bat: 1, blockCnt: 1, ...(stats || {}) },
  });
  if (garrison) r.garrisonIds = [garrison];
  if (kitRef) r.kitRef = kitRef;
  return r;
}

const withPackGarrisons = () => {
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
};

after(() => setGameData(null));

test('澄闪·重构：已激活的【维多利亚】每 200 层（精锐 100），技能开启时浮游单元 +1', async () => {
  await loadPack();
  withPackGarrisons();
  const GDGLOW = 'recon_chess_ws_recon_gdglow_a';
  const GDGLOW_E = 'recon_chess_ws_recon_gdglow_b';
  const layersOf = (n) => ({ [VICTORIA]: { count: 3, active: true, tier: 1, layers: n } });
  const build = (id, gid, layers) => makeBattle({
    defs: {
      chess: {
        [id]: rec(id, {
          garrison: gid, kitRef: 'char_377_gdglow',
          skill: { ...ONE_CAST, skillId: 'skchr_gdglow_3', bb: {} },
        }),
      },
      enemies: {},
    },
    units: [{ chessId: id, row: 11, col: 5 }],
    bonds: layersOf(layers), modeId: 'mode_recon_abyss', timeLimit: 6, autoFinish: false,
  });
  try {
    {
      const h = build(GDGLOW, 'recon_garrison_gdglow_a', 400);
      h.runUntil(() => h.hooksOf('skillStart').length >= 1, 3);
      const u = h.unit(GDGLOW);
      assert.ok(u && u.mem.gdDrones, '技能开启后浮游单元数组已建好');
      assert.equal(u.mem.gdDrones.length, 3, '普通：400 层 = 每 200 层 +1，共 2 个额外单元（基础 1）');
      assert.equal(h.invariants(), true);
    }
    {
      const h = build(GDGLOW_E, 'recon_garrison_gdglow_b', 400);
      h.runUntil(() => h.hooksOf('skillStart').length >= 1, 3);
      const u = h.unit(GDGLOW_E);
      assert.equal(u.mem.gdDrones.length, 5, '精锐：400 层 = 每 100 层 +1，共 4 个额外单元（基础 1）');
      assert.equal(h.invariants(), true);
    }
    {
      const h = build(GDGLOW, 'recon_garrison_gdglow_a', 150);
      h.runUntil(() => h.hooksOf('skillStart').length >= 1, 3);
      assert.equal(h.unit(GDGLOW).mem.gdDrones.length, 1, '不到 200 层：不加');
      assert.equal(h.invariants(), true);
    }
    {
      // 盟约没激活：层数再多也不加
      const h = makeBattle({
        defs: {
          chess: { [GDGLOW]: rec(GDGLOW, { garrison: 'recon_garrison_gdglow_a', kitRef: 'char_377_gdglow', skill: { ...ONE_CAST, skillId: 'skchr_gdglow_3', bb: {} } }) },
          enemies: {},
        },
        units: [{ chessId: GDGLOW, row: 11, col: 5 }],
        bonds: { [VICTORIA]: { count: 3, active: false, tier: 1, layers: 400 } },
        modeId: 'mode_recon_abyss', timeLimit: 6, autoFinish: false,
      });
      h.runUntil(() => h.hooksOf('skillStart').length >= 1, 3);
      assert.equal(h.unit(GDGLOW).mem.gdDrones.length, 1, '盟约未激活：不加');
      assert.equal(h.invariants(), true);
    }
  } finally {
    setGameData(null);
  }
});

test('死芒·重构：自身与召唤物伤害 +【维多利亚】层数×0.5%（精锐×1%）', async () => {
  await loadPack();
  withPackGarrisons();
  const NECRAS = 'recon_chess_ws_recon_necras_a';
  const NECRAS_E = 'recon_chess_ws_recon_necras_b';
  const TOKEN = 'recon_test_token';
  const tokenDef = {
    kind: 'summon', name: '仆役', position: 'MELEE', rangeGrid: [[0, 0]], deployLimit: 1, count: 1,
    stats: { maxHp: 100, atk: 10, def: 0, res: 0, bat: 1, blockCnt: 1, aspd: 100, respawnTime: 10, moveSpeed: 1, tauntLevel: 0, massLevel: 0, deployLimit: 1, deckStack: 0 },
  };
  const run = (id, gid, layers) => {
    const h = makeBattle({
      defs: {
        chess: { [id]: rec(id, { garrison: gid, kitRef: 'char_450_necras' }) },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0 }) },
        tokens: { [TOKEN]: tokenDef },
      },
      units: [{ chessId: id, row: 11, col: 6 }],
      enemies: [{ key: 'e_dummy', time: 0 }],
      bonds: { [VICTORIA]: { count: 3, active: true, tier: 1, layers } },
      modeId: 'mode_recon_abyss', timeLimit: 6, autoFinish: false,
    });
    h.run(0.5);
    const u = h.unit(id);
    const e = h.enemies()[0];
    const hp0 = e.hp;
    h.b.dealDamage(u, e, { amount: 1000, type: 'true' });
    const self = hp0 - e.hp;
    const hp1 = e.hp;
    const tok = h.b.spawnToken(u, TOKEN, 11, 5, { def: tokenDef });
    assert.ok(tok, '召唤物生成');
    h.b.dealDamage(tok, e, { amount: 1000, type: 'true' });
    return { self, token: hp1 - e.hp, h };
  };
  try {
    const a = run(NECRAS, 'recon_garrison_necras_a', 200);
    assert.ok(Math.abs(a.self - 2000) < 1e-6, '普通：200 层 ×0.5% ⇒ ×2.0');
    assert.ok(Math.abs(a.token - 2000) < 1e-6, '召唤物同样享受');
    assert.equal(a.h.invariants(), true);
    const b = run(NECRAS_E, 'recon_garrison_necras_b', 200);
    assert.ok(Math.abs(b.self - 3000) < 1e-6, '精锐：200 层 ×1% ⇒ ×3.0');
    const c = run(NECRAS, 'recon_garrison_necras_a', 0);
    assert.ok(Math.abs(c.self - 1000) < 1e-6, '没有层数 ⇒ 不放大');
  } finally {
    setGameData(null);
  }
});

test('死芒·重构：普通攻击与技能攻击范围 = 场上【维多利亚】干员攻击范围的总和', async () => {
  await loadPack();
  withPackGarrisons();
  const NECRAS = 'recon_chess_ws_recon_necras_a';
  const OTHER = 'ws_victoria_ally_a';
  const NON = 'ws_non_victoria_a';
  try {
    const h = makeBattle({
      defs: {
        chess: {
          [NECRAS]: rec(NECRAS, { garrison: 'recon_garrison_necras_a', rangeGrid: [[0, 0]] }),
          // 场上的另一名【维多利亚】干员：射程 0-3
          [OTHER]: rec(OTHER, { rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] }),
          [NON]: rec(NON, { bonds: [], rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] }),
        },
        enemies: {},
      },
      units: [
        { chessId: NECRAS, row: 11, col: 5 },
        { chessId: OTHER, row: 11, col: 8 },
        { chessId: NON, row: 9, col: 8 },
      ],
      bonds: { [VICTORIA]: { count: 3, active: true, tier: 1, layers: 0 } },
      modeId: 'mode_recon_abyss', timeLimit: 6, autoFinish: false,
    });
    h.run(0.8);
    const u = h.unit(NECRAS);
    const other = h.unit(OTHER);
    assert.ok(other, '另一名维多利亚在场');
    // 并集：另一名干员的 0-3 射程（(11,8)…(11,11)）都在死芒的范围里
    for (const c of [8, 9, 10, 11]) assert.ok(u.rangeKeySet.has(11 * COLS + c), `范围并集包含 (11,${c})`);
    // 非【维多利亚】干员的射程不在并集里：他在 (9,8)…(9,11)
    assert.equal(u.rangeKeySet.has(9 * COLS + 11), false, '非维多利亚干员的射程不进并集');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('傀影·重构：每次部署给自身已激活的盟约 +4（精锐 +8）层，最多 5 次；部署次数交给休整期', async () => {
  await loadPack();
  withPackGarrisons();
  const PHATOM = 'recon_chess_ws_recon_phatom_a';
  const PHATOM_E = 'recon_chess_ws_recon_phatom_b';
  const bonds = () => ({
    [VICTORIA]: { count: 3, active: true, tier: 1, layers: 0 },
    [RAID]: { count: 2, active: true, tier: 1, layers: 0 },
  });
  const build = (id, gid) => makeBattle({
    defs: { chess: { [id]: rec(id, { garrison: gid, bonds: [VICTORIA, RAID] }) }, enemies: {} },
    units: [{ chessId: id, row: 11, col: 5 }],
    bonds: bonds(), modeId: 'mode_recon_abyss', timeLimit: 6, autoFinish: false,
  });
  try {
    const h = build(PHATOM, 'recon_garrison_phatom_a');
    const ps = h.b.getPlayer('p1');
    h.run(0.1);
    assert.equal(ps.bonds[VICTORIA].layers, 4, '首次部署：【维多利亚】+4 层');
    assert.equal(ps.bonds[RAID].layers, 4, '【突袭】+4 层');
    const u = h.unit(PHATOM);
    for (let i = 0; i < 2; i++) { h.b.retreat(u, { reason: 'retreat' }); h.b.redeploy(u, { free: true }); h.run(0.1); }
    assert.equal(ps.bonds[VICTORIA].layers, 12, '第 3 次部署：共 12 层');
    h.runToEnd(8);
    assert.equal(h.invariants(), true);
    const marks = h.b._perPlayer.p1.marks || {};
    assert.equal(marks.reconPhantomDeploys, 3, '本场部署次数交给休整期');
  } finally {
    setGameData(null);
  }
  try {
    const h = build(PHATOM_E, 'recon_garrison_phatom_b');
    const ps = h.b.getPlayer('p1');
    h.run(0.1);
    assert.equal(ps.bonds[VICTORIA].layers, 8, '精锐：首次部署 +8 层');
    const u = h.unit(PHATOM_E);
    for (let i = 0; i < 5; i++) { h.b.retreat(u, { reason: 'retreat' }); h.b.redeploy(u, { free: true }); h.run(0.1); }
    assert.equal(ps.bonds[VICTORIA].layers, 40, '最多 5 次：8 × 5');
    h.runToEnd(8);
    assert.equal((h.b._perPlayer.p1.marks || {}).reconPhantomDeploys, 5, '标记封顶在 5 次');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('休整期：傀影本场部署 ≥3 次给维式重锤（精锐按 bb.count）', async () => {
  const mod = await import(pathToFileURL(path.join(PACK, 'meta/main.mjs')).href);
  let handler = null;
  mod.registerMeta({ global(name, h) { if (name === 'recon') handler = h; }, garrison() {}, item() {} });
  const run = (gid, marks) => {
    const granted = [];
    const ctx = {
      gd: { isRecon: true, garrison: (id) => GARRISONS[id] },
      board: () => [{ kind: 'chess', uid: 1, id: 'x_a', area: 'board' }],
      hand: () => [],
      garrisonsOf: () => [{ garrisonId: gid }],
      mark: (k) => (Object.prototype.hasOwnProperty.call(marks, k) ? marks[k] : null),
      grantItem: (id, opts) => granted.push({ id, opts }),
      rng: { pick: (arr) => arr[0] },
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
  const HAMMER = 'chess_item_2_03_e_a'; // VICT_WEAPONS[0]（stub rng 取第一件）
  assert.deepEqual(run('recon_garrison_phatom_a', { reconPhantomDeploys: 3 }), [HAMMER], '普通：1 件');
  assert.deepEqual(run('recon_garrison_phatom_b', { reconPhantomDeploys: 3 }), [HAMMER, HAMMER], '精锐：2 件');
  assert.deepEqual(run('recon_garrison_phatom_a', { reconPhantomDeploys: 2 }), [], '不到 3 次：没有');
  assert.deepEqual(run('recon_garrison_phatom_a', {}), [], '没有标记：没有');
});
