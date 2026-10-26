// 45×60 重构战场（workshop/mode-recon/stage-specs/my_map.json）的整备区：普通带与 4 块 boss 场地都是 16 格
// （2 行 × 8 格）+ 8 格临时整备区。地图按第 31/32 行的 a 格 + 第 30 行声明；这里逐场钉住解析出来的棋盘坐标，
// 也钉住官方图仍是 10 / 5。业主 2026-10-26「不要按照原版的 10 格整备区和 5 格临时整备区」。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GEO } from '../shared/constants.js';
import { layoutOf, benchOf, benchTileOf, benchBottomRow, bossAreaLayout, OFFICIAL_LAYOUT } from '../shared/layout.js';

const STAGE = JSON.parse(fs.readFileSync(new URL('../workshop/mode-recon/stage-specs/my_map.json', import.meta.url), 'utf8'));
const L = layoutOf(STAGE);

const shape = (b) => ({
  hand: { rows: b.hand.rows, c0: b.hand.c0, cols: b.hand.cols, size: b.hand.size },
  temp: b.temp ? { row: b.temp.row, c0: b.temp.c0, size: b.temp.size } : null,
});

describe('重构战场 my_map：整备区 16 + 临时 8（按地图格子）', () => {
  test('地图确实声明了 bench，并解析出 10 个场名', () => {
    assert.ok(STAGE.layout.bench, 'my_map 声明了 layout.bench');
    assert.deepEqual(Object.keys(L.bench).sort(), [
      'bossA2:0', 'bossA2:1', 'bossA3:0', 'bossA3:1', 'bossA4:0', 'bossA4:1',
      'bossL', 'bossR', 'normalL', 'normalR',
    ]);
  });

  test('普通带：两行 8 格（棋盘行 5 / 6，列 3–10），临时行是下面第 4 行', () => {
    for (const f of ['normalL', 'normalR']) {
      assert.deepEqual(shape(benchOf(L, f)), {
        hand: { rows: [5, 6], c0: 3, cols: 8, size: 16 },
        temp: { row: 4, c0: 3, size: 8 },
      }, f);
    }
  });

  test('第 1 块 boss 场地（左右两半）：两行 8 格（棋盘行 5 / 6，列 2–9），临时行 4', () => {
    for (const f of ['bossL', 'bossR']) {
      assert.deepEqual(shape(benchOf(L, f)), {
        hand: { rows: [5, 6], c0: 2, cols: 8, size: 16 },
        temp: { row: 4, c0: 2, size: 8 },
      }, f);
    }
  });

  test('第 2 / 3 块 boss 场地：两位棋手各一份（座位 0 在左组，座位 1 在右组）', () => {
    assert.deepEqual(shape(benchOf(L, 'bossL', 1, 0)), {
      hand: { rows: [1, 2], c0: -1, cols: 8, size: 16 }, temp: { row: 0, c0: -1, size: 8 },
    }, 'area2 seat0');
    assert.deepEqual(shape(benchOf(L, 'bossL', 1, 1)), {
      hand: { rows: [5, 6], c0: 8, cols: 8, size: 16 }, temp: { row: 4, c0: 8, size: 8 },
    }, 'area2 seat1');
    assert.deepEqual(shape(benchOf(L, 'bossL', 2, 0)), {
      hand: { rows: [1, 2], c0: -1, cols: 8, size: 16 }, temp: { row: 0, c0: -1, size: 8 },
    }, 'area3 seat0');
    assert.deepEqual(shape(benchOf(L, 'bossL', 2, 1)), {
      hand: { rows: [5, 6], c0: 8, cols: 8, size: 16 }, temp: { row: 4, c0: 8, size: 8 },
    }, 'area3 seat1');
  });

  test('第 4 块 boss 场地（贴地图底边）：临时行在战斗带一侧（第 5 行）', () => {
    assert.deepEqual(shape(benchOf(L, 'bossL', 3, 0)), {
      hand: { rows: [3, 4], c0: 1, cols: 8, size: 16 }, temp: { row: 5, c0: 1, size: 8 },
    }, 'area4 seat0');
    assert.deepEqual(shape(benchOf(L, 'bossL', 3, 1)), {
      hand: { rows: [3, 4], c0: 3, cols: 8, size: 16 }, temp: { row: 5, c0: 3, size: 8 },
    }, 'area4 seat1');
  });

  test('第 2 块场地的每人布局把整备区挂到 bossL / bossR（取景/建区不需要知道第几块）', () => {
    const seat0 = bossAreaLayout(L, 1, 0);
    assert.deepEqual(shape(benchOf(seat0, 'bossL')), shape(benchOf(L, 'bossL', 1, 0)));
    const seat1 = bossAreaLayout(L, 1, 1);
    assert.deepEqual(shape(benchOf(seat1, 'bossL')), shape(benchOf(L, 'bossL', 1, 1)));
  });

  test('格子换算：idx 0–7 第一行、8–15 第二行；临时 8 格；最右一格在列 10', () => {
    const b = benchOf(L, 'normalL');
    assert.deepEqual(benchTileOf(b, 'hand', 0), { row: 5, col: 3 });
    assert.deepEqual(benchTileOf(b, 'hand', 7), { row: 5, col: 10 });
    assert.deepEqual(benchTileOf(b, 'hand', 8), { row: 6, col: 3 });
    assert.deepEqual(benchTileOf(b, 'hand', 15), { row: 6, col: 10 });
    assert.equal(benchTileOf(b, 'hand', 16), null);
    assert.deepEqual(benchTileOf(b, 'temp', 0), { row: 4, col: 3 });
    assert.deepEqual(benchTileOf(b, 'temp', 7), { row: 4, col: 10 });
    assert.equal(benchTileOf(b, 'temp', 8), null);
    assert.equal(benchBottomRow(L, 'normalL'), 4, '临时行在手牌行下方');
    assert.equal(benchBottomRow(L, 'bossL', 3, 0), 3, '第 4 块场地的临时行在上方，底线是手牌第一行');
  });

  test('官方图仍是 10 / 5，不会因为这条声明而改变', () => {
    assert.deepEqual(shape(benchOf(OFFICIAL_LAYOUT)), {
      hand: { rows: [GEO.HAND_ROW], c0: 0, cols: GEO.HAND_SIZE, size: GEO.HAND_SIZE },
      temp: { row: GEO.TEMP_ROW, c0: GEO.TEMP_C0, size: GEO.TEMP_SIZE },
    });
  });
});
