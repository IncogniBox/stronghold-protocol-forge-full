// test/match/recon-trials.test.js — 重构模拟的「试炼首领」（第 4 / 8 回合的·重构首领候选与出怪）。
//
// 覆盖四处：
//   1. 候选表 `RECON_TRIAL_BOSSES`（shared/reconModes.js）：`{ 回合 → 候选 choice[] }`，每条 `{ id, keys }`。
//      第 4 回合五条**单选**（id = 它唯一的 key，与从前逐字相同）；第 8 回合五条，其中第 3 条**含两只**
//      （梅菲斯特·重构 + 浮士德·重构 —— 业主确认它们算**一次**选择）；12 / 16 故意留空（默认随机）。
//   2. 解析器 `Match.reconTrialBossFor`（server/match/match/reconTrials.js）：座位序里第一个合法选择赢（返回候选的 id）；
//      非法 / 缺席 ⇒ 从**独占**种子流 `deriveSeed(seed, 'recon-trial')` 抽一条（幂等）；没有候选的回合 / 非重构对局 ⇒ null。
//   3. 追加出怪表：R4 选一条单选 ⇒ 恰好 1 条；R8 选那对 ⇒ **每个 key 各一条**（2 条，同一 time / routeIndex）；预览与战场同一份列表。
//   4. 非重构对局：`reconTrialSpawns` 连这个键都不写（官方对局逐字节不变）。
//
// ⚠️ 十一个·重构 key 只在工坊包 workshop/mode-recon 里。测试套件把进程数据单例钉在**官方基线**（test/official-data.mjs），
// 所以这里自己用 `loadWorkshop` + `applyWorkshop` 先把那个包并进一份这一局用的 data（`applyWorkshop` 是纯的，不动单例）。
//
// 跑法：node --test --import ./test/official-data.mjs test/match/recon-trials.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, makeMatch } from './harness.js';
import { loadWorkshop } from '../../server/workshop.js';
import { applyWorkshop } from '../../shared/workshop.js';
import { RECON_TRIAL_BOSSES } from '../../shared/reconModes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };

// 第 4 回合
const SKULSR = 'enemy_ws_recon_skulsr';
const LSLIME = 'enemy_ws_recon_lslime';
const CQBW = 'enemy_ws_recon_cqbw';
const MDROCK = 'enemy_ws_recon_mdrock';
const DEMONK = 'enemy_ws_recon_demonk';
// 第 8 回合
const BIGADAM = 'enemy_ws_recon_bigadam';
const XI = 'enemy_ws_recon_xi';
const JAKILL = 'enemy_ws_recon_jakill';
const BLKSWB = 'enemy_ws_recon_blkswb';
// 第 12 回合
const REID = 'enemy_ws_recon_reid';

const R4 = RECON_TRIAL_BOSSES[4];
const R8 = RECON_TRIAL_BOSSES[8];
const R12 = RECON_TRIAL_BOSSES[12];
const R16 = RECON_TRIAL_BOSSES[16];
const R20 = RECON_TRIAL_BOSSES[20];

/** 这一局用的游戏数据：官方基线 + 只并进 workshop/mode-recon 一个包（·重构首领只在这个包里）。 */
function reconData() {
  if (DATA.enemies && DATA.enemies[MDROCK]) return DATA; // 基线里已经有（没钉官方基线的跑法）⇒ 直接用
  const packs = loadWorkshop(path.join(ROOT, 'workshop'), { log: QUIET }).packs.filter((p) => p.id === 'mode-recon');
  assert.ok(packs.length, 'workshop/mode-recon 必须在仓库里');
  return applyWorkshop(DATA, packs).data;
}
const RECON_DATA = reconData();

/** 一局重构模拟：room mode 'recon' ⇒ modeId 'mode_recon_normal'（模式本体由 shared/reconModes.js 运行时合成）。 */
function reconMatch(o = {}) {
  return makeMatch({ mode: 'recon', modeId: 'mode_recon_normal', humans: 2, seed: 7, fake: true, data: RECON_DATA, ...o });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. 候选表与数据

test('候选表：R4 五条、R8 四条、R12 一条（都是单选，id = key）；R16 / R20 无候选；数据里都能解析到', () => {
  assert.deepEqual(R4.map((c) => c.id), [SKULSR, LSLIME, CQBW, MDROCK, DEMONK], 'R4 的五条 id 与从前逐字相同（单选 id = key）');
  for (const c of R4) assert.deepEqual([...c.keys], [c.id], 'R4 每条只有它自己那个 key');
  assert.deepEqual(R8.map((c) => c.id), [BIGADAM, XI, JAKILL, BLKSWB], 'R8 四条单选（id = key）');
  for (const c of R8) assert.deepEqual([...c.keys], [c.id], 'R8 每条只有它自己那个 key');
  assert.deepEqual(R12.map((c) => c.id), [REID], 'R12 只剩“复仇者”一条');
  for (const c of R12) assert.deepEqual([...c.keys], [c.id], 'R12 每条只有它自己那个 key');
  assert.equal(R16, undefined, 'R16 没有候选（其余·重构首领已移除、等重新制作）');
  assert.equal(R20, undefined, 'R20 没有候选（首领回合回退官方随机）');

  const h = reconMatch();
  assert.equal(h.m.gd.isRecon, true, 'mode_recon_normal ⇒ isRecon');
  for (const c of [...R4, ...R8, ...R12]) for (const k of c.keys) assert.ok(h.m.gd.enemy(k), `${k} 能在这一局的数据里解析到`);
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 2. 解析器

test('reconTrialBossFor：座位序里第一个合法选择赢（返回候选 id）；缺席 / 非法 ⇒ 独占流抽一条（幂等）；无候选回合恒 null', () => {
  const h = reconMatch();
  const m = h.m;

  m.reconChoices = { p_1: { bosses: { 4: MDROCK } }, p_0: { bosses: { 4: CQBW } } };
  assert.equal(m.reconTrialBossFor(4), CQBW, 'p_0 座位更靠前 ⇒ 它的选择赢（协同规则 [ASSUMED]）');
  m.reconChoices = { p_1: { bosses: { 4: MDROCK } } };
  assert.equal(m.reconTrialBossFor(4), MDROCK, '只有 p_1 交了 ⇒ 用它的');
  m.reconChoices = { p_0: { bosses: { 4: MDROCK } }, p_1: { bosses: { 4: MDROCK } } };
  assert.equal(m.reconTrialBossFor(4), MDROCK, '两边一致时当然也是它');

  m.reconChoices = null;
  const drawn4 = m.reconTrialBossFor(4);
  assert.ok(R4.some((c) => c.id === drawn4), `没人交 ⇒ 从 R4 的五条候选里抽（抽到 ${drawn4}）`);
  assert.equal(m.reconTrialBossFor(4), drawn4, '同一回合反复解析得到同一条（每次新建 rng，首抽恒定）');

  // 交的 key 是合法敌人但不是候选（比如官方首领）⇒ 当没交
  m.reconChoices = { p_0: { bosses: { 4: 'enemy_1500_skulsr' } } };
  assert.equal(m.reconTrialBossFor(4), drawn4, '非法选择 = 没交 ⇒ 还是那一条');

  // R8 现在也有候选：交一条合法候选，就用它
  m.reconChoices = { p_0: { bosses: { 8: BLKSWB } } };
  assert.equal(m.reconTrialBossFor(8), BLKSWB, 'R8 交锏·重构 ⇒ 解析出它');
  m.reconChoices = { p_0: { bosses: { 8: MDROCK } } };
  const drawn8 = m.reconTrialBossFor(8);
  assert.ok(R8.some((c) => c.id === drawn8), `R8 交的不是它的候选 ⇒ 从 R8 的候选里抽（抽到 ${drawn8}）`);
  assert.equal(m.reconTrialBossFor(8), drawn8, 'R8 反复解析同一条');

  // R12 现在也有候选
  m.reconChoices = { p_0: { bosses: { 12: REID } } };
  assert.equal(m.reconTrialBossFor(12), REID, 'R12 交一条合法候选 ⇒ 用它');
  m.reconChoices = { p_0: { bosses: { 12: MDROCK } } };
  const drawn12 = m.reconTrialBossFor(12);
  assert.ok(R12.some((c) => c.id === drawn12), `R12 交的不是它的候选 ⇒ 从 R12 的候选里抽（抽到 ${drawn12}）`);
  assert.equal(m.reconTrialBossFor(12), drawn12, 'R12 反复解析同一条');

  // R16 / R20：候选表已经没有这两个回合 ⇒ 交什么都取决回 null（首领回合回退官方随机）
  m.reconChoices = { p_0: { bosses: { 16: MDROCK, 20: MDROCK } } };
  assert.equal(m.reconTrialBossFor(16), null, 'R16 没有候选 ⇒ null');
  assert.equal(m.reconTrialBossFor(20), null, 'R20 没有候选 ⇒ null');
  assert.equal(m.reconBossSpawnKeyFor(20), null, '首领回合没有替换键');
  const wave = { spawns: [{ tag: 'boss', key: 'enemy_1546_cliff' }, { key: 'enemy_1006_shield' }], routes: [] };
  const out = m.reconBossWaveFor(20, wave);
  assert.equal(out, wave, '没有候选 ⇒ 波次逐字返回（官方首领照旧）');
  assert.equal(out.spawns[0].key, 'enemy_1546_cliff', '首领本体不被替换');
  assert.deepEqual(m.reconTrialSpawnsFor(20, true), [], '首领回合不追加普通出怪');

  for (const r of [1, 2, 3, 5, 6, 16, 20, 21]) assert.equal(m.reconTrialBossFor(r), null, `R${r} 无候选 ⇒ null`);
  m.dispose();
});

test('非重构对局：解析恒 null（官方对局走不到这一条）', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7, fake: true });
  assert.equal(h.m.gd.isRecon, false);
  assert.equal(h.m.reconTrialBossFor(4), null);
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 3. 追加出怪表：R4 一条（单选，与从前一致）；R8 那对两条（每个 key 各一条）

test('重构模拟 R4：选定的·重构首领作为普通敌人恰好追加一条（预览 / 战场同一份列表），R5 没有', () => {
  const h = reconMatch();
  const m = h.m;
  h.start();
  assert.ok(h.drive(() => m.phase === 'PRE_RECON'), '重构模拟开局先进预重构');
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice', bosses: { 4: MDROCK } }), { ok: true }, 'p_0 交上 R4 的选择');
  assert.deepEqual(m.handle('p_1', { t: 'g.reconChoice' }), { ok: true }, 'p_1 交空选择（全员齐 ⇒ 提前结束预重构）');
  h.toPrep(4);

  const ps = h.ps('p_0');
  assert.equal(m.round, 4);
  assert.equal(m.reconTrialSpawns.length, 1, '这一回合的试炼首领追加：恰好一条');
  assert.equal(m.reconTrialSpawns[0].enemyKey, MDROCK);
  assert.equal(m.reconTrialSpawns[0].count, 1);
  // 预览（m.private.nextEnemies 的来源，views.js nextEnemiesFor）里恰好一条
  assert.equal(m.nextEnemiesFor(ps).filter((e) => e.enemyKey === MDROCK).length, 1, '预览里有且只有一条');
  // 战场出怪表（combat.js _normalOpts）里恰好一条 —— 与预览是同一份列表
  const opts = m._normalOpts(ps, { preview: true });
  assert.equal(opts.spawns.filter((s) => s.enemyKey === MDROCK).length, 1, '战场的 spawns 里也恰好一条');
  assert.ok(opts.spawns.every((s) => s.ownerPlayerId === ps.playerId || s.ownerPlayerId == null), '追加的这条按玩家归属');

  h.runToPhase('PREP', 5);
  assert.equal(m.reconTrialSpawns.length, 0, 'R5 没有试炼首领');
  assert.equal(m.nextEnemiesFor(h.ps('p_0')).filter((e) => e.enemyKey === MDROCK).length, 0, 'R5 的预览里也没有');
  m.dispose();
});

test('重构模拟 R8：选「锏·重构」⇒ 追加一条（预览 / 战场同一份列表）', () => {
  const h = reconMatch();
  const m = h.m;
  h.start();
  assert.ok(h.drive(() => m.phase === 'PRE_RECON'), '重构模拟开局先进预重构');
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice', bosses: { 8: BLKSWB } }), { ok: true }, 'p_0 交上 R8 的选择');
  assert.deepEqual(m.handle('p_1', { t: 'g.reconChoice' }), { ok: true }, 'p_1 交空选择（全员齐 ⇒ 提前结束预重构）');
  h.toPrep(8);

  const ps = h.ps('p_0');
  assert.equal(m.round, 8);
  assert.equal(m.reconTrialSpawns.length, 1, '这一回合的试炼首领追加：恰好一条');
  assert.equal(m.reconTrialSpawns[0].enemyKey, BLKSWB);
  assert.equal(m.reconTrialSpawns[0].count, 1);
  const preview = m.nextEnemiesFor(ps);
  assert.equal(preview.filter((e) => e.enemyKey === BLKSWB).length, 1, '预览里有且只有一条');
  const opts = m._normalOpts(ps, { preview: true });
  assert.equal(opts.spawns.filter((s) => s.enemyKey === BLKSWB).length, 1, '战场的 spawns 里也恰好一条');
  m.dispose();
});

test('重构模拟 R12：选「“复仇者”·重构」⇒ 追加一条（预览 / 战场同一份列表）', () => {
  const h = reconMatch();
  const m = h.m;
  h.start();
  assert.ok(h.drive(() => m.phase === 'PRE_RECON'), '重构模拟开局先进预重构');
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice', bosses: { 12: REID } }), { ok: true }, 'p_0 交上 R12 的选择');
  assert.deepEqual(m.handle('p_1', { t: 'g.reconChoice' }), { ok: true }, 'p_1 交空选择');
  h.toPrep(12);
  const ps = h.ps('p_0');
  assert.equal(m.round, 12);
  assert.equal(m.reconTrialSpawns.length, 1, '这一回合的试炼首领追加：恰好一条');
  assert.equal(m.reconTrialSpawns[0].enemyKey, REID);
  assert.equal(m.reconTrialSpawns[0].count, 1);
  assert.equal(m.nextEnemiesFor(ps).filter((e) => e.enemyKey === REID).length, 1, '预览里有且只有一条');
  const opts = m._normalOpts(ps, { preview: true });
  assert.equal(opts.spawns.filter((s) => s.enemyKey === REID).length, 1, '战场的 spawns 里也恰好一条');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
test('重构模拟 R16：候选已清空 ⇒ 不追加任何·重构首领', () => {
  const h = reconMatch();
  const m = h.m;
  h.start();
  assert.ok(h.drive(() => m.phase === 'PRE_RECON'), '重构模拟开局先进预重构');
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice' }), { ok: true }, 'p_0 交空选择');
  assert.deepEqual(m.handle('p_1', { t: 'g.reconChoice' }), { ok: true }, 'p_1 交空选择');
  h.toPrep(16);
  assert.equal(m.round, 16);
  assert.equal(m.reconTrialSpawns.length, 0, '没有候选 ⇒ 没有追加');
  const ps = h.ps('p_0');
  assert.equal(m.nextEnemiesFor(ps).filter((e) => String(e.enemyKey).startsWith('enemy_ws_recon_')).length, 0, '预览里没有·重构首领');
  m.dispose();
});

test('R20 首领回合：候选已清空 ⇒ 波次与 bossId 都保持官方随机', () => {
  const h = reconMatch();
  const m = h.m;
  m.reconChoices = { p_0: { bosses: { 20: MDROCK } } };
  m.round = 20;
  m._planBossWaves();
  assert.ok(Array.isArray(m.bossWaves) && m.bossWaves.length > 0, '首领波次已生成');
  for (const w of m.bossWaves) {
    const bosses = (w.wave.spawns || []).filter((s) => s && s.tag === 'boss');
    assert.equal(bosses.length, 1, '每个战场恰好一条首领 spawn');
    assert.equal(bosses[0].key, undefined, '没有被替换（替换才会写 key）');
    assert.ok(!String(bosses[0].enemyKey ?? '').startsWith('enemy_ws_recon_'), '首领本体仍是官方那只');
  }
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 4. 非重构对局不受影响

test('非重构对局 R4：连 reconTrialSpawns 这个键都不写，出怪表里没有任何·重构敌人', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7, fake: true });
  h.start();
  h.toPrep(4);
  assert.equal(h.m.reconTrialSpawns, undefined, '官方对局不写这一格（读点全走缺省路径）');
  const ps = h.ps('p_0');
  assert.equal(h.m.nextEnemiesFor(ps).filter((e) => String(e.enemyKey).startsWith('enemy_ws_recon_')).length, 0);
  assert.equal(h.m._normalOpts(ps, { preview: true }).spawns.filter((s) => String(s.enemyKey).startsWith('enemy_ws_recon_')).length, 0);
  h.m.dispose();
});
