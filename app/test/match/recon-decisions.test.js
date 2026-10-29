// test/match/recon-decisions.test.js — 重构模拟的「重构决策」（业主 2026-10-28）：
// 每回合休整期开始时，每名玩家**自己**抽 3 个候选、选 1 个（不共享）；选中后写一条常驻效果（EFFECTS 列）。
// R1 池六条（F 档）/ R4 池六条（E 档）。数值全在包 `choices.json` 的 `reconDecisions.rounds` 里。
//
// 跑法：node --test test/match/recon-decisions.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeMatch } from './harness.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { packLayer } from '../helpers/packLayer.js';
import { RECON_RULES } from '../../workshop/mode-recon/meta/main.mjs';

const LAYER = await packLayer({ ids: ['mode-recon'] });
const R1_POOL = [
  RECON_RULES.DECISION_FUNDS, RECON_RULES.DECISION_ASSAULT, RECON_RULES.DECISION_BOND,
  RECON_RULES.DECISION_GUARD, RECON_RULES.DECISION_REVIVE, RECON_RULES.DECISION_WEAKEN,
];
const R4_POOL = R1_POOL.map((id) => `${id}_e`);
const DECISION_KEY = RECON_RULES.DECISION_BATTLE_KEY;

function reconMatch(o = {}) {
  return makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', humans: 2, seed: 3, fake: true, registry: LAYER.registry, ...o }).start();
}

/** 走到指定回合的休整期（预重构交齐 + 继续），停在 PREP、私密选择还没选。 */
function toPrep(h, round = 1) {
  h.drive(() => h.m.phase === 'PRE_RECON');
  for (const ps of h.m.players.values()) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.reconChoice' });
  h.run(() => h.m.reconSummary);
  for (const ps of h.m.players.values()) if (!ps.isBot) h.m.handle(ps.playerId, { t: 'g.reconContinue' });
  h.drive(() => h.m.phase === 'PREP' && h.m.round === round);
  assert.equal(h.m.phase, 'PREP');
  return h;
}

test('R1 / R4 休整期：每名玩家各自拿到 3 个候选（不共享），全是该回合池里的', () => {
  const h = reconMatch();
  toPrep(h, 1);
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  assert.ok(p0.personalChoice && p1.personalChoice, '两名玩家各有一份');
  assert.notEqual(p0.personalChoice.id, p1.personalChoice.id, '两份选择互相独立');
  for (const ps of [p0, p1]) {
    assert.equal(ps.personalChoice.kind, 'recon');
    assert.equal(ps.personalChoice.round, 1);
    assert.equal(ps.personalChoice.cards.length, 3, '每次 3 个候选');
    assert.equal(new Set(ps.personalChoice.cards.map((c) => c.id)).size, 3, '不重复');
    for (const c of ps.personalChoice.cards) assert.ok(R1_POOL.includes(c.id), `${c.id} 是 R1 池里的`);
  }
  const v = p0.privateView().personalChoice;
  assert.equal(v.kind, 'recon');
  assert.ok(v.cards.every((c) => typeof c.name === 'string' && c.name && typeof c.desc === 'string'));
  // 走到 R4 / R8：池子依次换成 E / D 档
  h.drive(() => h.m.phase === 'PREP' && h.m.round === 4);
  const q = h.ps('p_0');
  assert.ok(q.personalChoice, 'R4 也有一次');
  assert.equal(q.personalChoice.round, 4);
  assert.equal(q.personalChoice.cards.length, 3);
  for (const c of q.personalChoice.cards) assert.ok(R4_POOL.includes(c.id), `${c.id} 是 R4 池里的`);
  h.drive(() => h.m.phase === 'PREP' && h.m.round === 8);
  const r = h.ps('p_0');
  assert.ok(r.personalChoice, 'R8 也有一次');
  assert.equal(r.personalChoice.round, 8);
  assert.equal(r.personalChoice.cards.length, 3);
  for (const c of r.personalChoice.cards) assert.ok(c.id.endsWith('_d'), `${c.id} 是 R8 池里的`);
  h.drive(() => h.m.phase === 'PREP' && h.m.round === 12);
  const s = h.ps('p_0');
  assert.ok(s.personalChoice, 'R12 也有一次');
  assert.equal(s.personalChoice.round, 12);
  assert.equal(s.personalChoice.cards.length, 3);
  for (const c of s.personalChoice.cards) assert.ok(c.id.endsWith('_c'), `${c.id} 是 R12 池里的`);
  h.drive(() => h.m.phase === 'PREP' && h.m.round === 16);
  const t = h.ps('p_0');
  assert.ok(t.personalChoice, 'R16 也有一次');
  assert.equal(t.personalChoice.round, 16);
  assert.equal(t.personalChoice.cards.length, 3);
  for (const c of t.personalChoice.cards) assert.ok(c.id.endsWith('_b'), `${c.id} 是 R16 池里的`);
  h.drive(() => h.m.phase === 'PREP' && h.m.round === 20);
  const u20 = h.ps('p_0');
  assert.ok(u20.personalChoice, 'R20 也有一次');
  assert.equal(u20.personalChoice.round, 20);
  assert.equal(u20.personalChoice.cards.length, 3);
  for (const c of u20.personalChoice.cards) assert.ok(c.id.endsWith('_a'), `${c.id} 是 R20 池里的`);
  h.m.dispose();
});

test('R21 池：三条 X 决策在数据里（R21 是隐秘核心，对局到 R20 结束，走不到 PREP）', () => {
  const choices = JSON.parse(fs.readFileSync(new URL('../../workshop/mode-recon/choices.json', import.meta.url), 'utf8'));
  const ids = choices.reconDecisions.rounds['21'].map((c) => c.id);
  assert.deepEqual(ids, ['recon_decision_logistics_x', 'recon_decision_frontline_x', 'recon_decision_aid_x']);
});

test('选中一条：写进常驻效果（EFFECTS），资金 / 复苏立刻生效；另一名玩家的选择不受影响', () => {
  const h = reconMatch({ seed: 9 });
  toPrep(h, 1);
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  const funds = p0.personalChoice.cards.find((c) => c.id === RECON_RULES.DECISION_FUNDS);
  const idx = funds ? p0.personalChoice.cards.indexOf(funds) : 0;
  const card = p0.personalChoice.cards[idx];
  const lp0 = p0.lp;
  const funds0 = p0.funds;
  assert.deepEqual(h.m.handle('p_0', { t: 'g.choice', idx, choiceId: p0.personalChoice.id }), { ok: true });
  assert.equal(p0.personalChoice, null);
  assert.ok(p1.personalChoice, 'p_1 的选择还在');
  const row = p0.effects.find((e) => e.id === `${RECON_RULES.DECISION_EFFECT_PREFIX}${card.id}`);
  assert.ok(row, '效果条目写进 EFFECTS');
  assert.equal(row.name, card.name);
  assert.equal(row.desc, card.desc);
  assert.ok(p0.effectsView().some((e) => e.id === row.id && e.name === card.name), 'EFFECTS 列读得到');
  if (card.id === RECON_RULES.DECISION_FUNDS) assert.equal(p0.funds, funds0 + 2, '+2 资金');
  if (card.id === RECON_RULES.DECISION_REVIVE) assert.equal(p0.lp, lp0 + 3, '+3 生命');
  h.m.dispose();
});

test('效果落地（按数据施加）：资金每回合 +N、复苏 +N、战斗条目带 ally/enemy 参数', () => {
  const h = reconMatch();
  toPrep(h, 1);
  const p0 = h.ps('p_0');
  p0.personalChoice = null;
  const funds0 = p0.funds;
  h.m.applyReconDecision(p0, { id: RECON_RULES.DECISION_FUNDS, name: '资金', desc: '', meta: { funds: 2, fundsEachRound: true } });
  assert.equal(p0.funds, funds0 + 2, '选中当回合 +2');
  h.m.dispatch(p0, 'onRoundStart', { round: 2 });
  assert.equal(p0.funds, funds0 + 4, '之后每个休整期再 +2');
  const lp0 = p0.lp;
  h.m.applyReconDecision(p0, { id: RECON_RULES.DECISION_REVIVE, name: '复苏', desc: '', meta: { lp: 3 } });
  assert.equal(p0.lp, lp0 + 3);
  // E 档：另一条资金 +4 也叠进每回合
  h.m.applyReconDecision(p0, { id: 'recon_decision_funds_e', name: '资金E', desc: '', meta: { funds: 4, fundsEachRound: true } });
  h.m.dispatch(p0, 'onRoundStart', { round: 3 });
  // 2（F 选中） + 2（R2） + 4（E 选中） + 6（R3 = F 2 + E 4）
  assert.equal(p0.funds, funds0 + 14, 'F + E 两条资金各自每回合生效');
  h.m.applyReconDecision(p0, { id: RECON_RULES.DECISION_ASSAULT, name: '攻势', desc: '', battle: { ally: { atkMul: 1.25 } } });
  const row = p0.effects.find((e) => e.id === `${RECON_RULES.DECISION_EFFECT_PREFIX}${RECON_RULES.DECISION_ASSAULT}`);
  assert.equal(row.key, DECISION_KEY);
  assert.deepEqual(row.params, { id: RECON_RULES.DECISION_ASSAULT, ally: { atkMul: 1.25 } });
  assert.ok(p0.battleInput().playerEffects.some((r) => r.key === DECISION_KEY && r.params && r.params.id === RECON_RULES.DECISION_ASSAULT), '进得了战斗');
  h.m.dispose();
});

const EFFECT = (id, params) => ({ id: `recon.dec.${id}`, key: DECISION_KEY, battle: true, params: { id, ...params } });

function battleWith(effects, enemyOver = {}, bonds = {}) {
  const op = chessRec({ id: 'd0_a', bonds: [], profession: 'WARRIOR', rangeGrid: [[0, 0], [0, 1]], skill: null,
    stats: { atk: 1000, maxHp: 5000, def: 100, res: 30, bat: 1, blockCnt: 1 } });
  const enemy = enemyRec({ key: 'e_dummy', hp: 1e8, speed: 0, def: 200, res: 30, atk: 800, ...enemyOver });
  const h = makeBattle({
    defs: { chess: { d0_a: op }, enemies: { e_dummy: enemy } },
    units: [{ chessId: 'd0_a', row: 10, col: 3 }],
    playerEffects: effects, bonds, battleInstallers: LAYER.installers, autoFinish: false, timeLimit: 20,
  });
  h.runUntil(() => h.allies().length >= 1, 10);
  return h;
}

test('战斗侧 R1：攻势 ×1.25 攻击、守备 +25% 生命/防御 + 法抗、削弱让敌人伤害 ×0.75', () => {
  const h = battleWith([
    EFFECT(RECON_RULES.DECISION_ASSAULT, { ally: { atkMul: 1.25 } }),
    EFFECT(RECON_RULES.DECISION_GUARD, { ally: { hpMul: 1.25, defMul: 1.25, resPct: 0.1, resMin: 10 } }),
    EFFECT(RECON_RULES.DECISION_WEAKEN, { enemy: { dmgDealtMul: 0.75 } }),
  ]);
  const u = h.unit('d0_a');
  assert.ok(Math.abs(u.s.atk - 1000 * 1.25) < 1e-6, `攻击 ${u.s.atk}`);
  assert.ok(Math.abs(u.s.maxHp - 5000 * 1.25) < 1e-6, `生命上限 ${u.s.maxHp}`);
  assert.ok(Math.abs(u.s.def - 100 * 1.25) < 1e-6, `防御 ${u.s.def}`);
  assert.ok(Math.abs(u.s.res - (30 + Math.max(10, 30 * 0.1))) < 1e-6, `法抗 ${u.s.res}`);
  const e = h.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  assert.ok(e.buffs.some((b) => b.key === `recon:dec:${RECON_RULES.DECISION_WEAKEN}`), '削弱 buff 挂在敌人身上');
  h.run(0.2);
  assert.equal(h.invariants(), true);
});

test('战斗侧 R4：攻势E 伤害 ×1.25、守备E 物理/法术减伤 ×0.75、削弱E 防御 ×0.75 / 法抗 -25%（最少 10）', () => {
  const h = battleWith([
    EFFECT('recon_decision_assault_e', { ally: { dmgDealtMul: 1.25 } }),
    EFFECT('recon_decision_guard_e', { ally: { physTakenMul: 0.75, artsTakenMul: 0.75 } }),
    EFFECT('recon_decision_weaken_e', { enemy: { defMul: 0.75, resPct: -0.25, resMin: 10 } }),
  ]);
  const u = h.unit('d0_a');
  assert.ok(Math.abs(u.s.dmgDealtMul - 1.25) < 1e-6, `伤害 ${u.s.dmgDealtMul}`);
  assert.ok(Math.abs(u.s.physTakenMul - 0.75) < 1e-6, `物理减伤 ${u.s.physTakenMul}`);
  assert.ok(Math.abs(u.s.artsTakenMul - 0.75) < 1e-6, `法术减伤 ${u.s.artsTakenMul}`);
  const e = h.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  assert.ok(Math.abs(e.s.def - 200 * 0.75) < 1e-6, `敌人防御 ${e.s.def}`);
  assert.ok(Math.abs(e.s.res - (30 - Math.max(10, 30 * 0.25))) < 1e-6, `敌人法抗 ${e.s.res}`);
  h.run(0.2);
  assert.equal(h.invariants(), true);
});

test('战斗侧 R12：攻势C 弱点伤害、守备C 受伤 ×0.75、削弱C 敌人攻速 -25%', () => {
  const plain = battleWith([], { def: 800, res: 0 });
  const weak = battleWith([EFFECT('recon_decision_assault_c', { ally: { attackWeakness: true } })], { def: 800, res: 0 });
  const e1 = plain.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  const e2 = weak.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  plain.run(2.4);
  weak.run(2.4);
  assert.ok(e2.hp < e1.hp - 1, `弱点伤害换到更有效的一类（多扣 ${e1.hp - e2.hp}）`);

  const guard = battleWith([EFFECT('recon_decision_guard_c', { ally: { dmgTakenMul: 0.75 } })]);
  assert.ok(Math.abs(guard.unit('d0_a').s.dmgTakenMul - 0.75) < 1e-6, '受伤 ×0.75');

  const slow = battleWith([EFFECT('recon_decision_weaken_c', { enemy: { batPct: 1 / 3, skillCdMul: 1.25 } })]);
  const ew = slow.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  assert.ok(Math.abs(ew.s.interval - e1.s.interval * (4 / 3)) < 1e-6, `攻速 -25% ⇒ 间隔 ×4/3（${ew.s.interval} vs ${e1.s.interval}）`);
});

test('战斗侧 R8：攻势D 攻击附带 25% 攻击力真伤；守备D 每 5 秒 10% 生命上限屏障（≤2 层）；削弱D 敌人攻击 ×0.75', () => {
  const plain = battleWith([]);
  const assD = battleWith([EFFECT('recon_decision_assault_d', { ally: { attackTruePct: 0.25 } })]);
  const ePlain = plain.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  const eAss = assD.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  plain.run(2.4);
  assD.run(2.4);
  assert.ok(eAss.hp < ePlain.hp - 200, `真伤额外扣血（${ePlain.hp - eAss.hp}）`);

  const guard = battleWith([EFFECT('recon_decision_guard_d', { ally: { shieldEvery: 5, shieldPct: 0.1, shieldMaxStacks: 2 } })]);
  const u = guard.unit('d0_a');
  const key = 'recon:dec:recon_decision_guard_d';
  const start = (u.findBuff(key) || {}).shield || 0;
  guard.run(5.2);
  const one = u.findBuff(key);
  assert.ok(one && one.shield >= Math.min(u.s.maxHp * 0.2, start + u.s.maxHp * 0.1) - 1, `护盾叠加 ${one && one.shield}`);
  guard.run(5.2);
  const two = u.findBuff(key);
  assert.ok(two && Math.abs(two.shield - u.s.maxHp * 0.2) < 1, `两层封顶 ${two && two.shield}`);

  const weak = battleWith([EFFECT('recon_decision_weaken_d', { enemy: { atkMul: 0.75 } })]);
  const ew = weak.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  assert.ok(Math.abs(ew.s.atk - 800 * 0.75) < 1e-6, `敌人攻击 ${ew.s.atk}`);
});

test('战斗侧 R16：攻势B 攻击叠敌防/法抗 -2.5%（≤20 层）、守备B 每秒回 2.5% 生命、削弱B 敌人攻击自吃 5000% 固定伤害', () => {
  const deb = battleWith([EFFECT('recon_decision_assault_b', { ally: { attackDebuffPct: 0.025, attackDebuffStacks: 20 } })]);
  const e = deb.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  deb.run(2.4);
  const buff = e.buffs.find((b) => typeof b.key === 'string' && b.key.startsWith('recon:dec:debuff:'));
  assert.ok(buff && buff.stacks >= 2, `叠层 ${buff && buff.stacks}`);
  assert.ok(Math.abs(e.s.def - 200 * (1 - 0.025 * buff.stacks)) < 1e-6, `防御 ${e.s.def}`);
  assert.ok(Math.abs(e.s.res - (30 - 30 * 0.025 * buff.stacks)) < 1e-6, `法抗 ${e.s.res}`);
  assert.ok(buff.stacks <= 20, '最多 20 层');

  const regen = battleWith([EFFECT('recon_decision_guard_b', { ally: { regenPctPerSec: 0.025 } })]);
  const u = regen.unit('d0_a');
  u.hp = u.s.maxHp / 2;
  const hp0 = u.hp;
  regen.run(1.2);
  assert.ok(u.hp > hp0 + 100, `每秒回血（${hp0} → ${u.hp}）`);

  const self = battleWith([EFFECT('recon_decision_weaken_b', { enemy: { selfDamageAtkPct: 5000 } })]);
  const eb = self.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  const op = self.unit('d0_a');
  // 「实际打出的伤害 1000」×5000% = 50000 真伤回到敌人自己身上
  self.b.emit('damaged', { source: eb, target: op, amount: 1000, type: 'phys' });
  assert.ok(Math.abs((1e8 - eb.hp) - 50000) < 1, `敌人自吃 5000% 实际伤害（掉了 ${1e8 - eb.hp}）`);
});

test('战斗侧 R20：攻势A 每次攻击自身攻速 +5（≤100 层）、守备A 每次伤害 -1000、削弱A 每 10 秒随机挂脆弱/麻痹/虚弱', () => {
  const aspd = battleWith([EFFECT('recon_decision_assault_a', { ally: { attackAspd: 5, attackAspdStacks: 100 } })]);
  const ea = aspd.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  const ua = aspd.unit('d0_a');
  const baseAspd = ua.s.aspd;
  aspd.b.emit('attack', { attacker: ua, targets: [ea], isSkill: false });
  aspd.b.emit('attack', { attacker: ua, targets: [ea], isSkill: false });
  const ab = ua.buffs.find((b) => typeof b.key === 'string' && b.key.startsWith('recon:dec:aspd:'));
  assert.ok(ab && ab.stacks === 2, `叠层 ${ab && ab.stacks}`);
  assert.ok(Math.abs(ua.s.aspd - (baseAspd + 10)) < 1e-6, `攻速 ${ua.s.aspd}`);

  const cut = battleWith([EFFECT('recon_decision_guard_a', { ally: { flatDamageCut: 1000 } })]);
  const uc = cut.unit('d0_a');
  const src = cut.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  cut.b.dealDamage(src, uc, { amount: 1500, type: 'true', canDodge: false });
  assert.ok(Math.abs((uc.s.maxHp - uc.hp) - 500) < 1, `净伤害 1500-1000（${uc.s.maxHp - uc.hp}）`);

  const rnd = battleWith([EFFECT('recon_decision_weaken_a', {
    enemy: { randomDebuffEvery: 10, randomDebuffDuration: 10, fragile: 0.5, palsy: 3, weaken: 0.5 },
  })]);
  const er = rnd.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  rnd.run(10.4);
  assert.ok(er.buffs.some((b) => ['physFragile', 'palsy', 'weaken'].includes(b.status)), '抽中一种减益');
});

test('战斗侧 R21：战线X 输出 +Σ层数%、受伤 ×0.5；援助X 敌人受伤 +Σ层数%', () => {
  const bonds = { yanShip: { count: 3, active: true, tier: 1, layers: 100 } };
  const h = battleWith([
    EFFECT('recon_decision_frontline_x', { ally: { bondLayerDamagePct: 0.01, dmgTakenMul: 0.5 } }),
    EFFECT('recon_decision_aid_x', { enemy: { bondLayerDamagePct: 0.01 } }),
  ], {}, bonds);
  h.run(1.2); // 每秒按当前盟约层数重刷
  const u = h.unit('d0_a');
  assert.ok(Math.abs(u.s.dmgDealtMul - 2) < 1e-6, `输出 ×2（${u.s.dmgDealtMul}）`);
  assert.ok(Math.abs(u.s.dmgTakenMul - 0.5) < 1e-6, `受伤 ×0.5（${u.s.dmgTakenMul}）`);
  const e = h.spawn('e_dummy', { pos: [10, 4], mods: { speedMul: 0 } });
  assert.ok(Math.abs(e.s.dmgTakenMul - 2) < 1e-6, `敌人受伤 ×2（${e.s.dmgTakenMul}）`);
});

test('R21 后勤整合X：立刻 +100 资金，盟约层数按整局 20 次上限', () => {
  const h = reconMatch();
  toPrep(h, 1);
  const p0 = h.ps('p_0');
  p0.personalChoice = null;
  const funds0 = p0.funds;
  h.m.applyReconDecision(p0, { id: 'recon_decision_logistics_x', name: '后勤', desc: '', meta: { funds: 100, bondLayers: 50, bondTriggerLimit: 20, bondTriggerScope: 'match' } });
  assert.equal(p0.funds, funds0 + 100, '立刻 +100');
  h.m.dispatch(p0, 'onRoundStart', { round: 2 });
  assert.equal(p0.funds, funds0 + 100, '不是每回合资金');
});
