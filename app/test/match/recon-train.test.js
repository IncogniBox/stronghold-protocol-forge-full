// test/match/recon-train.test.js — 重构协议·特训（模式扩展-重构模拟，shared/reconModes.js）。
//
// **叠加式**（业主裁决：训练是在原本的基础上加上教官的天赋、特质、技能效果，不是替换；盟约也要加上）。覆盖：
//   1. sim 组成通道 `DataSource.getTrainee`（server/sim/simdata.js）：学员自己的 def 为基（技能 / 特质 / 天赋 /
//      kit 派发键 / raw 照旧）、攻 / 防 / 生命 = 学员 + 教官 ×0.5（其余数值全学员自己的）；教官的盟约（含特质授予）
//      并进 `bonds`；`traineeMentor` 指针交给 content 层；教官或学员记录查无 ⇒ 退回学员自己的普通 def。
//      缓存按 (id, 教官, 双方 loadout, ratio) 分键。
//   2. 受理器 `PlayerState.reconTrain`（server/match/player/prep.js）：PREP + 重构对局 + 特训回合才收；
//      两角必须是场上或待部署区的干员且不同人；授予 bond_recon（棋子 meta.data.bondGrants）；重交覆盖同回合。
//   3. battleInput（server/match/player/round.js）：学员条目带 `reconTrainee = { chessId, loadout, ratio }` 且
//      保留自己的 skillIndex / moduleId；教官查无（已售）⇒ 静默不生效；补位 / 自选不参与特训。
//   4. 公开视图：重构对局整局带 `recon`（PRE_RECON 之外 choices 为 null）；官方对局连这个键都不写。
//   5. 真 sim（合成数据，content 'full'）：学员用自己的技能 / 特质 / 天赋，影子技能并进自己的 spec
//      （mods 相加、额外 1 次应用、攻击范围 / 攻击间隔 / 时长全学员自己的、随学员 duration 生效 / 结束）；
//      三围 = 学员 + 教官 ×0.5。
//   6. 真 sim（官方数据）：有手写 kit 的教官 —— 教官的天赋 installer 追加到学员 kit、盟约并入 def.bonds。
//
// 跑法：node --test --import ./test/official-data.mjs test/match/recon-train.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import { DATA, makeMatch } from './harness.js';
import { makeBattle, chessRec, enemyRec, ALL_HOOKS } from '../helpers/battleHarness.js';
import { loadWorkshop } from '../../server/workshop.js';
import { applyWorkshop } from '../../shared/workshop.js';
import { DataSource } from '../../server/sim/simdata.js';
import { KITS, setupUnitKit } from '../../server/sim/content/index.js';
import { unitInfo } from '../../server/sim/snapshot.js';
import { computeBonds } from '../../server/match/bondsMeta.js';
import { RECON_BOND_ID, RECON_TRAINEE_STAT_RATIO, RECON_TRAINING_ROUNDS } from '../../shared/reconModes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };

/** 这一局用的游戏数据：官方基线 + 只并进 workshop/mode-recon 一个包（与 recon-trials.test.js 同一口径）。 */
function reconData() {
  if (DATA.enemies && DATA.enemies['enemy_ws_recon_skulsr']) return DATA;
  const packs = loadWorkshop(path.join(ROOT, 'workshop'), { log: QUIET }).packs.filter((p) => p.id === 'mode-recon');
  assert.ok(packs.length, 'workshop/mode-recon 必须在仓库里');
  return applyWorkshop(DATA, packs).data;
}
const RECON_DATA = reconData();
/** 学员 / 教官：数据里真实存在的两条 chess，教官在 skillIndex 1 的选定技能 id ≠ 学员自己的默认技能 id（否则测不出影子）；
 *  教官优先选**自带盟约**的（盟约叠加 / 计数的断言要用）。 */
const { TRAINEE_ID, MENTOR_ID } = (() => {
  const map = RECON_DATA.chess ?? {};
  const withSkills = Object.keys(map).filter((id) => Array.isArray(map[id]?.skills) && map[id].skills.length >= 1);
  const ds = new DataSource(RECON_DATA);
  let fallback = null;
  for (const mentor of withSkills.filter((id) => map[id].skills.length >= 2)) {
    const md = ds.getChess(mentor, { skillIndex: 1, moduleId: null });
    if (!md?.skill?.id) continue;
    const trainee = withSkills.find((id) => id !== mentor && ds.getChess(id, null)?.skill?.id !== md.skill.id);
    if (!trainee) continue;
    const pair = { TRAINEE_ID: trainee, MENTOR_ID: mentor };
    if ((map[mentor].bonds ?? []).length >= 1) return pair;
    fallback ??= pair;
  }
  assert.ok(fallback, '数据里必须找得到「教官选定技能 ≠ 学员默认技能」的一对');
  return fallback;
})();

function reconMatch(o = {}) {
  return makeMatch({ mode: 'recon', modeId: 'mode_recon_normal', humans: 2, seed: 7, fake: true, data: RECON_DATA, ...o });
}

// ---------------------------------------------------------------------------------------------------------------
// 1. sim 组成通道

test('getTrainee（叠加式）：学员自己的 def 为基（技能 / 特质 / 天赋 / kit 键 / raw 照旧），三围 = 学员 + 教官 ×0.5 + 教官盟约并入 + traineeMentor 指针；缓存分键', () => {
  const ds = new DataSource(RECON_DATA);
  const own = ds.getChess(TRAINEE_ID, null);
  const mentor = ds.getChess(MENTOR_ID, { skillIndex: 1, moduleId: null });
  assert.ok(mentor.skill && mentor.skill.id, '教官有选定技能');
  assert.notEqual(mentor.skill.id, own.skill?.id || '', '教官的选定技能要与学员自己的不同（否则测不出影子）');
  assert.ok((mentor.bonds ?? []).length || (own.bonds ?? []).length, '至少一方有盟约可并');

  const d = ds.getChess(TRAINEE_ID, { traineeOf: { chessId: MENTOR_ID, loadout: { skillIndex: 1, moduleId: null }, ratio: RECON_TRAINEE_STAT_RATIO } });
  assert.equal(d.skill, own.skill, '技能还是学员自己的（教官的技能效果由 content 层影子合并）');
  assert.equal(d.charId, own.charId, 'charId = 学员的（kit 派发走学员自己的 kit）');
  assert.equal(d.raw.skill, own.raw.skill, 'raw 是学员的记录（kit 读的 bb 同源）——只有 garrisonIds 并进教官的特质');
  assert.deepEqual(d.raw.garrisonIds.slice(0, (own.raw.garrisonIds ?? []).length), own.raw.garrisonIds ?? [], '学员自己的特质在前');
  assert.deepEqual(d.talents, own.talents, '天赋 = 学员自己的（教官的在 content 层追加）');
  assert.equal(d.name, own.name, '名字还是学员的');
  assert.equal(d.spine, own.spine, '外观还是学员的（客户端按它画模型）');
  assert.equal(d.rangeGrid, own.rangeGrid, '射程还是学员的');
  assert.equal(d.stats.atk, Math.round(own.stats.atk + mentor.stats.atk * RECON_TRAINEE_STAT_RATIO), '攻击 = 学员 + 教官 ×0.5');
  assert.equal(d.stats.def, Math.round(own.stats.def + mentor.stats.def * RECON_TRAINEE_STAT_RATIO), '防御 = 学员 + 教官 ×0.5');
  assert.equal(d.stats.maxHp, Math.round(own.stats.maxHp + mentor.stats.maxHp * RECON_TRAINEE_STAT_RATIO), '生命 = 学员 + 教官 ×0.5');
  assert.equal(d.stats.cost, own.stats.cost, '费用还是学员的');
  assert.equal(d.stats.blockCnt, own.stats.blockCnt, '阻挡还是学员的');
  assert.equal(d.id, own.id, 'def.id 是学员自己的');
  assert.equal(d.loadout.isDefault, true, 'isDefault 标记防 syncUnitLoadout 把组成件换回普通 def');
  assert.equal(d.loadout.traineeOf?.chessId, MENTOR_ID, 'traineeOf 记在 loadout 上');
  assert.deepEqual(d.traineeMentor, { chessId: MENTOR_ID, loadout: { skillIndex: 1, moduleId: null }, diy: null }, 'traineeMentor 指针（content 层按它解析教官的 kit 与影子技能）');
  // 盟约 = 学员自己的 ∪ 教官的（含教官特质授予的）——去重、保序
  const want = new Set([...(own.bonds ?? []), ...(mentor.bonds ?? []), ...(mentor.raw?.trait?.grantsBonds ?? [])]);
  assert.equal(d.bonds.length, want.size, '盟约并集去重');
  for (const b of want) assert.ok(d.bonds.includes(b), `教官 / 学员的盟约 ${b} 都在`);

  // 换 ratio / 换教官 ⇒ 不同的缓存条目；查无教官 ⇒ 退回学员自己的 def
  const d2 = ds.getChess(TRAINEE_ID, { traineeOf: { chessId: MENTOR_ID, loadout: { skillIndex: 1, moduleId: null }, ratio: 1.5 } });
  assert.equal(d2.stats.atk, Math.round(own.stats.atk + mentor.stats.atk * 1.5), 'ratio 参与缓存键');
  const d3 = ds.getChess(TRAINEE_ID, { traineeOf: { chessId: 'chess_nope_404', loadout: null, ratio: RECON_TRAINEE_STAT_RATIO } });
  assert.equal(d3, own, '教官记录查无 ⇒ 学员自己的普通 def（特训不生效，棋子照常下场）');
});

// ---------------------------------------------------------------------------------------------------------------
// 1a. 特质（业主 2026-10-27 第 6 条）：学员自己的 ∪ 教官的 —— 战斗中类特质按 `raw.garrisonIds` 派发

test('getTrainee：特质并集 —— raw.garrisonIds = 学员自己的 ∪ 教官的（若叶睦这类 IN_BATTLE 特质因此也落在学员身上）', () => {
  const data = {
    chess: {
      tr_t: { ...chessRec({ id: 'tr_t' }), garrisonIds: ['g_own'] },
      mt_t: { ...chessRec({ id: 'mt_t' }), garrisonIds: ['g_mentor', 'g_own'] },
    },
  };
  const ds = new DataSource(data);
  const own = ds.getChess('tr_t', null);
  const d = ds.getChess('tr_t', { traineeOf: { chessId: 'mt_t', loadout: null, ratio: RECON_TRAINEE_STAT_RATIO } });
  assert.deepEqual(d.raw.garrisonIds, ['g_own', 'g_mentor'], '学员自己的在前，教官的追加、去重');
  assert.deepEqual(own.raw.garrisonIds, ['g_own'], '学员自己的普通 def 不被改写（教官只进特训这一份）');
  assert.notEqual(d.raw, own.raw, '并集写在新 raw 上（源记录冻结、共享）');
});

// ---------------------------------------------------------------------------------------------------------------
// 1b. 教官是甄选干员（自选槽位件）：按 pick 解析（getDiy 通道）——不是空槽位记录（业主实测 2026-10-22：
//     维什戴尔（甄选）当教官 ⇒ 影子技能 / 特效 / 音效全空的总根因）
/** 数据里真实可用的甄选 pick（ownedPool × 槽位，逐个试到第一个能解析的）——DIY 教官的用例用。 */
const DIY_PICK = (() => {
  const ds = new DataSource(RECON_DATA);
  const slots = RECON_DATA.backups?.diy?.slots ?? {};
  const pool = RECON_DATA.backups?.diy?.ownedPool ?? [];
  for (const slotId of Object.keys(slots)) {
    for (const charId of pool) {
      for (let si = 0; si <= 2; si++) {
        const pick = { charId, skillIndex: si, uniEquipId: null };
        if (ds.getChess(slotId, { diy: pick })?.diyFor) return { slotId, pick };
      }
    }
  }
  return null;
})();

test('getTrainee：教官是甄选干员时按它的 pick 解析出所选干员的那份 def', () => {
  assert.ok(DIY_PICK, '数据里必须找得到一个合法的甄选 pick');
  const ds = new DataSource(RECON_DATA);
  const own = ds.getChess(TRAINEE_ID, null);
  const d = ds.getChess(TRAINEE_ID, { traineeOf: { chessId: DIY_PICK.slotId, diy: DIY_PICK.pick, ratio: RECON_TRAINEE_STAT_RATIO } });
  assert.notEqual(d, own, 'DIY 教官解析成功（若查到的是空槽位记录 mentor 为 null，会退回学员自己的 def）');
  assert.equal(d.traineeMentor.chessId, DIY_PICK.slotId);
  assert.deepEqual(d.traineeMentor.diy, DIY_PICK.pick, 'pick 原样挂在 traineeMentor 上（content 层 / unitInfo 都按它解析）');
});

// ---------------------------------------------------------------------------------------------------------------
// 1c. 教官是补位（原型干员）上场：按补位 def 解析（`loadout.standIn`）—— 三围 / 技能 / spine / 音效键全是替补干员的

/** 数据里真实的一枚可补位 chess（backup.charId ≠ 自己的 charId，且补位 def 有技能）—— 补位教官的用例用。 */
const STANDIN_MENTOR_ID = (() => {
  const ds = new DataSource(RECON_DATA);
  for (const [id, r] of Object.entries(RECON_DATA.chess ?? {})) {
    const b = r?.backup;
    if (!b?.charId || b.charId === r.charId || r.chessType !== 'NORMAL') continue;
    const sd = ds.getChess(id, { standIn: true });
    if (sd && sd.id === id && sd.charId === b.charId && sd.skill?.id) return id;
  }
  return null;
})();

test('getTrainee：教官是补位时按补位 def 解析（替补干员的身体 / 技能 / 三围），不是原棋子', () => {
  assert.ok(STANDIN_MENTOR_ID, '数据里必须找得到一枚可补位且补位 def 有技能的 chess');
  const ds = new DataSource(RECON_DATA);
  const own = ds.getChess(TRAINEE_ID, null);
  const standIn = ds.getChess(STANDIN_MENTOR_ID, { standIn: true });
  const normal = ds.getChess(STANDIN_MENTOR_ID, null);
  assert.notEqual(standIn.charId, normal.charId, '补位 def 是替补干员的（原棋子另有其人）');

  const d = ds.getChess(TRAINEE_ID, { traineeOf: { chessId: STANDIN_MENTOR_ID, loadout: { standIn: true }, ratio: RECON_TRAINEE_STAT_RATIO } });
  assert.notEqual(d, own, '补位教官解析成功');
  assert.deepEqual(d.traineeMentor, { chessId: STANDIN_MENTOR_ID, loadout: { standIn: true }, diy: null }, '指针带 standIn 下去（content 层 / unitInfo 都按它解析）');
  assert.equal(d.stats.atk, Math.round(own.stats.atk + standIn.stats.atk * RECON_TRAINEE_STAT_RATIO), '攻击 = 学员 + 补位干员 ×0.5');
  assert.equal(d.stats.def, Math.round(own.stats.def + standIn.stats.def * RECON_TRAINEE_STAT_RATIO), '防御 = 学员 + 补位干员 ×0.5');
  const wrong = Math.round(own.stats.atk + normal.stats.atk * RECON_TRAINEE_STAT_RATIO);
  if (normal.stats.atk !== standIn.stats.atk) assert.notEqual(d.stats.atk, wrong, '不是按原棋子的三围算的');
  assert.ok(d.bonds.includes(standIn.bonds[0] ?? ''), '盟约含补位棋子的（补位记录继承盟约）');
  // 缓存键区分：同一教官 id 的「本人上场」与「补位上场」是两份 def
  const normalTrain = ds.getChess(TRAINEE_ID, { traineeOf: { chessId: STANDIN_MENTOR_ID, loadout: { skillIndex: 1, moduleId: null }, ratio: RECON_TRAINEE_STAT_RATIO } });
  assert.notEqual(d, normalTrain, 'standIn 参与缓存键（不与本人上场那份共用）');
});

// ---------------------------------------------------------------------------------------------------------------
// 2. 受理器

test('reconTrain：只有重构对局 + PREP + 特训回合收；两角必须是场上 / 待部署的干员且不同人；授予 bond_recon；重交覆盖', () => {
  const h = reconMatch();
  const m = h.m;
  const ps = m.players.get('p_0');
  assert.ok(ps, 'harness 里有人类座位 p_0');

  m.phase = PHASE.PREP;
  m.round = 4;
  // 待部署区一枚（学员）+ 场上一枚（教官）：TRAINEE_ID 当学员、MENTOR_ID 当教官
  ps.temp[0] = { uid: 501, kind: 'chess', id: TRAINEE_ID, items: [] };
  ps.board.set('3,3', { uid: 502, kind: 'chess', id: MENTOR_ID, items: [] });

  // 阶段 / 模式 / 回合闸
  m.phase = PHASE.PRE_RECON;
  assert.equal(ps.reconTrain({ mentor: 502, trainee: 501 }).error, 'WRONG_PHASE');
  m.phase = PHASE.PREP;
  m.round = 5;
  assert.equal(ps.reconTrain({ mentor: 502, trainee: 501 }).error, 'WRONG_PHASE', '5 不在特训回合表里');
  m.round = 4;
  assert.equal(ps.reconTrain({ mentor: 502, trainee: 502 }).error, 'BAD_TARGET', '同人两角不行');
  assert.equal(ps.reconTrain({ mentor: 999, trainee: 501 }).error, 'BAD_TARGET', '查无教官不行');

  const ok = ps.reconTrain({ mentor: 502, trainee: 501 });
  assert.equal(ok.error, undefined, '合法提交成功');
  assert.equal(ps.reconTraining.length, 1);
  assert.deepEqual(ps.reconTraining[0], { round: 4, mentor: 502, trainee: 501 });
  const tp = ps.trainPieceOf(501);
  const grants = tp.meta.data.bondGrants;
  assert.ok(grants.includes(RECON_BOND_ID), '学员被授予 bond_recon（引擎级授予通道）');
  // 教官的盟约也授给了学员（业主 2026-10-22「盟约也要加上」）
  const mentorBonds = (RECON_DATA.chess[MENTOR_ID].bonds ?? []).filter((b) => ps.gd.bond(b));
  assert.ok(mentorBonds.length, '选出的教官自带盟约（配对选择器保证）');
  for (const b of mentorBonds) assert.ok(grants.includes(b), `教官的盟约 ${b} 授给了学员`);
  assert.ok((RECON_DATA.chess[MENTOR_ID].trait?.grantsBonds ?? []).every((b) => !ps.gd.bond(b) || grants.includes(b)), '教官特质授予的盟约也在');

  // 重交覆盖同回合那条（换教官）
  ps.board.set('4,4', { uid: 503, kind: 'chess', id: MENTOR_ID, items: [] });
  ps.reconTrain({ mentor: 503, trainee: 501 });
  assert.equal(ps.reconTraining.length, 1, '同一学员重交 = 覆盖，不累积');
  assert.deepEqual(ps.reconTraining[0], { round: 4, mentor: 503, trainee: 501 });
  assert.ok(tp.meta.data.bondGrants.includes(RECON_BOND_ID), '授予幂等');

  // RECON_TRAINING_ROUNDS 常量与引擎回合表一致（防手滑改错）
  assert.deepEqual([...RECON_TRAINING_ROUNDS], [4, 8, 12, 16, 20]);
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 2a. 取消本回合的特训（业主 2026-10-23）：只回收这条关系实际加进去的盟约，其它来源保留

test('reconTrainCancel：撤掉本回合那条关系，只回收它实际授予的盟约；其它来源（装备继承等）原样保留', () => {
  const h = reconMatch();
  const m = h.m;
  const ps = m.players.get('p_0');
  m.phase = PHASE.PREP;
  m.round = 4;
  // 学员身上的「别的来源」授予（如哥伦比亚源石辅助仪继承的变形同构体盟约）——取消特训不能把它删掉
  const foreign = ps.gd.bondIds.find((b) => b !== RECON_BOND_ID
    && !(RECON_DATA.chess[MENTOR_ID].bonds ?? []).includes(b)
    && !(RECON_DATA.chess[MENTOR_ID].trait?.grantsBonds ?? []).includes(b));
  assert.ok(foreign, '数据里有第三条盟约可当「别的来源」');
  ps.board.set('2,2', { uid: 511, kind: 'chess', id: TRAINEE_ID, items: [], meta: { data: { bondGrants: [foreign] } } });
  ps.board.set('3,3', { uid: 512, kind: 'chess', id: MENTOR_ID, items: [] });
  assert.equal(ps.reconTrain({ mentor: 512, trainee: 511 }).error, undefined);
  const tp = ps.trainPieceOf(511);
  assert.ok(tp.meta.data.bondGrants.includes(RECON_BOND_ID));
  assert.ok(tp.meta.data.bondGrants.includes(foreign));
  // 同回合换一位教官再交（旧教官的盟约只进不退）：取消时这些也属于「这回合的关系」，一并回收
  const MENTOR2 = Object.keys(RECON_DATA.chess).find((id) => id !== MENTOR_ID && id !== TRAINEE_ID
    && (RECON_DATA.chess[id].bonds ?? []).length && Array.isArray(RECON_DATA.chess[id].skills));
  assert.ok(MENTOR2, '另有一位自带盟约的干员当第二任教官');
  const m2bonds = (RECON_DATA.chess[MENTOR2].bonds ?? []).filter((b) => ps.gd.bond(b));
  ps.board.set('4,4', { uid: 513, kind: 'chess', id: MENTOR2, items: [] });
  assert.equal(ps.reconTrain({ mentor: 513, trainee: 511 }).error, undefined);
  for (const b of m2bonds) assert.ok(tp.meta.data.bondGrants.includes(b), `第二任教官的盟约 ${b} 也在`);
  // 阶段 / 回合闸
  m.phase = PHASE.PRE_RECON;
  assert.equal(ps.reconTrainCancel({ trainee: 511 }).error, 'WRONG_PHASE');
  m.phase = PHASE.PREP;
  assert.equal(ps.reconTrainCancel({ trainee: 999 }).error, 'BAD_TARGET', '没有这名学员的特训');
  // 取消：只回收这次特训加进去的那几条
  assert.equal(ps.reconTrainCancel({ trainee: 511 }).error, undefined);
  assert.equal(ps.reconTraining.length, 0, '关系条目已撤');
  assert.deepEqual(tp.meta.data.bondGrants, [foreign], '只剩别的来源那一条（bond_recon / 教官盟约都回收了）');
  assert.equal(ps.battleInput().units.find((u) => u.uid === 511).reconTrainee, undefined, '战斗输入不再带特训');
  assert.equal(ps.reconTrainCancel({ trainee: 511 }).error, 'BAD_TARGET', '撤过之后再撤 ⇒ 查无');
  assert.equal(ps.reconTrain({ mentor: 512, trainee: 511 }).error, undefined, '撤回后可以重新交（换教官 / 改主意）');
  assert.equal(ps.reconTraining.length, 1);
  m.dispose();
});


test('盟约计数：学员与教官同场，教官的盟约多算学员这一个成员', () => {
  const h = reconMatch();
  const m = h.m;
  const ps = m.players.get('p_0');
  m.phase = PHASE.PREP;
  m.round = 4;
  assert.ok((RECON_DATA.chess[MENTOR_ID].bonds ?? []).length, '教官自带盟约');
  ps.board.set('2,2', { uid: 901, kind: 'chess', id: TRAINEE_ID, items: [] });
  ps.board.set('3,3', { uid: 902, kind: 'chess', id: MENTOR_ID, items: [] });
  const before = computeBonds(ps.gd, ps);
  assert.equal(ps.reconTrain({ mentor: 902, trainee: 901 }).error, undefined);
  const after = computeBonds(ps.gd, ps);
  for (const b of RECON_DATA.chess[MENTOR_ID].bonds) {
    if (!ps.gd.bond(b)) continue;
    assert.equal(after[b].count, (before[b]?.count ?? 0) + 1, `盟约 ${b}：学员算一个独立成员（${before[b]?.count ?? 0} → ${after[b].count}）`);
  }
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 2b. 特质（金色「整备 / 作战能力」那一块）：学员派发的是自己的 ∪ 教官的 —— 休整期钩子 / 内容钩子 / 结果校验同源

test('特训：学员的「特质」= 自己的 ∪ 教官的；取消本回合特训后回到自己的', () => {
  const h = reconMatch();
  const m = h.m;
  const ps = m.players.get('p_0');
  m.phase = PHASE.PREP;
  m.round = 4;
  const own = RECON_DATA.chess[TRAINEE_ID]?.garrisonIds ?? [];
  const mentor = RECON_DATA.chess[MENTOR_ID]?.garrisonIds ?? [];
  assert.ok(mentor.length, '选出的教官自带特质（否则测不出并集）');
  ps.temp[0] = { uid: 521, kind: 'chess', id: TRAINEE_ID, items: [] };
  ps.board.set('3,3', { uid: 522, kind: 'chess', id: MENTOR_ID, items: [] });
  const before = ps.pieceGarrisonIds(ps.trainPieceOf(521));
  assert.deepEqual(before, [...own], '没特训时就是自己的特质');
  assert.equal(ps.reconTrain({ mentor: 522, trainee: 521 }).error, undefined);
  const after = ps.pieceGarrisonIds(ps.trainPieceOf(521));
  for (const gid of [...own, ...mentor]) assert.ok(after.includes(gid), `特质 ${gid} 在学员身上`);
  assert.equal(after.length, new Set([...own, ...mentor]).size, '并集去重');
  assert.equal(ps.reconTrainCancel({ trainee: 521 }).error, undefined);
  assert.deepEqual(ps.pieceGarrisonIds(ps.trainPieceOf(521)), [...own], '取消后只留自己的');
  m.dispose();
});


test('精锐化续接：学员被合进新 uid 的精锐件 ⇒ 特训关系与 bondGrants 跟着走；两角合进同一枚 ⇒ 关系移除', () => {
  const h = reconMatch();
  const m = h.m;
  const ps = m.players.get('p_0');
  m.phase = PHASE.PREP;
  m.round = 4;
  ps.temp[0] = { uid: 701, kind: 'chess', id: TRAINEE_ID, items: [] };
  ps.board.set('3,3', { uid: 702, kind: 'chess', id: MENTOR_ID, items: [] });
  assert.equal(ps.reconTrain({ mentor: 702, trainee: 701 }).error, undefined);
  assert.equal(ps.reconTraining.length, 1);

  // 学员被精锐化合并（模拟 _mergeChess 的产物：被消耗件已摘除，新精锐件 uid 801 进手牌）
  const consumed = ps.temp[0];
  ps.temp[0] = null;
  const elite = { uid: 801, kind: 'chess', id: ps.gd.goldenIdOf(ps.gd.baseIdOf(TRAINEE_ID)) || TRAINEE_ID, items: [] };
  ps.hand.push(elite);
  ps.retainReconTraining([consumed], 801);
  assert.deepEqual(ps.reconTraining[0], { round: 4, mentor: 702, trainee: 801 }, 'trainee uid 重映射到精锐件');
  assert.deepEqual(elite.meta.data.bondGrants, consumed.meta.data.bondGrants, '学员的 bondGrants（bond_recon + 教官的盟约）搬到精锐件');
  assert.ok(ps.trainPieceOf(801), '精锐件在队上，battleInput 会按新 uid 出特训条目');

  // 教官也被精锐化（新 uid 802）⇒ mentor 重映射
  ps.board.delete('3,3');
  const mentorElite = { uid: 802, kind: 'chess', id: MENTOR_ID, items: [] };
  ps.hand.push(mentorElite);
  ps.retainReconTraining([{ uid: 702, kind: 'chess', id: MENTOR_ID, items: [] }], 802);
  assert.deepEqual(ps.reconTraining[0], { round: 4, mentor: 802, trainee: 801 }, 'mentor uid 重映射到精锐件');

  // 两角被合进同一枚精锐 ⇒ 那条关系失效移除
  ps.retainReconTraining([mentorElite], 801);
  assert.equal(ps.reconTraining.length, 0, 'mentor === trainee ⇒ 移除');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 2d. 全量模拟（m.dev）：特训开放、不限回合（业主 2026-10-22「加入且不再有限制，方便测试」）

test('全量模拟：特训不受特训回合表限制，任意 PREP 回合都能交', () => {
  const h = makeMatch({ mode: 'solo', dev: true, seed: 7, fake: true, data: RECON_DATA });
  const m = h.m;
  const ps = m.players.get('p_0');
  assert.ok(m.dev, 'dev 对局');
  m.phase = PHASE.PREP;
  m.round = 3; // 不在 RECON_TRAINING_ROUNDS 里
  ps.temp[0] = { uid: 751, kind: 'chess', id: TRAINEE_ID, items: [] };
  ps.board.set('3,3', { uid: 752, kind: 'chess', id: MENTOR_ID, items: [] });
  assert.equal(ps.reconTrain({ mentor: 752, trainee: 751 }).error, undefined, '第 3 回合也能特训');
  assert.deepEqual(ps.reconTraining[0], { round: 3, mentor: 752, trainee: 751 });
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 3. battleInput

test('battleInput：学员条目带 reconTrainee；教官已售 ⇒ 静默不生效；补位不参与', () => {
  const h = reconMatch();
  const m = h.m;
  const ps = m.players.get('p_0');
  m.phase = PHASE.PREP;
  m.round = 4;
  ps.board.set('2,2', { uid: 601, kind: 'chess', id: TRAINEE_ID, items: [] });
  ps.board.set('3,3', { uid: 602, kind: 'chess', id: MENTOR_ID, items: [] });
  ps.board.set('4,4', { uid: 603, kind: 'chess', id: TRAINEE_ID, items: [] }); // 一枚不参与特训的普通棋子
  ps.reconTrain({ mentor: 602, trainee: 601 });

  const inp = ps.battleInput();
  const t = inp.units.find((u) => u.uid === 601);
  assert.ok(t.reconTrainee, '学员条目带 reconTrainee');
  assert.equal(t.reconTrainee.chessId, MENTOR_ID);
  assert.equal(t.reconTrainee.ratio, RECON_TRAINEE_STAT_RATIO);
  assert.ok(!('reconTrainee' in inp.units.find((u) => u.uid === 603)), '没特训的棋子不带这个键');
  assert.ok('skillIndex' in t && 'moduleId' in t, '学员条目照常带自己的 skillIndex / moduleId（自己的技能与模组照常生效，不再被摘掉）');
  assert.ok(t.reconTrainee.loadout && 'skillIndex' in t.reconTrainee.loadout && 'moduleId' in t.reconTrainee.loadout, 'reconTrainee.loadout 是教官的选定 loadout（harness 棋子无调配 ⇒ 默认值）');

  // 教官**当前时装**随特训条目下去（客户端据此换教官来源的特效变体与音效）：按教官的干员 charId 记、同一个主人
  const mentorChar = ps.gd.chess(MENTOR_ID).charId;
  assert.ok(ps.setSkins({ [mentorChar]: 'demo-outfit' }), '给教官的干员选一套时装');
  const inp4 = ps.battleInput();
  assert.equal(inp4.units.find((u) => u.uid === 601).reconTrainee.skin, 'demo-outfit', '教官的时装随 reconTrainee 下去');
  ps.setSkins({});

  // 教官卖掉（从场上撤走并清出 uid）⇒ 静默不生效
  ps.reconTraining[0].mentor = 99999;
  const inp2 = ps.battleInput();
  assert.ok(!('reconTrainee' in inp2.units.find((u) => u.uid === 601)), '教官查无 ⇒ 静默不生效');

  // 补位不参与特训
  ps.reconTraining[0].mentor = 602;
  ps.fieldsStandIn = () => true; // 只这一条用例里把 601 当补位（fieldsStandIn 按 id 判，TRAINEE_ID 全体补位）
  const inp3 = ps.battleInput();
  assert.ok(!('reconTrainee' in inp3.units.find((u) => u.uid === 601)), '补位棋子不参与特训');
  m.dispose();
});

test('battleInput：教官是补位时 reconTrainee.loadout 带 standIn（sim 按补位干员那份 def 解析）', () => {
  assert.ok(STANDIN_MENTOR_ID, '数据里必须找得到一枚可补位的 chess');
  const h = reconMatch();
  const m = h.m;
  const ps = m.players.get('p_0');
  m.phase = PHASE.PREP;
  m.round = 4;
  assert.ok(ps.setNotOwned([STANDIN_MENTOR_ID]), '把这枚 chess 标成未持有（补位上场）');
  assert.ok(ps.fieldsStandIn(STANDIN_MENTOR_ID), '现在它按补位上场');
  ps.board.set('2,2', { uid: 611, kind: 'chess', id: TRAINEE_ID, items: [] });
  ps.board.set('3,3', { uid: 612, kind: 'chess', id: STANDIN_MENTOR_ID, items: [] });
  assert.equal(ps.reconTrain({ mentor: 612, trainee: 611 }).error, undefined, '补位教官可以当教官');
  const inp = ps.battleInput();
  const t = inp.units.find((u) => u.uid === 611);
  assert.ok(t.reconTrainee, '学员条目带 reconTrainee');
  assert.equal(t.reconTrainee.chessId, STANDIN_MENTOR_ID);
  assert.deepEqual(t.reconTrainee.loadout, { standIn: true }, '教官的补位标记随 loadout 下去（不带它 sim 会解析成原棋子）');
  const mentorUnit = inp.units.find((u) => u.uid === 612);
  assert.equal(mentorUnit.standIn, true, '教官自己照常按补位上场');
  m.dispose();
});


test('公开视图：重构对局整局带 recon（PRE_RECON 之外 choices 为 null）；官方对局连这个键都不写', () => {
  const h = reconMatch();
  h.m.phase = PHASE.PREP;
  h.m.round = 4;
  const v = h.m.publicView();
  assert.ok(v.recon, '重构对局带 recon 标记');
  assert.equal(v.recon.choices, null, 'PRE_RECON 之外 choices 为 null');

  const h2 = makeMatch({ mode: 'solo', seed: 7, fake: true });
  h2.m.phase = PHASE.PREP;
  assert.equal(h2.m.publicView().recon, undefined, '官方对局没有这个键（字节不变）');
  h.m.dispose();
  h2.m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 5. 真 sim（合成数据，content 'full'）：影子技能走完整的 players.js → getChess → applyTraineeMentor 合并链

/** 合成学员 / 教官 + 一个走到学员面前的不还手敌人。教官技能**默认是弹药类**且自带更远的攻击范围（业主 2026-10-22：
 *  影子只并效果——范围不跟教官、无弹药上限、学员技能期间每次攻击都触发）；`mentorSkill` 可换教官的技能（四种组合
 *  的用例）、`traineeSkill` 可换学员自己的技能。 */
function traineeBattle(extra = {}, traineeSkill = null, mentorSkill = null) {
  const defs = {
    chess: {
      // 学员：自己的技能（默认：攻击力 +20%、二连击、持续 6s）
      tr_o: chessRec({ id: 'tr_o', name: '学员', skill: traineeSkill ?? { skillId: 'sk_tr', name: '学员技', duration: 6, spCost: 8, bb: { atk: 0.2, times: 2 } }, trait: '学员特质描述', talents: [{ name: '学员天赋', bb: { atk: 0.1 } }], stats: { atk: 100, def: 50, maxHp: 1000, cost: 9, blockCnt: 2 } }),
      // 教官：弹药类技能（攻击力 +30%、三连击、3 发子弹）、技能自带 4 格范围（学员的范围不该被换成它）
      mt_o: chessRec({ id: 'mt_o', name: '教官', charId: 'mt_char', skill: mentorSkill ?? { skillId: 'sk_mt', name: '教官技', durationType: 'AMMO', duration: 0, spCost: 8, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]], bb: { trigger_time: 3, atk: 0.3, times: 3, base_attack_time: 0.5 } }, trait: '教官特质描述', talents: [{ name: '教官天赋', bb: { atk: 5 } }], stats: { atk: 999, def: 999, maxHp: 9999, cost: 30, blockCnt: 1, bat: 2.4 } }),
      t_b: chessRec({ id: 't_b', tier: 1, profession: 'WARRIOR', rangeGrid: [[0, 0]], skill: null, stats: { atk: 0, def: 0, maxHp: 1e7, bat: 1, blockCnt: 3 } }),
    },
    enemies: { e_t: enemyRec({ key: 'e_t', hp: 9000, atk: 0 }) },
  };
  return makeBattle({
    content: 'full', seed: 11, autoFinish: false, timeLimit: 60, defs,
    enemies: [{ key: 'e_t', time: 0, route: 0 }],
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [
        { uid: 1, kind: 'chess', chessId: 'tr_o', row: 9, col: 4, reconTrainee: { chessId: 'mt_o', loadout: null, ratio: RECON_TRAINEE_STAT_RATIO } },
      ],
      bonds: {}, bandId: null, playerEffects: [],
    }],
    ...extra,
  });
}

test('真 sim（叠加式）：学员用自己的技能 / 特质 / 天赋，影子技能并进自己的 spec（mods 相加、额外 1 次应用），三围 = 学员 + 教官 ×0.5', () => {
  const h = traineeBattle();
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  // def 级：学员自己的
  assert.equal(u.def.skill.id, 'sk_tr', '战斗单位用自己的技能（不是教官的）');
  assert.equal(u.def.charId, 'tr_o', 'kit 派发走学员自己的 charId');
  assert.equal(u.def.trait, '学员特质描述', '特质 = 学员自己的');
  assert.equal(u.def.talents.length, 1, '天赋 = 学员自己的（教官的在 kit 层追加）');
  assert.deepEqual(u.def.traineeMentor, { chessId: 'mt_o', loadout: null, diy: null }, 'traineeMentor 指针在 def 上');
  assert.equal(u.base.atk, 600, '攻击 = 学员 100 + 教官 999 ×0.5 = 599.5 → 600');
  assert.equal(u.base.def, 550, '防御 = 学员 50 + 教官 999 ×0.5 = 549.5 → 550');
  assert.equal(u.base.maxHp, 6000, '生命 = 学员 1000 + 教官 9999 ×0.5 = 5999.5 → 6000');
  assert.equal(u.base.cost, 9, '费用还是学员的');
  assert.equal(u.base.blockCnt, 2, '阻挡还是学员的');
  assert.equal(u.base.bat, u.def.stats.bat, '攻击间隔还是学员的');
  assert.equal(u.base.respawnTime, u.def.stats.respawnTime, '再部署时间还是学员的');
  // kit 级：影子技能并进学员自己的 spec —— 只并效果：mods 相加（0.2 + 0.3）、额外 1 次应用（学员 2 连击 → 3），
  // 攻击范围 / 攻击间隔都不跟教官（影子的 rangeGrid / batPct 不带过来）、弹药数无上限
  const spec = u.kit.skill;
  assert.ok(spec, '学员有技能 spec');
  assert.equal(spec.id, 'sk_tr', 'spec 还是学员自己的技能');
  assert.ok(Math.abs(spec.mods.atkPct - 0.5) < 1e-9, `mods 相加：atkPct = 0.2 + 0.3（实际 ${spec.mods.atkPct}）`);
  assert.equal(spec.attack?.hits, 3, '额外 1 次应用：学员自己的 2 连击 + 1');
  assert.ok(!spec.targeting?.rangeGrid, '攻击范围不跟教官（影子的 rangeGrid 不并）');
  assert.ok(spec.mods.batPct === undefined && spec.mods.aspd === undefined, '攻击间隔不跟教官（batPct / aspd 不并）');
  assert.equal(spec.ammo ?? null, null, '弹药类影子不带弹药上限（每次攻击都触发）');
  assert.equal(u.skill.duration, 6, 'duration 是学员自己的（影子随它结束）');
});

test('真 sim（叠加式）：学员施放自己的技能时影子生效（双方 mods 都在），技能结束影子一起结束', () => {
  const h = traineeBattle();
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  // 技力回满 + 有目标 ⇒ DEFAULT 自动施放；技能期间攻击力 = 600 × (1 + 0.2 + 0.3) = 900（双方技能的 mods 叠加）
  const ok = h.runUntil(() => u.skill.active, 30);
  assert.ok(ok, '学员的技能（带着影子）施放了');
  assert.ok(Math.abs(u.s.atk - 900) < 1e-6, `技能期间攻击力 600 × 1.5 = 900（实际 ${u.s.atk}）`);
  // 技能结束（学员自己的 duration 6s）：影子一起结束，攻击力回到 600
  h.run(8);
  assert.ok(!u.skill.active, '学员技能结束了');
  assert.ok(Math.abs(u.s.atk - 600) < 1e-6, `技能结束后攻击力回到 600（实际 ${u.s.atk}）`);
});

// ---------------------------------------------------------------------------------------------------------------
// 6. 真 sim（官方数据）：有手写 kit 的教官 —— 教官的天赋 installer 追加到学员 kit、盟约并入学员 def.bonds

const { TRAINEE_KIT_ID, MENTOR_KIT_ID } = (() => {
  const ds = new DataSource(RECON_DATA);
  const ids = Object.keys(RECON_DATA.chess ?? {}).filter((id) => Array.isArray(RECON_DATA.chess[id]?.skills) && RECON_DATA.chess[id].skills.length >= 1);
  let fallback = null;
  for (const m of ids) {
    const md = ds.getChess(m, null);
    if (!md?.skill) continue;
    const key = [md.baseId, md.id].find((k) => typeof KITS[k] === 'function');
    if (!key) continue;
    let mk;
    try { mk = KITS[key](md.skill.bb ?? {}, md.raw ?? md, md); } catch { continue; }
    if (!mk || !(mk.talents ?? []).some((t) => typeof t?.install === 'function')) continue;
    const t = ids.find((id) => id !== m);
    if (!t) continue;
    const pair = { TRAINEE_KIT_ID: t, MENTOR_KIT_ID: m };
    // 优先 5/6 阶教官——只有 5/6 阶有甄选（自选）槽位，DIY 教官的用例要用它
    if (md.tier === 5 || md.tier === 6) return pair;
    fallback ??= pair;
  }
  assert.ok(fallback, '官方数据里必须找得到「有手写 kit 且有天赋 installer」的教官');
  return fallback;
})();

test('真 sim（官方数据，叠加式）：教官的天赋 installer 追加到学员的 kit，教官的盟约并入学员 def.bonds', () => {
  const ds = new DataSource(RECON_DATA);
  const mentor = ds.getChess(MENTOR_KIT_ID, null);
  const mentorKit = KITS[mentor.baseId](mentor.skill?.bb ?? {}, mentor.raw ?? mentor, mentor);
  const expected = (mentorKit.talents ?? []).filter((t) => typeof t?.install === 'function').length;
  assert.ok(expected >= 1, '教官的 kit 带天赋 installer');
  const h = makeBattle({
    seed: 13, autoFinish: false, timeLimit: 30, data: new DataSource(RECON_DATA),
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: TRAINEE_KIT_ID, row: 9, col: 4, reconTrainee: { chessId: MENTOR_KIT_ID, loadout: null, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.uid === 1);
  assert.ok(u, '学员下场了');
  assert.equal(u.def.skill.id, ds.getChess(TRAINEE_KIT_ID, null)?.skill?.id, '学员用自己的技能');
  assert.ok((u.kit.talents ?? []).length >= expected, `教官的天赋 installer 追加到了学员的 kit（≥${expected}）`);
  for (const b of mentor.bonds ?? []) assert.ok((u.def.bonds ?? []).includes(b), `教官的盟约 ${b} 并入了学员的 def.bonds`);
});

// ---------------------------------------------------------------------------------------------------------------
// 6b. 真 sim（官方数据）：余（教官）× 烛煌（学员）—— 业主 2026-10-23 实测的一对。
//     学员自己的技能生效时：余的三围 mods（生命 / 攻击 / 防御 +80%）、余的 4 个天赋 installer（礼尚往来 / 闲云隐市 /
//     火墙 / 模组）与 S3 的火墙行为全部落在烛煌身上。

test('真 sim（官方数据）：余 → 烛煌 —— 三围 mods、天赋 installer 与 S3 火墙都落在学员身上', () => {
  const MENTOR_YU = 'chess_char_6_03_b';
  const TRAINEE_ZH = 'chess_char_5_03_b';
  const ds = new DataSource(RECON_DATA);
  const h = makeBattle({
    seed: 31, autoFinish: false, timeLimit: 60, hooks: [...ALL_HOOKS, 'elementHit'],
    defs: {
      enemies: {
        e_t: { key: 'e_t', name: '木桩', stats: { maxHp: 1e9, atk: 0, def: 0, res: 0, elementRes: 100, bat: 1, blockCnt: 0, moveSpeed: 1 }, motion: 'WALK' },
      },
    },
    enemies: [{ key: 'e_t', time: 0, route: 0 }],
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: TRAINEE_ZH, row: 9, col: 4, skillIndex: 2, reconTrainee: { chessId: MENTOR_YU, loadout: { skillIndex: 2, moduleId: null }, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.uid === 1);
  assert.ok(u, '学员下场了');
  assert.deepEqual(u.def.traineeMentor?.chessId, MENTOR_YU, '反查：余的 def 指针在学员身上');
  const own = ds.getChess(TRAINEE_ZH, null);
  assert.ok((u.kit.talents || []).length >= 6, `余的 4 个天赋 installer 追加到烛煌的 kit（实际 ${(u.kit.talents || []).length}）`);
  for (const k of ['hpPct', 'atkPct', 'defPct']) {
    assert.ok((u.kit.skill?.mods?.[k] ?? 0) >= 0.8, `余 S3 的 ${k} 并进学员技能（实际 ${u.kit.skill?.mods?.[k]}）`);
  }
  const on = h.runUntil(() => u.skill.active, 40);
  assert.ok(on, '烛煌自己的技能施放');
  assert.ok(u.s.maxHp > own.stats.maxHp * 1.7, `生命上限随余的 +80% 抬升（${own.stats.maxHp} → ${u.s.maxHp}）`);
  assert.ok(u.s.atk > own.stats.atk * 2.2, `攻击随双方技能 mods 抬升（${own.stats.atk} → ${u.s.atk}）`);
  assert.ok(u.buffs.some((b) => b.key === 'protect'), '余的「礼尚往来」庇护 buff 在烛煌身上');
  h.runUntil(() => u.mem && u.mem.yuWall, 5);
  assert.ok(u.mem?.yuWall, '余 S3 的火墙落在烛煌的格子上');
  // 火墙的灼燃：学员自己站在这面墙上，她的每一次法术伤害都算「穿过火墙」（余本人仍按官方「其他友方」排除）
  h.run(6);
  const firewall = h.hooksOf('elementHit').filter((c) => c.source === u && c.dmg?.tags?.includes('firewall'));
  assert.ok(firewall.length > 0, `烛煌自己的 S3 法术伤害穿过继承的火墙时附带灼燃损伤（实际 ${firewall.length} 次）`);
});

// ---------------------------------------------------------------------------------------------------------------
// 7. 真 sim：教官的天赋与学员自己的天赋**相互叠加、不覆盖**（业主 2026-10-22）——两份 installer 都安装，
//    两份 buff 共存，数值各自生效。

test('真 sim（叠加式）：教官天赋与学员自己的天赋共存（两份 buff 都在、数值都生效），不覆盖', () => {
  const h = traineeBattle({
    kits: {
      tr_o: () => ({ talents: [{ install(b, u) { b.addBuff(u, { key: 'talent:test:own', mods: { atkFlat: 10 }, persist: true, allowDead: true, tags: ['talent'] }); } }] }),
      mt_o: () => ({ talents: [{ install(b, u) { b.addBuff(u, { key: 'talent:test:mentor', mods: { defFlat: 5 }, persist: true, allowDead: true, tags: ['talent'] }); } }] }),
    },
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  assert.equal(u.kit.talents.length, 2, '学员自己的 + 教官的天赋 installer 都在 kit 上（追加，不是替换）');
  assert.ok(u.buffs.some((b) => b.key === 'talent:test:own'), '学员自己的天赋 buff 在');
  assert.ok(u.buffs.some((b) => b.key === 'talent:test:mentor'), '教官的天赋 buff 也在（没有被覆盖）');
  assert.ok(Math.abs(u.s.atk - 610) < 1e-6, `学员天赋的数值生效：600 + 10 = 610（实际 ${u.s.atk}）`);
  assert.ok(Math.abs(u.s.def - 555) < 1e-6, `教官天赋的数值生效：550 + 5 = 555（实际 ${u.s.def}）`);
});

// ---------------------------------------------------------------------------------------------------------------
// 8. 真 sim：unitInfo 带教官的身份与技能槽（客户端叠放教官技能的官方特效 / 音效的唯一供给）

test('真 sim（叠加式）：学员的 UnitInfo 供给 reconMentor（教官的 spine 与选定技能槽）', () => {
  const h = traineeBattle();
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  // unitInfo（snapshot.js）从这份供给读出 UnitInfo.reconMentor —— 客户端叠特效 / 音效的唯一来源
  assert.deepEqual(u.reconMentorInfo, { defId: 'mt_o', spine: 'mt_char', skillIndex: 1 }, '教官的身份与选定技能槽（chessRec 默认 index 1）');
  // 客户端的**唯一入口**：快照 → UnitInfo → renderInfo（view.info）→ skillfx.of 的 mentorPlan / mentorMode
  assert.deepEqual(unitInfo(u).reconMentor, u.reconMentorInfo, 'UnitInfo.reconMentor 随快照下去（renderInfo 必须转写它）');
});

test('真 sim（叠加式）：教官是甄选干员时按 pick 解析（reconMentorInfo = pick 的干员与技能槽）', () => {
  assert.ok(DIY_PICK, '数据里必须找得到一个合法的甄选 pick');
  const ds = new DataSource(RECON_DATA);
  const mentorDef = ds.getChess(DIY_PICK.slotId, { diy: DIY_PICK.pick });
  const h = makeBattle({
    seed: 17, autoFinish: false, timeLimit: 30, data: new DataSource(RECON_DATA),
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: TRAINEE_KIT_ID, row: 9, col: 4, reconTrainee: { chessId: DIY_PICK.slotId, diy: DIY_PICK.pick, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.uid === 1);
  assert.ok(u, '学员下场了');
  assert.equal(u.reconMentorInfo?.spine, mentorDef.charId, 'reconMentorInfo 是 pick 的干员（不是空槽位）');
  assert.equal(u.reconMentorInfo?.skillIndex, mentorDef.skill.index, 'pick 选定的技能槽');
  assert.equal(u.def.skill.id, ds.getChess(TRAINEE_KIT_ID, null)?.skill?.id, '学员用自己的技能');
});

test('真 sim（叠加式）：教官是补位时 reconMentorInfo = 补位干员的 spine 与技能槽（不是原棋子）', () => {
  assert.ok(STANDIN_MENTOR_ID, '数据里必须找得到一枚可补位的 chess');
  const ds = new DataSource(RECON_DATA);
  const mentorDef = ds.getChess(STANDIN_MENTOR_ID, { standIn: true });
  const h = makeBattle({
    seed: 19, autoFinish: false, timeLimit: 30, data: new DataSource(RECON_DATA),
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: TRAINEE_KIT_ID, row: 9, col: 4, reconTrainee: { chessId: STANDIN_MENTOR_ID, loadout: { standIn: true }, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.uid === 1);
  assert.ok(u, '学员下场了');
  assert.equal(u.def.traineeMentor?.loadout?.standIn, true, '指针带 standIn');
  assert.equal(u.reconMentorInfo?.spine, mentorDef.charId, 'reconMentorInfo 是补位干员（不是原棋子）');
  assert.equal(u.reconMentorInfo?.skillIndex, mentorDef.skill.index, '补位干员的技能槽');
  assert.equal(u.def.skill.id, ds.getChess(TRAINEE_KIT_ID, null)?.skill?.id, '学员用自己的技能');
});

// ---------------------------------------------------------------------------------------------------------------
// 10. 全干员审计（业主 2026-10-23「所有干员之间的天赋 / 技能 / 特质效果能相互叠加生效，不得互相覆盖 / 丢失」）：
//     每一位有手写 kit 的教官 × 同一名学员，学员自己的天赋 installer（前缀保序）、特质键、install 链与技能
//     全部保留；教官的 installer / 天赋 / 影子技能在其后叠加。任何一对都不抛错。

test('全干员审计：每一位有 kit 的教官都不覆盖 / 不丢失学员自己的天赋、特质、install 与技能', () => {
  const ds = new DataSource(RECON_DATA);
  const own = ds.getChess(TRAINEE_KIT_ID, null);
  const errs = [];
  const fake = {
    data: ds, opts: {}, started: false,
    _handlerError(where, unit, e) { errs.push({ where, message: String(e && e.message || e) }); },
  };
  const kitOfDef = (def) => setupUnitKit(fake, { kind: 'op', def, deployed: false }, 'full');
  const ownKit = kitOfDef(own);
  const ownT = (ownKit.talents ?? []).filter((x) => x && typeof x.install === 'function').length;
  const ownBase = own.baseId || own.id;
  const seen = new Set();
  let checked = 0;
  for (const id of Object.keys(RECON_DATA.chess ?? {})) {
    if (id === own.id) continue;
    const mdef = ds.getChess(id, null);
    if (!mdef || !mdef.skill) continue;
    const key = mdef.baseId || mdef.id;
    if (key === ownBase || seen.has(key)) continue;
    seen.add(key);
    const mkit = kitOfDef(mdef);
    const mT = (mkit?.talents ?? []).filter((x) => x && typeof x.install === 'function');
    if (!mkit || !(mkit.skill || typeof mkit.install === 'function' || mT.length || mkit.trait)) continue;
    const def = ds.getChess(TRAINEE_KIT_ID, { traineeOf: { chessId: id, loadout: null, ratio: RECON_TRAINEE_STAT_RATIO } });
    assert.notEqual(def, own, `${id}: 教官 def 解析成功`);
    // 注入这两份 kit（同引用）—— 两边的函数 / 天赋对象在这一次合成里才可做同一性断言
    const pairFake = { ...fake, opts: { kits: { [ownBase]: () => ownKit, [key]: () => mkit } } };
    const out = setupUnitKit(pairFake, { kind: 'op', def, deployed: false }, 'full');
    const label = `${id}(${mdef.name || ''})`;
    // 天赋：学员自己的 installer 原样在前（引用同一份），教官的追加在后
    for (let i = 0; i < (ownKit.talents ?? []).length; i++) {
      assert.equal(out.talents?.[i], ownKit.talents[i], `${label}: 学员自己的天赋 installer #${i} 原样保留`);
    }
    assert.ok((out.talents ?? []).length >= ownT + mT.length, `${label}: 教官的天赋 installer 追加`);
    // 特质：学员自己的键值优先（教官的并入但不覆盖）
    for (const [k, v] of Object.entries(ownKit.trait ?? {})) {
      assert.equal(out.trait?.[k], v, `${label}: 学员特质键 ${k} 未被覆盖`);
    }
    // install：两边都有时必须是**新链**（先学员后教官），不是替换掉其中一个
    if (typeof ownKit.install === 'function' && typeof mkit.install === 'function') {
      assert.equal(typeof out.install, 'function', `${label}: install 仍是函数`);
      assert.notEqual(out.install, ownKit.install, `${label}: 学员 install 被链上而不是被替换`);
      assert.notEqual(out.install, mkit.install, `${label}: 不是只剩教官的 install`);
    }
    // 技能：学员自己的 spec 仍是基（id / 时长 / 弹药 / 类别），自己的 mods 键一个不少
    if (ownKit.skill && mkit.skill) {
      assert.equal(out.skill?.id, ownKit.skill.id, `${label}: 技能 id 仍是学员自己的`);
      assert.equal(out.skill?.duration, ownKit.skill.duration, `${label}: 时长仍是学员自己的`);
      assert.equal(out.skill?.kind, ownKit.skill.kind, `${label}: 技能类别仍是学员自己的`);
      assert.equal(out.skill?.ammo ?? null, ownKit.skill.ammo ?? null, `${label}: 弹药仍是学员自己的`);
      for (const k of Object.keys(ownKit.skill.mods ?? {})) {
        assert.ok(Object.prototype.hasOwnProperty.call(out.skill.mods ?? {}, k), `${label}: 学员的 mods.${k} 还在`);
      }
    }
    checked += 1;
  }
  assert.ok(checked >= 100, `审计覆盖了足够多的教官（实际 ${checked}）`);
  assert.deepEqual(errs, [], '任何一对都没有解析错误');
});

// ---------------------------------------------------------------------------------------------------------------
// 9. 真 sim：学员自己也是**弹药类**技能 + 教官的弹药类技能——每发子弹带双方效果，弹药数按学员自己的算
//    （业主 2026-10-22「每发弹药都会有教官的弹药效果和特效」的 sim 侧；特效侧是 skillfx attackFx 的行叠加）

test('真 sim（叠加式）：学员的弹药类技能继承教官的弹药类技能——每发带双方效果，打完学员自己的弹药数', () => {
  const h = traineeBattle({}, { skillId: 'sk_tr', name: '学员技', durationType: 'AMMO', duration: 0, spCost: 8, bb: { trigger_time: 2, atk: 0.2, times: 2 } });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  const spec = u.kit.skill;
  assert.equal(spec.kind, 'ammo', '学员的技能还是弹药类');
  assert.equal(spec.ammo, 2, '弹药数是学员自己的（教官的不并入、无上限）');
  assert.equal(u.skill.ammo, 2, '运行时的子弹数 = 学员自己的');
  assert.ok(Math.abs(spec.mods.atkPct - 0.5) < 1e-9, '每发子弹带双方 mods（0.2 + 0.3）');
  assert.equal(spec.attack?.hits, 3, '每发子弹额外 1 次教官效果（学员自己的 2 连击 + 1）');
  // 打完学员自己的 2 发即结束（不是教官的 3 发）
  const ended = h.runUntil(() => u.skill.activations > 0 && !u.skill.active, 40);
  assert.ok(ended, '技能打完了');
  assert.equal(u.skill.activations, 1, '一次施放');
  assert.ok(u.skill.ammoLeft <= 0, '学员自己的 2 发打完');
});

// ---------------------------------------------------------------------------------------------------------------
// 10. 四种组合（业主 2026-10-27 第 5 条）：(1) 非弹药 × 非弹药、(3) 弹药 × 非弹药 —— 与 (2) / (4) 同一条语义
//     「学员每一次攻击（弹药类 = 每发弹药）额外附带 1 次教官技能的攻击效果」；教官的时长 / 射程 / 攻击间隔一律不并。

/** 非弹药教官技能：攻击力 +30%、三连击、持续 10s（比学员的 6s 长——用来证明时长不跟教官）。 */
const MENTOR_BUFF_SKILL = { skillId: 'sk_mt', name: '教官技', duration: 10, spCost: 8, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]], bb: { atk: 0.3, times: 3, base_attack_time: 0.5 } };
/** 弹药类学员技能：攻击力 +20%、二连击、2 发弹药。 */
const TRAINEE_AMMO_SKILL = { skillId: 'sk_tr', name: '学员技', durationType: 'AMMO', duration: 0, spCost: 8, bb: { trigger_time: 2, atk: 0.2, times: 2 } };

test('真 sim（组合 1）：学员非弹药 × 教官非弹药 —— 每次攻击额外 1 次应用，时长 / 射程 / 攻击间隔全是学员自己的', () => {
  const h = traineeBattle({}, null, MENTOR_BUFF_SKILL);
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  const spec = u.kit.skill;
  assert.notEqual(spec.kind, 'ammo', '学员的技能还是非弹药类');
  assert.equal(spec.ammo ?? null, null, '没有弹药上限');
  assert.equal(spec.attack?.hits, 3, '每次攻击：学员自己的 2 连击 + 额外 1 次教官效果');
  assert.ok(Math.abs(spec.mods.atkPct - 0.5) < 1e-9, `双方攻击力加成相加：0.2 + 0.3（实际 ${spec.mods.atkPct}）`);
  assert.equal(spec.duration, 6, '技能持续时间是学员自己的（教官的 10s 不加）');
  assert.ok(!spec.targeting?.rangeGrid, '攻击范围不跟教官');
  assert.ok(spec.mods.batPct === undefined && spec.mods.aspd === undefined, '攻击间隔不跟教官');
  const ok = h.runUntil(() => u.skill.active, 30);
  assert.ok(ok, '技能施放');
  assert.ok(Math.abs(u.s.atk - 900) < 1e-6, `技能期间攻击力 600 × 1.5 = 900（实际 ${u.s.atk}）`);
  h.run(8);
  assert.ok(!u.skill.active, '按学员自己的 6s 结束（不是教官的 10s）');
});

test('真 sim（组合 3）：学员弹药 × 教官非弹药 —— 每发弹药触发 1 次教官攻击效果，打完学员自己的弹药数', () => {
  const h = traineeBattle({}, TRAINEE_AMMO_SKILL, MENTOR_BUFF_SKILL);
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  const spec = u.kit.skill;
  assert.equal(spec.kind, 'ammo', '学员的技能还是弹药类');
  assert.equal(spec.ammo, 2, '弹药数是学员自己的');
  assert.equal(spec.attack?.hits, 3, '每发弹药：学员自己的 2 连击 + 额外 1 次教官效果');
  assert.ok(Math.abs(spec.mods.atkPct - 0.5) < 1e-9, `每发弹药带双方 mods（0.2 + 0.3）`);
  assert.ok(!spec.targeting?.rangeGrid, '攻击范围不跟教官');
  h.runUntil(() => u.skill.activations > 0, 30);
  assert.equal(u.skill.ammo, 2, '运行时的子弹数 = 学员自己的 2 发');
  const ended = h.runUntil(() => u.skill.activations > 0 && !u.skill.active, 40);
  assert.ok(ended, '打完了');
  assert.equal(u.skill.activations, 1, '一次施放');
  assert.ok(u.skill.ammoLeft <= 0, '学员自己的 2 发打完（教官的子弹数不并）');
});

