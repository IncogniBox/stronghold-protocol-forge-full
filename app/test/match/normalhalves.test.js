// 普通带左右两半（业主 2026-10-21 / 2026-10-24 确认）：一张声明了 `normalLeft` / `normalRight` 的图，
// 普通回合也按座位两两配对，**同一块普通对战区里一左一右两位玩家**。这里用 my_map 钉住这条行为：
//   * 4 人 → 两个普通战场，每组一人 L 一人 R；
//   * 3 人 → 一组两人 + 一组单人（单人站左半）；
//   * 左右半场的部署矩形、合法格完全镜像（地形也必须是关于镜像轴对称的）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { layoutOf, isDualLayout } from '../../shared/layout.js';
import { DATA, makeMatch } from './harness.js';

const STAGE = 'my_map';

function matchAt(round, humans, seed) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans, seed, fake: true }).start();
  h.setStage(STAGE);
  h.m.layout = layoutOf(h.m.stage);   // 真局里换图走 g.stage intent
  h.toPrep(round);
  return h;
}

describe('普通作战区左右两半：一左一右两位玩家', () => {
  test('my_map 的普通带是左右两半（normalLeft / normalRight），地形关于镜像轴对称', () => {
    const layout = layoutOf(DATA.stages[STAGE]);
    assert.equal(isDualLayout(layout), true);
    const rows = DATA.stages[STAGE].rows;
    const [r0, r1, c0, c1] = layout.deployRects.normalLeft;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        assert.equal(rows[r][c], rows[r][layout.mirrorCol - c], `row ${r} col ${c} mirrors`);
      }
    }
  });

  test('4 人：两个普通战场，每组一人左半一人右半，部署格数一致', () => {
    const h = matchAt(1, 4, 51);
    const m = h.m;
    assert.equal(m.dualNormal, true);
    const groups = m.normalGroups();
    assert.equal(groups.length, 2, '4 人 = 两组');
    assert.deepEqual(groups.map((g) => g.map((x) => x.side)), [['L', 'R'], ['L', 'R']]);
    for (const g of groups) {
      for (const { ps, side } of g) {
        assert.equal(m.deployFieldOf(ps), side === 'R' ? 'normalR' : 'normalL', `${ps.playerId} ${side}`);
        const rect = side === 'R' ? m.layout.deployRects.normalRight : m.layout.deployRects.normalLeft;
        assert.deepEqual(m.deployLayoutOf(ps).deployRects[side === 'R' ? 'normalRight' : 'normalLeft'], rect);
        assert.ok(m.deployMapFor(ps).size > 0, `${ps.playerId} has deploy tiles`);
      }
    }
    // 左右半场是同一副镜像地形 ⇒ 合法格（键与类别）逐条相同
    const L = groups[0][0].ps, R = groups[0][1].ps;
    assert.deepEqual([...m.deployMapFor(L)].sort(), [...m.deployMapFor(R)].sort());
    m.dispose();
  });

  test('3 人：一组两人（左右）+ 一组单人（左半）', () => {
    const h = matchAt(1, 3, 52);
    const m = h.m;
    const groups = m.normalGroups();
    assert.deepEqual(groups.map((g) => g.length), [2, 1]);
    assert.deepEqual(groups[0].map((x) => x.side), ['L', 'R']);
    assert.equal(groups[1][0].side, 'L');
    assert.equal(m.deployFieldOf(groups[1][0].ps), 'normalL');
    m.dispose();
  });
});
