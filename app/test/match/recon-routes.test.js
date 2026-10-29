// 重构战场 my_map 的敌人路线（业主 2026-10-26「敌人的行动路径按照我在地图上画的 8 条路线来……左半场的敌人用左半边的
// 路线，右半场的敌人用右半边的路线」「按照对应玩家场地上方的怪物等待区里的怪物来算，只走自己的半场，漏怪扣除的生命值也是
// 根据自己半场来算」）：
//   * 地图画了 8 条路线（左 4 / 右 4，各 2 地面 + 2 空中），运行期的整张路线表换成它们；
//   * 双人同场时**每个半场一份**出怪，各自只走自己那半场的路线，漏怪按半场记到那位玩家头上；
//   * 官方图没有自己的路线表 ⇒ 一切照旧（不复制出怪、不用 stage.routes）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeMatch } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { createRng } from '../../server/sim/rng.js';
import { routeGroup, routeIndexIn, routeSpawn, stageRoutesOf, stageBossRoutesOf, buildBossWave, setupMatchWaves } from '../../server/match/waves.js';

const STAGE = JSON.parse(fs.readFileSync(new URL('../../workshop/mode-recon/stages.json', import.meta.url), 'utf8')).my_map;
const ALL_ROUTES = STAGE.routes;
/** boss 区域的那几条（起点落在四块 boss 场地矩形里）——普通回合不用它们，只给首领。 */
const BOSS_RECTS = [STAGE.layout.battle.boss, ...STAGE.layout.bossAreas.slice(1).map((a) => a.battle)];
const inBossArea = (r) => BOSS_RECTS.some((q) => r.start[0] >= q.r0 && r.start[0] <= q.r1 && r.start[1] >= q.c0 && r.start[1] <= q.c1);
const BOSS_ROUTES = ALL_ROUTES.filter(inBossArea);
const ROUTES = ALL_ROUTES.filter((r) => !inBossArea(r));
const MID = STAGE.layout.mirrorCol / 2;

/** A recon match on the 45×60 map, at its first prep (the stage is forced like the editor's ▶ playtest). */
function reconPrep(o = {}) {
  const prev = process.env.SP_STAGE;
  process.env.SP_STAGE = 'my_map';
  try {
    const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', difficulty: 'ABYSS', humans: 2, bots: 0, seed: 1, fake: true, ...o });
    h.start();
    h.runToPhase('PREP');
    return h;
  } finally {
    if (prev === undefined) delete process.env.SP_STAGE; else process.env.SP_STAGE = prev;
  }
}

describe('重构战场 my_map：8 条作者路线（左 4 / 右 4，各 2 地面 + 2 空中）', () => {
  test('路线按终点列分半、按移动方式分组；同组按 k 轮换（作者画的两条变体都走到）', () => {
    assert.equal(ROUTES.length, 8);
    const walkL = routeGroup(ROUTES, false, 'L', MID);
    const walkR = routeGroup(ROUTES, false, 'R', MID);
    const flyL = routeGroup(ROUTES, true, 'L', MID);
    const flyR = routeGroup(ROUTES, true, 'R', MID);
    assert.equal(walkL.length, 2, '左半场 2 条地面');
    assert.equal(walkR.length, 2, '右半场 2 条地面');
    assert.equal(flyL.length, 2, '左半场 2 条空中');
    assert.equal(flyR.length, 2, '右半场 2 条空中');
    for (const i of walkL) assert.ok(ROUTES[i].end[1] < MID);
    for (const i of walkR) assert.ok(ROUTES[i].end[1] > MID);
    for (const i of [...flyL, ...flyR]) assert.equal(ROUTES[i].motion, 'FLY');
    assert.equal(routeIndexIn(ROUTES, false, 'L', MID, 0), walkL[0]);
    assert.equal(routeIndexIn(ROUTES, false, 'L', MID, 1), walkL[1]);
    assert.equal(routeIndexIn(ROUTES, false, 'L', MID, 2), walkL[0], 'k wraps around the group');
  });

  test('地图的 8 条路线成为这一回合的路线表；双人同场时每个半场各一份出怪，路线终点落在自己半场', () => {
    const h = reconPrep();
    const m = h.m;
    assert.equal(m.stageId, 'my_map');
    assert.equal(m.stage.routes.length, 16, '编译后的 stage 带着作者画的 16 条路线（8 普通 + 8 boss 区域）');
    assert.deepEqual(m.wave.routes, ROUTES, '普通回合的路线表只取地图上非 boss 区域的 8 条');
    const base = m.wave.spawns.length;
    assert.ok(base > 0);
    for (const s of m.wave.spawns) {
      const r = m.wave.routes[s.routeIndex];
      assert.ok(r, `spawn ${s.enemyKey} points at a map route`);
    }
    const groups = m.normalGroups();
    const pair = groups.find((g) => g.length === 2);
    assert.ok(pair, 'a two-half ordinary field pairs the seats');
    const opts = m._normalGroupOpts(pair);
    assert.equal(opts.spawns.length, base * 2, '每个半场一份完整波次');
    for (const { ps, side } of pair) {
      const own = opts.spawns.filter((s) => s.ownerPlayerId === ps.playerId && s.tag !== 'bounty');
      assert.equal(own.length, base, `${ps.playerId}: 自己那一份`);
      for (const s of own) {
        const end = opts.routes[s.routeIndex].end[1];
        assert.ok(side === 'R' ? end > MID : end < MID, `${ps.playerId}: ${s.enemyKey} 走自己半场的门 (col ${end})`);
      }
    }
  });

  test('等待区（m.private.nextEnemies）只列自己半场那一份', () => {
    const h = reconPrep();
    const m = h.m;
    for (const ps of m.order) {
      const list = ps.privateView().nextEnemies;
      assert.equal(list.length, m.wave.spawns.length, `${ps.playerId}: 与出怪条目同数`);
    }
  });

  test('sim：左右两半的敌人各自走到自己那半的门，漏怪记在那位玩家头上', () => {
    const stage = STAGE;
    const h = makeBattle({
      stage, kind: 'normal', rect: { r0: 34, r1: 38, c0: 20, c1: 40 }, routes: ROUTES, timeLimit: 150,
      players: [
        { playerId: 'pL', seat: 0, side: 'L', colOffset: 0, units: [] },
        { playerId: 'pR', seat: 1, side: 'R', colOffset: 10, units: [] },
      ],
      enemies: [
        { key: 'enemy_1007_slime', routeIndex: routeGroup(ROUTES, false, 'L', MID)[0], count: 1, ownerPlayerId: 'pL' },
        { key: 'enemy_1071_dftman', routeIndex: routeGroup(ROUTES, false, 'R', MID)[0], count: 1, ownerPlayerId: 'pR' },
      ],
      content: 'none',
    });
    h.run(150);
    const res = h.battle.result();
    assert.deepEqual(res.perPlayer.pL.leaked.map((l) => l.enemyKey), ['enemy_1007_slime'], '左半场的漏怪记给左半场玩家');
    assert.deepEqual(res.perPlayer.pR.leaked.map((l) => l.enemyKey), ['enemy_1071_dftman'], '右半场的漏怪记给右半场玩家');
    assert.equal(h.battle.result().perPlayer.pL.killedInTotal, 0);
  });

  test('boss 区域路线：四块场地各 2 条、起点在各自矩形内、闭环（起点 = 终点）', () => {
    const h = reconPrep();
    const gd = h.m.gd;
    assert.equal(BOSS_ROUTES.length, 8, '四块 boss 区域各两条');
    for (let i = 0; i < 4; i++) {
      const list = stageBossRoutesOf(gd, 'my_map', i);
      assert.equal(list.length, 2, `区域${i + 1} 两条`);
      const q = BOSS_RECTS[i];
      for (const r of list) {
        assert.deepEqual(r.start, r.end, `区域${i + 1} 的路线是闭环（终点回到起点）`);
        assert.ok(r.start[0] >= q.r0 && r.start[0] <= q.r1 && r.start[1] >= q.c0 && r.start[1] <= q.c1,
          `区域${i + 1} 的起点落在该区域的战斗矩形里（首领站位中心）`);
      }
    }
  });

  test('boss 回合的护送小怪也走地图：模板路线按比例缩进这块场地的战斗矩形', () => {
    const h = reconPrep();
    const m = h.m;
    const setup = setupMatchWaves(m.gd, createRng(1));
    const bossId = Object.keys(m.gd.mode && m.gd.mode.hiddenBossWeights || {})[0] || 'boss_8';
    for (let i = 0; i < 4; i++) {
      const w = buildBossWave(m.gd, createRng(1), setup.factions, 21, { bossId, solo: false, areaIndex: i }, 'my_map');
      const q = BOSS_RECTS[i];
      assert.ok(w.routes.length >= 3, `区域${i + 1}: 模板路线换成缩放后的那几条`);
      const ptsOf = (r) => [r.start, r.end, ...(Array.isArray(r.checkpoints) ? r.checkpoints : [])
        .map((c) => (Array.isArray(c) ? (typeof c[0] === 'number' ? c : c.slice(1)) : null)).filter(Boolean)];
      for (const s of w.spawns) {
        if (s.tag === 'boss' || s.tag === 'part') continue;   // 首领 / 部位走的是该区域的闭环巡逻线
        const r = w.routes[s.routeIndex];
        assert.ok(r, `区域${i + 1}: ${s.enemyKey} 有路线`);
        for (const p of ptsOf(r)) {
          assert.ok(p[0] >= q.r0 && p[0] <= q.r1 && p[1] >= q.c0 && p[1] <= q.c1,
            `区域${i + 1}: 护送路线点 ${JSON.stringify(p)} 落在场内 ${JSON.stringify(q)}`);
        }
      }
    }
  });

  test('闭环巡逻线：走完一圈回到起点不算漏怪，敌人仍在场上', () => {
    const loop = { motion: 'WALK', start: [2, 10], end: [2, 10], checkpoints: [[2, 6], [4, 6], [4, 14], [2, 14]] };
    const h = makeBattle({
      stage: 'flat', kind: 'boss', rect: { r0: 1, r1: 5, c0: 2, c1: 18 }, routes: [loop], timeLimit: 120,
      players: [{ playerId: 'p0', seat: 0, side: 'L', colOffset: 0, units: [] }],
      enemies: [{ key: 'enemy_1007_slime', routeIndex: 0, count: 1, ownerPlayerId: 'p0', tag: 'boss' }],
      content: 'none',
    });
    h.run(120);
    const res = h.battle.result();
    assert.equal(res.perPlayer.p0.leaked.length, 0, '走完一圈 / 数圈都不算漏怪');
    const alive = h.battle.enemies.filter((e) => e.alive);
    assert.equal(alive.length, 1, '巡逻中的首领一直留在场上（不是走一圈就消失）');
    assert.equal(alive[0].route.loop, true, '闭环路线被认成巡逻');
  });

  test('官方图没有自己的路线表：不换表、不按半场复制出怪', () => {
    const prev = process.env.SP_STAGE;
    delete process.env.SP_STAGE;
    try {
      const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', humans: 0, bots: 1, seed: 3, fake: true });
      h.start();
      h.runToPhase('PREP');
      const m = h.m;
      assert.equal(stageRoutesOf(m.gd, m.stageId), null);
      const groups = m.normalGroups();
      const opts = m._normalGroupOpts(groups[0]);
      assert.equal(opts.spawns.length, m.wave.spawns.length, '官方图一个玩家一份，不复制');
    } finally {
      if (prev !== undefined) process.env.SP_STAGE = prev;
    }
  });
});
