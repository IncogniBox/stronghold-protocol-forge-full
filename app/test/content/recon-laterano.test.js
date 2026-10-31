// test/content/recon-laterano.test.js — 拉特兰两名新增干员与两名重构（业主 2026-10-30）在重构模拟里的行为：
//   菲亚梅塔 `RECON_PHENXI_AMMO`  【拉特兰】干员本场弹药消耗总数 → 休整期的拉特兰桥夹（`lateranoPrepRewards` 读标记）
//   空构     `RECON_KONGGOU_LAYERS` <休整期结束时>身后一名【拉特兰】干员已激活的盟约 +2 / +4（meta 侧 `onPrepEnd`）
//   蕾缪安   `RECON_LEMUEN_FIELD`  技能开启期间射程内敌人速度 -90%、自身受到伤害按【拉特兰】层数 ×2% / ×4% 降低
//   塑心 → 5 阶、蕾缪安 → 7 阶（数据侧，`test/match/recon-chess.test.js` 断言）。
//
// 跑法：node --test test/content/recon-laterano.test.js
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
const LATERANO = 'lateranoShip';

let packLoad = null;
/** 与 `server/battlePack.js` 同一条装载路径（改白名单说明符 → data: 模块；模块顶层完成注册）。 */
function loadPack() {
  packLoad ??= (async () => {
    const src = fs.readFileSync(path.join(PACK, 'battle/main.mjs'), 'utf8');
    const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
    return import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  })();
  return packLoad;
}

function rec(id, { bonds = [LATERANO], garrison = null, skill = undefined, rangeGrid = [[0, 0], [0, 1]] } = {}) {
  const r = chessRec({
    id, bonds, rangeGrid,
    ...(skill === undefined ? {} : { skill }),
    stats: { atk: 100, maxHp: 5000, def: 500, res: 0, bat: 1, blockCnt: 1, spRecovery: 0 },
  });
  if (garrison) r.garrisonIds = [garrison];
  return r;
}

const withPackGarrisons = () => {
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
};

const SP_ONLY = { skillId: 'sk_test', spCost: 100, initSp: 0, duration: 10, spType: 'INCREASE_WITH_TIME', trigger: { rule: 'DEFAULT' } };
const CAST = { skillId: 'sk_test', skillType: 'MANUAL', durationType: 'NONE', duration: 15, spCost: 100, initSp: 0, spType: 'INCREASE_WITH_TIME', trigger: { rule: 'SP_FULL' } };

after(() => setGameData(null));

test('菲亚梅塔·重构：本场【拉特兰】弹药消耗 ≥200（精锐 100）⇒ 休整期发拉特兰桥夹', async () => {
  await loadPack();
  withPackGarrisons();
  const PHENXI = 'recon_chess_ws_recon_phenxi_a';
  const MARK = 'reconLateranoAmmo';
  try {
    const h = makeBattle({
      defs: { chess: { [PHENXI]: rec(PHENXI, { garrison: 'recon_garrison_phenxi_ammo_a', skill: SP_ONLY }) }, enemies: {} },
      units: [{ chessId: PHENXI, row: 10, col: 6 }],
      bonds: { [LATERANO]: { count: 3, active: true, tier: 1, layers: 0 } },
      modeId: 'mode_recon_abyss', timeLimit: 1, autoFinish: false,
    });
    h.run(0.2);
    const u = h.unit(PHENXI);
    for (let i = 0; i < 200; i++) h.b.emit('ammoUsed', { unit: u });
    h.runToEnd(5);
    assert.equal(h.b._perPlayer.p1.marks?.[MARK], 200, '每发弹药计数一次');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
  // meta：读数 ≥ 特质记录的 bb.ammo 才发件
  const mod = await import(pathToFileURL(path.join(PACK, 'meta/main.mjs')).href);
  let handler = null;
  mod.registerMeta({ global(name, h) { if (name === 'recon') handler = h; }, garrison() {}, item() {} });
  const run = (gid, ammo) => {
    const granted = [];
    const ctx = {
      gd: { isRecon: true, garrison: (id) => GARRISONS[id] },
      board: () => [{ kind: 'chess', uid: 1, id: 'x_a', area: 'board' }],
      hand: () => [],
      garrisonsOf: () => [{ garrisonId: gid }],
      mark: (k) => (k === MARK ? ammo : null),
      grantItem: (id, opts) => granted.push({ id, opts }),
      rng: { pick: (arr) => arr[0] },
      recon: () => null,
      addEffect() {},
      removeEffect() {},
      bonds: () => ({}),
      bondActive: () => true,
      layers: () => 0,
      counter: () => 0,
      setCounter: () => 0,
      incCounter: () => 0,
      shopLevel: () => 1,
    };
    handler.onRoundStart(ctx);
    return granted.map((g) => g.id);
  };
  const BRIDGE = 'chess_item_4_08_e_a';
  assert.deepEqual(run('recon_garrison_phenxi_ammo_a', 200), [BRIDGE], '普通：200 发正好发 1 件');
  assert.deepEqual(run('recon_garrison_phenxi_ammo_a', 199), [], '不够 200 发不发');
  assert.deepEqual(run('recon_garrison_phenxi_ammo_b', 100), [BRIDGE], '精锐：100 发即可');
  assert.deepEqual(run('recon_garrison_konggou_a', 999), [], '别的特质不发桥夹');
});

test('空构·重构：<休整期结束时>身后一名【拉特兰】干员的已激活盟约 +2（精锐 +4）', async () => {
  const mod = await import(pathToFileURL(path.join(PACK, 'meta/main.mjs')).href);
  let handler = null;
  mod.registerMeta({ global(name, h) { if (name === 'recon') handler = h; }, garrison() {}, item() {} });
  const run = (gid, { targetBonds = [LATERANO, 'preciShip'], dir = 'RIGHT' } = {}) => {
    const added = [];
    const kongs = { kind: 'chess', uid: 1, id: 'k_a', row: 10, col: 6, dir, area: 'board' };
    const target = { kind: 'chess', uid: 2, id: 't_a', row: 10, col: 5, area: 'board' };
    const ctx = {
      gd: { isRecon: true, garrison: (id) => GARRISONS[id] },
      board: () => [kongs, target],
      hand: () => [],
      garrisonsOf: (uid) => (uid === 1 ? [{ garrisonId: gid }] : []),
      pieceAt: (row, col) => (row === target.row && col === target.col ? target : null),
      pieceBonds: () => targetBonds,
      addLayers: (b, n) => added.push([b, n]),
      bondActive: (b) => b === LATERANO || b === 'preciShip',
      mark: () => null,
      grantItem() {},
      rng: { pick: (arr) => arr[0] },
      recon: () => null,
      addEffect() {},
      removeEffect() {},
      bonds: () => ({}),
      layers: () => 0,
      counter: () => 0,
      setCounter: () => 0,
      incCounter: () => 0,
      shopLevel: () => 1,
    };
    handler.onPrepEnd(ctx);
    return added;
  };
  assert.deepEqual(run('recon_garrison_konggou_a'), [[LATERANO, 2], ['preciShip', 2]], '普通：两条已激活盟约各 +2');
  assert.deepEqual(run('recon_garrison_konggou_b'), [[LATERANO, 4], ['preciShip', 4]], '精锐：各 +4');
  assert.deepEqual(run('recon_garrison_konggou_a', { targetBonds: ['preciShip'] }), [], '身后不是【拉特兰】⇒ 不加');
  assert.deepEqual(run('recon_garrison_konggou_a', { dir: 'LEFT' }), [], '朝向反过来 ⇒ 身后没人');
  assert.deepEqual(run('recon_garrison_phenxi_ammo_a'), [], '别的特质不触发');
});

test('蕾缪安·重构：技能开启期间射程内敌人速度 -90%，自身受到伤害降低【拉特兰】层数×2%', async () => {
  await loadPack();
  withPackGarrisons();
  const LEMUEN = 'recon_chess_char_6_01_a';
  const KEY = (uid) => `recon:lemuen:slow:${uid}`;
  try {
    const h = makeBattle({
      defs: {
        chess: { [LEMUEN]: rec(LEMUEN, { garrison: 'recon_garrison_lemuen_a', skill: CAST, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]] }) },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0.5, range: 0 }) },
      },
      units: [{ chessId: LEMUEN, row: 10, col: 6 }],
      enemies: [],
      bonds: { [LATERANO]: { count: 3, active: true, tier: 1, layers: 10 } },
      modeId: 'mode_recon_abyss', timeLimit: 10, autoFinish: false,
    });
    h.run(0.2);
    const u = h.unit(LEMUEN);
    const e = h.spawn('e_dummy', { pos: [10, 8] });
    // 技能没开：没有减速，也没有减伤
    const hp0 = u.hp;
    h.b.dealDamage(e, u, { amount: 1000, type: 'true', canDodge: false });
    const plain = hp0 - u.hp;
    assert.equal(plain, 1000, '技能未开启 ⇒ 全额');
    u.skill.gainSp(200, 'test');
    h.run(0.3);
    assert.equal(u.skill.active, true, 'S 持续中');
    const slow = e.findBuff(KEY(u.id));
    assert.ok(slow, '射程内敌人挂上减速');
    assert.ok(Math.abs(slow.mods.moveMul - 0.1) < 1e-9, '速度 -90% ⇒ moveMul 0.1');
    const hp1 = u.hp;
    h.b.dealDamage(e, u, { amount: 1000, type: 'true', canDodge: false });
    const cut = hp1 - u.hp;
    assert.ok(Math.abs(cut - 1000 * (1 - 10 * 0.02)) < 1e-6, `10 层 ×2% ⇒ 只吃 ${cut}`);
    h.runToEnd(10);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
  try {
    const h = makeBattle({
      defs: {
        chess: { [LEMUEN]: rec(LEMUEN, { garrison: 'recon_garrison_lemuen_b', skill: CAST, rangeGrid: [[0, 0], [0, 1]] }) },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0.5 }) },
      },
      units: [{ chessId: LEMUEN, row: 10, col: 6 }],
      enemies: [],
      bonds: { [LATERANO]: { count: 3, active: true, tier: 1, layers: 25 } },
      modeId: 'mode_recon_abyss', timeLimit: 10, autoFinish: false,
    });
    h.run(0.2);
    const u = h.unit(LEMUEN);
    const e = h.spawn('e_dummy', { pos: [10, 7] });
    u.skill.gainSp(200, 'test');
    h.run(0.3);
    const hp1 = u.hp;
    h.b.dealDamage(e, u, { amount: 1000, type: 'true', canDodge: false });
    const cut = hp1 - u.hp;
    assert.ok(Math.abs(cut - 1000 * (1 - 25 * 0.04)) < 1e-6, `精锐：25 层 ×4% ⇒ 只吃 ${cut}`);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});
