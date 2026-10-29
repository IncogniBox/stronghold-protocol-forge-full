// test/match/recon-bonds.test.js — 重构模拟的八条核心盟约（`bb.recon` 变体）在真 sim 上的冒烟 + 关键断言。
//
// 数据：`workshop/mode-recon/bonds.json` 里是 `recon_<id>` 记录；Match 只在重构对局里把它们别名到官方 id。
// 这里用 `setGameData` 手工造同一份「别名后的数据」，于是 `bondBb` 读到 `bb.recon`，引擎走重构分支。
//
// 跑法：node --test test/match/recon-bonds.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { setGameData, bondRecord } from '../../server/sim/content/support/index.js';
import { DATA } from './harness.js';
import { TOKEN_IDS } from '../../server/sim/content/tokens.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';

const RECON_IDS = ['yanShip', 'sargonShip', 'victoriaShip', 'kjeragShip', 'lateranoShip', 'egirShip', 'siracusaShip', 'kazimierzShip'];
const aliased = { ...DATA, bonds: { ...DATA.bonds } };
for (const id of RECON_IDS) if (DATA.bonds[`recon_${id}`]) aliased.bonds[id] = DATA.bonds[`recon_${id}`];
setGameData(aliased);
after(() => setGameData(DATA));

const bondOn = (count, layers = 0) => ({ count, active: true, tier: [3, 6, 9].filter((t) => count >= t).length, layers });const op = (id, bonds, stats = {}) => chessRec({ id, bonds, profession: 'WARRIOR', rangeGrid: [[0, 0], [0, 1]], skill: null, stats: { atk: 1000, maxHp: 5000, def: 0, res: 0, bat: 1, blockCnt: 1, ...stats } });
const lineup = (ids, { row = 10, col = 3, items: it = {} } = {}) => ids.map((chessId, i) => ({ chessId, row: row + Math.floor(i / 7), col: col + (i % 7), items: it[i] }));
const dummy = enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0, def: 0, res: 0 });
const defsOf = (list) => {
  const chess = {};
  for (const [id, bonds] of list) chess[id] = op(id, bonds);
  return { chess, enemies: { e_dummy: dummy } };
};

test('炎·重构：3 名即召唤 1 只炎佑（2 目标 / 20% 灼燃 / 20% 元素脆弱）', () => {
  const ids = ['y1_a', 'y2_a', 'y3_a'];
  const h = makeBattle({ defs: defsOf(ids.map((id) => [id, ['yanShip']])), units: lineup(ids), bonds: { yanShip: bondOn(3) }, autoFinish: false, timeLimit: 30 });
  h.runUntil(() => h.allies().length >= 3, 10);
  const you = h.b.allyUnits.filter((u) => u.defId === TOKEN_IDS.yanyou);
  assert.equal(you.length, 1, '3 名就有炎佑');
  assert.equal(you[0].profile.maxTargets, 2, '2 个目标');
  assert.equal(you[0].mem.yanyouRecon.burn, 0.2);
  assert.equal(you[0].mem.yanyouRecon.frag, 0.2);
  h.step(30);
  assert.equal(h.invariants(), true);
});

test('萨尔贡·重构：开技能给全队 +15 攻速；6 名自身层数无限；9 名相邻 +25% 技力', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `s${i}_a`);
  const skills = { skillType: 'AUTO', spCost: 10, initSp: 0, duration: 1 };
  const chess = {};
  for (const id of ids) chess[id] = chessRec({ id, bonds: ['sargonShip'], profession: 'WARRIOR', rangeGrid: [[0, 0], [0, 1]], skill: skills, stats: { atk: 100, maxHp: 5000, def: 0, res: 0, bat: 1, blockCnt: 1 } });
  const h = makeBattle({ defs: { chess, enemies: { e_dummy: dummy } }, units: lineup(ids), bonds: { sargonShip: bondOn(9, 0) }, autoFinish: false, timeLimit: 20 });
  h.runUntil(() => h.allies().length >= 9, 10);
  const u = h.unit('s0_a');
  const adj = h.unit('s1_a');
  const before = adj.skill.sp;
  h.b.emit('skillStart', { unit: u });
  assert.ok(adj.skill.sp > before, '相邻【萨尔贡】拿到了技力');
  assert.ok(h.allies().every((a) => a.buffs.some((b) => b.key === 'bond:sargon')), '全队都挂上了攻速层');
  h.step(5);
  assert.equal(h.invariants(), true);
});

test('维多利亚·重构：3 名带装备的成员伤害 ×1.25；6 名的装备位 +1 由 Match 侧另测', () => {
  const ids = ['v1_a', 'v2_a', 'v3_a'];
  const h = makeBattle({ defs: defsOf(ids.map((id) => [id, ['victoriaShip']])), units: lineup(ids, { items: { 0: ['chess_item_1_01_e_a'] } }), bonds: { victoriaShip: bondOn(3) }, autoFinish: false, timeLimit: 10 });
  h.runUntil(() => h.allies().length >= 3, 10);
  const buff = h.unit('v1_a').buffs.find((b) => b.key === 'bond:victoria');
  assert.ok(buff, '带装备的成员有伤害 buff');
  assert.equal(buff.mods.dmgDealtMul, 1.25);
  h.step(2);
  assert.equal(h.invariants(), true);
});

test('谢拉格·重构：6 名让寒冷 / 冻结的敌人吃 15% 物理与法术脆弱', () => {
  const ids = Array.from({ length: 6 }, (_, i) => `k${i}_a`);
  const h = makeBattle({ defs: defsOf(ids.map((id) => [id, ['kjeragShip']])), units: lineup(ids), bonds: { kjeragShip: bondOn(6) }, autoFinish: false, timeLimit: 30 });
  h.runUntil(() => h.allies().length >= 6, 10);
  const e = h.spawn('e_dummy', { pos: { row: 10, col: 9 }, routeIndex: 0, mods: { speedMul: 0 } });
  h.b.applyStatus(e, 'cold', { duration: 10 });
  h.run(1.2);
  assert.ok(e.buffs.some((b) => b.status === 'physFragile'), '物理脆弱');
  assert.ok(e.buffs.some((b) => b.status === 'artsFragile'), '法术脆弱');
  assert.equal(h.invariants(), true);
});

test('谢拉格·重构：9 名攻击寒冷 / 冻结的敌人 ⇒ 自身攻速 +2（可叠 50 层，5 秒刷新）', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `k9_${i}_a`);
  const chess = {};
  for (const id of ids) chess[id] = chessRec({ id, bonds: ['kjeragShip'], profession: 'WARRIOR', rangeGrid: [[0, 0], [0, 1], [0, -1]], skill: null, stats: { atk: 1000, maxHp: 5000, def: 0, res: 0, bat: 1, blockCnt: 1 } });
  const units = ids.map((chessId, i) => ({ chessId, row: 10 + Math.floor(i / 7), col: 3 + (i % 7) }));
  const h = makeBattle({ defs: { chess, enemies: { e_dummy: dummy } }, units, bonds: { kjeragShip: bondOn(9) }, autoFinish: false, timeLimit: 30 });
  h.runUntil(() => h.allies().length >= 9, 10);
  const u = h.unit(ids[0]);
  const base = u.s.aspd;
  const e = h.spawn('e_dummy', { pos: [10, 2], mods: { speedMul: 0 } });
  h.b.applyStatus(e, 'cold', { duration: 2.5 });
  h.run(2.2);
  const haste = u.buffs.filter((b) => b.key === 'bond:kjerag:haste');
  assert.equal(haste.length, 1, '同名 buff 只有一层（叠的是层数）');
  assert.ok(haste[0].stacks >= 2, `攻击寒冷敌人叠加（${haste[0].stacks} 层）`);
  assert.ok(haste[0].stacks <= 50, '最多 50 层');
  assert.ok(haste[0].timeLeft > 0 && haste[0].timeLeft <= 5, `5 秒窗口（${haste[0].timeLeft}）`);
  assert.ok(u.s.aspd > base, `攻速真的涨了（${base} → ${u.s.aspd}）`);
  h.run(6); // 寒冷 2.5 s 后不再叠层，最后一层 5 s 到期
  assert.equal(u.buffs.filter((b) => b.key === 'bond:kjerag:haste').length, 0, '离开窗口后掉光');
  assert.equal(h.invariants(), true);
});

test('阿戈尔·重构：3 名生命上限 +50%；6 名可同时攻击的敌人数量随吞噬增加', () => {
  const ids = Array.from({ length: 6 }, (_, i) => `e${i}_a`);
  const h = makeBattle({ defs: defsOf(ids.map((id) => [id, ['egirShip']])), units: lineup(ids), bonds: { egirShip: bondOn(6) }, autoFinish: false, timeLimit: 20 });
  h.runUntil(() => h.allies().length >= 6, 10);
  const u = h.unit('e1_a');
  assert.ok(u.s.maxHp > 7500, `生命上限至少 +50%（吞噬加层后 ${u.s.maxHp}）`);
  assert.ok(u.s.blockCnt > 1, '吞噬拿到了阻挡数');
  h.step(2);
  assert.equal(h.invariants(), true);
});

test('叙拉古·重构：3 名部署即隐匿；9 名召唤狼之主', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `r${i}_a`);
  const h = makeBattle({ defs: defsOf(ids.map((id) => [id, ['siracusaShip']])), units: lineup(ids), bonds: { siracusaShip: bondOn(9) }, autoFinish: false, timeLimit: 20 });
  h.runUntil(() => h.allies().length >= 9, 10);
  assert.equal(!!h.unit('r0_a').s.flags.stealth, true, '3 名开始隐匿');
  assert.ok(h.b.allyUnits.some((u) => u.defId === TOKEN_IDS.wolfPack), '9 名召唤了狼之主');
  h.step(5);
  assert.equal(h.invariants(), true);
});

test('卡西米尔·重构：3 名再部署 -25%；6 名保留脉冲与未阻挡真伤', () => {
  const ids = Array.from({ length: 6 }, (_, i) => `c${i}_a`);
  const h = makeBattle({ defs: defsOf(ids.map((id) => [id, ['kazimierzShip']])), units: lineup(ids), bonds: { kazimierzShip: bondOn(6) }, autoFinish: false, timeLimit: 20 });
  h.runUntil(() => h.allies().length >= 6, 10);
  const u = h.unit('c0_a');
  const buff = u.buffs.find((b) => b.key === 'bond:kazimierz:redeploy');
  assert.ok(buff && Math.abs(buff.mods.redeployMul - 0.75) < 1e-9, '再部署时间 -25%');
  h.step(3);
  assert.equal(h.invariants(), true);
});

test('原本加核心盟约层数的效果，加到的就是重构盟约的层数（同一 bond id）', () => {
  const ids = ['L1_a', 'L2_a', 'L3_a'];
  const h = makeBattle({ defs: defsOf(ids.map((id) => [id, ['yanShip']])), units: lineup(ids), bonds: { yanShip: bondOn(3, 0) }, autoFinish: false, timeLimit: 30 });
  h.runUntil(() => h.allies().length >= 3, 10);
  const u = h.unit('L1_a');
  const before = u.s.atk;
  h.b.addLayers('p1', 'yanShip', 20, 'test');
  h.step(2);
  assert.equal(h.b.getPlayer('p1').bonds.yanShip.layers, 20, '层数记在官方 id 上');
  const want = 1000 * (1 + 0.25 + 0.01 * 20);
  assert.ok(Math.abs(u.s.atk - want) < 1e-6, `重构公式吃到新层数：${u.s.atk} ≠ ${want}`);
  assert.ok(u.s.atk > before, '攻击力确实提高');
  assert.equal(h.invariants(), true);
});

// 业主管线 2026-10-27「重构后的效果在重构模拟里没有生效，还是原本的效果」：生产默认是**浏览器**跑战斗
// （`clientCombat`），而别名以前只加在 `Match` 准备期那份数据上 —— 战斗读的仍是官方记录。这一条钉住别名已经
// 下沉到 `Battle`（`createBattleFromSpec` → `Battle.dataObjectOf`）：战斗里 `bondRecord(官方 id)` 读到重构记录，
// 非重构模式仍是官方记录。
test('createBattleFromSpec：mode_recon_* 的战斗读到重构记录（bb.recon），官方模式仍是原记录', () => {
  const spec = { v: 1, battleId: 'recon-alias', kind: 'normal', seed: 1, round: 1, stageId: null, players: [], spawns: [], routes: [], flags: {}, timeLimit: 10 };
  setGameData(DATA); // 默认数据回到官方那一份：战斗里读到的记录只可能来自它自己的数据作用域
  try {
    const readInBattle = (modeId, bondId) => {
      const b = createBattleFromSpec({ ...spec, modeId }, new DataSource(DATA, null), { quiet: true, recordEvents: false });
      let rec = null;
      b.on('battleStart', () => { rec = bondRecord(bondId); });
      b.start();
      return rec;
    };
    const yan = readInBattle('mode_recon_abyss', 'yanShip');
    assert.ok(yan && yan.bb && yan.bb.recon, '重构战斗读到的官方 id 上有 bb.recon');
    assert.equal(yan.name, '炎·重构');
    assert.equal(readInBattle('mode_recon_abyss', 'egirShip').name, '阿戈尔·重构');
    const plain = readInBattle('mode_multi_normal', 'yanShip');
    assert.equal(plain.name, '炎', '非重构模式仍是官方记录');
    assert.equal(plain.bb.recon, undefined);
  } finally {
    setGameData(aliased);
  }
});

test('拉特兰·重构：数值（弹药 +10% / 每层 +2%；3 名每发 +5%）在数据里', () => {
  const rec = aliased.bonds.lateranoShip;
  const bb = rec.buffs[0].bb;
  assert.equal(bb.base_ammo_percent, 0.1);
  assert.equal(bb.ammo_percent_per_stack, 0.02);
  assert.equal(bb.atk_per_consume, 0.05);
  assert.equal(bb.max_atk_for_consume, 5);
  assert.equal(bb.recon.hpPct, 0.02);
  assert.equal(bb.recon.refillChance, 0.25);
});
