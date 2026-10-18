// test/content/avemujica_amoris.test.js — 祐天寺若麦（workshop/ave-mujica）的技能段数、每段倍率与「持续攻击」。
//
// 业主报的 bug：S2「如麦般生长」一套动作应是**八段**伤害（S1 是**三段**），实际「只有第一段」。
// 根因（复现实测）：引擎连击循环写的是 `for (let h = 0; h < hits && target.alive; h++)`（server/sim/ai.js
// resolveHit）—— 目标在**第 1 段**就被打死时整条连击立刻中断。技能黑板与生效档都正确（`prof.hits === 8`），
// 8 段只在「目标扛得住」时才全数落地 ⇒ 敌人一死就只剩第一段。
//
// 那是引擎对**所有**干员的既有语义（只给若麦翻掉 `&& target.alive` 会让黄金语料不再逐字节一致），
// 所以修在**包侧**：`kits/chess_char_5_31_a.js` 的 `attack` 用 `hits: 1` + `attack.onHit` 补完其余
// `N − 1` 段（每段重新在攻击范围内随机取一个**存活**敌人，且**每段各有自己的倍率**）⇒ 一套动作必定打满，
// 且不因目标阵亡 / 转移而重置。「持续攻击」同祥子的做法，在 `battle/main.mjs` 的盟约安装器里按 `s.interval`
// 出手（自省句柄 `battle._avemujicaAmoris`）。
//
// 每段倍率（逐段取自各技能的 `bb`；缺键回落旧的单一 `atk_scale`）：
//   S1：段 1 = `first_scale` 1.3，段 2–3 = `sub_scale` 0.2  ⇒ 合计 1.7 × atk
//   S2：段 1 **与段 5** = `main_scale` 1.0，其余 6 段 = `sub_scale` 0.1 ⇒ 合计 2.6 × atk
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch, give } from '../match/harness.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { packLayer } from '../helpers/packLayer.js';
import { loadData } from '../../server/data.js';
import { loadWorkshop, loadWorkshopKits } from '../../server/workshop.js';
import { effectiveProfile, performAttack } from '../../server/sim/ai.js';
import { COLS } from '../../server/sim/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WS_DIR = join(ROOT, 'workshop');
const QUIET = { info() {}, warn() {}, error() {}, debug() {}, log() {} };
const AMORIS = 'chess_char_5_31_a';
const S1 = 0; // 如焰般热烈（3 段）
const S2 = 1; // 如麦般生长（8 段）

let DATA = null, LAYER = null, KITS = null;
before(async () => {
  // 用**显式** workshopDir 读一份带本包 overlay 的数据；不碰进程单例（test/official-data.mjs 把它锁在官方基线）。
  DATA = loadData(undefined, { log: QUIET, workshopDir: WS_DIR });
  LAYER = await packLayer({ ids: ['ave-mujica'], log: QUIET });
  const loaded = loadWorkshop(WS_DIR, { log: QUIET });
  const res = await loadWorkshopKits(loaded, { log: QUIET, knownIds: new Set(Object.keys(DATA.chess)) });
  KITS = res.kits;
  assert.equal(res.errors.length, 0, `kit 装载错误: ${JSON.stringify(res.errors)}`);
  assert.equal(typeof KITS[AMORIS], 'function', '本包的若麦 kit 装上了');
});

/** 上一位若麦（可选 loadout 技能），返回 makeBattle harness 与那位干员。 */
function field(skillIndex) {
  const mh = makeMatch({ mode: 'solo', seed: 7, data: DATA, registry: LAYER.registry, fake: true }).start();
  const m = mh.m, ps = mh.ps('p_0');
  mh.toPrep(1); ps.shop.level = 6;
  if (skillIndex != null) ps.loadout = { [AMORIS]: { skill: skillIndex, module: null } };
  give(m, ps, AMORIS, 'board', [10, 4]);
  const input = ps.battleInput();
  const h = makeBattle({ data: DATA, players: [input], enemies: [], timeLimit: 30, autoFinish: false, kits: KITS, battleInstallers: LAYER.installers });
  mh.m.dispose?.();
  h.step(1);
  const u = h.b.allyUnits.find((x) => String(x.defId || x.def?.id).startsWith('chess_char_5_31'));
  assert.ok(u, '若麦在场');
  return { h, u };
}

const rc = (k) => [Math.floor(k / COLS), k % COLS];
/** 她当前攻击范围里除自己脚下之外的格子（[row, col]）。 */
const rangeTiles = (u) => (u.rangeKeys || []).map(rc).filter(([r, c]) => r !== u.tileR || c !== u.tileC);
/** 一个不会动、不会反击、血可调的靶子。 */
const dummy = (hp) => enemyRec({ key: 'amoris_dummy', hp, def: 0, res: 0, atk: 0, speed: 0, range: 0 });
/** 开技能 → 刷新范围 → 把一个靶子放到给定格。手动出手不在 tick 内，故自己重建一次逐格敌人索引。 */
function engage(h, u, hp, tile) {
  const e = h.b.spawnEnemy('amoris_dummy', { pos: tile, def: dummy(hp) });
  h.b._buildEnemyIndex();
  return e;
}
/** 记下打在 `e` 身上的每一段（按发生顺序），返回那个数组。 */
const watch = (h, e) => {
  const hits = [];
  h.b.on('damaged', (c) => { if (c.target === e) hits.push(c.amount); }, { priority: -500 });
  return hits;
};
/** 每段伤害 = atk × 该段倍率 × 单位的 atkScaleMul。 */
const segAtk = (u) => u.s.atk * u.s.atkScaleMul;
const closeTo = (a, b, msg, eps = 0.02) => assert.ok(Math.abs(a - b) <= eps * Math.abs(b), `${msg}（实测 ${a}，期望 ≈${b}）`);

test('S2「如麦般生长」：8 段，段 1 与段 5 = 100%、其余 6 段 = 10%（合计 ≈ 2.6× atk）', () => {
  const { h, u } = field(S2);
  u.skill.activate('test', { free: true });
  h.step(1);
  const prof = effectiveProfile(u);
  assert.ok(prof.isSkill, '技能生效，走的是技能档');
  assert.equal(prof.hits, 1, `引擎那一击只算第 1 段（prof.hits=${prof.hits}，其余由 kit 的 onHit 补）`);
  const t = rangeTiles(u);
  assert.ok(t.length >= 1, `S2 范围扩大后至少 1 个可选格（${JSON.stringify(t)}）`);
  const atk = segAtk(u);
  assert.ok(Math.abs(prof.atkScale - 1) < 1e-9, `段 1 的倍率 = main_scale 1.0（prof.atkScale=${prof.atkScale}）`);
  const e = engage(h, u, 1e9, t[0]);
  const hits = watch(h, e);
  performAttack(h.b, u, prof, [e]);
  assert.equal(hits.length, 8, `一套动作 8 段，实测 ${hits.length}`);
  closeTo(hits[0], atk * 1.0, '段 1 = 100%');
  closeTo(hits[4], atk * 1.0, '段 5 = 100%（其余 10% 那几段里唯一的大段）');
  assert.equal(hits.filter((x) => Math.abs(x - atk) <= 0.02 * atk).length, 2, '「100% 段」恰好 2 段');
  assert.equal(hits.filter((x) => Math.abs(x - atk * 0.1) <= 0.02 * atk).length, 6, '「10% 段」恰好 6 段');
  closeTo(hits.reduce((a, b) => a + b, 0), atk * 2.6, '合计 = 1 + 6×0.1 + 1 = 2.6 × atk');
  assert.ok(e.alive, '靶子扛得住（1e9）⇒ 8 段全落在它身上（单目标无溅射）');
  h.invariants();
});

test('S1「如焰般热烈」：3 段，段 1 = 130%、段 2–3 = 20%（合计 ≈ 1.7× atk）', () => {
  const { h, u } = field(S1);
  u.skill.activate('test', { free: true });
  h.step(1);
  const prof = effectiveProfile(u);
  const t = rangeTiles(u);
  const atk = segAtk(u);
  assert.ok(Math.abs(prof.atkScale - 1.3) < 1e-9, `段 1 = first_scale 1.3（prof.atkScale=${prof.atkScale}）`);
  const e = engage(h, u, 1e9, t[0]);
  const hits = watch(h, e);
  performAttack(h.b, u, prof, [e]);
  assert.equal(hits.length, 3, `一套动作 3 段，实测 ${hits.length}`);
  closeTo(hits[0], atk * 1.3, '段 1 = 130%');
  closeTo(hits[1], atk * 0.2, '段 2 = 20%');
  closeTo(hits[2], atk * 0.2, '段 3 = 20%');
  closeTo(hits.reduce((a, b) => a + b, 0), atk * 1.7, '合计 = 1.3 + 2×0.2 = 1.7 × atk');
  h.invariants();
});

test('目标在连击途中阵亡 / 目标转移 ⇒ 8 段照样打完，不腰斩、不重置', () => {
  const { h, u } = field(S2);
  u.skill.activate('test', { free: true });
  h.step(1);
  const prof = effectiveProfile(u);
  const t = rangeTiles(u);
  assert.ok(t.length >= 2, `S2 范围扩大后至少 2 个可选格（${JSON.stringify(t)}）`);
  const main = engage(h, u, 120, t[0]); // 120 血：第 1 段（100%）必死
  const other = engage(h, u, 1e9, t[1]);
  const n1 = watch(h, main), n2 = watch(h, other);
  performAttack(h.b, u, prof, [main]);
  assert.equal(n1.length, 1, `主目标只挨到第 1 段就阵亡（实测 ${n1.length}）`);
  assert.equal(main.alive, false, '主目标已阵亡');
  // 其余 7 段每一段都「重新在范围内随机取一个存活敌人」⇒ 全落到另一个敌人身上
  assert.ok(n2.length >= 7, `其余 7 段落到范围内另一个敌人身上（实测 ${n2.length}，含锤溅射）`);
  h.invariants();
});

// =====================================================================================================================
// §7.20 颂乐音符的索敌：「被任意【颂乐人偶】成员阻挡的敌人」也是候选人（2026-10-18）
//
// 业主：「被其他 ave mujica 成员阻挡的目标也会成为丰川祥子射出音符的索敌目标。」「其他成员」按**超集**理解
// （含祥子自己）。改动在 `battle/main.mjs` 的 `nearestEnemy`：候选池 = **半径内**的敌人 **或** **被任意成员阻挡**的
// 敌人（`e.blockedBy` = 引擎记的阻挡者，`roleOf` 判成员）⇒ 被成员阻挡的敌人**不必在音符半径内**也会被锁定。
// 下面两条钉住：非祥子成员阻挡的敌人**会被**音符锁上；被**非** aveMujica 单位阻挡的敌人**不会**因这条新规则被锁。
const OBLIVIONIS = 'chess_char_6_30_a'; // 丰川祥子（音符的演奏者）
const MORTIS = 'chess_char_5_25_a';     // 若叶睦：一名**非祥子**的【颂乐人偶】成员（阻挡数 2）
const TANK = 'chess_char_1_02_a';       // 官方重装（**非** aveMujica 单位，阻挡数 3）—— 对照组

/** 上场：祥子（行 10 的路上）+ 一名阻挡者（行 9 的路上）。返回 harness 与两者。 */
function fieldNotes(blocker) {
  const mh = makeMatch({ mode: 'solo', seed: 7, data: DATA, registry: LAYER.registry, fake: true }).start();
  const m = mh.m, ps = mh.ps('p_0');
  mh.toPrep(1); ps.shop.level = 6;
  give(m, ps, OBLIVIONIS, 'board', [10, 4]);
  give(m, ps, blocker, 'board', [9, 9]);
  const input = ps.battleInput();
  const h = makeBattle({ data: DATA, players: [input], enemies: [], timeLimit: 30, autoFinish: false, kits: KITS, battleInstallers: LAYER.installers });
  mh.m.dispose?.();
  h.step(1);
  const find = (id) => h.b.allyUnits.find((x) => String(x.defId || x.def?.id).startsWith(id.replace(/_[ab]$/, '')));
  const ob = find(OBLIVIONIS), blk = find(blocker);
  assert.ok(ob, '丰川祥子在场');
  assert.ok(blk, '阻挡者在场');
  return { h, ob, blk };
}

/** 一个会走动、打不动人（atk 0）也打不死（1e9 血）的靶子。 */
const walker = (hp) => enemyRec({ key: 'note_target_dummy', hp, def: 0, res: 0, atk: 0, speed: 1, range: 0 });
/** 在阻挡者身旁（格内的接触半径 0.7071 内）生一个靶子 ⇒ 引擎下一 tick 就把它记成 `e.blockedBy`（不用等它走到）。 */
function spawnBlocked(h) {
  const e = h.b.spawnEnemy('note_target_dummy', { pos: [9, 9.4], def: walker(1e9) });
  h.b._buildEnemyIndex();
  assert.ok(e, '靶子生成成功');
  h.step(1);
  return e;
}
/** 音符表里**第一个**盯住 `e` 的音符（没有 ⇒ undefined）。 */
const noteOn = (h, e) => h.b._avemujicaNotes.list.find((n) => n.target === e);

test('§7.20 索敌：被**非祥子**成员阻挡的敌人 ⇒ 成为丰川祥子音符的追踪目标', () => {
  const { h, blk } = fieldNotes(MORTIS);
  const e = spawnBlocked(h);
  assert.equal(e.blockedBy, blk, '引擎把敌人记成被若叶睦阻挡（`e.blockedBy`）');
  assert.ok(!h.b.enemies.some((x) => x !== e && x.alive), '场上只有这个靶子 ⇒ 只能靠新规则锁它');
  const ok = h.runUntil(() => !!noteOn(h, e), 4);
  assert.ok(ok, '音符锁定了被【颂乐人偶】成员阻挡的敌人');
  const n = noteOn(h, e);
  // 该靶子在音符**半径之外**（音符半径 1.0）⇒ 锁上它只可能来自新规则，而不是原来的「半径内最近」
  assert.ok(Math.hypot(n.x - e.x, n.y - e.y) > 1.0, `锁定时音符与目标相距 > 1.0（实测 ${Math.hypot(n.x - e.x, n.y - e.y).toFixed(2)}）`);
  h.invariants();
});

test('§7.20 对照组：被**非** aveMujica 单位阻挡的敌人，音符不因新规则锁它', () => {
  const { h, blk } = fieldNotes(TANK);
  const e = spawnBlocked(h);
  assert.equal(e.blockedBy, blk, '引擎把敌人记成被官方重装阻挡（非成员）');
  let acquired = false;
  for (let i = 0; i < 150 && !acquired; i++) {   // 5 s：如新规则误把非成员阻挡也算进去，这段时间足够锁上
    h.step(1);
    acquired = !!noteOn(h, e);
  }
  assert.equal(acquired, false, '音符从未锁定该敌人（它既不在半径内，也不是被成员阻挡）');
  h.invariants();
});

test('「持续攻击」：攻击范围内没有敌人，也按自身攻击间隔持续出手', () => {
  const { h, u } = field(S1);
  const st = h.b._avemujicaAmoris;
  assert.ok(st, '盟约安装器挂出了自省句柄 battle._avemujicaAmoris');
  assert.equal(h.b.enemies.length, 0, '场上没有敌人');
  const actions0 = st.actions, sp0 = u.skill.sp;
  h.step(120); // 4 s（她的攻击间隔 ≈ 1.8 s）⇒ 至少 2 次出手
  assert.ok(st.actions >= actions0 + 2, `无敌人也持续出手（actions ${actions0} → ${st.actions}）`);
  assert.ok(u.skill.sp > sp0, `无目标那一路补了攻击技力（sp ${sp0} → ${u.skill.sp}）`);
  h.invariants();
});
