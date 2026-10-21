// test/layout.test.js — 大图支持：一张地图自己的尺寸与分区（shared/layout.js）。
//
// 业主 2026-10-08：「你能稍微把地图做的更大些吗，加入对大图的支持怎么样，这样图会更多样化」。
//
// 这个文件守两件互相拉扯的事：
//   1. **官方零变化**：`layoutForSize(19×21)` 解出来的每一个数字都必须与历史常量逐字段相等，棋盘↔地图的映射也必须
//      与旧公式（普通恒等、boss 减 7、bossR 过 20 列镜像）逐格相等 —— 11 张官方图与素材靠这条不动。
//   2. **大图真的能玩**：三档尺寸的带位、部署矩形的形状、越界声明回落、以及一张 23×27 的图从授权到引擎到部署图全链。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GEO } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';
import {
  OFFICIAL_LAYOUT, OFFICIAL_SIZE, SIZE_PRESETS, MIN_ROWS, MIN_COLS, MAX_ROWS, MAX_COLS,
  layoutForSize, normalizeLayout, layoutOf, isOfficialLayout, sizeOf, clampSize, isSize, sizePresetOf, presetStep,
  deployRectOf, deployRectName, stageRowOfBoard, stageColOfBoard, fieldTileOf, boardTileOf, viewRectOf, bandMidOf,
  boardRectOf, handRowOf, tempRowOf,
} from '../shared/layout.js';
import {
  DEPLOY_RECTS, STAGE_ZONES, GATE_PAIRS, STAGE_ROWS, STAGE_COLS, zonesOf, deployRectsOf, gatePairsFor,
  deployRectsAt, roadsOutsideDeployRects, sampleStageSpec, validateStage, stageErrors, HUGE_STAGE_SPEC, hugeStageSpec,
} from '../shared/stageAuthoring.js';
import { deriveStage, validateStageRecord, deriveGroundPaths } from '../server/stageAuthoring.js';
import { buildDeployMap, fieldTile } from '../server/match/board.js';
import { ROWS, COLS } from '../server/sim/constants.js';
import { makeBattle, chessRec, enemyRec, checkInvariants } from './helpers/battleHarness.js';

const deep = (a, b, m) => assert.deepEqual(a, b, m);

describe('官方零变化：19×21 解出来的就是今天那一套', () => {
  test('画布 = 最大档位，官方尺寸 = 最小档位', () => {
    assert.equal(MAX_ROWS, GEO.CANVAS_ROWS, '画布行数就是最大档');
    assert.equal(MAX_COLS, GEO.CANVAS_COLS, '画布列数就是最大档');
    assert.equal(MIN_ROWS, GEO.ROWS, '最小档就是官方尺寸');
    assert.equal(MIN_COLS, GEO.COLS);
    assert.equal(ROWS, GEO.CANVAS_ROWS, 'sim 的步长是画布，不是地图窗口');
    assert.equal(COLS, GEO.CANVAS_COLS);
    deep(SIZE_PRESETS.map((p) => p.size), [[19, 21], [23, 27], [27, 33], [33, 39], [45, 60]]);
  });

  test('三块部署矩形与 stageAuthoring 的官方常量逐条相等（数组形状也一样）', () => {
    deep(OFFICIAL_LAYOUT.deployRects, DEPLOY_RECTS);
    deep(deployRectsOf(OFFICIAL_SIZE), DEPLOY_RECTS);
    deep(OFFICIAL_LAYOUT.deployRects.normal, [9, 12, 2, 10]);
    deep(OFFICIAL_LAYOUT.deployRects.bossLeft, [1, 5, 2, 10]);
    deep(OFFICIAL_LAYOUT.deployRects.bossRight, [1, 5, 10, 18]);
  });

  test('三个战斗矩形与 GEO 的官方常量相等，等待区与镜像轴也一致', () => {
    deep(OFFICIAL_LAYOUT.battle.normal, GEO.NORMAL_RECT);
    deep(OFFICIAL_LAYOUT.battle.unite, GEO.UNITE_RECT);
    deep(OFFICIAL_LAYOUT.battle.boss, GEO.BOSS_RECT);
    deep(OFFICIAL_LAYOUT.pen, { r0: 14, r1: 18, c0: 7, c1: 13 });
    assert.equal(OFFICIAL_LAYOUT.mirrorCol, 20, 'boss 右半场的镜像轴');
    deep(OFFICIAL_LAYOUT.size, [STAGE_ROWS, STAGE_COLS]);
    assert.ok(isOfficialLayout(OFFICIAL_LAYOUT));
    assert.ok(isOfficialLayout(undefined), '没有布局 = 官方');
  });

  test('棋盘↔地图的映射：普通恒等、boss 减 7、bossR 过 20 列镜像', () => {
    const L = OFFICIAL_LAYOUT;
    for (const field of ['normal', 'bossL', 'bossR']) {
      for (const [r, c] of [[9, 2], [10, 8], [12, 10], [7, 0], [8, 4]]) {
        const legacy = field === 'normal' ? [r, c] : [r - 7, field === 'bossR' ? 20 - c : c];
        deep(fieldTileOf(L, field, r, c), legacy, `${field} ${r},${c}`);
        deep(boardTileOf(L, field, legacy[0], legacy[1]), [r, c], `${field} 逆映射 ${r},${c}`);
      }
    }
    // 两个 boss 半场读同一块矩形（左右差别只在镜像）
    assert.equal(deployRectName('bossL'), deployRectName('bossR'));
    deep(deployRectOf(L, 'bossR'), deployRectOf(L, 'bossLeft'));
  });

  test('zonesOf 与官方的 STAGE_ZONES、GATE_PAIRS 与官方 12 对，都是同一份', () => {
    deep(zonesOf(OFFICIAL_SIZE), STAGE_ZONES.map((z) => ({ id: z.id, rows: [...z.rows], deployRects: [...z.deployRects] })));
    deep(zonesOf(OFFICIAL_SIZE).map((z) => z.rows), [[14, 18], [9, 12], [1, 5], [0, 18]]);
    assert.equal(gatePairsFor([], {}, OFFICIAL_SIZE), GATE_PAIRS, '官方尺寸下就是那 12 对');
  });

  test('取景矩形按 kind 取，官方与 GEO/相机预设同值', () => {
    deep(viewRectOf(OFFICIAL_LAYOUT, 'normal'), GEO.NORMAL_RECT);
    deep(viewRectOf(OFFICIAL_LAYOUT, 'unite'), GEO.UNITE_RECT);
    deep(viewRectOf(OFFICIAL_LAYOUT, 'boss'), GEO.BOSS_RECT);
    deep(viewRectOf(OFFICIAL_LAYOUT, 'prep'), { r0: 7, r1: 12, c0: 0, c1: 10 });
    deep(viewRectOf(OFFICIAL_LAYOUT, 'bossPrep'), { r0: 0, r1: 5, c0: 0, c1: 10 });
    deep(viewRectOf(OFFICIAL_LAYOUT, 'pen'), { r0: 14, r1: 18, c0: 7, c1: 13 });
  });
});

describe('大图：带位锚法、形状约束与回落', () => {
  test('五档尺寸的带位：等待区贴顶、普通带离顶第 7–10 行、boss 贴底第 1–5 行', () => {
    for (const { size } of SIZE_PRESETS) {
      const [R, C] = size;
      const L = layoutForSize(size);
      deep(L.size, size);
      // 列**默认不随尺寸变**：任何尺寸解出来都是官方那套（大图默认与官方同锚）
      deep(L.pen, { r0: R - 5, r1: R - 1, c0: 7, c1: 13 }, `${R}×${C} 等待区`);
      deep([L.deployRects.normal[0], L.deployRects.normal[1]], [R - 10, R - 7], `${R}×${C} 普通带`);
      deep([L.deployRects.normal[2], L.deployRects.normal[3]], [2, 10], `${R}×${C} 普通带列`);
      deep([L.deployRects.bossLeft[0], L.deployRects.bossLeft[1]], [1, 5], `${R}×${C} boss 带`);
      deep([L.deployRects.bossLeft[2], L.deployRects.bossLeft[3]], [2, 10], `${R}×${C} boss 左半列`);
      deep([L.deployRects.bossRight[2], L.deployRects.bossRight[3]], [10, 18], `${R}×${C} boss 右半列`);
      assert.equal(L.mirrorCol, 20, `${R}×${C} 镜像轴仍是 20`);
      deep(L.battle.unite, { r0: R - 10, r1: R - 7, c0: 0, c1: C - 1 }, `${R}×${C} 联防满宽`);
      deep(L.battle.boss, { r0: 0, r1: 5, c0: 0, c1: C - 1 }, `${R}×${C} boss 满宽`);
      // 三块矩形永远在窗口里，且之间的先后关系不变（中间战场在 boss 与普通之间）
      for (const [name, [r0, r1, c0, c1]] of Object.entries(L.deployRects)) {
        assert.ok(r0 >= 0 && r1 < R && c0 >= 0 && c1 < C, `${R}×${C} ${name} 在窗口里`);
      }
      assert.ok(L.battle.boss.r1 < L.deployRects.normal[0], `${R}×${C}: boss 带在普通带下方`);
      assert.ok(L.pen.r0 > L.deployRects.normal[1], `${R}×${C}: 等待区在普通带上方`);
      assert.ok(L.pen.r1 <= R - 1 && L.pen.r0 >= 0);
      assert.deepEqual(zonesOf(size).map((z) => z.rows), [[L.pen.r0, L.pen.r1], [R - 10, R - 7], [1, 5], [0, R - 1]]);
    }
  });

  test('部署矩形是棋盘本身的形状，且列被镜像几何定死：普通 4×9、boss 半场 5×9，只有行能动', () => {
    const L = layoutForSize([23, 27]);
    const bad = normalizeLayout({ deployRects: { normal: [0, 0, 0, 0], bossLeft: [1, 5, 2, 10] } }, [23, 27]);
    deep(bad.deployRects.normal, L.deployRects.normal, '形状不对 → 默认');
    deep(bad.deployRects.bossLeft, L.deployRects.bossLeft, '形状对、位置合法 → 保留');
    const outside = normalizeLayout({ deployRects: { normal: [20, 30, 2, 10] } }, [23, 27]);
    deep(outside.deployRects.normal, L.deployRects.normal, '越界 → 默认');
    // 挪行是允许的：整块上移 2 行（列仍由这张图的相接列定出来 —— 这张图没声明，就是官方那两列）
    const moved = normalizeLayout({ deployRects: { normal: [11, 14, 2, 10] } }, [23, 27]);
    deep(moved.deployRects.normal, [11, 14, 2, 10]);
    deep(fieldTileOf(moved, 'normal', 9, 2), [11, 2], '棋盘左上角跟着矩形走');
    // 挪列一律拉回这张图的那两列：棋盘 9 列、两个半场在相接列会合，挪了列对战镜像就对不上了
    const colsMoved = normalizeLayout({ deployRects: { normal: [11, 14, 4, 12] } }, [23, 27]);
    deep(colsMoved.deployRects.normal, [11, 14, 2, 10], '列被归一化回 2..10');
  });

  test('镜像轴由相接列定死（默认 20），声明的值说了不算', () => {
    assert.equal(normalizeLayout({ mirrorCol: 26 }, [23, 27]).mirrorCol, 20, '镜像轴不是可挑的参数');
    deep(deployRectOf(layoutForSize([27, 33]), 'bossRight'), [1, 5, 10, 18], '大图默认与官方同锚：boss 半场列不变');
  });

  test('一张图可以自己声明一整套居中的分区 —— 声明它的那张图才变，别的图不动', () => {
    // 45×60 的中心列是 30（业主点的「整张地图的中心位置」）：两个半场在 30 会合、镜像轴 60
    const centered = layoutForSize([45, 60], bandMidOf([45, 60]));
    deep(centered.deployRects.normal, [35, 38, 22, 30]);
    deep(centered.deployRects.bossLeft, [1, 5, 22, 30]);
    deep(centered.deployRects.bossRight, [1, 5, 30, 38]);
    deep(centered.pen, { r0: 40, r1: 44, c0: 27, c1: 33 }, '等待区跟着居中');
    deep(centered.battle.normal, { r0: 35, r1: 38, c0: 20, c1: 30 }, '战斗矩形跟着居中（棋盘左界再往左 2 列）');
    assert.equal(centered.mirrorCol, 60);
    // 整套声明绕一圈：normalizeLayout 认它（相接列说得出来）
    const kept = normalizeLayout({ deployRects: { normal: [35, 38, 22, 30], bossLeft: [1, 5, 22, 30], bossRight: [1, 5, 30, 38] } }, [45, 60]);
    deep(kept.deployRects.normal, [35, 38, 22, 30]);
    deep(kept.deployRects.bossRight, [1, 5, 30, 38]);
    assert.equal(kept.mirrorCol, 60, '镜像轴 = 相接列 × 2');
    // 三块说不出一条相接列 = 坏数据：整组退回默认锚（官方那套）
    const mixed = normalizeLayout({ deployRects: { normal: [35, 38, 22, 30], bossLeft: [1, 5, 22, 30], bossRight: [1, 5, 2, 10] } }, [45, 60]);
    deep(mixed.deployRects.normal, [35, 38, 2, 10], '退回默认锚');
    assert.equal(mixed.mirrorCol, 20);
    // 别的尺寸/别的图不受影响：同一张 45×60 的图**不声明**时仍是官方锚
    const plain = layoutForSize([45, 60]);
    deep(plain.deployRects.normal, [35, 38, 2, 10]);
    assert.equal(plain.mirrorCol, 20);
  });

  test('尺寸工具：合法区间、档位来回、脏值回落', () => {
    assert.ok(isSize([19, 21]) && isSize([27, 33]) && isSize([23, 25]) && isSize([33, 39]) && isSize([45, 60]));
    for (const bad of [[18, 21], [46, 60], [19, 20], [19, 61], [19], 'x', null, [19, 21, 1]]) assert.ok(!isSize(bad), JSON.stringify(bad));
    deep(clampSize([23, 27]), [23, 27]);
    deep(clampSize('nope'), [19, 21]);
    assert.equal(sizePresetOf([23, 27]), 'large');
    assert.equal(sizePresetOf([33, 39]), 'gigantic');
    assert.equal(sizePresetOf([45, 60]), 'colossal');
    assert.equal(sizePresetOf([23, 25]), null, '自定尺寸没有档位名');
    assert.equal(presetStep('large', 1), 'huge');
    assert.equal(presetStep('huge', 1), 'gigantic');
    assert.equal(presetStep('gigantic', 1), 'colossal');
    assert.equal(presetStep('colossal', 1), 'colossal', '到头就停');
    assert.equal(presetStep('standard', -1), 'standard');
    assert.equal(presetStep('nope', 1), 'large', '脏 id 当作第一档');
  });

  test('地图记录：没写 size/layout 的官方记录当作官方布局', () => {
    deep(sizeOf({}), [19, 21]);
    deep(sizeOf({ size: [23, 27] }), [23, 27]);
    deep(sizeOf({ size: [0, 0] }), [19, 21], '坏尺寸回落，不抛');
    assert.equal(isOfficialLayout(layoutOf({ id: 'x', rows: [] })), true);
    assert.equal(isOfficialLayout(layoutOf({ size: [23, 27] })), false);
    deep(layoutOf({ size: [23, 27] }).deployRects.normal, [13, 16, 2, 10]);
  });
});

// 业主 2026-10-20：一张 27×33 的图，普通部署带是 17–20 行，而 g.move / g.art 的棋盘落点以前以**官方 19×21**
// 为界（shared/protocol.js 的 target() 用 GEO.ROWS/GEO.COLS）—— 那两行因此**发不出落点**（真客户端在这张图上
// 放不下第 19/20 行）。一张图是画布里的窗口，所以线上那道界的正确值就是画布本身。
describe('大图与线上：棋盘落点以画布为界（官方界外的 19/20 行不再是禁区）', () => {
  const mv = (row, col) => validateC2S({ t: 'g.move', uid: 1, to: { area: 'board', row, col }, dir: 'UP' });
  const art = (row, col) => validateC2S({ t: 'g.art', itemUid: 1, row, col, dir: 'UP' });

  test('27×33 的部署带整条都在线上（含官方界外的 19/20 行）', () => {
    const [r0, r1, c0, c1] = deployRectOf(layoutForSize([27, 33]), 'normal');
    assert.ok(r1 > GEO.ROWS - 1, `这条带伸到官方 19×21 之外（到第 ${r1} 行）—— 否则这个用例没意义`);
    for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) {
      assert.equal(mv(row, col), null, `g.move (${row},${col}) 在部署带里`);
      assert.equal(art(row, col), null, `g.art (${row},${col}) 在部署带里`);
    }
  });

  test('越出画布仍被拒 —— 界放宽了，但不是没有界', () => {
    assert.equal(mv(GEO.CANVAS_ROWS - 1, GEO.CANVAS_COLS - 1), null, '画布最后一格合法');
    assert.match(String(mv(GEO.CANVAS_ROWS, 0)), /^bad field /, '画布之外的行');
    assert.match(String(mv(0, GEO.CANVAS_COLS)), /^bad field /, '画布之外的列');
    assert.match(String(art(GEO.CANVAS_ROWS, 0)), /^bad field /, 'g.art 那条内联上界同一条界');
  });
});

describe('棋盘形状：一张图把自己的部署区放大（业主 2026-10-20「从 4×9 扩大到 5×11」）', () => {
  const HUGE = layoutForSize([45, 60], bandMidOf([45, 60]), { rows: 5, cols: 11, normalMargin: 0 });

  test('官方那副棋盘是缺省：boardRectOf / 整备行 / 临时整备行就是 GEO.FIELD 与 GEO.HAND_ROW / TEMP_ROW', () => {
    const box = (r) => [r.r0, r.r1, r.c0, r.c1];
    deep(box(boardRectOf(OFFICIAL_LAYOUT)), [GEO.FIELD.r0, GEO.FIELD.r1, GEO.FIELD.c0, GEO.FIELD.c1]);
    assert.deepEqual([boardRectOf(OFFICIAL_LAYOUT).rows, boardRectOf(OFFICIAL_LAYOUT).cols], [4, 9]);
    deep(box(boardRectOf(OFFICIAL_LAYOUT, 'bossL')), [GEO.FIELD.r0, GEO.FIELD.r1, GEO.FIELD.c0, GEO.FIELD.c1], 'boss 半场与普通带同形（官方）');
    assert.equal(handRowOf(OFFICIAL_LAYOUT), GEO.HAND_ROW);
    assert.equal(tempRowOf(OFFICIAL_LAYOUT), GEO.TEMP_ROW);
    // 一张没声明 layout 的大图（任何尺寸）也还是官方那副棋盘 —— 列不随窗口变
    deep(box(boardRectOf(layoutForSize([45, 60]))), [9, 12, 2, 10]);
    deep(box(boardRectOf(layoutForSize([27, 33]))), [9, 12, 2, 10]);
  });

  test('45×60 的大战场样板：部署区 5×11（34–38 × 20–30），棋盘行 8–12 / 列 2–12', () => {
    deep(HUGE.deployRects.normal, [34, 38, 20, 30]);
    deep(HUGE.deployRects.bossLeft, [1, 5, 22, 30], 'boss 先不变');
    deep(HUGE.deployRects.bossRight, [1, 5, 30, 38]);
    assert.equal(HUGE.mirrorCol, 60);
    // 普通战斗矩形与部署区**同宽同高**（这一张图不要那 2 列场地边距）；整备矩形同比扩到 7 行，且保住那 2 列
    deep(HUGE.battle.normal, { r0: 34, r1: 38, c0: 20, c1: 30 });
    deep(HUGE.battle.prep, { r0: 32, r1: 38, c0: 18, c1: 30 });
    deep(HUGE.battle.bossPrep, { r0: 0, r1: 5, c0: 20, c1: 30 });
    deep(HUGE.pen, { r0: 40, r1: 44, c0: 27, c1: 33 });
    // 棋盘本身：行 8–12（5 行）、列 2–12（11 列），整备行因此下移到 6、临时整备行 7
    const B = boardRectOf(HUGE);
    deep([B.r0, B.r1, B.c0, B.c1], [8, 12, 2, 12]);
    assert.deepEqual([B.rows, B.cols], [5, 11]);
    assert.equal(handRowOf(HUGE), 6);
    assert.equal(tempRowOf(HUGE), 7);
    // 两个 boss 半场仍是 4×9 的棋盘（棋盘第 8 行/第 11–12 列在半场上没有位置）
    const bossB = boardRectOf(HUGE, 'bossL');
    deep([bossB.r0, bossB.r1, bossB.c0, bossB.c1], [9, 12, 2, 10]);
    // 棋盘↔地图：棋盘第 12 行 = 部署矩形顶行、第 2 列 = 部署矩形左列；多出来的那一行一列也落在矩形里
    deep(fieldTileOf(HUGE, 'normal', 12, 2), [38, 20]);
    deep(fieldTileOf(HUGE, 'normal', 8, 12), [34, 30]);
    deep(boardTileOf(HUGE, 'normal', 34, 30), [8, 12]);
    deep(fieldTileOf(HUGE, 'bossL', 10, 8), [3, 28], 'boss 带没动（左半场 22–30）');
  });

  test('整套声明绕一圈：normalizeLayout / validateStage 都认它（列就是那条相接列、又比官方棋盘宽）', () => {
    const again = normalizeLayout(HUGE, [45, 60]);
    deep(again.deployRects, HUGE.deployRects);
    deep(again.battle, HUGE.battle);
    assert.equal(again.mirrorCol, 60);
    assert.deepEqual(stageErrors(validateStage(hugeStageSpec())), []);
    // 样板自己的记录：部署图是这一张图的棋盘（5×11 = 55 格），不是官方那 36 格
    const derived = deriveStage(hugeStageSpec(), { paths: false });
    assert.ok(derived.ok, JSON.stringify(derived.errors));
    const rec = derived.stage;
    const normal = buildDeployMap(rec, { field: 'normal' });
    assert.equal(normal.size, 55, '普通带 5×11');
    assert.ok([...normal.keys()].every((k) => { const [r, c] = String(k).split(',').map(Number); return r >= 8 && r <= 12 && c >= 2 && c <= 12; }));
    // boss 半场的棋盘仍是官方那 4×9（板内有多少格可部署，由那一段地形决定 —— 样板那一段多半是普通地面）
    const bossMap = buildDeployMap(rec, { field: 'bossL' });
    assert.ok(bossMap.size > 0 && [...bossMap.keys()].every((k) => { const [r, c] = String(k).split(',').map(Number); return r >= 9 && r <= 12 && c >= 2 && c <= 10; }),
      'boss 半场不出官方那 4×9 的棋盘');
    // 越界声明仍然回落到默认锚（列被拉回那条相接列；形状小于官方棋盘也回落）
    const smaller = normalizeLayout({ deployRects: { normal: [35, 37, 22, 30] } }, [45, 60]);
    deep(smaller.deployRects.normal, [35, 38, 2, 10], '3 行不是棋盘 → 整块回落到默认（官方锚那 4×9）');
    const offSeam = normalizeLayout({ deployRects: { normal: [34, 38, 18, 28], bossLeft: [1, 5, 22, 30], bossRight: [1, 5, 30, 38] } }, [45, 60]);
    deep(offSeam.deployRects.normal, [34, 38, 2, 10], '右缘不在相接列上 ⇒ 整套说不出一条列 ⇒ 列回到官方锚（行照旧留着）');
  });
});

describe('大图从授权到引擎：一张 23×27 的图真的能存、能画、能部署', () => {
  /** 一张合法的 23×27 图：上下留空气，中间整条道路，入口在左、目标在右。 */
  const bigRows = (R, C) => {
    const rows = [];
    for (let r = 0; r < R; r++) rows.push(r === 0 || r === R - 1 ? '-'.repeat(C) : 'r'.repeat(C));
    const put = (r, c, g) => { rows[r] = `${rows[r].slice(0, c)}${g}${rows[r].slice(c + 1)}`; };
    put(13, 0, 'S');
    put(13, C - 1, 'E');
    return rows;
  };
  const spec = () => ({
    ...sampleStageSpec(),
    id: 'ws_big_map',
    name: '大图样板',
    size: [23, 27],
    rows: bigRows(23, 27),
    routes: [{ motion: 'WALK', start: [13, 0], end: [13, 26], checkpoints: [] }],
  });

  test('校验：尺寸与行数逐条对得上，越界位置与变形分区都会报出来', () => {
    const ok = spec();
    assert.deepEqual(stageErrors(validateStage(ok)), []);
    const short = { ...ok, rows: ok.rows.slice(0, 19) };
    assert.ok(stageErrors(validateStage(short)).some((e) => e.code === 'BAD_SIZE'), '行数不对');
    const narrow = { ...ok, rows: ok.rows.map((l) => l.slice(0, 21)) };
    assert.ok(stageErrors(validateStage(narrow)).some((e) => e.code === 'BAD_SIZE'), '每行格数不对');
    const badSize = { ...ok, size: [18, 21] };
    assert.ok(stageErrors(validateStage(badSize)).some((e) => e.code === 'BAD_SIZE'), '比官方还小');
    const badRect = { ...ok, layout: { deployRects: { normal: [1, 3, 1, 9] } } };
    assert.ok(stageErrors(validateStage(badRect)).some((e) => e.code === 'BAD_LAYOUT'), '普通矩形不是 4×9');
    const outRect = { ...ok, layout: { deployRects: { normal: [21, 24, 2, 10] } } };
    assert.ok(stageErrors(validateStage(outRect)).some((e) => e.code === 'OUT_OF_BOUNDS'), '普通矩形越界');
    const badRoute = { ...ok, routes: [{ motion: 'WALK', start: [30, 0], end: [13, 26], checkpoints: [] }] };
    assert.ok(stageErrors(validateStage(badRoute)).some((e) => e.code === 'BAD_POS'), '路线起点越界');
  });

  test('派生：记录带上尺寸，deployTiles 按布局的矩形算，寻路走整张图', () => {
    const r = deriveStage(spec(), { paths: true });
    assert.ok(r.ok, JSON.stringify(r.errors));
    const rec = r.stage;
    deep(rec.size, [23, 27]);
    // 布局与这张 size 的默认布局相同 ⇒ 记录里不写 layout（老样子的小图记录因此与今天逐字节一样）
    assert.equal(rec.layout, undefined, '默认布局不写进记录');
    const L = layoutOf(rec);
    deep(L.deployRects.normal, [13, 16, 2, 10]);
    deep(L.pen, { r0: 18, r1: 22, c0: 7, c1: 13 });
    // 挪过分区才写 layout，而且写的是归一化后的那一份
    const moved = deriveStage({ ...spec(), layout: { deployRects: { normal: [11, 14, 2, 10] } } }, { paths: true });
    assert.ok(moved.ok, JSON.stringify(moved.errors));
    deep(moved.stage.layout.deployRects.normal, [11, 14, 2, 10]);
    deep(layoutOf(moved.stage).deployRects.normal, [11, 14, 2, 10]);
    // 整条路都是可部署的近战位，普通带 4×9 = 36 格全在里面
    assert.equal(rec.deployTiles.normal.melee.length, 36, '普通带整块可部署');
    assert.ok(rec.deployTiles.normal.melee.every(([rr]) => rr >= 13 && rr <= 16), '都落在普通带里');
    // 这张图的门是它自己的 S→E，不是官方那 12 对
    deep(Object.keys(rec.groundPaths), ['13,0->13,26']);
    assert.ok(rec.groundPaths['13,0->13,26'].length > 20, '路线横穿整张图');
    assert.deepEqual(validateStageRecord(rec, { id: rec.id }), []);
    // 官方那张 19×21 的样板图不受影响
    const small = deriveStage({ ...sampleStageSpec(), size: [19, 21] }, { paths: true });
    assert.ok(small.ok, JSON.stringify(small.errors));
    deep(small.stage.size, [19, 21]);
    assert.equal(small.stage.layout, undefined);
    assert.equal(gatePairsFor(small.stage.rows, small.stage.tiles, small.stage.size), GATE_PAIRS);
    deep(deriveGroundPaths({ ...small.stage, layout: undefined, size: undefined }), deriveGroundPaths(small.stage),
      '官方尺寸下有没有布局，派生出来的寻路表一样');
  });

  test('引擎：棋盘坐标经布局落到大图上，部署图与地图矩形一致', () => {
    const rec = deriveStage(spec(), { paths: true }).stage;
    const L = layoutOf(rec);
    assert.deepEqual(fieldTile('normal', 9, 2, L), [13, 2]);
    assert.deepEqual(fieldTile('bossL', 10, 8, L), [3, 8], 'boss 带没动');
    const normal = buildDeployMap(rec, { field: 'normal' });
    assert.equal(normal.get('9,2'), 'melee', '棋盘左上角 → 普通矩形左上角');
    assert.equal(normal.get('12,10'), 'melee');
    assert.equal(normal.size, 36, '普通带 4×9');
    const bossL = buildDeployMap(rec, { field: 'bossL' });
    assert.equal(bossL.get('10,8'), 'melee');
    const bossR = buildDeployMap(rec, { field: 'bossR' });
    assert.equal(bossR.get('10,8'), 'melee', '右半场过镜像轴，落在同一块矩形里');
  });

  test('一张 23×27 的图上真的能打：单位落在布局给的格子上，敌人沿路线走进战场', () => {
    const rec = deriveStage(spec(), { paths: true }).stage;
    const guard = chessRec({ id: 't_guard', profession: 'TANK', stats: { atk: 0, maxHp: 1e6, blockCnt: 3 }, skill: null });
    const walker = enemyRec({ key: 'enemy_walker', hp: 1e5, speed: 1 });
    const h = makeBattle({
      stage: rec, kind: 'normal', content: 'none',
      defs: { chess: { t_guard: guard }, enemies: { enemy_walker: walker } },
      units: [{ chessId: 't_guard', row: 10, col: 5 }],
      // 普通战场的竞技场是**玩家那一半**（cols 0–10），所以路线要走场内：官方门位那一行
      enemies: [{ key: 'enemy_walker', route: { motion: 'WALK', start: [13, 10], end: [13, 2], checkpoints: [] } }],
      autoFinish: false, timeLimit: 60,
    });
    const u = h.unit('t_guard');
    assert.equal(u.tileR, 14, '棋盘第 10 行 → 地图第 14 行（普通带 13–16）');
    assert.equal(u.tileC, 5);
    assert.deepEqual(h.b.rect, { r0: 13, r1: 16, c0: 0, c1: 10 }, '战斗矩形来自这张图的布局');
    h.step();
    const e = h.enemies()[0];
    assert.ok(e, '敌人出场');
    const x0 = e.x;
    h.run(6);
    assert.ok(e.x < x0, `敌人朝目标走（${x0.toFixed(2)} → ${e.x.toFixed(2)}）`);
    checkInvariants(h.b);
  });

  test('映射的往返性质：整备行 7 到棋盘底行 12，三档尺寸 × 三个部署场逐格回得来', () => {
    for (const { size } of SIZE_PRESETS) {
      const L = layoutForSize(size);
      for (const field of ['normal', 'bossL', 'bossR']) {
        for (let r = GEO.HAND_ROW; r <= GEO.FIELD.r1; r++) {
          // 行位移就是这条式子的全部：部署矩形的 r1 行 = 棋盘第 12 行（官方 normal → 恒等，bossLeft → 减 7）
          const expectRow = deployRectOf(L, field)[1] - (GEO.FIELD.r1 - r);
          assert.equal(stageRowOfBoard(L, field, r), expectRow, `${size} ${field} 行位移 ${r}`);
          for (const c of [0, 2, 6, 10, 12, 18]) {
            const [sr, sc] = fieldTileOf(L, field, r, c);
            assert.ok(sr >= 0 && sr < size[0] && sc >= 0 && sc < size[1], `${size} ${field} ${r},${c} → ${sr},${sc} 在窗口里`);
            assert.equal(sr, expectRow, `${size} ${field} ${r},${c} 落在位移后的那一行`);
            assert.equal(sc, stageColOfBoard(L, field, c), `${size} ${field} ${r},${c} 列`);
            deep(boardTileOf(L, field, sr, sc), [r, c], `${size} ${field} ${r},${c} 往返`);
          }
        }
      }
    }
  });

  test('编辑器视图：分区与部署矩形读数都按这张图的布局走', () => {
    const rec = deriveStage(spec(), { paths: true }).stage;
    const L = layoutOf(rec);
    const zones = zonesOf(rec.size);
    deep(zones.map((z) => z.id), ['pen', 'normal', 'boss', 'all']);
    deep(zones[0].rows, [18, 22]);
    deep(deployRectsAt(13, 2, L.deployRects), ['normal']);
    deep(deployRectsAt(1, 10, L.deployRects), ['bossLeft', 'bossRight'], '两个半场在中间那一列相接');
    deep(deployRectsAt(1, 12, L.deployRects), ['bossRight']);
    deep(deployRectsAt(9, 2, L.deployRects), [], '中间战场不在任何部署矩形里');
    // 中间战场上的道路：在部署行之外，编辑器要提示（这份图整条都是路，所以中间战场会被报出来）
    const roads = roadsOutsideDeployRects(rec.rows, rec.tiles, L.deployRects);
    assert.ok(roads.length > 0, '部署行里落在矩形外的道路会被提示');
    assert.ok(roads.every(([r, c]) => rec.rows[r][c] === 'r'), '报出来的都是道路');
    assert.ok(roads.every(([r, c]) => deployRectsAt(r, c, L.deployRects).length === 0), '报出来的一律不在部署矩形里');
  });
});
