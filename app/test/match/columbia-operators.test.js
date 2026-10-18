// 哥伦比亚 mod 新增的【哥伦比亚】盟约干员（workshop/columbia/chess.json + garrisons.json，
// 包的 Layer-B 载荷 `server.meta` / `server.battle`）：在真实 Match（合并数据 + 真实 meta 注册表）上跑特质。
// 覆盖休整期类特质：娜斯提 <获得时>得装备 / 涤火杰西卡 <休整期结束时>按装备加层 / 霍尔海雅 获得装备时额外获得 1 件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { makeMatch, give, giveItem, legalTileFor } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { packLayer } from '../helpers/packLayer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const quiet = { info() {}, warn() {}, error() {}, debug() {}, log() {} };
const MERGED = loadData(join(ROOT, 'data'), { log: quiet, workshopDir: join(ROOT, 'workshop') });
// 哥伦比亚包声明的 Layer-B 载荷（server.meta + server.battle）——包的行为只在房间装配里生效，测试按同一条路装一遍。
const LAYER = await packLayer({ ids: ['columbia'], log: quiet });

const APHRIS = 'chess_ws_col_aphris_a';
const NASTI = 'chess_ws_col_nasti_a';
const JESCA = 'chess_ws_col_jesca_a';
const HEYAK = 'chess_ws_col_heyak_a';
const HAMMER = 'chess_item_1_01_e_a';

function prep(seed = 61) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', humans: 1, seed, fake: true, data: MERGED, registry: LAYER.registry }).start();
  h.toPrep(1);
  for (const ps of h.m.players.values()) {
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
    ps.funds = 50; ps.bandId = null;
    ps.recompute();
  }
  return h;
}
const place = (h, pid, chessId, skip = new Set()) => {
  const p = give(h.m, h.ps(pid), chessId, 'hand');
  const at = legalTileFor(h.m, h.ps(pid), chessId, skip);
  assert.deepEqual(h.m.handle(pid, { t: 'g.move', uid: p.uid, to: { area: 'board', row: at[0], col: at[1] } }), { ok: true });
  return { p, at };
};
const equip = (h, pid, p, id) => h.m.handle(pid, { t: 'g.equip', itemUid: giveItem(h.m, h.ps(pid), id).uid, targetUid: p.uid });
const handItemCount = (ps) => ps.hand.filter((p) => p && p.kind === 'item').length;

test('娜斯提 <获得时> gains a random item of the 调度中心 tier', () => {
  const h = prep(62); const { m } = h; const ps = h.ps('p_0');
  ps.shop.level = 3;
  const before = handItemCount(ps);
  const p = give(m, ps, NASTI, 'hand');
  m.dispatcher.dispatch(ps, 'onGain', { piece: p });
  assert.equal(handItemCount(ps), before + 1, 'one item gained');
  h.invariants();
});

test('涤火杰西卡 <休整期结束时> adds 3 【哥伦比亚】 layers per carried item', () => {
  const h = prep(63); const { m } = h; const ps = h.ps('p_0');
  place(h, 'p_0', APHRIS); place(h, 'p_0', NASTI);
  const { p } = place(h, 'p_0', JESCA);
  for (const id of [HAMMER, 'chess_item_1_02_e_a']) assert.deepEqual(equip(h, 'p_0', p, id), { ok: true });
  assert.equal(p.items.length, 2);
  assert.equal(ps.bonds.columbiaShip.active, true, '3 members → the bond is active');
  const before = ps.bonds.columbiaShip.layers;
  m.dispatcher.dispatch(ps, 'onPrepEnd', {});
  assert.equal(ps.bonds.columbiaShip.layers, before + 6, '2 items × 3 layers');
  h.invariants();
});

test('霍尔海雅 获得装备时 gains one extra item of tier ≤ the gained item (once per round)', () => {
  const h = prep(64); const { m } = h; const ps = h.ps('p_0');
  place(h, 'p_0', HEYAK);
  const before = handItemCount(ps);
  // SERVER_GAIN_ITEM / onGainItem：装备本身不是棋子，派发时按携带者（霍尔海雅）逐个跑特质
  m.dispatcher.dispatch(ps, 'onGainItem', { piece: { kind: 'item', id: HAMMER }, kind: 'item', source: 'test' });
  assert.equal(handItemCount(ps), before + 1, 'one extra item of tier ≤ the gained item');
  // 「每回合 1 次」：同回合再获得装备不再发
  m.dispatcher.dispatch(ps, 'onGainItem', { piece: { kind: 'item', id: HAMMER }, kind: 'item', source: 'test' });
  assert.equal(handItemCount(ps), before + 1, 'once per round only');
  h.invariants();
});

test('策略【混沌本质】 盟约层每叠加 50 层 gain 1 沙盘·α 和 1 沙盘·β（可重复触发）', () => {
  const h = prep(66); const { m } = h; const ps = h.ps('p_0');
  place(h, 'p_0', APHRIS); place(h, 'p_0', NASTI); place(h, 'p_0', JESCA);
  ps.bandId = 'band_columbia';
  ps.recompute();
  assert.equal(ps.bonds.columbiaShip.active, true, '3 members → the bond is active');
  const before = handItemCount(ps);
  // onLayers 由 ps.addLayers 派发（{from, to}）：跨过 50 的里程碑 ⇒ 各发 1 件 α / β（再跨 1 个里程碑会再各发 1 件，
  // 两份同名随后自动合成进阶 —— 「可重复触发」）。
  ps.addLayers('columbiaShip', 50, { requireActive: true, reason: 'test' });
  assert.equal(handItemCount(ps), before + 2, 'one 50-layer milestone → α + β');
  const ids = ps.hand.filter((x) => x && x.kind === 'item').map((x) => x.id);
  assert.ok(ids.includes('chess_item_3_13_e_a') && ids.includes('chess_item_3_14_e_a'), 'both 沙盘·α / β granted');
  h.invariants();
});

test('卡夫卡 <战斗中> no redeploy ⇒ the next prep gains one item from the battle→prep mark', () => {
  const h = prep(65); const { m } = h; const ps = h.ps('p_0');
  place(h, 'p_0', KAFKA);
  ps.marks = { equipTier: 1 }; // 战斗侧 setBattleMark('equipTier', …) 写 → _finishCombat 收进 ps.marks
  const before = handItemCount(ps);
  m.dispatcher.dispatch(ps, 'onRoundStart', {});
  assert.equal(handItemCount(ps), before + 1, 'one item gained');
  // 标记每场战斗结束**整体替换**：没有标记的那一次休整期不再发放
  ps.marks = null;
  m.dispatcher.dispatch(ps, 'onRoundStart', {});
  assert.equal(handItemCount(ps), before + 1, 'no mark ⇒ no further grant');
  h.invariants();
});

// ---------------------------------------------------------------------------------------------------------------------
// 战斗侧特质（IN_BATTLE）：makeBattle 在合并数据（含 workshop/columbia）上跑真实战斗。

const ASTER = 'chess_ws_col_astesia_a';
const CUTTER = 'chess_ws_col_cutter_a';
const KAFKA = 'chess_ws_col_kafka_a';
const ENEMY = 'enemy_1000_gopro_2';
const bondLayersOf = (h, bond) => h.b.getPlayer('p1').bonds[bond]?.layers ?? 0;
const fight = (units, opts = {}) => {
  const { flags, ...rest } = opts;
  return makeBattle({
    data: MERGED, units, enemies: [{ key: ENEMY, time: 0, route: 0 }], seed: 7,
    battleInstallers: LAYER.installers,
    ...rest, flags: { layerGainsEnabled: true, ...flags },
  });
};

test('刻刀 <战斗开始时> adds a layer to each of its own bonds without activation', () => {
  const h = fight([{ chessId: CUTTER, row: 10, col: 5 }], {
    bonds: {
      columbiaShip: { count: 1, active: false, tier: 0, layers: 0 },
      swiftShip: { count: 1, active: false, tier: 0, layers: 0 },
    },
  });
  h.runUntil((b) => b.time > 0.2);
  assert.equal(bondLayersOf(h, 'columbiaShip'), 1, '【哥伦比亚】+1（无需激活）');
  assert.equal(bondLayersOf(h, 'swiftShip'), 1, '【迅捷】+1（无需激活）');
  h.invariants();
});

test('星极 <战斗开始时> shields itself and the surrounding operators, scaled by 【哥伦比亚】 layers', () => {
  const h = fight([{ chessId: ASTER, row: 10, col: 5 }, { chessId: CUTTER, row: 10, col: 6 }], {
    bonds: { columbiaShip: { count: 1, active: true, tier: 1, layers: 40 } },
  });
  h.runUntil((b) => b.time > 0.2);
  const shieldOf = (chessId) => {
    const u = h.unit(chessId);
    const bf = u && u.findBuff('gar:garrison_col_astesia_a:shield');
    return bf ? bf.shieldHits : 0;
  };
  assert.equal(shieldOf(ASTER), 3, '1 base + floor(40 / 20)');
  assert.equal(shieldOf(CUTTER), 3, 'the neighbouring operator gets the same shield');
  h.invariants();
});

test('卡夫卡 <部署时> gains a 【哥伦比亚】 layer and marks the battle for the next prep', () => {
  const h = fight([{ chessId: KAFKA, row: 10, col: 5 }], {
    bonds: { columbiaShip: { count: 1, active: true, tier: 1, layers: 0 } },
  });
  h.runUntil((b) => b.time > 0.2);
  assert.equal(bondLayersOf(h, 'columbiaShip'), 2, '<部署时>+2');
  h.runToEnd();
  assert.equal(h.b._perPlayer['p1'].marks.equipTier, 1, 'no redeploy → the tier reaches the next prep');
  h.invariants();
});

test('谬因 <战斗中> boosts the carried equipment numbers by the 【哥伦比亚】 layers', () => {
  const h = fight([{ chessId: APHRIS, items: [HAMMER], row: 10, col: 5 }], {
    bonds: { columbiaShip: { count: 1, active: true, tier: 1, layers: 20 } },
  });
  h.runUntil((b) => b.time > 0.2);
  const u = h.unit(APHRIS);
  const bf = u && u.findBuff('gar:garrison_col_aphris_a');
  assert.ok(bf, 'the equipment bonus buff is applied');
  assert.ok((bf.mods.atkPct ?? 0) > 0 || (bf.mods.atkMul ?? 0) > 1, 'a positive atk bonus from the carried equipment');
  assert.equal(bf.mods.aspd ?? 0, 5, 'attack speed +5 (1 carried item × 5%)');
  h.invariants();
});
