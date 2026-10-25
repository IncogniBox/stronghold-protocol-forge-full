// Boss areas 2… (`layout.bossAreas`): each field's players deploy on their OWN rectangle of that field, no mirror
// (owner 2026-10-24「boss区域2、boss区域3、boss区域4 都改为和 boss区域1 一样的可设置部署地块」). Field 1 keeps the
// two mirrored halves of `deployRects.bossLeft` / `bossRight`; fields 2… read `bossAreas[i].deploy[k]` and every reader
// (server legality, the battle, the prep view) goes through the per-player layout (`shared/layout.js bossAreaLayout`).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeployMap, canPlace, boardOf } from '../../server/match/board.js';
import {
  layoutOf, bossAreaCount, bossAreaDeployRect, bossAreaDeployRectMap, bossAreaBattleRect, bossAreaLayout, boardRectOf, fieldTileOf,
} from '../../shared/layout.js';
import { deriveDeployTiles, groundRuleOf } from '../../shared/stageAuthoring.js';
import { Battle } from '../../server/sim/Battle.js';
import { deploySets } from '../../public/js/ui/gameLogic.js';
import { DATA, makeMatch } from './harness.js';

const STAGE = 'my_map';
const layout = layoutOf(DATA.stages[STAGE]);

describe('boss areas 2…: each player deploys on its own rectangle', () => {
  test('the map declares four fields; field 1 = deployRects.bossLeft / bossRight, 2… = bossAreas[i].deploy', () => {
    assert.equal(bossAreaCount(layout), 4);
    assert.deepEqual(bossAreaDeployRect(layout, 0, 0), layout.deployRects.bossLeft);
    assert.deepEqual(bossAreaDeployRect(layout, 0, 1), layout.deployRects.bossRight);
    for (let i = 1; i < 4; i++) {
      assert.deepEqual(bossAreaDeployRect(layout, i, 0), layout.bossAreas[i].deploy[0]);
      assert.deepEqual(bossAreaDeployRect(layout, i, 1), layout.bossAreas[i].deploy[1]);
    }
  });

  test('every declared boss area derives its own deploy tiles (what the editor paints)', () => {
    const st = DATA.stages[STAGE];
    const dt = deriveDeployTiles(st.rows, st.tiles, st.devices, {
      groundHighGround: groundRuleOf(st),
      rects: { ...layout.deployRects, ...bossAreaDeployRectMap(layout) },
    });
    for (let i = 1; i < 4; i++) {
      for (const k of [0, 1]) {
        const key = `bossA${i + 1}:${k}`;
        assert.ok(dt[key], `${key} derived`);
        assert.ok(dt[key].melee.length > 0, `${key} has melee tiles`);
      }
    }
    // 记录里保存的那份必须就是这份（server/stageAuthoring.js 的 STALE_DERIVED 校验同一口径）
    assert.deepEqual(st.deployTiles, dt);
  });

  test('a per-player layout maps board → its own rectangle, never mirrored', () => {
    for (let i = 1; i < 4; i++) {
      for (const seat of [0, 1]) {
        const rect = bossAreaDeployRect(layout, i, seat);
        const L = bossAreaLayout(layout, i, seat);
        const B = boardRectOf(L, 'bossL');
        // the board's bottom row / left column land on the rectangle's top row / left column
        assert.deepEqual(fieldTileOf(L, 'bossL', B.r1, B.c0), [rect[1], rect[2]], `area ${i + 1} seat ${seat}`);
        // a battle height layout: the area's own battle rect, and the mirror column maps the rectangle onto itself
        assert.deepEqual(L.battle.boss, bossAreaBattleRect(layout, i));
        assert.equal(L.mirrorCol, rect[2] + rect[3]);
      }
    }
    // field 1 returns the map's own layout unchanged (its halves still mirror about the map's axis)
    assert.equal(bossAreaLayout(layout, 0, 1), layout);
  });

  test('the deploy map of each area is read from that area’s tiles', () => {
    for (let i = 1; i < 4; i++) {
      for (const seat of [0, 1]) {
        const L = bossAreaLayout(layout, i, seat);
        const map = buildDeployMap(DATA.stages[STAGE], { field: 'bossL', layout: L });
        // 区域 4 移到 3–9 行后落在地图的普通地板（`f`，不可部署）—— 部署图可以是空的；这里只钉「客户端 = 服务端」
        if (i < 3) assert.ok(map.size > 0, `area ${i + 1} seat ${seat} has deployable tiles`);
        // the client's mirror reads the same per-player layout
        const sets = deploySets(DATA.stages[STAGE], 'bossL', {}, L);
        assert.deepEqual([...sets.ranged].sort(), [...map.keys()].sort(), `area ${i + 1} seat ${seat}: client = server`);
        const B = boardOf(L, 'bossL');
        for (const k of map.keys()) {
          const [r, c] = k.split(',').map(Number);
          assert.ok(r >= B.r0 && r <= B.r1 && c >= B.c0 && c <= B.c1, `${k} inside the area board`);
          const [sr, sc] = fieldTileOf(L, 'bossL', r, c);
          assert.ok(Number.isInteger(sr) && Number.isInteger(sc), `${k} maps onto a map tile`);
        }
      }
    }
    // and the two seats of an area are different rectangles (not a mirror pair)
    assert.notDeepEqual(bossAreaDeployRect(layout, 2, 0), bossAreaDeployRect(layout, 2, 1));
  });

  test('a boss-round match: every pair gets its own area, its own field and its own layout', () => {
    // 8 humans → 4 pairs → all four declared fields are used (ceil(8/2) = 4)
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 8, seed: 31, fake: true }).start();
    h.setStage(STAGE);
    const m = h.m;
    m.layout = layoutOf(m.stage);   // 真局里换图走 `g.stage` intent（intents.js 同一步）；harness 的 setStage 只换记录
    h.toPrep(m.gd.bossRound);
    assert.equal(m.bossWaves.length, 4);
    for (let i = 0; i < 4; i++) {
      const ids = m.bossWaves[i].players;
      assert.equal(ids.length, 2);
      ids.forEach((pid, seat) => {
        const ps = h.ps(pid);
        assert.deepEqual(m.bossAreaOf(ps), { index: i, seat });
        if (i === 0) {
          assert.equal(m.deployFieldOf(ps), seat === 0 ? 'bossL' : 'bossR');
        } else {
          assert.equal(m.deployFieldOf(ps), 'bossL', `${pid} deploys on its own rect (no mirror)`);
          const L = m.deployLayoutOf(ps);
          assert.deepEqual(L.deployRects.bossLeft, bossAreaDeployRect(layout, i, seat));
          assert.deepEqual(m.bossAreaRectOf(ps), bossAreaBattleRect(layout, i));
          // the player's deploy map is built on that rectangle (area 4 currently stands on plain floor ⇒ empty is legal)
          const dmap = m.deployMapFor(ps);
          if (i < 3) assert.ok(dmap.size > 0, `${pid} has deployable tiles in area ${i + 1}`);
          const B = boardOf(L, 'bossL');
          for (const [k, cls] of dmap) {
            const [r, c] = k.split(',').map(Number);
            assert.ok(r >= B.r0 && r <= B.r1 && c >= B.c0 && c <= B.c1);
            assert.ok(canPlace(dmap, cls, r, c, L, 'bossL'));
          }
        }
      });
    }
    m.dispose();
  });

  test('the battle stands a field 2… player on its own rectangle (no mirror, own battle rect)', () => {
    const rect = bossAreaDeployRect(layout, 2, 1);
    const battle = new Battle({
      stage: DATA.stages[STAGE], kind: 'boss',
      rect: bossAreaBattleRect(layout, 2),
      players: [{ playerId: 'p', side: 'R', bossRect: rect, units: [] }],
      autoFinish: false,
    });
    const ps = battle.players[0];
    assert.equal(ps.deployField, 'bossL', 'a per-player rect never mirrors');
    assert.equal(ps.mirror, false);
    assert.equal(ps.dir, 'RIGHT');
    assert.equal(ps.half, 'R');
    assert.deepEqual(ps.layout.deployRects.bossLeft, rect);
    // board (12, 2) = the rectangle's top row / left column; board rows 9–12 = the field's rows
    assert.deepEqual(battle.mapTile(ps, 12, 2), [rect[1], rect[2]]);
    assert.deepEqual(battle.mapTile(ps, 9, 2), [rect[1] - 3, rect[2]]);
    battle.dispose?.();
  });

  test('fewer players than fields: ceil(players / 2) fields are used (3 players → 2)', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, seed: 32, fake: true }).start();
    h.setStage(STAGE);
    const m = h.m;
    m.layout = layoutOf(m.stage);
    h.toPrep(m.gd.bossRound);
    // 3 人 → 2 块场地（ceil(3 / 2)），用到的只有前两块
    assert.equal(m.bossWaves.length, Math.ceil(3 / 2));
    for (const ps of m.alivePlayers()) {
      const a = m.bossAreaOf(ps);
      assert.ok(a.index === 0 || a.index === 1, `${ps.playerId} in area ${a.index + 1}`);
      assert.equal(m.deployFieldOf(ps), a.index > 0 ? 'bossL' : a.seat === 0 ? 'bossL' : 'bossR');
    }
    m.dispose();
  });
});
