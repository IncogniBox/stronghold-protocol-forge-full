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
import { routeGroup, routeIndexIn, routeSpawn, stageRoutesOf } from '../../server/match/waves.js';

const STAGE = JSON.parse(fs.readFileSync(new URL('../../workshop/mode-recon/stages.json', import.meta.url), 'utf8')).my_map;
const ROUTES = STAGE.routes;
const MID = STAGE.layout.mirrorCol / 2;

/** A recon match on the 45×60 map, at its first prep (the stage is forced like the editor's ▶ playtest). */
function reconPrep(o = {}) {
  const prev = process.env.SP_STAGE;
  process.env.SP_STAGE = 'my_map';
  try {
    const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_funny', difficulty: 'FUNNY', humans: 2, bots: 0, seed: 1, fake: true, ...o });
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
    assert.equal(m.stage.routes.length, 8, '编译后的 stage 带着作者画的路线');
    assert.deepEqual(m.wave.routes, ROUTES, '整张路线表换成地图的');
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

  test('官方图没有自己的路线表：不换表、不按半场复制出怪', () => {
    const prev = process.env.SP_STAGE;
    delete process.env.SP_STAGE;
    try {
      const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 0, bots: 1, seed: 3, fake: true });
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
