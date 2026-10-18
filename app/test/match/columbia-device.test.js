// 哥伦比亚 mod 的源石辅助仪（workshop/columbia 的 Layer-B 载荷：`server.meta` 休整期处理器 + `server.battle`）：
//   * 装备格加成由 shared/equipSlots.js 提供（test/match/equipCapacity.test.js）；
//   * <进入休整期时> 把携带者其余装备的数值汇总吸收到携带者身上并销毁它们（可叠加）；
//   * 被销毁的装备在搭配变形同构体时授予的盟约一并继承（`piece.meta.data.bondGrants`）。
// 这里在真实 Match（合并了 workshop/columbia 的数据 + 真实 meta 注册表）上跑休整期派发。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from '../../server/data.js';
import { makeMatch, give, giveItem, legalTileFor } from './harness.js';
import { packLayer } from '../helpers/packLayer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const quiet = { info() {}, warn() {}, error() {}, debug() {}, log() {} };
const MERGED = loadData(join(ROOT, 'data'), { log: quiet, workshopDir: join(ROOT, 'workshop') });
// 哥伦比亚包声明的休整期处理器（server.meta）——包的行为只在房间装配里生效，测试按同一条路装一遍。
const LAYER = await packLayer({ ids: ['columbia'], log: quiet });

const DEVICE = 'chess_item_6_13_e_a'; // 源石辅助仪（T6）
const ISO = 'chess_item_6_09_e_a'; // 变形同构体（canGiveBond）
const PROJ = 'chess_item_5_06_e_a'; // 博士投影（晋升装备 `equip_round_start_upgrade_char`）
const FELLOW = 'chess_item_4_13_e_a'; // 同行者（giveBondId columbiaShip）
const GOLD = MERGED.items[DEVICE].goldenId; // 进阶源石辅助仪（对照组也带一件装置时用它，避免两件基础件又合成进阶）

const outsider = Object.values(MERGED.chess).find((c) => c.visible && !c.isGolden && c.tier <= 2
  && !c.bonds.includes('columbiaShip') && !c.bonds.includes('maniShip')).chessId;
/** 与 `outsider` 不同的另一名同款普通干员（对照组的携带者用）。 */
const outsider2 = Object.values(MERGED.chess).find((c) => c.visible && !c.isGolden && c.tier <= 2
  && !c.bonds.includes('columbiaShip') && !c.bonds.includes('maniShip') && c.chessId !== outsider).chessId;

/** 普通、无盟约授予的装备（塞满携带者、逼出「替换」路径用；排除带 slot_cap 的源石辅助仪本身）。 */
const FILLERS = Object.values(MERGED.items)
  .filter((r) => r && r.itemType === 'EQUIP' && !r.isGolden && r.id === r.baseId && r.kind === 'passive'
    && !r.canGiveBond && !r.giveBondId && !(r.params && r.params.slot_cap))
  .map((r) => r.id);

/** PREP R1 of a real match on the merged data, the player's pieces cleared. `loadout` (optional) is the seat's
 * 干员调配 (DESIGN §16), keyed by the chess's base id. */
function prep(seed = 41, loadout = null) {
  const seats = loadout ? [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, loadout }] : undefined;
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', humans: 1, seed, fake: true, data: MERGED, seats, registry: LAYER.registry }).start();
  h.toPrep(1);
  for (const ps of h.m.players.values()) {
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
    ps.funds = 50; ps.bandId = null;
    ps.recompute();
  }
  return h;
}
const equip = (h, pid, p, id) => h.m.handle(pid, { t: 'g.equip', itemUid: giveItem(h.m, h.ps(pid), id).uid, targetUid: p.uid });
const roundStart = (h, pid) => h.m.dispatcher.dispatch(h.ps(pid), 'onRoundStart', {});

test('源石辅助仪 absorbs and destroys the carrier’s other equipment at the round start', () => {
  const h = prep(); const { m } = h; const ps = h.ps('p_0');
  const p = give(m, ps, outsider, 'hand');
  for (const id of [DEVICE, ISO, FELLOW]) assert.deepEqual(equip(h, 'p_0', p, id), { ok: true });
  assert.equal(p.items.length, 3, 'the device raises the cap, so all three fit');
  roundStart(h, 'p_0');
  // 变形同构体 (canGiveBond) 不吸收、不销毁：只有 同行者 被吸收（items.json 的「不会继承和消耗变形同构体」）
  assert.equal(p.items.length, 2, 'the 同行者 is destroyed; the 变形同构体 stays');
  assert.deepEqual(p.items.map((it) => it.id).sort(), [DEVICE, ISO].sort());
  const data = p.meta.data;
  assert.ok(data && data.columbia, 'the absorbed numbers are stored on the carrier');
  assert.equal(data.columbia.count, 1);
  assert.ok(Math.abs(data.columbia.mods.defIgnorePct - 0.1) < 1e-9, '同行者 def_penetrate 0.1 absorbed');
  assert.ok(Math.abs(data.columbia.mods.resIgnorePct - 0.1) < 1e-9, '同行者 magic_resist_penetrate 0.1 absorbed');
  // 已继承的装备 id（详情卡「已继承的装备」那一段读的就是它）
  assert.deepEqual(data.columbia.items, [FELLOW]);
  assert.deepEqual(data.bondGrants, ['columbiaShip'], 'the 同行者 × 变形同构体 grant is inherited');
  h.invariants();
});

test('the inherited grant keeps the carrier a 【哥伦比亚】 member after the destroyed equipment is gone', () => {
  const h = prep(43); const { m } = h; const ps = h.ps('p_0');
  const p = give(m, ps, outsider, 'hand');
  for (const id of [DEVICE, ISO, FELLOW]) assert.deepEqual(equip(h, 'p_0', p, id), { ok: true });
  const at = legalTileFor(m, ps, outsider);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: p.uid, to: { area: 'board', row: at[0], col: at[1] } }), { ok: true });
  assert.equal(ps.bonds.columbiaShip.count, 1, 'before the absorb: counted through the 变形同构体 pairing');
  roundStart(h, 'p_0');
  assert.equal(p.items.length, 2, '同行者 destroyed, 变形同构体 kept');
  assert.equal(ps.bonds.columbiaShip.count, 1, 'after the absorb: still counted, now through the inherited grant');
  h.invariants();
});

test('the absorb accumulates across preps — one entry per absorbed copy, numbers added', () => {
  const h = prep(47); const { m } = h; const ps = h.ps('p_0');
  const p = give(m, ps, outsider, 'hand');
  assert.deepEqual(equip(h, 'p_0', p, DEVICE), { ok: true });
  for (const _ of [1, 2]) {
    // 上一份已被销毁 ⇒ `completesItemMerge` 不再触发，同一 id 可以再装一次（第二件会被吸收，不会与第一件合成）
    assert.deepEqual(equip(h, 'p_0', p, FELLOW), { ok: true });
    roundStart(h, 'p_0');
  }
  const data = p.meta.data;
  assert.equal(data.columbia.count, 2, 'two copies absorbed');
  assert.deepEqual(data.columbia.items, [FELLOW, FELLOW], '件数保留（不去重）：详情卡按名字合并时靠它把两份数值加对');
  assert.ok(Math.abs(data.columbia.mods.defIgnorePct - 0.2) < 1e-9, '0.1 + 0.1 — 吸收跨休整期累加，无上限');
  assert.ok(Math.abs(data.columbia.mods.resIgnorePct - 0.2) < 1e-9);
  h.invariants();
});

test('源石辅助仪被替换/取下后，携带者已继承的数值与盟约授予一并清除', () => {
  const h = prep(55); const { m } = h; const ps = h.ps('p_0');
  const p = give(m, ps, outsider, 'hand');
  for (const id of [DEVICE, ISO, FELLOW]) assert.deepEqual(equip(h, 'p_0', p, id), { ok: true });
  roundStart(h, 'p_0');
  assert.ok(p.meta.data.columbia && p.meta.data.bondGrants, '先吸收 + 继承变形同构体授予');
  assert.ok(FILLERS.length >= 3, 'data has plain filler equipment');
  // 把携带者装到上限（2 件 + 源石辅助仪的 slot_cap 2 = 4 格），再装第 5 件并指定替换源石辅助仪 —— 引擎会销毁它并派发 onDestroy
  for (const id of FILLERS.slice(0, 2)) assert.deepEqual(equip(h, 'p_0', p, id), { ok: true });
  const dev = p.items.find((it) => it.id === DEVICE);
  assert.ok(dev, 'device still equipped before the replace');
  const extra = giveItem(m, ps, FILLERS[2]);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: extra.uid, targetUid: p.uid, replaceUid: dev.uid }), { ok: true });
  assert.ok(!p.items.some((it) => it.id === DEVICE), 'device gone');
  assert.ok(!p.meta.data.columbia, 'inherited numbers cleared when the device leaves the carrier');
  assert.ok(!p.meta.data.bondGrants, 'inherited bond grant cleared too');
  h.invariants();
});

test('源石辅助仪：2 件基础合成进阶，携带者已继承的数值/效果保留', () => {
  const h = prep(57); const { m } = h; const ps = h.ps('p_0');
  const p = give(m, ps, outsider, 'hand');
  for (const id of [DEVICE, ISO, FELLOW]) assert.deepEqual(equip(h, 'p_0', p, id), { ok: true });
  roundStart(h, 'p_0');
  const before = JSON.parse(JSON.stringify(p.meta.data.columbia));
  assert.ok(before && p.meta.data.bondGrants, 'absorbed before the merge');
  // 第二件基础源石辅助仪：装上时与已装备的那件合成进阶装备（`_mergeItem` 只 _detach，不派发 onDestroy）
  assert.deepEqual(equip(h, 'p_0', p, DEVICE), { ok: true });
  const golden = MERGED.items[DEVICE].goldenId;
  assert.ok([...ps.hand, ...ps.temp].some((x) => x && x.id === golden), '两个基础合成了一件进阶装备');
  assert.ok(!p.items.some((it) => it.id === DEVICE), 'base device consumed by the merge');
  assert.deepEqual(p.meta.data.columbia, before, 'inherited numbers survive the merge');
  assert.deepEqual(p.meta.data.bondGrants, ['columbiaShip'], 'inherited bond grant survives the merge');
  h.invariants();
});

test('娜斯提的手牌召唤物跟随所选技能：S1/S2/S3 → 质检专员/监工专员/应急承重小组', () => {
  const cases = [[0, 'token_10059_nasti_nstdef'], [1, 'token_10060_nasti_nstchr'], [2, 'token_10061_nasti_nstbld']];
  for (const [skill, tok] of cases) {
    const h = prep(60 + skill, { chess_ws_col_nasti_a: { skill, module: 'none' } });
    const { m } = h; const ps = h.ps('p_0');
    assert.equal(ps.loadoutFor(m.gd.chess('chess_ws_col_nasti_a')).skillIndex, skill, `loadout S${skill + 1} applied`);
    const p = give(m, ps, 'chess_ws_col_nasti_a', 'hand');
    const at = legalTileFor(m, ps, 'chess_ws_col_nasti_a');
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: p.uid, to: { area: 'board', row: at[0], col: at[1] } }), { ok: true });
    const hand = [...ps.hand, ...ps.temp].filter((x) => x && x.kind === 'token').map((x) => x.id);
    assert.deepEqual(hand, [tok], `S${skill + 1} sends its own device`);
    h.invariants();
  }
});

/** 【哥伦比亚】的可见普通干员（board 计数的成员）。 */
const COLUMBIA = Object.values(MERGED.chess)
  .filter((c) => c.visible && !c.isGolden && !c.isDiy && Array.isArray(c.bonds) && c.bonds.includes('columbiaShip'))
  .map((c) => c.chessId);

test('【哥伦比亚】3 人档发 1 件源石辅助仪，再从 3 人加到 6 人档再发 1 件（onBondChange，不是 onBondActivate）', () => {
  const h = prep(61); const { m } = h; const ps = h.ps('p_0');
  assert.ok(COLUMBIA.length >= 6, 'data has at least 6 【哥伦比亚】 chess');
  const place = (id) => {
    const p = give(m, ps, id, 'hand');
    const at = legalTileFor(m, ps, id);
    assert.ok(at, `a legal tile for ${id}`);
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: p.uid, to: { area: 'board', row: at[0], col: at[1] } }), { ok: true });
  };
  for (const id of COLUMBIA.slice(0, 3)) place(id);
  assert.equal(ps.bonds.columbiaShip.tier, 1, '3 members → tier 1');
  assert.equal(ps.counters['columbia:three'], 1, 'the 3-person device is granted');
  assert.ok(!ps.counters['columbia:six'], 'no 6-person grant yet');
  for (const id of COLUMBIA.slice(3, 6)) place(id);
  assert.equal(ps.bonds.columbiaShip.tier, 2, '6 members → tier 2');
  assert.equal(ps.counters['columbia:six'], 1, 'the 6-person device is granted on the tier change');
  const devices = [...ps.hand, ...ps.temp].filter((x) => x && x.kind === 'item' && x.id.startsWith('chess_item_6_13_e'));
  assert.ok(devices.length, '源石辅助仪 owned (base or 进阶)');
  h.invariants();
});

test('源石辅助仪：携带者被出售后效果随装备保留，装到新干员身上即恢复', () => {
  const h = prep(65); const { m } = h; const ps = h.ps('p_0');
  const p = give(m, ps, outsider, 'hand');
  assert.deepEqual(equip(h, 'p_0', p, DEVICE), { ok: true });
  assert.deepEqual(equip(h, 'p_0', p, FELLOW), { ok: true });
  roundStart(h, 'p_0'); // 吸收 同行者
  const dev = p.items.find((it) => it.id === DEVICE);
  const rec = JSON.parse(JSON.stringify(dev.meta.data.columbia));
  assert.equal(rec.count, 1, 'the device itself carries the inherited record');
  assert.ok(Math.abs(rec.mods.defIgnorePct - 0.1) < 1e-9, '同行者 def_penetrate 0.1 on the device');
  // 出售该干员 —— 装备回到整备区，效果跟着装备走（而不是留在已消失的携带者身上）
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: p.uid }), { ok: true });
  const inBag = [...ps.hand, ...ps.temp].find((x) => x && x.kind === 'item' && x.id === DEVICE);
  assert.ok(inBag, 'the device is back in 整备区');
  assert.deepEqual(inBag.meta.data.columbia, rec, '继承记录随装备保留');
  // 装到另一名干员身上 → 镜像到新携带者，效果恢复
  const q = give(m, ps, outsider, 'hand');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: inBag.uid, targetUid: q.uid }), { ok: true });
  assert.equal(q.meta.data.columbia.count, 1, 'restored on the new carrier');
  assert.ok(Math.abs(q.meta.data.columbia.mods.defIgnorePct - 0.1) < 1e-9, 'the inherited numbers are back');
  h.invariants();
});

test('源石辅助仪：先吸收、后装备变形同构体 → 继承来的盟约随即生效，换掉变形同构体则失效', () => {
  const h = prep(63); const { m } = h; const ps = h.ps('p_0');
  const p = give(m, ps, outsider, 'hand');
  assert.deepEqual(equip(h, 'p_0', p, DEVICE), { ok: true });
  assert.deepEqual(equip(h, 'p_0', p, FELLOW), { ok: true });
  roundStart(h, 'p_0'); // 吸收 同行者 —— 此时身上没有变形同构体
  assert.deepEqual(p.meta.data.columbia.bondSources, ['columbiaShip'], 'the absorbed bond source is remembered');
  assert.ok(!p.meta.data.bondGrants, 'no grant while 变形同构体 is absent');
  assert.deepEqual(equip(h, 'p_0', p, ISO), { ok: true });
  assert.deepEqual(p.meta.data.bondGrants, ['columbiaShip'], '装备变形同构体后，继承来的盟约立刻生效');
  const iso = p.items.find((it) => it.id === ISO);
  p.items.splice(p.items.indexOf(iso), 1); // 与 _attach 的替换一致：先从 items 摘掉，再派发 onDestroy
  m.dispatchItem(ps, iso, p, 'onDestroy', { item: iso, holder: p, reason: 'replace' });
  assert.ok(!p.meta.data.bondGrants, '换掉变形同构体后该授予失效');
  assert.deepEqual(p.meta.data.columbia.bondSources, ['columbiaShip'], 'the remembered source stays (a re-equip turns it back on)');
  assert.deepEqual(equip(h, 'p_0', p, ISO), { ok: true });
  assert.deepEqual(p.meta.data.bondGrants, ['columbiaShip'], '再装回变形同构体 → 又生效');
  h.invariants();
});

// 博士投影（官方 `chess_item_5_06_e_a`，普通件的 `equip_round_start_upgrade_char` 会把它留到下个休整期再晋升）与
// 变形同构体同待遇：源石辅助仪「进入休整期时」既不继承它的数值、也不销毁它 —— 它留在携带者身上。
// 这里只派发**装置自己的** onRoundStart 钩子来隔离观察吸收（全量 onRoundStart 还会跑博士投影自身的延迟晋升效果，
// 把它消费掉并让携带者精锐化，见下一条测试）—— `dispatchItem` 与引擎遍历装备时是同一条调用路径。
test('源石辅助仪：进入休整期时不继承、不销毁博士投影（与变形同构体同待遇）', () => {
  const h = prep(71); const { m } = h; const ps = h.ps('p_0');
  // p：源石辅助仪 + 博士投影 + 同行者 —— 只吸收同行者，博士投影留在身上
  const p = give(m, ps, outsider, 'hand');
  for (const id of [DEVICE, PROJ, FELLOW]) assert.deepEqual(equip(h, 'p_0', p, id), { ok: true });
  // q：进阶源石辅助仪 + 变形同构体 + 件普通装备 —— 对照组，变形同构体照旧不吸收
  // （q 用进阶装置与另一件普通装备：同一玩家两件相同的基础装备会就地合成进阶装备，对照组不能与 p 撞件）
  const q = give(m, ps, outsider2, 'hand');
  for (const id of [GOLD, ISO, FILLERS[0]]) assert.deepEqual(equip(h, 'p_0', q, id), { ok: true });
  const dev = p.items.find((it) => it.id === DEVICE);
  m.dispatchItem(ps, dev, p, 'onRoundStart', {}); // 只跑装置的吸收钩子
  // 博士投影不吸收、不销毁：它留在携带者身上（items.json 的「不会继承和消耗变形同构体、博士投影」）
  assert.deepEqual(p.items.map((it) => it.id).sort(), [DEVICE, PROJ].sort(),
    '博士投影留在携带者身上，只有同行者被吸收销毁');
  assert.equal(p.meta.data.columbia.count, 1, '只吸收了同行者');
  assert.deepEqual(p.meta.data.columbia.items, [FELLOW], '已继承的装备里没有博士投影');
  assert.deepEqual(p.meta.data.columbia.bondSources, ['columbiaShip'], '同行者的盟约源照常记下（待变形同构体配对）');
  // 对照组：变形同构体照旧不吸收（同样的 <进入休整期时> 处理器）
  assert.deepEqual(q.items.map((it) => it.id).sort(), [GOLD, ISO].sort(),
    '对照组：变形同构体留在携带者身上，只有那件普通装备被吸收销毁');
  assert.equal(q.meta.data.columbia.count, 1);
  assert.deepEqual(q.meta.data.columbia.items, [FILLERS[0]]);
  h.invariants();
});

test('源石辅助仪 + 博士投影：进入休整期，装置不吃博士投影，博士投影自身的延迟晋升照常把携带者精锐化', () => {
  const h = prep(73); const { m } = h; const ps = h.ps('p_0');
  const p = give(m, ps, outsider, 'hand');
  for (const id of [DEVICE, PROJ, FELLOW]) assert.deepEqual(equip(h, 'p_0', p, id), { ok: true });
  roundStart(h, 'p_0');
  assert.ok(m.gd.isGolden(p.id), '博士投影没被装置吃掉，它的 <进入休整期时> 晋升效果把携带者精锐化');
  assert.ok(!p.items.some((it) => it.id === PROJ), '博士投影由它自己的效果消费掉，而非被装置吸收');
  const data = p.meta.data;
  assert.ok(data && data.columbia, '同行者仍被装置吸收');
  assert.equal(data.columbia.count, 1, '博士投影没有被吸收');
  assert.deepEqual(data.columbia.items, [FELLOW]);
  h.invariants();
});
