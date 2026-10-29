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
import { makeBattle } from '../helpers/battleHarness.js';
import { loadWorkshop } from '../../server/workshop.js';
import { applyWorkshop } from '../../shared/workshop.js';
import { RECON_TRIAL_BOSSES, RECON_TRIAL_ROUNDS } from '../../shared/reconModes.js';
import { PHASE } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };

// 第 4 回合
const SKULSR = 'enemy_ws_recon_skulsr';
const LSLIME = 'enemy_ws_recon_lslime';
const CQBW = 'enemy_ws_recon_cqbw';
const MDROCK = 'enemy_ws_recon_mdrock';
const MOUSEK = 'enemy_ws_recon_mousek';
// 第 8 回合
const DEKGHT = 'enemy_ws_recon_dekght';
const DEKGHT2 = 'enemy_ws_recon_dekght_2';
const DEKGHT_PAIR = 'enemy_ws_recon_dekght_pair';
const XI = 'enemy_ws_recon_xi';
const MEPHI = 'enemy_ws_recon_mephi';
const FAUST = 'enemy_ws_recon_faust';
const MEPHI_FAUST = 'enemy_ws_recon_mephi_faust';
const JAKILL = 'enemy_ws_recon_jakill';
const FRSTAR2 = 'enemy_ws_recon_frstar2';
// 第 12 回合
const TALULA = 'enemy_ws_recon_talula';
const BLKSWB = 'enemy_ws_recon_blkswb';
const PATRT = 'enemy_ws_recon_patrt';
const MIRBST = 'enemy_ws_recon_mirbst';
const REID = 'enemy_ws_recon_reid';

// 第 16 回合
const MANDRA = 'enemy_ws_recon_mandra';
const BLDKGT = 'enemy_ws_recon_bldkgt';
const MORPHIS = 'enemy_ws_recon_morphis';
const DIRCTR = 'enemy_ws_recon_dirctr';
const DYWQGS = 'enemy_ws_recon_dywqgs';

// 第 20 回合（最终首领）
const BSNAKE = 'enemy_ws_recon_bsnake';
const SKZJKL = 'enemy_ws_recon_skzjkl';
const SYSKAD = 'enemy_ws_recon_syskad';
const SHCHMR = 'enemy_ws_recon_shchmr';
const DYCYUE = 'enemy_ws_recon_dycyue';

// 第 21 回合（隐秘核心）
const CSDOLL = 'enemy_ws_recon_csdoll';
const SKZAMY = 'enemy_ws_recon_skzamy';
const MUAMA = 'enemy_ws_recon_muama';
const MUTWIN = 'enemy_ws_recon_mutwin';
const MUSNAKE = 'enemy_ws_recon_musnake';
const SUISHO = 'enemy_ws_recon_suisho';
const SUIZZH = 'enemy_ws_recon_suizzh';
const SUIYZH = 'enemy_ws_recon_suiyzh';
const SUIWEI = 'enemy_ws_recon_suiwei';
const SHOPHM = 'enemy_ws_recon_shophm';
const SHORBB = 'enemy_ws_recon_shorbb';
const AMA_GROUP = 'enemy_ws_recon_ama_group';
const SUI_GROUP = 'enemy_ws_recon_sui_group';
const SHP_GROUP = 'enemy_ws_recon_shp_group';

const R4 = RECON_TRIAL_BOSSES[4];
const R8 = RECON_TRIAL_BOSSES[8];
const R12 = RECON_TRIAL_BOSSES[12];
const R16 = RECON_TRIAL_BOSSES[16];
const R20 = RECON_TRIAL_BOSSES[20];
const R21 = RECON_TRIAL_BOSSES[21];

/** 这一局用的游戏数据：官方基线 + 只并进 workshop/mode-recon 一个包（·重构首领只在这个包里）。 */
function reconData() {
  if (DATA.enemies && DATA.enemies[MDROCK]) return DATA; // 基线里已经有（没钉官方基线的跑法）⇒ 直接用
  const packs = loadWorkshop(path.join(ROOT, 'workshop'), { log: QUIET }).packs.filter((p) => p.id === 'mode-recon');
  assert.ok(packs.length, 'workshop/mode-recon 必须在仓库里');
  return applyWorkshop(DATA, packs).data;
}
const RECON_DATA = reconData();

/** 一局重构模拟：room mode 'recon' ⇒ modeId 'mode_recon_abyss'（模式本体由 shared/reconModes.js 运行时合成）。 */
function reconMatch(o = {}) {
  return makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', humans: 2, seed: 7, fake: true, data: RECON_DATA, ...o });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. 候选表与数据

test('候选表：R4 / R8 / R12 / R16 / R20 / R21 都有候选；数据里都能解析到', () => {
  assert.deepEqual([...RECON_TRIAL_ROUNDS], [4, 8, 12, 16], '面板只有四个普通回合（R20 / R21 是原版首领，不进选择面板）');
  assert.deepEqual(R4.map((c) => c.id), [SKULSR, LSLIME, CQBW, MDROCK, MOUSEK], 'R4 的五条 id（业主 2026-10-27 的顺序：碎骨 / 庞贝 / W / 泥岩 / 鼠王）');
  for (const c of R4) assert.deepEqual([...c.keys], [c.id], 'R4 每条只有它自己那个 key');
  assert.deepEqual(R8.map((c) => c.id), [DEKGHT_PAIR, XI, MEPHI_FAUST, JAKILL, FRSTAR2], 'R8 五条：腐败+凋零一对、自在、梅菲斯特+浮士德一对、杰斯顿、霜星');
  assert.deepEqual([...R8[0].keys], [DEKGHT, DEKGHT2], '第 1 项一次两只（腐败 + 凋零）');
  assert.deepEqual([...R8[2].keys], [MEPHI, FAUST], '第 3 项一次两只（梅菲斯特 + 浮士德）');
  for (const c of R8.filter((x) => x.id !== DEKGHT_PAIR && x.id !== MEPHI_FAUST)) assert.deepEqual([...c.keys], [c.id], '其余三条单选');
  assert.deepEqual(R12.map((c) => c.id), [TALULA, BLKSWB, PATRT, REID, MIRBST], 'R12 五条单选（业主 2026-10-27 的顺序）');
  for (const c of R12) assert.deepEqual([...c.keys], [c.id], 'R12 每条只有它自己那个 key');
  assert.deepEqual(R16.map((c) => c.id), [MANDRA, BLDKGT, MORPHIS, DIRCTR, DYWQGS], 'R16 五条单选（业主 2026-10-28 的顺序）');
  for (const c of R16) assert.deepEqual([...c.keys], [c.id], 'R16 每条只有它自己那个 key');
  assert.deepEqual(R20.map((c) => c.id), [BSNAKE, SKZJKL, SYSKAD, SHCHMR, DYCYUE], 'R20 五条单选（业主 2026-10-28 的顺序）');
  for (const c of R20) assert.deepEqual([...c.keys], [c.id], 'R20 每条只有它自己那个 key');
  assert.deepEqual(R21.map((c) => c.id), [CSDOLL, SKZAMY, AMA_GROUP, SUI_GROUP, SHP_GROUP], 'R21 五组：大锁 / 阿米娅 / AMa-10 三只 / 岁四部位 / 洛伦茨+源阶方');
  assert.deepEqual([...R21[0].keys], [CSDOLL], '第 1 组单选');
  assert.deepEqual([...R21[1].keys], [SKZAMY], '第 2 组单选');
  assert.deepEqual([...R21[2].keys], [MUAMA, MUTWIN, MUSNAKE], '第 3 组三只');
  assert.deepEqual([...R21[3].keys], [SUISHO, SUIZZH, SUIYZH, SUIWEI], '第 4 组四部位');
  assert.deepEqual([...R21[4].keys], [SHOPHM, SHORBB], '第 5 组一对');

  const h = reconMatch();
  assert.equal(h.m.gd.isRecon, true, 'mode_recon_abyss ⇒ isRecon');
  for (const c of [...R4, ...R8, ...R12, ...R16, ...R20, ...R21]) for (const k of c.keys) assert.ok(h.m.gd.enemy(k), `${k} 能在这一局的数据里解析到`);
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 2. 解析器

test('reconTrialBossFor：座位序里第一个合法选择赢（返回候选 id）；缺席 / 非法 ⇒ 独占流抽一条（幂等）；无候选回合恒 null', () => {
  // 8 人房：R21 的五组候选全部可抽（岁组要 8 人起，业主 2026-10-29）
  const h = reconMatch({ humans: 8 });
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
  m.reconChoices = { p_0: { bosses: { 8: JAKILL } } };
  assert.equal(m.reconTrialBossFor(8), JAKILL, 'R8 交杰斯顿·重构 ⇒ 解析出它');
  m.reconChoices = { p_0: { bosses: { 8: MEPHI_FAUST } } };
  assert.equal(m.reconTrialBossFor(8), MEPHI_FAUST, 'R8 交「梅菲斯特+浮士德」这一对 ⇒ 解析出这一对');
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

  // R16 / R20 都有候选
  m.reconChoices = { p_0: { bosses: { 16: MANDRA, 20: BSNAKE } } };
  assert.equal(m.reconTrialBossFor(16), MANDRA, 'R16 交一条合法候选 ⇒ 用它');
  assert.equal(m.reconTrialBossFor(20), BSNAKE, 'R20 交一条合法候选 ⇒ 用它');
  assert.equal(m.reconBossSpawnKeyFor(20), BSNAKE, 'R20 的替换键 = 选中的首领');
  m.reconChoices = { p_0: { bosses: { 16: MDROCK, 20: MDROCK } } };
  const drawn16 = m.reconTrialBossFor(16);
  assert.ok(R16.some((c) => c.id === drawn16), `R16 交的不是它的候选 ⇒ 从 R16 的候选里抽（抽到 ${drawn16}）`);
  const drawn20 = m.reconTrialBossFor(20);
  assert.ok(R20.some((c) => c.id === drawn20), `R20 交的不是它的候选 ⇒ 从 R20 的候选里抽（抽到 ${drawn20}）`);
  assert.equal(m.reconBossSpawnKeyFor(20), drawn20, 'R20 的替换键 = 抽到的候选');
  const wave = { spawns: [{ tag: 'boss', enemyKey: 'enemy_1546_cliff' }, { enemyKey: 'enemy_1006_shield' }], routes: [] };
  const out = m.reconBossWaveFor(20, wave);
  assert.notEqual(out, wave, '有候选 ⇒ 返回新波次');
  assert.equal(out.spawns[0].key, drawn20, '首领本体被替换成选中的·重构首领');
  assert.equal(out.spawns[1].key, undefined, '其他 spawn 不动');
  assert.deepEqual(m.reconTrialSpawnsFor(20, true), [], '首领回合不追加普通出怪');

  // R21（隐秘核心）也有候选：单选与多只两组
  m.reconChoices = { p_0: { bosses: { 21: CSDOLL } } };
  assert.equal(m.reconTrialBossFor(21), CSDOLL, 'R21 交伤心的大锁 ⇒ 用它');
  assert.equal(m.reconBossSpawnKeyFor(21), CSDOLL, 'R21 的替换键 = 大锁');
  m.reconChoices = { p_0: { bosses: { 21: SUI_GROUP } } };
  assert.equal(m.reconTrialBossFor(21), SUI_GROUP, 'R21 交岁四部位 ⇒ 用这一组');
  const suWave = { spawns: [{ tag: 'boss', enemyKey: 'enemy_9021_acduml_2' }, { enemyKey: 'enemy_1249_lysdb_2' }], routes: [] };
  // 业主 2026-10-29：四部位**各自只出现在 boss 区域 1 / 2 / 3 / 4**，不再同场追加其余部位
  const suKeys = [SUISHO, SUIZZH, SUIYZH, SUIWEI];
  suKeys.forEach((key, area) => {
    const out = m.reconBossWaveFor(21, suWave, area);
    assert.equal(out.spawns[0].key, key, `区域${area + 1} = ${key}`);
    assert.equal(out.spawns.filter((s) => s.tag === 'part').length, 0, `区域${area + 1} 不追加别的部位`);
    assert.equal(out.spawns[1].key, undefined, '其他 spawn 不动');
  });
  assert.equal(m.reconBossWaveFor(21, suWave, 9).spawns[0].key, SUIWEI, '区域 > 4 沿用尾');
  assert.deepEqual(m.reconTrialSpawnsFor(21, true), [], '隐秘核心回合不追加普通出怪');

  for (const r of [1, 2, 3, 5, 6, 15]) assert.equal(m.reconTrialBossFor(r), null, `R${r} 无候选 ⇒ null`);
  m.dispose();
});

test('公开视图：重构对局带 pub.recon.bossKey —— 第 20 回合实际出战的·重构首领（简报页首领卡用它，原版首领不画）', () => {
  const h = reconMatch();
  h.start();
  h.drive(() => h.m.phase === PHASE.PRE_RECON, { band: 'band_bldsk', ready: false });
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice', major: [], minor: [], story: null, bosses: { 20: BSNAKE }, assist: null, load: null }), { ok: true });
  h.run(() => h.publicState()?.recon?.bossKey === BSNAKE, { maxSteps: 5 });
  const pub = h.publicState();
  assert.equal(pub.recon.bossKey, BSNAKE, '交了 R20 的候选 ⇒ 首领卡画它');
  assert.ok(pub.bossId, '官方 bossId 仍在（共享血量池 / 模板用，只是不画它的本体）');
  assert.equal(pub.recon.bossKey, m.reconBossSpawnKeyFor(20), '与出怪替换用的是同一个 key');
  assert.ok(R20.some((c) => c.id === pub.recon.bossKey), 'bossKey 恒为 R20 候选之一');
  m.dispose();
});

test('非重构对局：解析恒 null（官方对局走不到这一条）', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 7, fake: true });
  assert.equal(h.m.gd.isRecon, false);
  assert.equal(h.m.reconTrialBossFor(4), null);
  assert.equal(h.m.players.get('p_0').deployCap, 8, '官方对局的部署上限不变（8）');
  h.m.dispose();
});

test('重构模拟的基础部署上限 = 9（业主 2026-10-29）', () => {
  const h = reconMatch();
  assert.equal(h.m.players.get('p_0').deployCap, 9, '重构对局 = 官方 8 + 1');
  h.m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 3. 追加出怪表：R4 一条（单选，与从前一致）；R8 那对两条（每个 key 各一条）

test('R21 的 AMa-10 三组：房间 < 6 人时不会被抽到；≥ 6 人时按 boss 区域分场（1 终始 / 2 AMa-10 / 3 异构体）', () => {
  const two = reconMatch();
  assert.notEqual(two.m.reconTrialBossFor(21), AMA_GROUP, '2 人房不可能抽到 AMa-10 三组');
  two.m.dispose();

  const six = reconMatch({ humans: 6 });
  six.m.reconChoices = { p_0: { bosses: { 21: AMA_GROUP } } };
  assert.equal(six.m.reconTrialBossFor(21), AMA_GROUP, '6 人房可以选到');
  const wave = { spawns: [{ tag: 'boss', enemyKey: 'enemy_9021_acduml_2' }], routes: [] };
  assert.equal(six.m.reconBossWaveFor(21, wave, 0).spawns[0].key, MUSNAKE, '区域1 = 终始');
  assert.equal(six.m.reconBossWaveFor(21, wave, 1).spawns[0].key, MUAMA, '区域2 = AMa-10');
  assert.equal(six.m.reconBossWaveFor(21, wave, 2).spawns[0].key, MUTWIN, '区域3 = 异构体');
  six.m.dispose();
});

test('R21 洛伦茨组：房间 < 6 人抽不到；区域1 的首领是源阶方，区域2/3/4 各一整对（洛伦茨 + 源阶方）', () => {
  const two = reconMatch();
  assert.notEqual(two.m.reconTrialBossFor(21), SHP_GROUP, '2 人房抽不到');
  two.m.dispose();

  const four = reconMatch({ humans: 4 });
  four.m.reconChoices = { p_0: { bosses: { 21: SHP_GROUP } } };
  assert.notEqual(four.m.reconTrialBossFor(21), SHP_GROUP, '4 人房也抽不到（业主 2026-10-29：≤5 人只出大锁 / 阿米娅）');
  four.m.dispose();

  const six = reconMatch({ humans: 6 });
  six.m.reconChoices = { p_0: { bosses: { 21: SHP_GROUP } } };
  assert.equal(six.m.reconTrialBossFor(21), SHP_GROUP, '6 人房可以选到');
  const wave = { spawns: [{ tag: 'boss', enemyKey: 'enemy_9021_acduml_2' }, { enemyKey: 'enemy_1249_lysdb_2' }], routes: [] };
  const a0 = six.m.reconBossWaveFor(21, wave, 0);
  const solo = a0.spawns.find((s) => s.key === SHORBB) || null;
  assert.ok(solo, '区域1 的首领是源阶方');
  assert.equal(solo.tag, 'boss', '源阶方按 boss 出（自己的 2200 万池）');
  assert.equal(solo.count, 1, '单独一只');
  assert.equal(a0.spawns.some((s) => s.key === SHOPHM), false, '区域1 没有洛伦茨');
  for (let i = 1; i <= 3; i++) {
    const out = six.m.reconBossWaveFor(21, wave, i);
    assert.equal(out.spawns[0].key, SHOPHM, `区域${i + 1} 的 boss = 洛伦茨`);
    assert.deepEqual(out.spawns.filter((s) => s.tag === 'part').map((s) => s.key), [SHORBB], `区域${i + 1} 同场追加源阶方`);
  }
  six.m.dispose();

  // 7 人（3 对 + 1 单人 = 4 块场地）：区域1 仍是源阶方单只，区域2/3/4 都是「洛伦茨 + 源阶方」——
  // 洛伦茨在 6–7 人房里从不单只出现（业主 2026-10-29 确认保持现状）。
  const seven = reconMatch({ humans: 7 });
  seven.m.reconChoices = { p_0: { bosses: { 21: SHP_GROUP } } };
  assert.equal(seven.m.reconTrialBossFor(21), SHP_GROUP, '7 人房也能选到');
  for (let i = 1; i <= 3; i++) {
    const out = seven.m.reconBossWaveFor(21, wave, i);
    assert.equal(out.spawns[0].key, SHOPHM, `7 人：区域${i + 1} 的 boss = 洛伦茨`);
    assert.deepEqual(out.spawns.filter((s) => s.tag === 'part').map((s) => s.key), [SHORBB], `7 人：区域${i + 1} 与源阶方成对`);
  }
  seven.m.dispose();
});

test('R21 候选按人数分档：≤5 只有大锁 / 阿米娅；6–7 加洛伦茨与“终始”组；≥8 才加岁组', () => {
  const pickable = (n, id) => {
    const h = reconMatch({ humans: n });
    h.m.reconChoices = { p_0: { bosses: { 21: id } } };
    const got = h.m.reconTrialBossFor(21);
    h.m.dispose();
    return got === id;
  };
  // ≤5：大锁 / 阿米娅两选一，其余三组都抽不到
  for (const n of [2, 4, 5]) {
    assert.equal(pickable(n, CSDOLL), true, `${n} 人：大锁`);
    assert.equal(pickable(n, SKZAMY), true, `${n} 人：阿米娅`);
    assert.equal(pickable(n, SHP_GROUP), false, `${n} 人：没有洛伦茨`);
    assert.equal(pickable(n, AMA_GROUP), false, `${n} 人：没有“终始”那组`);
    assert.equal(pickable(n, SUI_GROUP), false, `${n} 人：没有岁`);
  }
  // 6–7：加洛伦茨 + “终始”那组，岁仍不出现
  for (const n of [6, 7]) {
    assert.equal(pickable(n, SHP_GROUP), true, `${n} 人：洛伦茨`);
    assert.equal(pickable(n, AMA_GROUP), true, `${n} 人：“终始”组`);
    assert.equal(pickable(n, SUI_GROUP), false, `${n} 人：岁要 8 人`);
  }
  // ≥8：五组都在
  for (const n of [8, 10]) {
    for (const id of [CSDOLL, SKZAMY, SHP_GROUP, AMA_GROUP, SUI_GROUP]) assert.equal(pickable(n, id), true, `${n} 人：${id}`);
  }
});

test('重构模拟的装备上限 / 盟约层数上限 / 维多利亚 +1（业主 2026-10-29）', () => {
  const h = reconMatch();
  const m = h.m;
  h.start();
  h.runToPhase('PREP');
  const ps = h.ps('p_0');
  // ① 每名干员的装备格：官方 2 + 重构 1 = 3（服务端与客户端读同一条判据）
  assert.equal(m.gd.equipCapacity([]), 3, '重构对局的基础装备格 = 3');
  // ② 维多利亚 6 名在场：盟约成员再 +1（→ 4）
  const vic = Object.keys(RECON_DATA.chess).filter((id) => /_a$/.test(id) && (RECON_DATA.chess[id].bonds || []).includes('victoriaShip')).slice(0, 6);
  assert.equal(vic.length, 6, '数据里有 6 名不同的维多利亚干员');
  vic.forEach((id, i) => ps.board.set(`9,${2 + i}`, { uid: 900 + i, kind: 'chess', id, golden: false, tier: 1, items: [], row: 9, col: 2 + i }));
  ps.recompute();
  assert.equal(ps.bonds.victoriaShip.tier, 2, '6 名 ⇒ tier 2');
  assert.equal(ps._victoriaExtraSlot([...ps.board.values()][0]), 1, '成员再 +1');
  assert.equal(m.gd.equipCapacity([], null) + ps._victoriaExtraSlot([...ps.board.values()][0]), 4, '维多利亚成员共 4 格');
  // ③ 盟约层数上限：重构 2000（官方 999）
  assert.equal(ps.addLayers('victoriaShip', 1500), 1500, '1500 层在重构对局里是允许的');
  assert.equal(ps.addLayers('victoriaShip', 600), 500, '第二笔只加到 2000');
  m.dispose();
});

test('重构模拟的战斗内层数上限也是 2000（Battle.addLayers 按这一场战斗的 modeId）', () => {
  const h = makeBattle({
    stage: 'flat', kind: 'normal', rect: { r0: 9, r1: 12, c0: 2, c1: 10 }, timeLimit: 30, modeId: 'mode_recon_abyss',
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [] }], enemies: [], content: 'none',
  });
  assert.equal(h.b.addLayers('p1', 'yanShip', 1500), 1500, '重构战场加得进 1500 层');
  assert.equal(h.b.addLayers('p1', 'yanShip', 600), 500, '到 2000 为止');
});

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

test('重构模拟 R8：选「杰斯顿·重构」⇒ 追加一条（预览 / 战场同一份列表）', () => {
  const h = reconMatch();
  const m = h.m;
  h.start();
  assert.ok(h.drive(() => m.phase === 'PRE_RECON'), '重构模拟开局先进预重构');
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice', bosses: { 8: JAKILL } }), { ok: true }, 'p_0 交上 R8 的选择');
  assert.deepEqual(m.handle('p_1', { t: 'g.reconChoice' }), { ok: true }, 'p_1 交空选择（全员齐 ⇒ 提前结束预重构）');
  h.toPrep(8);

  const ps = h.ps('p_0');
  assert.equal(m.round, 8);
  assert.equal(m.reconTrialSpawns.length, 1, '这一回合的试炼首领追加：恰好一条');
  assert.equal(m.reconTrialSpawns[0].enemyKey, JAKILL);
  assert.equal(m.reconTrialSpawns[0].count, 1);
  const preview = m.nextEnemiesFor(ps);
  assert.equal(preview.filter((e) => e.enemyKey === JAKILL).length, 1, '预览里有且只有一条');
  const opts = m._normalOpts(ps, { preview: true });
  assert.equal(opts.spawns.filter((s) => s.enemyKey === JAKILL).length, 1, '战场的 spawns 里也恰好一条');
  m.dispose();
});

test('重构模拟 R8：选「梅菲斯特·重构 + 浮士德·重构」这一对 ⇒ 两个 key 各追加一条', () => {
  const h = reconMatch();
  const m = h.m;
  h.start();
  assert.ok(h.drive(() => m.phase === 'PRE_RECON'), '重构模拟开局先进预重构');
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice', bosses: { 8: MEPHI_FAUST } }), { ok: true }, 'p_0 交上 R8 的这一对');
  assert.deepEqual(m.handle('p_1', { t: 'g.reconChoice' }), { ok: true }, 'p_1 交空选择');
  h.toPrep(8);

  const ps = h.ps('p_0');
  assert.equal(m.reconTrialSpawns.length, 2, '一条选择含两只 ⇒ 追加两条');
  assert.deepEqual(m.reconTrialSpawns.map((s) => s.enemyKey).sort(), [MEPHI, FAUST].sort());
  const preview = m.nextEnemiesFor(ps);
  assert.equal(preview.filter((e) => e.enemyKey === MEPHI).length, 1, '预览里有梅菲斯特');
  assert.equal(preview.filter((e) => e.enemyKey === FAUST).length, 1, '预览里有浮士德');
  const opts = m._normalOpts(ps, { preview: true });
  assert.equal(opts.spawns.filter((s) => s.enemyKey === MEPHI).length, 1);
  assert.equal(opts.spawns.filter((s) => s.enemyKey === FAUST).length, 1);
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
test('重构模拟 R16：选「蔓德拉·重构」⇒ 追加一条（预览 / 战场同一份列表）', () => {
  const h = reconMatch();
  const m = h.m;
  h.start();
  assert.ok(h.drive(() => m.phase === 'PRE_RECON'), '重构模拟开局先进预重构');
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice', bosses: { 16: MANDRA } }), { ok: true }, 'p_0 交上 R16 的选择');
  assert.deepEqual(m.handle('p_1', { t: 'g.reconChoice' }), { ok: true }, 'p_1 交空选择');
  h.toPrep(16);
  assert.equal(m.round, 16);
  assert.equal(m.reconTrialSpawns.length, 1, '这一回合的试炼首领追加：恰好一条');
  assert.equal(m.reconTrialSpawns[0].enemyKey, MANDRA);
  const ps = h.ps('p_0');
  assert.equal(m.nextEnemiesFor(ps).filter((e) => e.enemyKey === MANDRA).length, 1, '预览里有一条');
  const opts = m._normalOpts(ps, { preview: true });
  assert.equal(opts.spawns.filter((s) => s.enemyKey === MANDRA).length, 1, '战场的 spawns 里也恰好一条');
  m.dispose();
});

test('R20 首领回合：选中「不死的黑蛇·重构」⇒ 每个战场的首领本体都被替换', () => {
  const h = reconMatch();
  const m = h.m;
  m.reconChoices = { p_0: { bosses: { 20: BSNAKE } } };
  m.round = 20;
  m._planBossWaves();
  assert.ok(Array.isArray(m.bossWaves) && m.bossWaves.length > 0, '首领波次已生成');
  for (const w of m.bossWaves) {
    const bosses = (w.wave.spawns || []).filter((s) => s && s.tag === 'boss');
    assert.equal(bosses.length, 1, '每个战场恰好一条首领 spawn');
    assert.equal(bosses[0].key, BSNAKE, '首领本体 = 选中的·重构首领');
    // ⚠️ 出生读的是 `s.enemyKey ?? s.key`（server/sim/simdata.js）：只换 key 的话场上仍是官方首领
    assert.equal(bosses[0].enemyKey, BSNAKE, 'enemyKey 也要换成·重构（业主 2026-10-29）');
    assert.equal(bosses[0].preview && bosses[0].preview.boss, true, '预览仍按首领画');
  }
  m.dispose();
});

test('R21 隐秘核心：startFinalAssault(true) 同样替换首领，并且不带官方模板自带的部件', () => {
  const h = reconMatch();
  const m = h.m;
  h.start();
  assert.ok(h.drive(() => m.phase === 'PRE_RECON'), '重构模拟开局先进预重构');
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice', bosses: { 21: CSDOLL } }), { ok: true });
  assert.deepEqual(m.handle('p_1', { t: 'g.reconChoice' }), { ok: true });
  h.drive(() => m.phase === PHASE.PREP);
  m.round = 21;
  m._planBossWaves();
  m.startFinalAssault(true);
  assert.ok(m.fields.length > 0, '隐秘核心的战场已开');
  for (const f of m.fields) {
    // client-combat 的场次挂在 `f.battle` 上，server-run 的挂在 `f.opts`
    const spawns = (f.opts && f.opts.spawns) || (f.battle && f.battle.spawns) || [];
    const bosses = spawns.filter((s) => s && s.tag === 'boss');
    assert.equal(bosses.length, 1, '每个战场恰好一条首领 spawn');
    assert.equal(bosses[0].key, CSDOLL, '首领本体 = 安心的大锁·重构');
    assert.equal(bosses[0].enemyKey, CSDOLL, 'enemyKey 同步（出生读它）');
    assert.equal(spawns.filter((s) => s && s.tag === 'part').length, 0, '官方隐秘首领的部件（斩胄之剑 / 破胄之锤）不再跟进来');
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
