// 重构战场 my_map 的联防路线（业主 2026-10-27）：
//   「单人联防走自己一半的两条地面路线；双人联防先走右半边承接者上方的一条地面路线，进入右半保护目标的敌人保留当前
//    状态再从下方的敌方入口出现走一遍左半边下方的地面路线，进入左半边保护目标时再扣除对应生命值」。
// 官方图没有自己的路线表 ⇒ 一切照旧（escaped_single / escaped_multi 的模板路线）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, give, chessOfTier, legalTileFor, DATA } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { FakeBattle } from './fakeBattle.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { fieldTileOf } from '../../shared/layout.js';
import { uniteRoutePlan, buildUniteWave, routeGroup } from '../../server/match/waves.js';
import { uniteSurvivors } from '../../server/match/unite.js';

const STAGE = JSON.parse(fs.readFileSync(new URL('../../workshop/mode-recon/stages.json', import.meta.url), 'utf8')).my_map;
const ROUTES = STAGE.routes;
const MID = STAGE.layout.mirrorCol / 2;
const RECT = STAGE.layout.battle.unite;

const withStage = (fn) => {
  const prev = process.env.SP_STAGE;
  process.env.SP_STAGE = 'my_map';
  try { return fn(); } finally { if (prev === undefined) delete process.env.SP_STAGE; else process.env.SP_STAGE = prev; }
};

let cached = null;
/** 一局重构对局的 gd + 关卡（只看数据，不推进流程） */
function gdOf() {
  if (cached) return cached;
  cached = withStage(() => {
    const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', difficulty: 'ABYSS', humans: 2, bots: 0, seed: 1, fake: true });
    h.start();
    h.runToPhase('PREP');
    return h.m.gd;
  });
  return cached;
}

/** 一条漏怪（形状同 unite.js planUnite 的 leaked 条目） */
const leak = (key, sourcePlayerId = 'pLeak') => ({ enemyKey: key, mods: null, lpr: 1, sourcePlayerId, tag: null, bounty: null });

describe('重构战场 my_map：联防路线（单人 = 自己半场两条地面；双人 = 右上 → 左下二段）', () => {
  test('单人：只走左半场的两条地面路线，按 spawn 轮换；不带显式 route', () => {
    const plan = uniteRoutePlan(gdOf(), 'my_map', 1);
    assert.ok(plan, '自绘地图有联防路线计划');
    assert.deepEqual(plan.routes, ROUTES, '整张路线表换成地图的');
    const leftWalk = routeGroup(ROUTES, false, 'L', MID);
    assert.equal(leftWalk.length, 2);
    const picks = [0, 1, 2, 3].map((k) => plan.pick(k));
    assert.deepEqual(picks.map((p) => p.routeIndex), [leftWalk[0], leftWalk[1], leftWalk[0], leftWalk[1]], '两条地面路线轮换');
    for (const p of picks) assert.equal(p.route, undefined, '单人没有二段路线');
  });

  test('双人：第一段 = 右半场起点行最大的地面路线；第二段 = 左半场起点行最小的地面路线；中间从下方入口 `[35,30]` 重新出现', () => {
    const plan = uniteRoutePlan(gdOf(), 'my_map', 2);
    assert.ok(plan);
    const pick = plan.pick(0);
    assert.equal(pick.routeIndex, 4, '右半场上方那条地面路线（起点行最大 = [37,30]）');
    assert.deepEqual(ROUTES[pick.routeIndex].start, [37, 30]);
    assert.deepEqual(pick.route.start, [37, 30]);
    assert.deepEqual(pick.route.end, [36, 20], '终点是左目标');
    const types = pick.route.steps.map((s) => s.t);
    const di = types.indexOf('DISAPPEAR');
    assert.ok(di > 0, '到右目标后消失');
    assert.deepEqual(pick.route.steps[di - 1].p, [36, 40], '消失前最后一步就是右门');
    assert.equal(types[di + 1], 'APPEAR');
    assert.deepEqual(pick.route.steps[di + 1].p, [35, 30], '从下方的敌方入口（左下半场路线起点）重新入场');
    assert.ok(pick.route.steps.slice(di + 2).length > 0, '第二段有路线');
    assert.equal(plan.pick(1).route, pick.route, '同一条两段路线（每条出怪各一份，内容相同）');
  });

  test('官方图 / 没有路线表：没有计划（走模板自带路线）', () => {
    const gd = gdOf();
    assert.equal(uniteRoutePlan(gd, null, 2), null);
    assert.equal(uniteRoutePlan(gd, 'act2autochess_m03', 2), null);
    assert.equal(uniteRoutePlan(gd, 'my_map', 1).routes.length, 8);
  });

  test('buildUniteWave：自绘图上所有漏怪改用地图路线（飞行敌人也走地面）；双人每条带二段 route', () => {
    const gd = gdOf();
    const leaked = [leak('enemy_1007_slime'), leak('enemy_1756_demon'), leak('enemy_1505_smfat'), leak('enemy_1007_slime', 'pLeak2')];

    const one = buildUniteWave(gd, leaked, 1, 60, { stageId: 'my_map' });
    assert.deepEqual(one.routes, ROUTES);
    const leftWalk = routeGroup(ROUTES, false, 'L', MID);
    for (const s of one.spawns) assert.ok(leftWalk.includes(s.routeIndex), `${s.enemyKey}: 单人只有左半场地面路线`);
    assert.ok(one.spawns.every((s) => s.route == null), '单人没有显式 route');

    const two = buildUniteWave(gd, leaked, 2, 60, { stageId: 'my_map' });
    for (const s of two.spawns) {
      assert.equal(s.routeIndex, 4, `${s.enemyKey}: 右上半场那条地面路线`);
      assert.ok(s.route && Array.isArray(s.route.steps), '双人带一条两段路线');
      assert.deepEqual(s.preview.start, [37, 30], '预览的起点也是右上入口');
    }

    // 官方图：没有 stageId ⇒ 一条都不带，路线仍是模板自带的那一份
    const off = buildUniteWave(gd, leaked, 2, 60);
    assert.deepEqual(off.routes, gd.wave(gd.unite.templates['2']).routes, 'escaped_multi 模板的路线');
    assert.ok(off.spawns.every((s) => s.route == null));
  });

  test('match 集成：2 人（1 承接者）→ 左半场两条地面路线；3 人（2 承接者）→ 两段路线（服务端跑 / 客户端跑各一遍）', () => {
    for (const clientCombat of [false, true]) {
      for (const [humans, helpers] of [[2, 1], [3, 2]]) {
        withStage(() => {
          const h = makeMatch({
            mode: 'recon', modeId: 'mode_recon_abyss', difficulty: 'ABYSS', humans, bots: 0, seed: 1, fake: true, clientCombat,
            script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 2 } } : {}),
          }).start();
          const m = h.m;
          h.toPrep(1);
          const ranged = chessOfTier(1, (c) => c.position === 'RANGED').filter((x) => m.pool.has(x));
          for (let i = 1; i < humans; i++) give(m, h.ps(`p_${i}`), ranged[i], 'board', legalTileFor(m, h.ps(`p_${i}`), ranged[i]));
          h.drive(() => m.phase === PHASE.UNITE);
          assert.equal(m.phase, PHASE.UNITE, clientCombat ? 'client-side combat' : 'server-run');
          assert.equal(m.unitePlan.helpers.length, helpers);
          // 联防场的真数据：客户端跑 = 过线的 spec（browser / 复算读的就是它），服务端跑 = match 交给 Battle 的 opts
          const field = clientCombat ? m.fields[0].spec : FakeBattle.instances.find((b) => b.kind === 'unite').opts;
          assert.equal(field.stageId, 'my_map');
          assert.deepEqual(field.routes, ROUTES, '联防场的路线表就是地图那一份');
          for (const s of field.spawns) {
            if (helpers === 1) {
              assert.ok(routeGroup(ROUTES, false, 'L', MID).includes(s.routeIndex), `${s.enemyKey}: 左半场地面路线`);
              assert.equal(s.route, undefined);
            } else {
              assert.equal(s.routeIndex, 4);
              assert.ok(Array.isArray(s.route.steps), `${s.enemyKey}: 两段路线过线`);
            }
          }
          m.dispose();
        });
      }
    }
  });

  test('双人联防：左半场玩家换到右半场时，干员按地图的镜像轴镜像（不是 +8 平移）', () => {
    withStage(() => {
      const h = makeMatch({
        mode: 'recon', modeId: 'mode_recon_abyss', difficulty: 'ABYSS', humans: 3, bots: 0, seed: 1, fake: true, clientCombat: true,
        script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 2 } } : {}),
      }).start();
      const m = h.m;
      h.toPrep(1);
      const ranged = chessOfTier(1, (c) => c.position === 'RANGED').filter((x) => m.pool.has(x));
      const p1 = h.ps('p_1'), p2 = h.ps('p_2');
      // p_1（左半场的那位）放两名干员 ⇒ helperOrder 把它排第一，也就是站到**右半场**
      give(m, p1, ranged[0], 'board', legalTileFor(m, p1, ranged[0]));
      give(m, p1, ranged[1], 'board', legalTileFor(m, p1, ranged[1]));
      give(m, p2, ranged[2], 'board', legalTileFor(m, p2, ranged[2]));
      h.drive(() => m.phase === PHASE.UNITE);
      assert.deepEqual(m.unitePlan.helpers.map((x) => x.playerId), ['p_1', 'p_2'], 'p_1 率先迎敌（右半场）');

      const b = createBattleFromSpec(m.fields[0].spec, new DataSource(DATA, null), { recordEvents: false, quiet: true });
      b.step();
      for (const [ps, half] of [[p1, 'normalR'], [p2, 'normalL']]) {
        for (const [key, piece] of ps.board) {
          const [row, col] = key.split(',').map(Number);
          const want = fieldTileOf(m.layout, half, row, col);
          const u = b.allyUnits.find((x) => x.uid === piece.uid && x.ownerId === ps.playerId);
          assert.ok(u && u.deployed, `${ps.playerId} ${piece.id} 已部署`);
          assert.deepEqual([u.tileR, u.tileC], want, `${ps.playerId} ${piece.id}: 棋盘 (${row},${col}) → ${half} 上的镜像位置`);
          if (half === 'normalR') assert.ok(u.tileC > MID, `${ps.playerId}: 在右半场（col ${u.tileC}）`);
          else assert.ok(u.tileC <= MID, `${ps.playerId}: 在左半场（col ${u.tileC}）`);
        }
      }
      m.dispose();
    });
  });

  test('sim：双人二段路线 —— 先到右门、保留状态从 [35,30] 再入场、只在左门漏一次（记漏怪者）', () => {
    const plan = uniteRoutePlan(gdOf(), 'my_map', 2);
    const route = plan.pick(0).route;
    const KEY = 'enemy_1007_slime';
    const leaksAt = [];
    const h = makeBattle({
      stage: STAGE, kind: 'unite', rect: RECT, routes: ROUTES, timeLimit: 150, content: 'none', autoFinish: true,
      players: [
        { playerId: 'pL', seat: 0, side: 'L', colOffset: 0, units: [] },
        { playerId: 'pR', seat: 1, side: 'R', colOffset: 8, units: [] },
      ],
      enemies: [{ key: KEY, time: 0, route, sourcePlayerId: 'pLeak' }],
      setup: (b) => {
        b.on('enemyLeak', (ctx) => leaksAt.push([Math.round(ctx.enemy.y), Math.round(ctx.enemy.x)]), { priority: 1000 });
      },
    });
    h.run(0.05);
    const e = h.enemy(KEY);
    assert.ok(e && e.alive, '敌人已入场');
    assert.ok(e.x > MID, `从右半场进来（x=${e.x}）`);
    e.hp = e.hp * 0.5;
    const halfHp = e.hp;

    let rightSeen = false;
    let backSeen = false;
    let hpKept = true;
    for (let i = 0; i < 20000 && !h.battle.finished && e.alive; i++) {
      h.battle.step();
      if (!e.alive) break;
      if (e.hidden) continue;
      if (e.x >= RECT.c1 - 0.6) rightSeen = true;
      if (rightSeen && e.x <= MID + 0.6) backSeen = true;
      if (backSeen && Math.abs(e.hp - halfHp) > 1e-6) hpKept = false;
    }
    assert.ok(rightSeen && backSeen, `先到右门再从下方入口回到左半场（rightSeen=${rightSeen}, backSeen=${backSeen}）`);
    assert.ok(hpKept, '跨过右门时保留当前状态（HP 不变）');
    assert.deepEqual(leaksAt, [[36, 20]], '只有一次漏怪，而且在左目标');

    const res = h.battle.result();
    const entries = Object.values(res.perPlayer).flatMap((pp) => pp.leaked || []);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].sourcePlayerId, 'pLeak');
    const billed = uniteSurvivors({ notReentered: new Map(), helpers: [], leakers: [], leaked: [] }, res);
    assert.deepEqual([...billed], [['pLeak', 1]], '只扣一次（右门不结算）');
  });
});
