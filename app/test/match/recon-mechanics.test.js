// test/match/recon-mechanics.test.js — 「重构模拟」（工坊包 workshop/mode-recon）的新机制回归。
//
// 覆盖两处实现 + 引擎新增的三格：
//   * workshop/mode-recon/meta/main.mjs 的四个钩子：publishChoice / bondAssist / destroyAssist / syncLoadDoom
//   * 引擎：ctx.recon()（server/match/effectsMeta.js）、ctx.destroyItem（server/match/player/items.js）、
//     m.rollItemId({ minTier })（server/match/match/spDraft.js）。
// 跑法：node --test test/match/recon-mechanics.test.js
//
// ⚠️ 两条**口径事实**（实现已如此，本文件照它写）：
//   1. onEquip / onArt / onDestroy 走 `EffectDispatcher.dispatchItem`（item 作用域，**不经过 `dispatch`**）。
//      **0.3.1 起那条路也跑 `global:` 处理器** —— 从前它会跳过它们，而官方的 global 处理器一个都没有（builtinMeta
//      只注册 `item:` / `effect:`），所以这条扩宽对官方内容是零改动；pack 的「装备重构」正是靠它数销毁次数。
//      文件末尾有一条走**真实销毁路径**的端到端断言（`g.destroy` → dispatchItem → global:recon），别只信这一行。
//   2. data/bonds.json 的 bondType 只有 SEASON / REGULAR，**没有 SIDE_STORY** ——「故事集盟约」一类在当前数据下无
//      可落之盟约（pack 的 kindOf 会把它们都归到 core / addon）。所以「三类各 +10 层」只有用**手工构造的假 ctx**
//      才能把 story 一路测到（见文件末尾那一条，并在注释里点名它是假 ctx）。
//
// 真引擎用 m.dispatch 驱动：registerMeta(match.registry) 把 global:recon 挂到**这一局**的注册表，再断言玩家状态
// （层数 / 物品 / counter / effects）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, chessOfTier, legalTileFor } from './harness.js';
import { makeCtx, MetaRegistry } from '../../server/match/effectsMeta.js';
import { tileKey } from '../../server/match/board.js';
import { registerMeta, RECON_RULES } from '../../workshop/mode-recon/meta/main.mjs';

const A_BOND = RECON_RULES.ASSIST_BOND;   // 'recon_assist_bond'
const A_EQUIP = RECON_RULES.ASSIST_EQUIP; // 'recon_assist_equip'
const A_DATA = 'recon_assist_data';       // RECON_RULES 未导出，逐字照抄
const L_BOND = RECON_RULES.LOAD_BOND;     // 'recon_load_bond'
const L_EQUIP = RECON_RULES.LOAD_EQUIP;   // 'recon_load_equip'

const EQUIP3 = 'chess_item_3_01_e_a';     // tier 3 EQUIP
const EQUIP_EXEMPT = 'chess_item_6_09_e_a'; // 变形同构体（豁免，tier 6）
const MAGIC = 'chess_item_6_02_m';        // 画卷（itemType MAGIC）

/** 一局 solo 对局（PREP R1），注册表里**只**挂 pack 的 global:recon（裸 MetaRegistry，不受别的处理器干扰）。 */
function setup(seed = 7) {
  const registry = new MetaRegistry();
  registerMeta(registry);
  const h = makeMatch({ mode: 'solo', humans: 1, seed, registry, fake: true }).start();
  h.toPrep(1);
  const m = h.m, ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) {
    if (p.kind === 'chess') ps.returnCopies(p); else if (p.kind === 'item') ps.releaseItemStock(p);
  }
  ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
  ps.counters = {}; ps.layers = {}; ps.funds = 50;
  ps.recompute();
  return { h, m, ps, registry };
}

/** 一件手牌装备装到手牌干员身上（g.equip 必须成功）。 */
function equipOnHand(m, ps, itemId, chessId) {
  const holder = give(m, ps, chessId, 'hand');
  const item = giveItem(m, ps, itemId);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: holder.uid }), { ok: true });
  assert.ok(holder.items.includes(item), '装备应已挂上');
  return { holder, item };
}

// ---------------------------------------------------------------------------------------------
// 1. ctx.recon()

test('ctx.recon(): 没交过选择 → null；交过 → 得到拷贝（major/minor 也是数组拷贝）', () => {
  const { m, ps } = setup();
  const ctx = makeCtx(m, ps, { kind: 'global', key: 'global:recon' }, 'onRoundStart');
  assert.equal(m.reconChoices, null, '开局 reconChoices 为 null');
  assert.equal(ctx.recon(), null, '没交过 → null');
  m.reconChoices = { other: { assist: A_DATA } };
  assert.equal(ctx.recon(), null, '这一局没有本玩家的记录 → null');

  const own = { assist: A_DATA, load: L_BOND, major: ['m1'], minor: ['n1'], story: 's1' };
  m.reconChoices.p_0 = own;
  const got = ctx.recon();
  assert.deepEqual(got, own, '原样读回');
  assert.notEqual(got, own, '返回的是拷贝');
  assert.notEqual(got.major, own.major, 'major 是数组拷贝');
  assert.notEqual(got.minor, own.minor, 'minor 是数组拷贝');
  got.assist = 'changed'; got.major.push('m2'); got.minor.push('n2'); got.story = 'z';
  assert.deepEqual(own, { assist: A_DATA, load: L_BOND, major: ['m1'], minor: ['n1'], story: 's1' }, '改拷贝动不了引擎手里那一份');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------
// 2. rollItemId({ minTier })

test('rollItemId({ minTier }): 下界 tier >= minTier；不写 = 旧行为（tier 1 仍抽得到）；> 6 夹到 6；写 tier 只抽那一档', () => {
  const m = makeMatch({ mode: 'coop', humans: 1, seed: 3, fake: true }).m;
  const tierOf = (id) => { assert.ok(id, 'roll returned null'); return m.gd.item(id).tier; };

  const plain = new Set();
  for (let i = 0; i < 300; i++) plain.add(tierOf(m.rollItemId({})));
  assert.ok(plain.has(1), '不写 minTier ⇒ 下界仍是 1（旧的逐字节行为）');

  for (const mt of [2, 3, 4, 5]) for (let i = 0; i < 200; i++) assert.ok(tierOf(m.rollItemId({ minTier: mt })) >= mt, `minTier ${mt}`);
  for (let i = 0; i < 100; i++) assert.equal(tierOf(m.rollItemId({ minTier: 6 })), 6);
  for (let i = 0; i < 50; i++) assert.equal(tierOf(m.rollItemId({ minTier: 9 })), 6, 'minTier 超过 6 按 6 夹住，不抛');
  for (let i = 0; i < 50; i++) assert.equal(tierOf(m.rollItemId({ tier: 3 })), 3, '写了 tier 就只抽那一档');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------
// 3. ctx.destroyItem

test('ctx.destroyItem: 销毁已装备的装备成功（返回 true、离开携带者、onDestroy 收到 reason）；未知 uid / 非装备件返回 false', () => {
  const { m, ps, registry } = setup();
  const reasons = [];
  registry.item(EQUIP3, { onDestroy(ctx, ev) { reasons.push(ev.reason); } });

  const { holder, item } = equipOnHand(m, ps, EQUIP3, chessOfTier(1)[0]);
  const ctx = makeCtx(m, ps, { kind: 'item', key: 'item:test' }, 'onDestroy');
  // g.destroy（玩家意图）锁着已装备的装备 —— 与 ctx.destroyItem 的差别（失败意图返回 { error } 而非 { ok:false }）
  const gd = m.handle('p_0', { t: 'g.destroy', uid: item.uid });
  assert.ok(gd.error, 'g.destroy 烧不动已装备的装备');
  assert.ok(holder.items.includes(item), '仍在身上');
  assert.equal(ctx.destroyItem(item.uid, { reason: 'recon_load' }), true, '内容层无条件销毁');
  assert.equal(ps.find(item.uid), null, '装备离开了携带者且不再被拥有');
  assert.ok(!holder.items.includes(item));
  assert.deepEqual(reasons, ['recon_load'], 'onDestroy 收到调用方给的 reason');

  // reason 缺省为 'content'
  const it2 = equipOnHand(m, ps, EQUIP3, chessOfTier(1)[0]).item;
  assert.equal(ctx.destroyItem(it2.uid), true);
  assert.deepEqual(reasons, ['recon_load', 'content']);
  // 未知 uid / 非装备件（棋子）
  assert.equal(ctx.destroyItem(999999), false);
  assert.equal(ctx.destroyItem(holder.uid), false, '棋子不是装备件');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------
// 4. publishChoice（onRoundStart）

test('publishChoice: onRoundStart 写出 EffectRef（id/key/params 正确、hidden/battle 为 true）；没选择 → removeEffect 移除', () => {
  const { m, ps } = setup();
  assert.equal(ps.effects.find((e) => e.id === RECON_RULES.EFFECT_ID), undefined, '开局没有这条效果');

  m.reconChoices = { p_0: { assist: A_BOND, load: L_EQUIP } };
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  const ref = ps.effects.find((e) => e.id === RECON_RULES.EFFECT_ID);
  assert.ok(ref, '回合开始写出了重构协议');
  assert.equal(ref.key, RECON_RULES.EFFECT_KEY);
  assert.equal(ref.key, 'effect:recon_protocol');
  assert.equal(ref.hidden, true, '技术性条目：不进玩家的效果列表');
  assert.equal(ref.battle, true, '要跟着 PlayerBattleInput 进战斗');
  assert.deepEqual(ref.params, { assist: A_BOND, load: L_EQUIP });

  // 选择被清空 → 下一回合移除这条 ref
  m.reconChoices.p_0 = {};
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.equal(ps.effects.find((e) => e.id === RECON_RULES.EFFECT_ID), undefined, '没选择 → removeEffect');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------
// 5. destroyAssist（onDestroy）——见文件头事实 1：引擎不把 onDestroy 送给 global，这里直接 m.dispatch 驱动

test('装备重构: 每销毁一件 EQUIP 补一件 tier >= 被销毁者的装备，每回合 3 次，下一回合恢复 3 次；法术 / 其它 assist 不动', () => {
  const { m, ps } = setup();
  m.reconChoices = { p_0: { assist: A_EQUIP } };
  const rolls = [];
  const orig = m.rollItemId.bind(m);
  m.rollItemId = (opts) => { const id = orig(opts); rolls.push({ opts, id }); return id; };

  const destroyed = giveItem(m, ps, EQUIP3); // tier 3
  const ev = { item: destroyed };
  for (let i = 0; i < 4; i++) m.dispatch(ps, 'onDestroy', ev);
  assert.equal(rolls.length, 3, '每回合只数前 3 次销毁');
  for (const r of rolls) {
    assert.equal(r.opts.minTier, 3, 'minTier = 被销毁装备的阶级');
    assert.ok(r.id && m.gd.item(r.id).tier >= 3, '补的装备不低于被销毁者');
  }
  assert.equal(ps.counters['recon.destroy.round'], m.round);
  assert.equal(ps.counters['recon.destroy.count'], 3, '计数停在上限');

  // 下一回合恢复 3 次
  m.round += 1;
  m.dispatch(ps, 'onDestroy', ev);
  assert.equal(rolls.length, 4, '新回合又开始计数');
  assert.equal(ps.counters['recon.destroy.round'], m.round);
  assert.equal(ps.counters['recon.destroy.count'], 1, '新回合重新从 0 计');

  // 法术（itemType !== 'EQUIP'）不计
  m.dispatch(ps, 'onDestroy', { item: giveItem(m, ps, MAGIC) });
  assert.equal(rolls.length, 4, '非 EQUIP 不算一次销毁');
  assert.equal(ps.counters['recon.destroy.count'], 1);

  // assist 不是装备重构 → 什么都不做
  m.reconChoices.p_0 = { assist: A_BOND };
  m.dispatch(ps, 'onDestroy', ev);
  assert.equal(rolls.length, 4);
  assert.equal(ps.counters['recon.destroy.count'], 1, '计数也不动');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------
// 6. syncLoadDoom（装备负载，onRoundStart；onEquip 那条见文件头事实 1）

test('装备负载: 装备阶级高于携带者 → 记 round+3，到点销毁（reason recon_load）', () => {
  const { m, ps, registry } = setup();
  m.reconChoices = { p_0: { load: L_EQUIP } };
  const reasons = [];
  registry.item(EQUIP3, { onDestroy(ctx, ev) { reasons.push(ev.reason); } });

  const { item } = equipOnHand(m, ps, EQUIP3, chessOfTier(1)[0]); // 携带者 tier 1 < 装备 tier 3
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  const key = `recon.doom.${item.uid}`;
  assert.equal(ps.counters[key], m.round + RECON_RULES.LOAD_EQUIP_ROUNDS, '倒计时按 round + 3 记');
  assert.ok(ps.find(item.uid), '还没到点，装备仍在');

  m.round += RECON_RULES.LOAD_EQUIP_ROUNDS; // 到点那一回合
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.equal(ps.find(item.uid), null, '到点 → ctx.destroyItem 销毁');
  // pack 的 syncLoadDoom 传的是 `{ reason: 'recon_load' }`（引擎的 ctx.destroyItem 第二参就是这个形状），所以
  // `onDestroy` 收到的理由就是它（曾经这里传的是裸字符串，reason 会落成缺省 'content' —— 已修）。
  assert.deepEqual(reasons, ['recon_load'], '销毁理由原样送到 onDestroy');
  assert.equal(ps.counters[key] || 0, 0, '销毁后倒计时清零');
  m.dispose();
});

test('装备负载: 豁免的两件不记倒计时、不会被销毁（变形同构体）', () => {
  assert.equal(RECON_RULES.LOAD_EQUIP_EXEMPT.includes('chess_item_6_09_e'), true);
  assert.equal(RECON_RULES.LOAD_EQUIP_EXEMPT.includes('chess_item_6_13_e'), true, '哥伦比亚包那件也在名单里');
  const { m, ps } = setup();
  m.reconChoices = { p_0: { load: L_EQUIP } };
  const { item } = equipOnHand(m, ps, EQUIP_EXEMPT, chessOfTier(1)[0]); // tier 6 > 携带者 tier 1，但在豁免名单
  const key = `recon.doom.${item.uid}`;
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.equal(ps.counters[key] || 0, 0, '豁免 → 不排倒计时');
  m.round += 10;
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.ok(ps.find(item.uid), '豁免的装备永不被销毁');
  m.dispose();
});

test('装备负载: 条件不再成立（装备阶级不高于携带者）→ 已记的倒计时被清零、不销毁', () => {
  const { m, ps } = setup();
  m.reconChoices = { p_0: { load: L_EQUIP } };
  const { item } = equipOnHand(m, ps, EQUIP3, chessOfTier(3)[0]); // tier 3 装备装到 tier 3 携带者：不满足 `tier > 携带者`
  const key = `recon.doom.${item.uid}`;
  ps.counters[key] = m.round + RECON_RULES.LOAD_EQUIP_ROUNDS; // 假装它曾被记过一次
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.equal(ps.counters[key] || 0, 0, '条件不成立 ⇒ 清零');
  m.round += RECON_RULES.LOAD_EQUIP_ROUNDS;
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.ok(ps.find(item.uid), '条件不成立时不会被销毁');
  m.dispose();
});

test('装备负载: load 不是 recon_load_equip → 既不记倒计时也不销毁', () => {
  const { m, ps } = setup();
  m.reconChoices = { p_0: { load: L_BOND } };
  const { item } = equipOnHand(m, ps, EQUIP3, chessOfTier(1)[0]);
  const key = `recon.doom.${item.uid}`;
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.equal(ps.counters[key] || 0, 0, '不记');
  m.round += 5;
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.ok(ps.find(item.uid), '不销毁');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------
// 4'. 盟约重构（bondAssist，onPrepEnd）

test('盟约重构（真引擎）: onPrepEnd 给已激活的最高层核心 / 附加盟约各 +10 层；assist 不是它时不动', () => {
  const { m, ps } = setup();
  m.reconChoices = { p_0: { assist: A_BOND } };
  const used = new Set();
  const put = (id) => { const t = legalTileFor(m, ps, id, used); assert.ok(t, `没有合法落点 ${id}`); used.add(tileKey(t[0], t[1])); give(m, ps, id, 'board', t); };
  // 炎（核心 yanShip，3 人激活）+ 迅捷（附加 swiftShip，2 人激活）
  for (const id of ['chess_char_1_03_a', 'chess_char_2_04_a', 'chess_char_3_03_a']) put(id);
  for (const id of ['chess_char_1_01_a', 'chess_char_1_19_a']) put(id);
  ps.recompute();
  assert.equal(ps.bonds.yanShip && ps.bonds.yanShip.active, true, '核心盟约已激活');
  assert.equal(ps.bonds.swiftShip && ps.bonds.swiftShip.active, true, '附加盟约已激活');
  ps.layers = { yanShip: 5, swiftShip: 3 };

  m.dispatch(ps, 'onPrepEnd', { round: m.round });
  assert.equal(ps.layers.yanShip, 15, '核心 +10');
  assert.equal(ps.layers.swiftShip, 13, '附加 +10');

  // assist 不是盟约重构 → 不动
  ps.layers = { yanShip: 5, swiftShip: 3 };
  m.reconChoices.p_0 = { assist: A_EQUIP };
  m.dispatch(ps, 'onPrepEnd', { round: m.round });
  assert.equal(ps.layers.yanShip, 5);
  assert.equal(ps.layers.swiftShip, 3);
  m.dispose();
});

test('盟约重构（假 ctx）: 三类（核心 / 附加 / 故事集）各 +10 层、只加「已激活且层数最高」的那一条、assist 不是它时什么都不做', () => {
  // ⚠️ 这是**手工构造的假 ctx**（不是真引擎）：pack 的 meta 模块只依赖 ctx，这里用假 ctx 记录调用。
  // 为什么必须假 ctx：真数据里没有 bondType === 'SIDE_STORY' 的盟约（只有 SEASON / REGULAR），「故事集」这一类
  // 无法在真实对局里搭出来 —— 只有假 ctx 能把 story 这一路测到。
  const reg = new MetaRegistry();
  registerMeta(reg);
  const h = reg.get('global:recon');
  assert.ok(h && typeof h.onPrepEnd === 'function');

  const gdBonds = {
    coreHigh: { isCore: true, bondType: 'REGULAR' },
    coreLow: { isCore: true, bondType: 'REGULAR' },
    addonHigh: { isCore: false, bondType: 'REGULAR' },
    storyHigh: { isCore: false, bondType: 'SIDE_STORY' },
    off: { isCore: false, bondType: 'REGULAR' },
  };
  const bonds = { coreHigh: { active: true }, coreLow: { active: true }, addonHigh: { active: true }, storyHigh: { active: true }, off: { active: false } };
  const layers = { coreHigh: 7, coreLow: 2, addonHigh: 4, storyHigh: 1, off: 99 };
  const calls = [];
  const ctx = {
    round: 1,
    recon: () => ({ assist: A_BOND }),
    bonds: () => ({ ...bonds }),
    bondActive: (id) => !!(bonds[id] && bonds[id].active),
    layers: (id) => layers[id] || 0,
    gd: { bond: (id) => gdBonds[id] || null },
    addLayers: (id, n, opts) => { calls.push([id, n, opts]); layers[id] = (layers[id] || 0) + n; return n; },
  };
  h.onPrepEnd(ctx);
  assert.deepEqual(calls, [
    ['coreHigh', 10, { requireActive: true }],
    ['addonHigh', 10, { requireActive: true }],
    ['storyHigh', 10, { requireActive: true }],
  ], '三类各取「已激活且层数最高」的那一条，只 +10；未激活的高层（off）与低层的不动');
  assert.equal(layers.off, 99, '未激活的盟约没有被加层');

  // assist 不是盟约重构 / 没交选择 → 什么都不做
  calls.length = 0;
  ctx.recon = () => ({ assist: A_EQUIP });
  h.onPrepEnd(ctx);
  ctx.recon = () => null;
  h.onPrepEnd(ctx);
  assert.deepEqual(calls, []);

  // 某一类没有已激活盟约（storyHigh 失活）→ 该类整类跳过
  bonds.storyHigh.active = false;
  ctx.recon = () => ({ assist: A_BOND });
  h.onPrepEnd(ctx);
  assert.deepEqual(calls.map((c) => c[0]), ['coreHigh', 'addonHigh'], '没有已激活盟约的一类不加层');
});

// ---------------------------------------------------------------------------------------------
// 7. 端到端：真实的销毁路径真的把 onDestroy 送到 global:recon（0.3.1 的扩宽 —— 上面 5 节是「处理器本身」）

test('装备重构走真实路径：g.destroy → EffectDispatcher.dispatchItem → global:recon 的 onDestroy', () => {
  const { m, ps } = setup();
  m.reconChoices = { p_0: { assist: A_EQUIP } };
  const item = giveItem(m, ps, EQUIP3);
  assert.equal(ps.find(item.uid).area, 'hand', '起点：一件 tier 3 的装备在手牌里');
  const uid = item.uid;
  assert.deepEqual(m.handle('p_0', { t: 'g.destroy', uid }), { ok: true }, 'g.destroy 走通（player/items.js destroy → dispatchItem）');

  assert.equal(ps.find(uid), null, '被销毁的那件离开了');
  assert.equal(ps.counters['recon.destroy.count'], 1, 'global:recon 在**真实路径**上收到了 onDestroy，并计了一次');
  const items = [...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'item');
  assert.ok(items.length >= 1, '补回了一件装备');
  assert.ok(items.every((p) => m.gd.item(p.id).tier >= 3), '补回来的不低于被销毁那件的阶级');
  m.dispose();
});
