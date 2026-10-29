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
//      （mods 相加、每次伤害同步 1 次应用（段数 = 学员 × (1 + 教官段数)）、攻击范围 / 攻击间隔 / 时长全学员自己的、
//      随学员 duration 生效 / 结束）；
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
/** 链式特训用的第三枚棋子（教官的教官）：任意一枚与那对不同的、有技能的 chess。 */
const CHAIN_ID = Object.keys(RECON_DATA.chess ?? {}).find((id) => id !== TRAINEE_ID && id !== MENTOR_ID
  && Array.isArray(RECON_DATA.chess[id]?.skills) && RECON_DATA.chess[id].skills.length >= 1);

function reconMatch(o = {}) {
  return makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', humans: 2, seed: 7, fake: true, data: RECON_DATA, ...o });
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

test('getTrainee（链式，业主 2026-10-29）：教官自己也是学员 ⇒ 三围逐层 ×0.5（A + B×0.5 + C×0.25），盟约 / 技能仍只取直接教官', () => {
  assert.ok(CHAIN_ID, '数据里要能找到第三枚棋子当「教官的教官」');
  const ds = new DataSource(RECON_DATA);
  const own = ds.getChess(TRAINEE_ID, null);
  const mentor = ds.getChess(MENTOR_ID, { skillIndex: 1, moduleId: null });
  const grand = ds.getChess(CHAIN_ID, null);
  const chain = { chessId: CHAIN_ID, loadout: null, ratio: RECON_TRAINEE_STAT_RATIO };
  const d = ds.getChess(TRAINEE_ID, { traineeOf: { chessId: MENTOR_ID, loadout: { skillIndex: 1, moduleId: null }, ratio: RECON_TRAINEE_STAT_RATIO, chain } });
  // 教官那一层自己的组成三围：B + C×0.5（simdata._chainStats 逐层四舍五入）
  const patk = Math.round(mentor.stats.atk + grand.stats.atk * RECON_TRAINEE_STAT_RATIO);
  const pdef = Math.round(mentor.stats.def + grand.stats.def * RECON_TRAINEE_STAT_RATIO);
  const php = Math.round(mentor.stats.maxHp + grand.stats.maxHp * RECON_TRAINEE_STAT_RATIO);
  assert.equal(d.stats.atk, Math.round(own.stats.atk + patk * RECON_TRAINEE_STAT_RATIO), '攻击 = 学员 + (教官 + 教官的教官 ×0.5) ×0.5');
  assert.equal(d.stats.def, Math.round(own.stats.def + pdef * RECON_TRAINEE_STAT_RATIO), '防御同上');
  assert.equal(d.stats.maxHp, Math.round(own.stats.maxHp + php * RECON_TRAINEE_STAT_RATIO), '生命同上');
  assert.deepEqual(d.traineeMentor.chain, chain, 'chain 指针随 traineeMentor 下去');
  assert.equal(d.skill, own.skill, '技能还是学员自己的（C 的影子不叠到 A）');
  // 盟约 / 特质只取直接教官 B 的：与不带 chain 的同一条组成相同
  const plain = ds.getChess(TRAINEE_ID, { traineeOf: { chessId: MENTOR_ID, loadout: { skillIndex: 1, moduleId: null }, ratio: RECON_TRAINEE_STAT_RATIO } });
  assert.deepEqual(d.bonds, plain.bonds, '盟约不沿链传（只有直接教官 B 的）');
  assert.deepEqual(d.raw.garrisonIds, plain.raw.garrisonIds, '特质（garrisonIds）不沿链传');
  assert.notEqual(d, plain, 'chain 参与缓存键，两条 def 不共用');
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

test('battleInput：链式特训 —— 教官自己也是学员时，`reconTrainee.chain` 带它的教官那条（逐层）', () => {
  const h = reconMatch();
  const m = h.m;
  const ps = m.players.get('p_0');
  m.phase = PHASE.PREP;
  m.round = 4;
  ps.board.set('2,2', { uid: 621, kind: 'chess', id: TRAINEE_ID, items: [] });
  ps.board.set('3,3', { uid: 622, kind: 'chess', id: MENTOR_ID, items: [] });
  ps.board.set('4,4', { uid: 623, kind: 'chess', id: CHAIN_ID, items: [] });
  assert.equal(ps.reconTrain({ mentor: 622, trainee: 621 }).error, undefined, 'A ← B');
  assert.equal(ps.reconTrain({ mentor: 623, trainee: 622 }).error, undefined, 'B ← C（同一回合里 B 自己也是学员）');
  const inp = ps.battleInput();
  const a = inp.units.find((u) => u.uid === 621);
  assert.equal(a.reconTrainee.chessId, MENTOR_ID, 'A 的直接教官仍是 B');
  assert.ok(a.reconTrainee.chain, 'A 的条目带链');
  assert.equal(a.reconTrainee.chain.chessId, CHAIN_ID, 'chain = B 的教官 C');
  assert.equal(a.reconTrainee.chain.ratio, RECON_TRAINEE_STAT_RATIO);
  assert.ok(!('chain' in inp.units.find((u) => u.uid === 622).reconTrainee), 'B 自己的条目只有 C 一层（不重复套链）');
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
function traineeBattle(extra = {}, traineeSkill = null, mentorSkill = null, kits = null) {
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
    ...(kits ? { kits } : null),
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

test('真 sim（叠加式）：学员用自己的技能 / 特质 / 天赋，影子技能并进自己的 spec（mods 相加、每次伤害同步 1 次应用），三围 = 学员 + 教官 ×0.5', () => {
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
  // kit 级：影子技能并进学员自己的 spec —— 只并效果：mods 相加（0.2 + 0.3）、每次伤害同步 1 次应用（学员 2 连击 → 4），
  // 攻击范围 / 攻击间隔都不跟教官（影子的 rangeGrid / batPct 不带过来）、弹药数无上限
  const spec = u.kit.skill;
  assert.ok(spec, '学员有技能 spec');
  assert.equal(spec.id, 'sk_tr', 'spec 还是学员自己的技能');
  assert.ok(Math.abs(spec.mods.atkPct - 0.5) < 1e-9, `mods 相加：atkPct = 0.2 + 0.3（实际 ${spec.mods.atkPct}）`);
  assert.equal(spec.attack?.hits, 8, '每次伤害同步 1 次应用：学员自己的 2 段 × (1 + 教官 3 段) = 8');
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

// ---- 会部署召唤物的教官技能（业主 2026-10-29）：每次攻击 / 每次消耗弹药部署一枚，技能结束同步退场 -------------

/** 一局「学员 ← 会部署召唤物的教官」：教官技能记录带 `overrideTokenKey`（望 / 令 这类），召唤物是一枚合成 token。 */
function summonTraineeBattle(traineeSkill = null, kits = null) {
  return makeBattle({
    content: 'full', seed: 11, autoFinish: false, timeLimit: 60,
    defs: {
      chess: {
        tr_s: chessRec({ id: 'tr_s', name: '学员', skill: traineeSkill ?? { skillId: 'sk_tr', name: '学员技', duration: 6, spCost: 8, bb: { atk: 0.2, times: 2 } }, stats: { atk: 100, def: 50, maxHp: 1000, cost: 9, blockCnt: 2 } }),
        mt_s: chessRec({
          id: 'mt_s', name: '教官', charId: 'mt_char', tokens: ['tok_s'],
          skill: { skillId: 'sk_mt', name: '部署技', duration: 10, spCost: 8, bb: {}, overrideTokenKey: 'tok_s' },
          stats: { atk: 999, def: 999, maxHp: 9999, cost: 30, blockCnt: 1, bat: 2.4 },
        }),
      },
      tokens: {
        tok_s: {
          tokenId: 'tok_s', kind: 'summon', name: '棋子', deployLimit: 7, count: 7,
          stats: { maxHp: 100, atk: 0, def: 0, res: 0, cost: 0, blockCnt: 0, bat: 1, aspd: 100, respawnTime: 2, spRecovery: 1, moveSpeed: 1, massLevel: 0 },
          rangeGrid: [[0, 0]], dmgType: 'phys', attackKind: 'melee', projectile: 'none', skill: null,
        },
      },
      enemies: { e_t: enemyRec({ key: 'e_t', hp: 9000, atk: 0 }) },
    },
    enemies: [{ key: 'e_t', time: 0, route: 0 }],
    ...(kits ? { kits } : null),
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: 'tr_s', row: 9, col: 4, reconTrainee: { chessId: 'mt_s', loadout: null, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
}

/** 跑到学员施放技能，返回学员单位。 */
function summonTraineeActive(h) {
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  assert.ok(h.runUntil(() => u.skill.active, 30), '学员的技能施放了');
  return u;
}

const summonsOf = (h, u) => h.battle.allyUnits.filter((t) => t.kind === 'token' && t.defId === 'tok_s' && t.ownerUnit === u);

test('真 sim：会部署召唤物的教官技能 —— 学员每次攻击在目标格（不可用时就近）部署一枚，技能结束同步退场', () => {
  const h = summonTraineeBattle();
  const u = summonTraineeActive(h);
  // 第二次攻击 ⇒ 两枚（每次攻击各一枚，不是只在施放时一枚）
  assert.ok(h.runUntil(() => summonsOf(h, u).filter((t) => t.alive).length >= 2, 20), '每次攻击都部署了一枚');
  const alive = summonsOf(h, u).filter((t) => t.alive);
  const e = h.enemies()[0];
  // 落点就在被攻击的目标附近（目标所在格或它的相邻格 —— 敌人所在格不阻挡召唤）
  const near = e ? alive.some((t) => Math.max(Math.abs(t.tileR - Math.round(e.y)), Math.abs(t.tileC - Math.round(e.x))) <= 2) : true;
  assert.ok(near, '召唤物落在目标附近');
  const all = summonsOf(h, u);
  h.run(8);
  assert.ok(!u.skill.active, '技能结束');
  assert.ok(all.length >= 2 && all.every((t) => !t.alive), '技能结束时召唤物同步退场（一枚不剩）');
});

test('真 sim：弹药技能的同一次攻击只算一枚（attack 与 ammoUsed 不叠），弹药耗尽（技能结束）时一起退场', () => {
  const h = summonTraineeBattle({ skillId: 'sk_tr', name: '弹药技', durationType: 'AMMO', spCost: 8, bb: { trigger_time: 3, atk: 0.2 } });
  const u = summonTraineeActive(h);
  const spent = () => h.hooksOf('ammoUsed').filter((c) => c.unit === u).length;
  assert.ok(h.runUntil(() => spent() >= 1, 30), '打出了至少一发弹药');
  h.runUntil(() => spent() >= 2, 20);
  const alive = () => summonsOf(h, u).filter((t) => t.alive).length;
  assert.equal(alive(), spent(), '每消耗一发弹药只部署一枚（同一次攻击的 attack + ammoUsed 不叠）');
  // 弹药打空 ⇒ 技能结束 ⇒ 同步退场
  assert.ok(h.runUntil(() => !u.skill.active, 30), '弹药耗尽后技能结束');
  assert.equal(alive(), 0, '召唤物同步退场');
});

test('真 sim：教官 kit 自己按攻击召唤同一枚召唤物（夕 S3 这类）⇒ 学员这一发不重复叠两枚', () => {
  let byKit = 0;
  let atk = 0;
  // 夕 S3 的 install：每次攻击把已有的那枚移到新目标格、没有就召一只（deployLimit 1 的「召唤 / 刷新」）
  const mentorKit = () => ({
    install(b, u) {
      b.on('attack', (c) => {
        if (c.attacker !== u || !u.skill?.active) return;
        const t = (c.targets || []).find((x) => x && x.side === 'enemy');
        if (!t) return;
        atk++;
        const r = Math.round(t.y), cc = Math.round(t.x);
        const mine = b.allyUnits.find((x) => x.kind === 'token' && x.defId === 'tok_s' && x.ownerUnit === u && x.alive);
        if (mine) b.relocate(mine, r, cc);
        else if (b.spawnToken(u, 'tok_s', r, cc, { anySource: true })) byKit++;
      }, { owner: u });
    },
  });
  const h = summonTraineeBattle(null, { mt_s: mentorKit });
  const u = summonTraineeActive(h);
  assert.ok(h.runUntil(() => atk >= 2, 20), '教官 kit 自己按攻击召唤 / 刷新');
  assert.equal(byKit, 1, '教官 kit 只召了那一只（之后都是移到新目标格）');
  assert.equal(summonsOf(h, u).filter((t) => t.alive).length, 1, '仍然只有教官 kit 那一枚（这一层不再叠）');
});

test('真 sim：教官 kit 的 `tokenSummon` —— 学员部署出的每一枚召唤物都吃那个技能自己的效果', () => {
  const marked = [];
  const mentorKit = () => ({ tokenSummon: (b, u, t) => { t.mem.skillTag = 'mt_s'; marked.push(t); } });
  const h = summonTraineeBattle(null, { mt_s: mentorKit });
  const u = summonTraineeActive(h);
  assert.ok(h.runUntil(() => summonsOf(h, u).filter((t) => t.alive).length >= 2, 20), '每次攻击各一枚');
  assert.equal(marked.length, summonsOf(h, u).length, '每一枚部署出来的召唤物都调了 tokenSummon');
  for (const t of marked) assert.equal(t.mem.skillTag, 'mt_s', '钩子把那个技能的效果登记到召唤物上');
});

test('望的 kit 提供 tokenSummon：学员部署出的棋子登记成她的一片棋子（立即激活、不可选中、不普攻）', () => {
  const f = KITS.char_2027_wang;
  assert.equal(typeof f, 'function', '望的 kit 在注册表里');
  const kit = f({}, {}, { id: 'x', raw: {} });
  assert.equal(typeof kit.tokenSummon, 'function', 'kit 暴露 tokenSummon（学员的召唤物层会调）');
  const buffs = [];
  const battle = { addBuff: (t, b) => buffs.push(b) };
  const unit = { mem: { wang: { seq: 0 } } };
  const t = { mem: {} };
  kit.tokenSummon(battle, unit, t);
  assert.deepEqual(t.mem.wangNode, { seq: 1, act: true, h: false, v: false, stacks: 0 }, '登记成一片棋子（立即可触发）');
  assert.equal(unit.mem.wang.seq, 1, '序号递增（与她自己摆下的棋子共用同一张表）');
  assert.deepEqual(buffs[0].flags, { untargetable: true, disarm: true }, '棋子的特性：不可选中、不普攻');
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
  assert.equal(spec.attack?.hits, 8, '每发子弹：学员自己的 2 段 × (1 + 教官 3 段) = 8（每次伤害同步 1 次教官效果）');
  // 打完学员自己的 2 发即结束（不是教官的 3 发）
  const ended = h.runUntil(() => u.skill.activations > 0 && !u.skill.active, 40);
  assert.ok(ended, '技能打完了');
  assert.equal(u.skill.activations, 1, '一次施放');
  assert.ok(u.skill.ammoLeft <= 0, '学员自己的 2 发打完');
});

// ---------------------------------------------------------------------------------------------------------------
// 10. 四种组合（业主 2026-10-27 第 5 条 + 2026-10-29 频率修正）：(1) 非弹药 × 非弹药、(3) 弹药 × 非弹药 —— 与 (2) / (4)
//     同一条语义「学员造成的每一次伤害（多段攻击按段数；弹药类 = 每发弹药各自的段数）同步 1 次教官技能的攻击效果」；
//     教官的时长 / 射程 / 攻击间隔一律不并。

/** 非弹药教官技能：攻击力 +30%、三连击、持续 10s（比学员的 6s 长——用来证明时长不跟教官）。 */
const MENTOR_BUFF_SKILL = { skillId: 'sk_mt', name: '教官技', duration: 10, spCost: 8, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]], bb: { atk: 0.3, times: 3, base_attack_time: 0.5 } };
/** 弹药类学员技能：攻击力 +20%、二连击、2 发弹药。 */
const TRAINEE_AMMO_SKILL = { skillId: 'sk_tr', name: '学员技', durationType: 'AMMO', duration: 0, spCost: 8, bb: { trigger_time: 2, atk: 0.2, times: 2 } };

test('真 sim（组合 1）：学员非弹药 × 教官非弹药 —— 每次伤害同步 1 次应用，时长 / 射程 / 攻击间隔全是学员自己的', () => {
  const h = traineeBattle({}, null, MENTOR_BUFF_SKILL);
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  const spec = u.kit.skill;
  assert.notEqual(spec.kind, 'ammo', '学员的技能还是非弹药类');
  assert.equal(spec.ammo ?? null, null, '没有弹药上限');
  assert.equal(spec.attack?.hits, 8, '每次伤害：学员自己的 2 段 × (1 + 教官 3 段) = 8（各同步 1 次教官效果）');
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
  assert.equal(spec.attack?.hits, 8, '每发弹药：学员自己的 2 段 × (1 + 教官 3 段) = 8（每次伤害同步 1 次教官效果）');
  assert.ok(Math.abs(spec.mods.atkPct - 0.5) < 1e-9, `每发弹药带双方 mods（0.2 + 0.3）`);
  assert.ok(!spec.targeting?.rangeGrid, '攻击范围不跟教官');
  h.runUntil(() => u.skill.activations > 0, 30);
  assert.equal(u.skill.ammo, 2, '运行时的子弹数 = 学员自己的 2 发');
  const ended = h.runUntil(() => u.skill.activations > 0 && !u.skill.active, 40);
  assert.ok(ended, '打完了');
  assert.equal(u.skill.activations, 1, '一次施放');
  assert.ok(u.skill.ammoLeft <= 0, '学员自己的 2 发打完（教官的子弹数不并）');
});

// 10b. 攻击次数 / 目标选择数量（业主 2026-10-29）：赤刃明霄陈 S3 改变「每次普攻的攻击次数」（3 段）、逻各斯 S3
//      改变「攻击目标选择数量」（`attack@max_target`）—— 这两样也随影子技能一起继承。

test('真 sim（叠加式）：教官改变的攻击次数 / 目标选择数量也一起继承', () => {
  const mentorSkill = { skillId: 'sk_mt', name: '教官技', duration: 10, spCost: 8, bb: { atk: 0.3, times: 3, max_target: 4 } };
  // (1) 学员自己的技能带 attack：段数 = 学员 2 × (1 + 教官 3) = 8；目标数取大 = 4
  const h = traineeBattle({}, null, mentorSkill);
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  assert.equal(u.kit.skill.attack?.hits, 8, '段数：学员自己的 2 段 × (1 + 教官 3 段)');
  assert.equal(u.kit.skill.targeting?.maxTargets, 4, '目标选择数量：教官的 max_target 4 并入');
  // (2) 学员自己的技能没有 attack 行（纯 buff 技能）：教官那一套直接作为它的攻击 —— 段数照教官的 3，目标数 4
  const h2 = traineeBattle({}, { skillId: 'sk_tr', name: '学员技', duration: 6, spCost: 8, bb: { atk: 0.2 } }, mentorSkill);
  h2.runUntil(() => h2.allies().length >= 1, 30);
  const u2 = h2.allies().find((x) => x.name === '学员');
  assert.ok(u2, '学员下场了');
  assert.ok(u2.kit.skill.attack, '教官的攻击成了学员技能的攻击（不再是空）');
  assert.equal(u2.kit.skill.attack.hits, 3, '段数照教官的（从前被压成 1 段）');
  assert.equal(u2.kit.skill.targeting?.maxTargets, 4, '目标选择数量同样继承');
});

// ---------------------------------------------------------------------------------------------------------------
// 11. 召唤物（业主 2026-10-29）：学员召唤的 token 也吃教官的天赋 / 特质 installer；不是学员的主人召的不吃

test('真 sim：教官的天赋 installer 也作用到学员的召唤物（token 自己的技能 / 特性照常）', () => {
  const mark = { key: 'talent:mt_mark', mods: { atkPct: 0.5 }, persist: true, allowDead: true };
  const mentorTalent = { name: '教官天赋', install: (b, u) => b.addBuff(u, mark) };
  const defs = {
    chess: {
      tr_o: chessRec({ id: 'tr_o', name: '学员', skill: { skillId: 'sk_tr', name: '学员技', duration: 6, spCost: 8, bb: { atk: 0.2, times: 2 } }, stats: { atk: 100, def: 50, maxHp: 1000, cost: 9, blockCnt: 2 } }),
      mt_o: chessRec({ id: 'mt_o', name: '教官', charId: 'mt_char', skill: { skillId: 'sk_mt', name: '教官技', duration: 10, spCost: 8, bb: { atk: 0.3, times: 3 } }, stats: { atk: 999, def: 999, maxHp: 9999, cost: 30, blockCnt: 1 } }),
      other_o: chessRec({ id: 'other_o', name: '别人', skill: null, stats: { atk: 100, def: 10, maxHp: 500, cost: 5, blockCnt: 1 } }),
    },
    enemies: { e_t: enemyRec({ key: 'e_t', hp: 9000, atk: 0 }) },
  };
  const tokenDef = { name: '召唤物', stats: { maxHp: 5000, atk: 100, def: 0, magicResistance: 0, blockCnt: 0, baseAttackTime: 1, attackSpeed: 100 }, rangeGrid: [[0, 0]], profession: 'TOKEN' };
  const h = makeBattle({
    content: 'full', seed: 11, autoFinish: false, timeLimit: 60, defs, kits: { mt_o: () => ({ talents: [mentorTalent] }) },
    enemies: [{ key: 'e_t', time: 0, route: 0 }],
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [
        { uid: 1, kind: 'chess', chessId: 'tr_o', row: 9, col: 4, reconTrainee: { chessId: 'mt_o', loadout: null, ratio: RECON_TRAINEE_STAT_RATIO } },
        { uid: 2, kind: 'chess', chessId: 'other_o', row: 9, col: 2 },
      ],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().filter((x) => x.kind === 'op').length >= 2, 30);
  const u = h.allies().find((x) => x.name === '学员');
  const other = h.allies().find((x) => x.name === '别人');
  assert.ok(u && other, '两名干员都下场了');
  const tok = h.b.spawnToken(u, 'test_token', 10, 6, { def: tokenDef, force: true, anySource: true });
  assert.ok(tok, '学员的召唤物下场');
  assert.ok(tok.kit.talents.some((t) => t === mentorTalent), 'token 的 kit 里确实追加了教官的天赋');
  assert.ok(tok.buffs.some((b) => b.key === mark.key), '教官的天赋挂在学员的召唤物上');
  assert.equal(tok.s.atk, 150, '教官的 +50% 攻击在召唤物身上生效（100 → 150）');
  const tok2 = h.b.spawnToken(other, 'test_token', 10, 8, { def: tokenDef, force: true, anySource: true });
  assert.ok(tok2, '别人的召唤物也下场');
  assert.ok(!tok2.buffs.some((b) => b.key === mark.key), '不是学员的主人召的 token 不吃教官增益');
});

// ---------------------------------------------------------------------------------------------------------------
// 12. 技能效果完整继承（业主 2026-10-29）：赤刃明霄陈 S3 的「剑气」是一段 kit 行为（游走 + 百分比伤害），
//     它的 tick 注册在教官 kit.install 里、以 `unit.skill.id === skchr_chen3_3` 为条件 —— 学员自己的技能 id 不同，
//     从前整段行为被漏掉（只剩一个不动的 mem）。applyTraineeMentor 现在在跑教官 install 的一瞬换 id。

test('真 sim（官方数据）：教官赤刃明霄陈 S3 —— 学员施放时完整继承剑气（那条波真的动起来）', () => {
  const CHEN3 = { charId: 'char_1050_chen3', skillIndex: 2, uniEquipId: null };
  const ds = new DataSource(RECON_DATA);
  const slotId = Object.keys(RECON_DATA.backups?.diy?.slots ?? {}).find((sid) => ds.getChess(sid, { diy: CHEN3 })?.skill?.id === 'skchr_chen3_3');
  assert.ok(slotId, '数据里能选到赤刃明霄陈 S3');
  const h = makeBattle({
    seed: 31, autoFinish: false, timeLimit: 60, data: new DataSource(RECON_DATA), hooks: ALL_HOOKS,
    defs: { enemies: { e_t: { key: 'e_t', name: '木桩', stats: { maxHp: 1e9, atk: 0, def: 0, res: 0, elementRes: 100, bat: 1, blockCnt: 0, moveSpeed: 1 }, motion: 'WALK' } } },
    enemies: [{ key: 'e_t', time: 0, route: 0 }],
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_5_03_b', row: 9, col: 4, reconTrainee: { chessId: slotId, diy: CHEN3, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.uid === 1);
  assert.ok(u, '学员下场了');
  assert.equal(u.skill?.id, 'skchr_blaze2_3', '学员自己的技能 id（不是教官的）');
  // 业主 2026-10-29：陈3 S3 的「每次普攻的攻击次数 3」（`_additionalTimes` 2）也一起继承
  assert.ok((u.kit.skill?.attack?.hits ?? 0) >= 3, `学员的攻击段数继承教官的 3 段（实际 ${u.kit.skill?.attack?.hits}）`);
  u.skill.sp = u.skill.spCost;
  u.skill.activate('test', { free: true });
  h.step();
  assert.ok(u.mem?.chen3Wave, '教官 S3 的 onStart 随影子建出剑气状态');
  h.run(3);
  const waves = h.eventsOf('fx').filter((e) => e[1] === 'chen3Wave');
  assert.ok(waves.length > 0, `剑气的 tick 已注册到学员身上、真的在游走（实际 ${waves.length} 次位置事件）`);
  assert.notEqual(u.skill.id, 'skchr_chen3_3', '运行期 `skill.id` 仍是学员自己的（临时换 id 只发生在 install 那一瞬）');
});

test('真 sim（叠加式）：学员 kit 自己结算的伤害（浮游单元命中这类）也同步一次教官攻击的伤害与 afterHit', () => {
  // 学员的 kit：技能期间不普攻，靠 onTick 自己直接结算一次伤害（模拟浮游单元的一次命中）
  const traineeKit = { skills: { sk_tr: {
    kind: 'duration', duration: 6,
    attack: { noAttack: true },
    onTick({ battle, unit }) {
      if (unit.mem.mtest) return;
      unit.mem.mtest = true;
      const e = battle.enemies.find((x) => x.alive);
      if (e) battle.dealDamage(unit, e, { amount: 100, type: 'arts', isSkill: true });
    },
  } } };
  // 教官的 kit：攻击倍率 2，命中后带一个 afterHit（维什戴尔 S3 的爆炸就是这个形状）
  const mentorKit = { skills: { sk_mt: {
    kind: 'duration', duration: 10,
    attack: { atkScale: 2, afterHit(battle, unit, target) {
      battle.dealDamage(unit, target, { amount: 50, type: 'true', isSplash: true, tags: ['t_after'] });
    } },
  } } };
  const h = traineeBattle({}, null, null, { tr_o: () => traineeKit, mt_o: () => mentorKit });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  assert.equal(typeof u.kit.skill.attack?.afterHit, 'function', '教官的 afterHit（爆炸）并进学员的攻击');
  u.skill.sp = u.skill.spCost;
  u.skill.activate('test', { free: true });
  h.step();
  const e = h.enemies().find((x) => x.alive);
  assert.ok(e, '敌人还在');
  h.runUntil(() => u.mem.mtest, 10);
  h.step();
  // 自己那一段 100 + 教官攻击那一段（ATK × 2，技能期间 ATK 已含教官的 +30%）+ afterHit 50
  const ev = h.eventsOf('dmg').filter((x) => x[1] === e.id);
  assert.ok(ev.length >= 3, `敌人身上三段伤害（实际 ${ev.length}）`);
  assert.ok(ev.some((x) => x[2] >= 1000), '教官攻击的那一段（ATK × 2）也结算在敌人身上');
  assert.ok(ev.some((x) => x[2] === 50), '教官 afterHit 的爆炸伤害也在');
  assert.ok(9000 - e.hp > 1000, `总伤害含教官那一段（实际扣除 ${9000 - e.hp}）`);
});

test('真 sim（官方数据）：教官维什戴尔 S3 —— 学员继承攻击的 afterHit（爆裂黎明的爆炸）', () => {
  const WISDEL = { charId: 'char_1035_wisdel', skillIndex: 2, uniEquipId: null };
  const ds = new DataSource(RECON_DATA);
  const slotId = Object.keys(RECON_DATA.backups?.diy?.slots ?? {}).find((sid) => ds.getChess(sid, { diy: WISDEL })?.skill?.id === 'skchr_wisdel_3');
  assert.ok(slotId, '数据里能选到维什戴尔 S3');
  const h = makeBattle({
    seed: 36, autoFinish: false, timeLimit: 60, data: new DataSource(RECON_DATA), hooks: ALL_HOOKS,
    defs: { enemies: { e_t: { key: 'e_t', name: '木桩', stats: { maxHp: 1e9, atk: 0, def: 0, res: 0, elementRes: 100, bat: 1, blockCnt: 0, moveSpeed: 1 }, motion: 'WALK' } } },
    enemies: [{ key: 'e_t', time: 0, route: 0 }],
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_5_03_b', row: 9, col: 4, reconTrainee: { chessId: slotId, diy: WISDEL, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.uid === 1);
  assert.ok(u, '学员下场了');
  const spec = u.kit.skill;
  assert.equal(typeof spec?.attack?.afterHit, 'function', '维什戴尔 S3 的 afterHit（余震 / 好礼爆炸）随影子继承');
  assert.ok(spec.attack.splashRadius >= 2.5, `攻击溅射半径也继承（实际 ${spec.attack.splashRadius}）`);
});

test('真 sim（叠加式）：单次释放类教官（异客 S3 的雷暴这类）—— 学员每次攻击各触发 1 次，kit 直伤也一样', () => {
  // 教官：本体没有 attack / mods / targeting，效果全在一次 onStart 里（异客 S3 辉煌裂片的雷暴就是这个形状）
  const mentorKit = { skills: { sk_mt: { kind: 'duration', duration: 10, onStart({ battle, unit }) {
    battle.fx('mstorm', { x: unit.x, y: unit.y, id: unit.id });
  } } } };
  // 学员：自己的技能照常攻击，另有一次 kit 直接结算的伤害（模拟浮游单元的一次命中）
  const traineeKit = { skills: { sk_tr: { kind: 'duration', duration: 6, attack: { hits: 1 },
    onTick({ battle, unit }) {
      if (unit.mem.monce) return;
      unit.mem.monce = true;
      const e = battle.enemies.find((x) => x.alive);
      if (e) battle.dealDamage(unit, e, { amount: 10, type: 'arts' });   // 攻击性质（不是 DoT 的 isSkill）
    },
  } } };
  const h = traineeBattle({}, null, null, { tr_o: () => traineeKit, mt_o: () => mentorKit });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  assert.ok(!u.kit.skill.onStart || u.kit.skill.skillSource === 'skills', '单次释放类教官的 onStart 不再挂在施放上');
  assert.equal(typeof u.kit.skill.onAttack, 'function', '改成每次攻击触发一次');
  u.skill.sp = u.skill.spCost;
  const fxN = () => h.eventsOf('fx').filter((e) => e[1] === 'mstorm').length;
  const atkN = () => h.eventsOf('atk').filter((e) => e[1] === u.id).length;
  h.runUntil(() => atkN() >= 1, 60);   // 先等敌人走进射程、打出第一击（此时技能还没开）
  u.skill.activate('test', { free: true });
  const f0 = fxN(), a0 = atkN();
  h.runUntil(() => atkN() - a0 >= 2, 30);
  const storms = fxN() - f0, attacks = atkN() - a0;
  assert.ok(attacks >= 2, `技能期间至少打了两次（实际 ${attacks}）`);
  assert.ok(storms >= attacks, `每次攻击各触发 1 次效果（kit 直伤那一次可能被 0.2 s CD 并进相邻那一发：${storms} 次 / 攻击 ${attacks} 次）`);
});

test('真 sim（官方数据）：教官异客 S3 —— 学员每次攻击触发 1 次雷暴（单次释放类）', () => {
  const h = makeBattle({
    seed: 37, autoFinish: false, timeLimit: 90, data: new DataSource(RECON_DATA), hooks: ALL_HOOKS,
    defs: { enemies: { e_t: { key: 'e_t', name: '木桩', stats: { maxHp: 1e9, atk: 0, def: 0, res: 0, elementRes: 100, bat: 1, blockCnt: 0, moveSpeed: 1 }, motion: 'WALK' } } },
    enemies: [{ key: 'e_t', time: 0, route: 0 }],
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_5_03_b', row: 9, col: 4, reconTrainee: { chessId: 'chess_char_6_05_b', loadout: { skillIndex: 2, moduleId: null }, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.uid === 1);
  assert.ok(u, '学员下场了');
  assert.equal(u.def.skill?.id, 'skchr_blaze2_3', '学员用的是自己的技能');
  u.skill.sp = u.skill.spCost;
  const atkN = () => h.eventsOf('atk').filter((e) => e[1] === u.id).length;
  h.runUntil(() => atkN() >= 1, 60);
  u.skill.activate('test', { free: true });
  const a0 = atkN();
  h.runUntil(() => atkN() - a0 >= 1 && u.skill.active, 200);
  const attacks = atkN() - a0;
  const storms = h.eventsOf('fx').filter((e) => e[1] === 'storm').length;
  assert.ok(attacks >= 1, `技能期间至少打了一次（实际 ${attacks}）`);
  assert.ok(storms >= attacks, `每次攻击各触发 1 次雷暴（实际 ${storms} 次，攻击 ${attacks} 次）`);
});

test('真 sim（叠加式）：单次释放类教官在学员**攻击范围外**的命中也会触发（以命中目标为中心）', () => {
  // 教官（单次释放类，异客 S3 的形状）：从「自己攻击范围内的敌人」里挑一个，在那里生成效果
  const mentorKit = { skills: { sk_mt: { kind: 'duration', duration: 10,
    onStart({ battle, unit }) {
      const cands = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
      if (!cands.length) return;
      const t = cands[0];
      battle.fx('mstorm', { x: Math.round(t.x), y: Math.round(t.y), id: unit.id });
    },
  } } };
  // 学员 kit：技能期间自己直接结算一次伤害（模拟浮游单元在全场命中的那一发）
  const traineeKit = { skills: { sk_tr: { kind: 'duration', duration: 6, attack: { noAttack: true },
    onTick({ battle, unit }) {
      if (unit.mem.farOnce) return;
      unit.mem.farOnce = true;
      const e = battle.enemies.find((x) => x.alive);
      if (e) battle.dealDamage(unit, e, { amount: 10, type: 'arts' });   // 攻击性质的命中
    },
  } } };
  const h = traineeBattle({}, null, null, { tr_o: () => traineeKit, mt_o: () => mentorKit });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  const e = h.enemies().find((x) => x.alive);
  assert.ok(e, '敌人还在');
  u.skill.sp = u.skill.spCost;
  u.skill.activate('test', { free: true });
  h.step();   // onTick 的那一发：敌人还在远处、学员自己范围内没有东西
  const storms = h.eventsOf('fx').filter((x) => x[1] === 'mstorm');
  assert.ok(storms.length >= 1, `范围外的命中也触发了教官技能（实际 ${storms.length} 次）`);
  const at = storms[storms.length - 1];
  assert.ok(Math.abs(at[2] - Math.round(e.x)) <= 1 && Math.abs(at[3] - Math.round(e.y)) <= 1,
    `效果落在命中目标附近（${at[2]},${at[3]} vs 目标 ${Math.round(e.x)},${Math.round(e.y)}）`);
});

test('真 sim（叠加式）：单次释放类教官只认攻击性质（DoT tick 不触发）+ 0.2 s 内置 CD', () => {
  const mentorKit = { skills: { sk_mt: { kind: 'duration', duration: 10, onStart({ battle, unit }) {
    battle.fx('mstorm', { x: unit.x, y: unit.y, id: unit.id });
  } } } };
  const traineeKit = { skills: { sk_tr: { kind: 'duration', duration: 6, attack: { noAttack: true },
    onTick({ battle, unit }) {
      if (unit.mem.once) return;
      unit.mem.once = true;
      const e = battle.enemies.find((x) => x.alive);
      if (!e) return;
      battle.dealDamage(unit, e, { amount: 5, type: 'arts' });                    // ① 攻击性质
      battle.dealDamage(unit, e, { amount: 5, type: 'arts' });                    // ② 同一帧，被 0.2 s CD 吞掉
      battle.dealDamage(unit, e, { amount: 5, type: 'arts', isSkill: true });      // ③ DoT tick 形状：不触发
    },
  } } };
  const h = traineeBattle({}, null, null, { tr_o: () => traineeKit, mt_o: () => mentorKit });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  u.skill.sp = u.skill.spCost;
  u.skill.activate('test', { free: true });
  h.step();
  const storms = h.eventsOf('fx').filter((x) => x[1] === 'mstorm').length;
  assert.equal(storms, 1, `同一帧的两发只算一次、DoT tick 不触发（实际 ${storms} 次）`);
});

test('真 sim（叠加式）：自建实体的「每一发」也触发教官效果（isAttack 但没有 attackId，如丰川祥子的音符）', () => {
  // 教官：攻击倍率 1 + afterHit 留一个记号（每次应用一次）
  const mentorKit = { skills: { sk_mt: { kind: 'duration', duration: 10,
    attack: { atkScale: 1, afterHit(battle) { battle.fx('mhit', { x: 0, y: 0 }); } } } } };
  // 学员 kit：技能期间自己直接结算两发 `isAttack`（没有 isSkill / attackId —— 包侧自建音符就是这个形状）
  const traineeKit = { skills: { sk_tr: { kind: 'duration', duration: 6, attack: { noAttack: true },
    onTick({ battle, unit }) {
      if (unit.mem.notes) return;
      unit.mem.notes = true;
      const e = battle.enemies.find((x) => x.alive);
      for (let i = 0; i < 2 && e; i++) battle.dealDamage(unit, e, { amount: 10, type: 'arts', isAttack: true, tags: ['note'] });
    },
  } } };
  const h = traineeBattle({}, null, null, { tr_o: () => traineeKit, mt_o: () => mentorKit });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.name === '学员');
  assert.ok(u, '学员下场了');
  u.skill.sp = u.skill.spCost;
  u.skill.activate('test', { free: true });
  h.step();
  const hits = h.eventsOf('fx').filter((x) => x[1] === 'mhit');
  assert.equal(hits.length, 2, `两发音符各触发一次教官应用（实际 ${hits.length}）`);
});

test('真 sim（官方数据）：教官逻各斯 S3 —— 学员继承「攻击目标选择数量」（attack@max_target）', () => {
  const LOGOS = { charId: 'char_4133_logos', skillIndex: 2, uniEquipId: null };
  const ds = new DataSource(RECON_DATA);
  const slotId = Object.keys(RECON_DATA.backups?.diy?.slots ?? {}).find((sid) => ds.getChess(sid, { diy: LOGOS })?.skill?.id === 'skchr_logos_3');
  assert.ok(slotId, '数据里能选到逻各斯 S3');
  const h = makeBattle({
    seed: 35, autoFinish: false, timeLimit: 60, data: new DataSource(RECON_DATA), hooks: ALL_HOOKS,
    defs: { enemies: { e_t: { key: 'e_t', name: '木桩', stats: { maxHp: 1e9, atk: 0, def: 0, res: 0, elementRes: 100, bat: 1, blockCnt: 0, moveSpeed: 1 }, motion: 'WALK' } } },
    enemies: [{ key: 'e_t', time: 0, route: 0 }],
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_5_03_b', row: 9, col: 4, reconTrainee: { chessId: slotId, diy: LOGOS, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.uid === 1);
  assert.ok(u, '学员下场了');
  const spec = u.kit.skill;
  assert.ok(spec?.targeting?.maxTargets >= 3, `逻各斯 S3 的目标选择数量并入学员（实际 ${spec?.targeting?.maxTargets}）`);
});

test('真 sim（官方数据）：教官是驭械术师（荒芜拉普兰德 S3）—— 学员施放时也召出浮游单元并结算技能效果', () => {
  const h = makeBattle({
    seed: 33, autoFinish: false, timeLimit: 60, data: new DataSource(RECON_DATA), hooks: ALL_HOOKS,
    defs: { enemies: { e_t: { key: 'e_t', name: '木桩', stats: { maxHp: 1e9, atk: 0, def: 0, res: 0, elementRes: 100, bat: 1, blockCnt: 0, moveSpeed: 1 }, motion: 'WALK' } } },
    enemies: [{ key: 'e_t', time: 0, route: 0 }],
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: 'chess_char_5_03_b', row: 9, col: 4, reconTrainee: { chessId: 'chess_char_6_18_b', loadout: { skillIndex: 2, moduleId: null }, ratio: RECON_TRAINEE_STAT_RATIO } }],
      bonds: {}, bandId: null, playerEffects: [],
    }],
  });
  h.runUntil(() => h.allies().length >= 1, 30);
  const u = h.allies().find((x) => x.uid === 1);
  assert.ok(u, '学员下场了');
  assert.notEqual(u.def.skill?.id, 'skchr_whitw2_3', '学员用的是自己的技能');
  u.skill.sp = u.skill.spCost;
  u.skill.activate('test', { free: true });
  h.step();
  assert.ok(Array.isArray(u.mem?.drones) && u.mem.drones.length >= 1, `荒芜拉普兰德 S3 的浮游单元随学员施放召出（实际 ${u.mem?.drones?.length ?? 0}）`);
  h.run(2);
  const fx = h.eventsOf('fx').filter((e) => e[1] === 'drone' || e[1] === 'drones' || e[1] === 'droneLock');
  assert.ok(fx.length > 0, '浮游单元在动 / 在锁敌（技能效果一起继承了）');
});




