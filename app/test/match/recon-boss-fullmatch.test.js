// test/match/recon-boss-fullmatch.test.js — 重构模拟 R20 / R21 的**整局**集成测试。
//
// 前面的 recon-trials.test.js / recon-bosses.test.js 已经把「候选 → 出怪替换 → 血池口径」逐段钉住了；这一份只跑
// **一整局**：从开局（INFO_CHECK → 预重构 → 20 个回合）走到第 20 回合的最终攻势，再走到第 21 回合的隐秘核心，
// 断言三件端到端的事：
//   1. 场上真正交给战场的 spawns（`FakeBattle.spawns`）里，模板的官方首领已经被「·重构」记录换掉（R20 / R21 两条路）；
//   2. 共享血量池按包记录的口径开账（R20 单人池；R21 的跨战斗通道池 core / ama / shp，以及洛伦茨的区域1独立池）；
//   3. HUD（公开视图 `bossHp` / `recon.bossKey`）与实际池一致，且整局没有任何 reportError / 调度回调异常。
//
// 为什么是「全机器人 6 座」：预重构阶段 AI 自动交空选择并自动点继续（phases.enterPreRecon），不需要真人交互；6 人
// 正好凑 3 块 boss 场地，R21 的 AMa-10 组（minPlayers 6）与洛伦茨组（minPlayers 6）才在候选里。FakeBattle 默认不漏怪
// ⇒ 20 个回合没有目标生命损失；每回合 PREP 把 LP 抬到 400、在 R20 的 PREP 给每个有成员的盟约加 100 层，隐秘核心
// 的资格（Σ 激活层数 > 阈值、队伍 LP > 1）就自然成立 —— 走的是真实规则，不是写死 hiddenLayerSum。
//
// 跑法：node --test --import ./test/official-data.mjs test/match/recon-boss-fullmatch.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA, makeMatch } from './harness.js';
import { loadWorkshop } from '../../server/workshop.js';
import { applyWorkshop } from '../../shared/workshop.js';
import { PHASE } from '../../shared/constants.js';
import { bossStandsStill } from '../../server/match/waves.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const QUIET = { info() {}, warn() {}, error() {}, debug() {} };

// —— 第 20 回合的五名最终首领（bosses.json 里的「·重构」记录 key）——
const BSNAKE = 'enemy_ws_recon_bsnake';
const SHCHMR = 'enemy_ws_recon_shchmr';
const DYCYUE = 'enemy_ws_recon_dycyue';
// —— 第 21 回合 ——
const CSDOLL = 'enemy_ws_recon_csdoll';
const AMA_GROUP = 'enemy_ws_recon_ama_group';
const SHP_GROUP = 'enemy_ws_recon_shp_group';
const MUAMA = 'enemy_ws_recon_muama';
const MUTWIN = 'enemy_ws_recon_mutwin';
const MUSNAKE = 'enemy_ws_recon_musnake';
const SHOPHM = 'enemy_ws_recon_shophm';
const SHORBB = 'enemy_ws_recon_shorbb';

/** 这一局用的游戏数据：官方基线 + 只并进 workshop/mode-recon 一个包（·重构首领只在这个包里）。 */
function reconData() {
  if (DATA.enemies && DATA.enemies[SHCHMR]) return DATA; // 没钉官方基线的跑法 ⇒ 直接用
  const packs = loadWorkshop(path.join(ROOT, 'workshop'), { log: QUIET }).packs.filter((p) => p.id === 'mode-recon');
  assert.ok(packs.length, 'workshop/mode-recon 必须在仓库里');
  return applyWorkshop(DATA, packs).data;
}
const RECON_DATA = reconData();

/** 首领战里只要共享池还在流血就结束得快：每条血池每秒 10 亿（按战场人数平摊）。 */
const killBoss = (b) => ((b.kind === 'boss' || b.kind === 'hidden') ? { bossDps: 1e9 } : null);

/**
 * 一整局重构模拟（6 个 AI 座位），在预重构交上 `bosses` 选择，然后驱动到最终攻势（R20）或隐秘核心（R21）。
 * @param {{ bosses: Record<string,string>, to?: string, seed?: number }} o
 */
function reconMatchToBoss({ bosses, to = PHASE.FINAL_ASSAULT, seed = 7 }) {
  const seats = Array.from({ length: 6 }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seats, seed, data: RECON_DATA, fake: true, script: killBoss, captureFrames: false });
  const m = h.m;
  m.start();
  assert.ok(h.run(() => m.phase === PHASE.PRE_RECON, { maxSteps: 8e6 }), '进入预重构');
  // AI 座位在 enterPreRecon 里已经交了空选择；把「首领」这一格补成业主/测试想要的那一只（座位序第一个合法选择赢）
  m.reconChoices.ai_0 = { ...m.reconChoices.ai_0, bosses: { ...bosses } };
  let last = '';
  const ok = h.run(() => {
    const k = `${m.phase}:${m.round}`;
    if (k !== last) {
      last = k;
      if (m.phase === PHASE.PREP) {
        // 20 个回合都满 LP（FakeBattle 不漏怪，这里只防别的扣血路径把座位打没）
        for (const ps of m.alivePlayers()) ps.lp = 400;
        if (m.round === m.gd.bossRound) {
          // 隐秘核心的资格：每个有盟约成员的座位给那条盟约 +100 层（与 bosshp.test.js 同一手法，走真实规则）
          for (const ps of m.alivePlayers()) {
            const bond = m.gd.bondIds.find((id) => ps.bonds[id] && ps.bonds[id].count > 0);
            if (bond) { ps.bonds[bond].active = true; ps.bonds[bond].layers = (ps.bonds[bond].layers || 0) + 100; }
          }
        }
      }
    }
    return h.ended != null || m.phase === to;
  }, { maxSteps: 8e6 });
  assert.ok(ok, `没能走到 ${to}（停在第 ${m.round} 回合 / ${m.phase}${h.ended ? '，对局已结束' : ''}）`);
  return { h, m };
}

/** 一块首领场地里 `tag:'boss'` 的那条 spawn（`spawns` 已过 `_sanitizeSpawns`，tag 原样保留）。 */
function bossSpawnOf(field) {
  const spawns = (field.battle ? field.battle.spawns : field.opts.spawns) || [];
  return spawns.filter((s) => s && s.tag === 'boss');
}

/** 一条 spawn 的实际出生 key：`server/sim/simdata.js` 读 `enemyKey ?? key`。 */
const spawnKey = (s) => s.enemyKey ?? s.key;

/** 全场公共断言：每块首领场地都有首领本体，出生 key 是 `keys[i]`；战场 bossId 与 HUD 同源。
 *  业主 2026-10-30：**会移动**的首领在双人场地里每位玩家各一只（两条巡逻线各一条），站定首领仍只一只。 */
function assertBossFields(h, m, keys) {
  assert.equal(m.fields.length, keys.length, 'boss 场地数 = 6 名存活棋手两两一组');
  m.fields.forEach((f, i) => {
    const bosses = bossSpawnOf(f);
    const want = bossStandsStill(m.gd, keys[i]) ? 1 : 2;
    assert.equal(bosses.length, want, `${f.fieldId}: ${keys[i]} ${want === 1 ? '站定 ⇒ 一只' : '会移动 ⇒ 每位玩家一只'}`);
    for (const b of bosses) assert.equal(spawnKey(b), keys[i], `${f.fieldId}: 首领本体 = ${keys[i]}（不是模板里的官方首领）`);
    if (want === 2) {
      assert.notEqual(bosses[0].route, bosses[1].route, `${f.fieldId}: 两只各走一条巡逻线`);
      assert.deepEqual(bosses[0].route.start, bosses[1].route.start, `${f.fieldId}: 两条线的起点都是场地中心`);
    }
    // 战场自己的 bossId 也是「·重构」那一条 —— HUD / 领袖结算读它
    assert.equal(f.battle ? f.battle.opts.bossId : f.opts.bossId, m.phase === PHASE.HIDDEN_CORE ? m.hiddenBossId : m.bossId, `${f.fieldId}: bossId`);
  });
  assert.deepEqual(h.logs.error, [], '整局没有 reportError');
  assert.deepEqual(h.sched.errors, [], '调度回调没有抛异常');
}

// -------------------------------------------------------------------------------------------------------------
// R20 最终攻势 → R21 隐秘核心（单人候选，走完整 21 回合）

test('整局 R20+R21：最终攻势把首领换成 玻利瓦尔·重构，池 = 包记录 × 6 人；达标后进入隐秘核心换成 伤心的大锁·重构', () => {
  const { h, m } = reconMatchToBoss({ bosses: { 20: SHCHMR, 21: CSDOLL }, to: PHASE.FINAL_ASSAULT });
  // —— 第 20 回合的最终攻势 ——
  assert.equal(m.round, m.gd.bossRound, '停在最终攻势');
  assert.equal(m.alivePlayers().length, 6, '6 名棋手都活着（3 块场地）');
  assert.equal(m.bossId, SHCHMR, 'bossId 切成包记录 key（不是原版首领）');
  assertBossFields(h, m, [SHCHMR, SHCHMR, SHCHMR]);
  const rec20 = m.gd.enemy(SHCHMR);
  assert.ok(rec20 && rec20.stats.maxHp > 0, '包记录在数据里');
  const alive = m.alivePlayers().length;
  assert.equal(m.bossPool.maxHp, Math.round(rec20.stats.maxHp * m.gd.bossPoolShare(alive)), 'R20 池 = 记录生命 × 人数份额');
  assert.ok(m.bossPool.maxHp >= rec20.stats.maxHp, '不是官方 500000 的兜底池');
  assert.ok(m.hiddenLayerSum > m.gd.hiddenCore.multi, `隐秘核心资格成立（Σ 层 ${m.hiddenLayerSum} > ${m.gd.hiddenCore.multi}）`);
  m.flush(true); // markPublic 是「下次 flush 发」：先把这一帧送出去，再读客户端看到的公开视图
  const pub20 = h.publicState();
  assert.equal(pub20.recon.bossKey, SHCHMR, 'HUD 左上角首领卡 = 玻利瓦尔·重构');
  assert.equal(pub20.bossHp.max, m.bossPool.maxHp, 'HUD 血条上限 = 实际共享池');
  assert.equal(pub20.recon.choices.ai_0.bosses['20'], SHCHMR, '预重构的 R20 选择也在公开视图里');

  // 打空池 → 结算 → 达标 ⇒ 隐秘核心
  assert.ok(h.run(() => h.ended != null || m.phase === PHASE.HIDDEN_CORE, { maxSteps: 2e6 }), '走到隐秘核心');
  assert.equal(m.phase, PHASE.HIDDEN_CORE, '达到隐秘核心');
  assert.equal(m.hiddenReached, true, 'hiddenReached 置位');

  // —— 第 21 回合的隐秘核心 ——
  assert.equal(m.round, m.gd.hiddenRound, '停在隐秘核心回合');
  assert.equal(m.hiddenBossId, CSDOLL, 'hiddenBossId 切成包记录 key');
  assertBossFields(h, m, [CSDOLL, CSDOLL, CSDOLL]);
  assert.equal(m.reconChannel, null, '单只候选不开跨战斗通道');
  const rec21 = m.gd.enemy(CSDOLL);
  assert.equal(m.bossPool.maxHp, Math.round(rec21.stats.maxHp * m.gd.bossPoolShare(alive)), 'R21 池同样按包记录口径');
  m.flush(true);
  const pub21 = h.publicState();
  assert.equal(pub21.bossHp.max, m.bossPool.maxHp, '隐秘核心的 HUD 血条上限 = 实际池');
  assert.equal(pub21.recon.choices.ai_0.bosses['21'], CSDOLL, '预重构的 R21 选择在公开视图里');

  assert.ok(h.run(() => h.ended != null, { maxSteps: 2e6 }), '隐秘核心打完');
  assert.equal(h.ended.victory, true, '整局胜利');
  assert.equal(h.ended.hiddenCleared, true, '隐秘核心已清');
  assert.deepEqual(h.logs.error, [], '整局没有 reportError');
  assert.deepEqual(h.sched.errors, [], '调度回调没有抛异常');
});

// -------------------------------------------------------------------------------------------------------------
// R21 「终始」组：跨战斗通道（core = 终始 / ama = AMa-10 + 异构体）

test('整局 R21 AMa 组：三块场地分守 终始 / AMa-10 / 异构体，core 与 ama 两条通道池跨战场共享', () => {
  const { h, m } = reconMatchToBoss({ bosses: { 20: BSNAKE, 21: AMA_GROUP }, to: PHASE.HIDDEN_CORE });
  assert.equal(m.round, m.gd.hiddenRound, '停在隐秘核心');
  assert.equal(m.alivePlayers().length, 6, '6 名棋手 → 3 块场地');
  assert.ok(m.reconChannel, 'AMa 组开了跨战斗通道');
  const core = m.reconChannel.pool('core');
  const ama = m.reconChannel.pool('ama');
  assert.equal(core.maxHp, m.gd.enemy(MUSNAKE).stats.maxHp, '终始池 = 终始记录生命');
  assert.equal(ama.maxHp, m.gd.enemy(MUAMA).stats.maxHp, 'AMa 池 = AMa-10 记录生命');
  assert.equal(m.bossPool.maxHp, core.maxHp, '完成条件 / HUD 读 core（终始）');
  assert.equal(m.amaPool.maxHp, ama.maxHp, 'AMa-10 / 异构体读 ama');

  // 场地按区域分守：区域1 = 终始，区域2 = AMa-10，区域3 = 异构体
  assertBossFields(h, m, [MUSNAKE, MUAMA, MUTWIN]);
  // 每块战场拿到的 sharedBoss 就是它那一区的通道池
  assert.equal(m.fields[0].battle.sharedBoss, m.bossPool, '区域1 吃 core');
  assert.equal(m.fields[1].battle.sharedBoss, m.amaPool, '区域2 吃 ama');
  assert.equal(m.fields[2].battle.sharedBoss, m.amaPool, '区域3 吃同一条 ama');

  // 共享是真的：区域2 打一点，区域3 与通道池看到同一个数值
  const before = ama.hp;
  const dealt = m.fields[1].battle.sharedBoss.damage('ai_2', 1e6);
  assert.equal(dealt, 1e6, '扣血走了通道');
  assert.equal(ama.hp, before - 1e6, '通道池同步减少');
  assert.equal(m.fields[2].battle.sharedBoss.hp, ama.hp, '区域3 读到同一个池值');

  m.flush(true); // 让客户端看到隐秘核心这一帧（bossHp 只在下一次 flush 发出）
  const pub = h.publicState();
  assert.equal(pub.bossHp.max, core.maxHp, 'HUD 血条上限 = core（终始）');
  assert.equal(pub.recon.choices.ai_0.bosses['21'], AMA_GROUP, 'R21 选择在公开视图里');

  assert.ok(h.run(() => h.ended != null, { maxSteps: 2e6 }), '隐秘核心打完');
  assert.equal(h.ended.victory, true, '整局胜利');
  assert.deepEqual(h.logs.error, [], '整局没有 reportError');
  assert.deepEqual(h.sched.errors, [], '调度回调没有抛异常');
});

// -------------------------------------------------------------------------------------------------------------
// R21 洛伦茨组：区域1 源阶方独立池（22M），区域2/3 洛伦茨 + 源阶方一对共享叠加池（3M × 2）

test('整局 R21 洛伦茨组：区域1 只有 源阶方·重构（2200 万独立池），区域2/3 是 洛伦茨+源阶方 一对（共享 300 万×2）', () => {
  const { h, m } = reconMatchToBoss({ bosses: { 20: DYCYUE, 21: SHP_GROUP }, to: PHASE.HIDDEN_CORE });
  assert.equal(m.round, m.gd.hiddenRound, '停在隐秘核心');
  assert.equal(m.alivePlayers().length, 6, '6 名棋手 → 3 块场地');
  assert.ok(m.reconChannel, '洛伦茨组开了跨战斗通道');
  const base = m.gd.enemy(SHOPHM).stats.maxHp;
  const area1Hp = m.gd.enemy(SHORBB).stats.maxHp;
  assert.equal(m.reconChannel.pool('shp').maxHp, base * 2, '洛伦茨池 = 300 万 × 2 只');
  assert.equal(m.bossPool.maxHp, base * 2, '完成条件 / HUD 读洛伦茨叠加池');
  assert.equal(m.shpArea1Pool.maxHp, area1Hp, '区域1 源阶方独立池 = 它的记录生命');

  const f0 = bossSpawnOf(m.fields[0]);
  assert.equal(f0.length, 1, '区域1 只有一条首领本体');
  assert.equal(spawnKey(f0[0]), SHORBB, '区域1 的首领 = 源阶方·重构');
  for (const i of [1, 2]) {
    const bosses = bossSpawnOf(m.fields[i]);
    assert.equal(spawnKey(bosses[0]), SHOPHM, `区域${i + 1} 的首领 = 洛伦茨·重构`);
    const parts = ((m.fields[i].battle ? m.fields[i].battle.spawns : m.fields[i].opts.spawns) || []).filter((s) => s && s.tag === 'part');
    assert.equal(parts.length, 1, `区域${i + 1}: 追加一只部件`);
    assert.equal(spawnKey(parts[0]), SHORBB, `区域${i + 1}: 部件 = 源阶方·重构`);
  }
  assert.equal(m.fields[0].battle.sharedBoss, m.shpArea1Pool, '区域1 吃自己的 2200 万池');
  assert.equal(m.fields[1].battle.sharedBoss, m.bossPool, '区域2 吃洛伦茨叠加池');
  assert.equal(m.fields[2].battle.sharedBoss, m.bossPool, '区域3 吃同一条叠加池');
  // 叠加是真的：两只洛伦茨共用一条 600 万的池
  assert.equal(m.fields[1].battle.sharedBoss.hp, m.fields[2].battle.sharedBoss.hp, '区域2/3 读到同一个池值');

  m.flush(true); // 让客户端看到隐秘核心这一帧（bossHp 只在下一次 flush 发出）
  const pub = h.publicState();
  assert.equal(pub.bossHp.max, base * 2, 'HUD 血条上限 = 洛伦茨叠加池');
  assert.equal(pub.recon.choices.ai_0.bosses['21'], SHP_GROUP, 'R21 选择在公开视图里');

  assert.ok(h.run(() => h.ended != null, { maxSteps: 2e6 }), '隐秘核心打完');
  assert.equal(h.ended.victory, true, '整局胜利');
  assert.deepEqual(h.logs.error, [], '整局没有 reportError');
  assert.deepEqual(h.sched.errors, [], '调度回调没有抛异常');
});
