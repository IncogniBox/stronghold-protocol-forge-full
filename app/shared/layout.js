// shared/layout.js — 一张地图自己的「尺寸 + 分区」。
//
// 业主 2026-10-08：「你能稍微把地图做的更大些吗，加入对大图的支持怎么样，这样图会更多样化」。
//
// 在这之前，地图尺寸是**六层各自钉死**的：引擎世界 (sim/constants ROWS×COLS)、战斗矩形 (GEO.NORMAL_RECT 一族)、
// 三块部署矩形 (stageAuthoring DEPLOY_RECTS)、客户端渲染 (render/tiles ROWS/COLS)、官方相机 (projection 按
// 「格心 = 列−10 / 行−9」拟合)、授权校验 (恰好 19 行 21 格)。所以「把图做大」不是改一个数字，而是**让地图自己带
// 尺寸和分区**，其余五层改读地图：这个模块就是那份布局，以及「官方布局」的定义。
//
// 记录里本来就有 `size: [19, 21]`（tools/build-data.mjs:2942 从官方 dump 读出来的），只是一直没有代码读它 ——
// 它就是天然的挂点。`layout` 是新字段，官方记录**没有**它，于是 `layoutOf()` 从 `size` 推出来；
// `layoutForSize([19, 21])` 解出来的每一个数字都等于今天的常量（有测试逐字段钉住），所以 11 张官方图与素材
// 逐字节、逐像素不变。
//
// 两套坐标系，别混：
//   * 画布 (canvas) = 引擎世界 GEO.CANVAS_ROWS×GEO.CANVAS_COLS，格子的键就是 r*COLS+c。它取**最大的档位**，不随地图变 ——
//     让 COLS 随地图变会把 sim 里 250 处 `r*COLS+c` 全部变成动态步长，那是另一场重写。地图在自己的窗口里活动。
//   * 地图窗口 (window) = 这张图的 size，永远贴在画布左下角（行 r、列 c 从 0 起，行 0 = 最底）。
//
// 三块 band 的锚法（放大时多出来的行全部落进「中间战场」，见 docs/DESIGN.md §3）：
//   等待区   贴顶 5 行              (R−5 … R−1)
//   普通带   离顶第 7–10 行         (R−10 … R−7)
//   中间战场 普通带与 boss 带之间    (6 … R−11)
//   boss 带  贴底第 1–5 行          (1 … 5)，行 0 留作边缘
// 列**默认不随尺寸变**：三块部署矩形（棋盘本身）永远锚在 2–10 / 2–10 / 10–18（两个半场在 col 10 会合、镜像轴
// 20），任何尺寸解出来都一样 —— 官方 11 张图与所有历史数据因此零变化。放开的是**行**（放大时多出来的行全落进
// 中间战场）；右侧多出来的列是加宽的地形与绕路空间，在联防/boss 的满宽战场里能走能看。
//
// 一张图可以在 `layout` 里**自己声明**一套列（三块矩形 + `mirrorCol`，由同一条相接列定出来，见
// `seamOfDeployRects`）：业主 2026-10-20「把镜像轴移动到地图中间」就是这种，而且**只影响声明它的那一张图** ——
// 45×60 那张大战场样板自己声明了居中那套（`layoutForSize(size, bandMidOf(size))`），别的模板一张都不动。

import { GEO } from './constants.js';

/** 官方尺寸：11 张官方图都是它，也是所有历史数据的尺寸。 */
export const OFFICIAL_SIZE = Object.freeze([19, 21]);

/**
 * 编辑器给的五个档位。「稍微大一点」是业主的原话，所以标准档仍是最小档，向下不缩（缩了分区就放不下）。
 * 任何 [MIN_ROWS..MAX_ROWS] × [MIN_COLS..MAX_COLS] 内的尺寸都合法，档位只是界面上的快捷方式。
 * 只带 `id` 与 `size`：界面上的名字（标准 / 大 / 特大 / 巨型 / 超巨）是编辑器自己的词条，那边唯一一份。
 *
 * 阶梯式放大（业主 2026-10-20）：起点是「把地图做得更大些」，一档一档往上抬，画布常量（见 shared/constants.js
 * 的 CANVAS_ROWS/COLS）跟着顶档走。33×39 那一档自证通过后，业主点了 45×60 —— 画布因此抬到 45×60，顶档 = 它。
 * 顶档恒等于画布：再往上加尺寸，就是抬画布 + 加一档这一套动作。
 */
export const SIZE_PRESETS = Object.freeze([
  Object.freeze({ id: 'standard', size: OFFICIAL_SIZE }),
  Object.freeze({ id: 'large', size: Object.freeze([23, 27]) }),
  Object.freeze({ id: 'huge', size: Object.freeze([27, 33]) }),
  Object.freeze({ id: 'gigantic', size: Object.freeze([33, 39]) }),
  Object.freeze({ id: 'colossal', size: Object.freeze([45, 60]) }),
]);

export const MIN_ROWS = OFFICIAL_SIZE[0];
export const MIN_COLS = OFFICIAL_SIZE[1];
/** 画布上限 = 最大的档位（= GEO.CANVAS_ROWS/COLS，见 shared/constants.js）。 */
export const MAX_ROWS = SIZE_PRESETS[SIZE_PRESETS.length - 1].size[0];
export const MAX_COLS = SIZE_PRESETS[SIZE_PRESETS.length - 1].size[1];

/**
 * 官方那副棋盘的形状，也是**最小**的一副：普通带 4 行、9 列。它们就是棋盘本身，**不随窗口尺寸变** —— 一张图要换一副
 * 更大的，是在自己的 `layout` 里声明（见 `boardRectOf`），不是让这两个数跟着 `size` 漂。
 */
export const BAND_ROWS = 4;
export const BOARD_COLS = 9;
/**
 * 一张图**自己声明的棋盘形状**（`layoutForSize` 的第三个参数）缺省就是官方那副：行、列，以及普通战斗矩形比部署矩形
 * 多让出来的**左边距**（官方 2 列 —— 手牌那 10 格落在棋盘列 0–9，其中 0–1 在棋盘左界之外，取景窗口没有这 2 列手牌就
 * 会出框）。业主 2026-10-20 把 45×60 那张大战场的部署区从 4×9 扩到 5×11，传的就是 `{ rows: 5, cols: 11,
 * normalMargin: 0 }`：部署区与普通战斗矩形同宽同高，整备矩形仍保住那 2 列。
 */
export const DEFAULT_BOARD = Object.freeze({ rows: BAND_ROWS, cols: BOARD_COLS, normalMargin: 2 });
/**
 * 三块部署矩形的列 —— **默认锚**：官方 19×21 那一份，也是**所有没自己声明 `layout` 的图**的锚（任何尺寸）。
 *
 * 棋盘 9 列、两个 boss 半场在那条**相接列**上会合、镜像 `c → mirrorCol − c` —— 这三件事互相咬着，所以任何一套
 * 合法的列都由一条相接列 `seam` 定出来（见 `deployColsAt`）：普通/左半 `[seam−8, seam]`、右半 `[seam, seam+8]`、
 * `mirrorCol = 2·seam`。默认这套的 seam 是 col 10（官方），所以 `layoutForSize` 对**每个尺寸**解出来的都是
 * 2–10 / 2–10 / 10–18 —— 大图默认与官方同锚，**不随窗口宽度变**。
 *
 * 业主 2026-10-20「把镜像轴移动到地图中间」的落地口径：**只影响那一张图**。所以居中不是全局规则，而是一张图
 * 自己在 `layout` 里声明的那一套（45×60 那张大战场样板就是这么声明的，`layoutForSize(size, seam)` 一次算出整
 * 套）；校验见 shared/stageAuthoring.js `validateLayout`，没声明或声明得不自洽就退回这里。
 */
export const FIXED_DEPLOY_COLS = Object.freeze({ normal: Object.freeze([2, 10]), bossLeft: Object.freeze([2, 10]), bossRight: Object.freeze([10, 18]) });
/** 默认那套的相接列（官方 col 10）。 */
export const DEFAULT_SEAM = FIXED_DEPLOY_COLS.bossLeft[1];
/** 等待区深度、boss 带深度、boss 带下的边缘行数。 */
const PEN_ROWS = 5;
/** 等待区的列宽（官方 (14,7)–(18,13)：7 列）。一套左右两半的布局里，每个等待区都是它、各以本方半场的中心居中。 */
const PEN_COLS = 7;
/** boss 半场的高度（5 行：最上面那一行是它的整备区行，棋盘只占下面 4 行）。 */
export const BOSS_ROWS = 5;
/** 最底那一行留作边缘（官方布局的 boss 带是 1–5，行 0 空着）。 */
const BOSS_BASE_ROW = 1;

/**
 * 窗口的**正中列**：奇数宽度取正中那一列（21 → 10），偶数宽度取正中偏右那一列（60 → 30，业主 2026-10-20 点的
 * 「整张地图的中心位置」）。一张要居中分区的图就拿它当相接列（`layoutForSize(size, bandMidOf(size))`）。
 * 行 0 = 最底，列 0 = 最左。
 */
export function bandMidOf(size) {
  const [, C] = clampSize(size);
  return Math.ceil((C - 1) / 2);
}

/**
 * 一条**相接列** `seam` 定出的三块部署矩形的列：普通/左半 `[seam−(w−1), seam]`、右半 `[seam, seam+8]`。默认那套的
 * seam 是 10、`boardCols` 是 9 → 与 `FIXED_DEPLOY_COLS` 逐条相等。
 *
 * `boardCols` 是**普通带自己的宽度**（一张图可以声明更大的棋盘，见 `DEFAULT_BOARD`）；两个 boss 半场永远是官方那 9
 * 列 —— 半场就是半场，普通带放大不会把它撑宽（业主 2026-10-20「boss 先不变」）。
 */
export function deployColsAt(seam, boardCols = BOARD_COLS) {
  const w = Number.isInteger(boardCols) && boardCols >= BOARD_COLS ? boardCols : BOARD_COLS;
  return {
    normal: [seam - (w - 1), seam],
    bossLeft: [seam - (BOARD_COLS - 1), seam],
    bossRight: [seam, seam + (BOARD_COLS - 1)],
  };
}

const isInt = (v) => Number.isInteger(v);
const isRectArr = (v) => Array.isArray(v) && v.length === 4 && v.every(isInt);
const isRectObj = (v) => !!v && typeof v === 'object' && [v.r0, v.r1, v.c0, v.c1].every(isInt);

/** A `{r0,r1,c0,c1}` copy of a rect in either shape (array or object), or null. */
export function toRectObj(v) {
  if (isRectArr(v)) return { r0: v[0], r1: v[1], c0: v[2], c1: v[3] };
  if (isRectObj(v)) return { r0: v.r0, r1: v.r1, c0: v.c0, c1: v.c1 };
  return null;
}
/** The `[r0,r1,c0,c1]` array shape of a rect (the authoring shape, `DEPLOY_RECTS`). */
export const toRectArr = (v) => {
  const r = toRectObj(v);
  return r ? [r.r0, r.r1, r.c0, r.c1] : null;
};

/** Whether `v` is a usable `[rows, cols]` for a map (ints inside the canvas, at least the official size). */
export function isSize(v) {
  return Array.isArray(v) && v.length === 2 && isInt(v[0]) && isInt(v[1])
    && v[0] >= MIN_ROWS && v[0] <= MAX_ROWS && v[1] >= MIN_COLS && v[1] <= MAX_COLS;
}

/** `v` as a valid size, falling back to the official one (a stamp of a stale UI is not an error). */
export function clampSize(v) {
  if (!isSize(v)) return [...OFFICIAL_SIZE];
  return [v[0], v[1]];
}

/** The size a stage record declares (official when it declares nothing). */
export function sizeOf(stage) {
  return clampSize(stage && stage.size);
}

/** The preset id of a size, or null when it is a custom one. */
export function sizePresetOf(size) {
  const s = clampSize(size);
  const hit = SIZE_PRESETS.find((p) => p.size[0] === s[0] && p.size[1] === s[1]);
  return hit ? hit.id : null;
}

/** The size preset after `id` (the editor's 放大 / 缩小 buttons), clamped at both ends. */
export function presetStep(id, delta) {
  const i = SIZE_PRESETS.findIndex((p) => p.id === id);
  const j = Math.max(0, Math.min(SIZE_PRESETS.length - 1, (i < 0 ? 0 : i) + delta));
  return SIZE_PRESETS[j].id;
}

const rectIn = (r, size) => {
  const R = size[0], C = size[1];
  return r.r0 >= 0 && r.r1 < R && r.c0 >= 0 && r.c1 < C && r.r0 <= r.r1 && r.c0 <= r.c1;
};

/**
 * 声明的那三块部署矩形给出的**相接列**：三块都在窗口里，两个 boss 半场是官方的 5×9 且在**同一条相接列**上会合
 * （`bossLeft.c1` / `bossRight.c0`），普通带**不比官方棋盘小**（≥ 4 行 × ≥ 9 列）且右缘就落在那条相接列上。任何一条
 * 不成立就返回 null —— 那就当这张图没声明分区，用默认锚（官方 col 10）。
 *
 * 为什么必须整组一致：两个半场在那条相接列会合、镜像 `c → mirrorCol − c`、普通带的右缘也在那儿，是同一件事的三面；
 * 只声明其中一块会让另外两块留在默认位置上（棋盘与战斗矩形对不上）。普通带**可以比 9 列宽**（业主 2026-10-20 把
 * 大战场样板的部署区扩到 5×11）：宽度由它自己说了算，其余照旧。
 */
export function seamOfDeployRects(rects, size) {
  let seam = null;
  for (const key of ['bossLeft', 'bossRight']) {
    const r = toRectObj(rects && rects[key]);
    if (!r || !rectIn(r, size)) return null;
    if (r.r1 - r.r0 + 1 !== BOSS_ROWS || r.c1 - r.c0 + 1 !== BOARD_COLS) return null;
    const here = key === 'bossRight' ? r.c0 : r.c1;
    if (seam === null) seam = here;
    else if (seam !== here) return null;
  }
  const n = toRectObj(rects && rects.normal);
  if (n) {
    if (!rectIn(n, size)) return null;
    if (n.r1 - n.r0 + 1 < BAND_ROWS || n.c1 - n.c0 + 1 < BOARD_COLS) return null;
    if (n.c1 !== seam) return null;
  }
  // 一套左右两半的普通带（业主 2026-10-21「普通对战部署区以镜像轴分成左右半，左右各一位玩家同场」）：两块都要够大、都在
  // 那条相接列上会合，而且互为镜像（同一组行、同一宽度）—— 说得出来才算一套合法声明。
  const nl = toRectObj(rects && rects.normalLeft);
  const nr = toRectObj(rects && rects.normalRight);
  if (nl || nr) {
    if (!nl || !nr) return null;
    for (const r of [nl, nr]) {
      if (!rectIn(r, size)) return null;
      if (r.r1 - r.r0 + 1 < BAND_ROWS || r.c1 - r.c0 + 1 < BOARD_COLS) return null;
    }
    if (nl.c1 !== seam || nr.c0 !== seam) return null;
    if (nl.r0 !== nr.r0 || nl.r1 !== nr.r1) return null;
    if (nl.c1 - nl.c0 !== nr.c1 - nr.c0) return null;
  }
  return seam;
}

/**
 * 一张 `[rows, cols]` 地图的**默认**布局（锚法见文件头）。
 *
 * `seam` 是那三块部署矩形会合的那一列，默认 `DEFAULT_SEAM`（官方 col 10）—— 所以任何尺寸解出来的都是官方那一套。
 * 要一张**自己居中**的图，传 `bandMidOf(size)` 进来（45×60 那张大战场样板就是这么取它的 layout 的）。
 *
 * `board` 是**这张图自己的棋盘形状**（见 `DEFAULT_BOARD`）。缺省就是官方那副（4 行 × 9 列、普通战斗矩形往左多让 2
 * 列），于是任何尺寸解出来的都是官方那一套；业主 2026-10-20「普通对战部署区从 4×9 扩大到 5×11，普通战斗矩形也同比
 * 扩大」在那张 45×60 大战场上就是 `{ rows: 5, cols: 11, normalMargin: 0 }`。
 *
 * 行与列在窗口里的锚法与尺寸无关，只有**棋盘自己的形状**变：
 *   * 普通带贴着窗口顶下方第 7–(7+rows−1) 行，列是 `[seam−(cols−1), seam]`；
 *   * 两个 boss 半场仍是官方的 5×9，在 seam 会合（业主「boss 先不变」）；
 *   * 战斗矩形：`normal` 的列与普通带同宽（`normalMargin` 决定它左界比棋盘左界再往左几列），`prep` 永远是棋盘左界
 *     再往左 2 列（手牌那两格落在棋盘之外，取景窗口少了它手牌就出框）。
 *
 * @param {readonly number[]} size
 * @param {number} [seam]
 * @param {{ rows?: number, cols?: number, normalMargin?: number }} [board]
 * @returns {{ size: number[], deployRects: Record<string, number[]>, battle: Record<string, object>, pen: object, mirrorCol: number }}
 */
export function layoutForSize(size, seam = DEFAULT_SEAM, board = DEFAULT_BOARD, dual = false) {
  const [R, C] = clampSize(size);
  const rows = Number.isInteger(board?.rows) && board.rows >= BAND_ROWS ? board.rows : BAND_ROWS;
  const margin = Number.isInteger(board?.normalMargin) && board.normalMargin >= 0 ? board.normalMargin : DEFAULT_BOARD.normalMargin;
  const cols = deployColsAt(seam, board?.cols);   // 默认 seam = 10、cols = 9 → 官方 2–10 / 2–10 / 10–18
  const w = cols.normal[1] - cols.normal[0] + 1;  // 棋盘自己的宽度（官方 9，大战场样板 11）
  const penTop = R - PEN_ROWS;             // 19 → 14
  const normalR1 = R - 7;                  // 19 → 12
  const normalR0 = normalR1 - (rows - 1);  // 19（4 行）→ 9；45×60（5 行）→ 34
  const bossR0 = BOSS_BASE_ROW;            // 1（行 0 是边缘）
  const bossR1 = bossR0 + BOSS_ROWS - 1;   // 5
  // 棋盘左边界再往左 `margin` 列是场地边距（官方 2 = 2 − 2）；整备矩形一律再多让 2 列 —— 手牌那 10 格落在棋盘列
  // 0–9，其中 0–1 在棋盘左界之外，取景窗口少了这 2 列手牌就会出框。
  const fieldC0 = cols.normal[0] - margin;
  const prepC0 = cols.normal[0] - 2;
  // 一套左右两半（`dual`）：普通带以相接列为镜像轴拆成左右两位棋手各自的半场（业主 2026-10-21）。战斗矩形因此**跨到
  // 相接列的右边**（右半场的右缘 = seam + w − 1），等待区则是两份、各以本方半场的中心居中（业主「怪物等待区也复制一份」）。
  const penHalf = Math.floor(PEN_COLS / 2);            // 3
  const penLeft = { r0: penTop, r1: R - 1, c0: seam - Math.floor((w - 1) / 2) - penHalf, c1: seam - Math.floor((w - 1) / 2) + penHalf };
  const penRight = { r0: penTop, r1: R - 1, c0: 2 * seam - penLeft.c1, c1: 2 * seam - penLeft.c0 };
  return {
    size: [R, C],
    // 授权形状（数组）：与 shared/stageAuthoring.js DEPLOY_RECTS 同一套，官方解出来逐条相等
    deployRects: dual ? {
      normalLeft: [normalR0, normalR1, seam - (w - 1), seam],
      normalRight: [normalR0, normalR1, seam, seam + (w - 1)],
      bossLeft: [bossR0, bossR1, cols.bossLeft[0], cols.bossLeft[1]],
      bossRight: [bossR0, bossR1, cols.bossRight[0], cols.bossRight[1]],
    } : {
      normal: [normalR0, normalR1, cols.normal[0], cols.normal[1]],
      bossLeft: [bossR0, bossR1, cols.bossLeft[0], cols.bossLeft[1]],
      bossRight: [bossR0, bossR1, cols.bossRight[0], cols.bossRight[1]],
    },
    // 引擎/相机形状（对象）：sim 的战斗矩形与三个取景窗口
    battle: {
      normal: { r0: normalR0, r1: normalR1, c0: fieldC0, c1: dual ? seam + (w - 1) : seam },
      prep: { r0: normalR0 - 2, r1: normalR1, c0: prepC0, c1: dual ? seam + (w - 1) : seam },
      unite: { r0: normalR0, r1: normalR1, c0: 0, c1: C - 1 },
      boss: { r0: 0, r1: bossR1, c0: 0, c1: C - 1 },
      bossPrep: { r0: 0, r1: bossR1, c0: cols.bossLeft[0] - 2, c1: seam },
    },
    pen: dual ? { ...penLeft } : { r0: penTop, r1: R - 1, c0: seam - penHalf, c1: seam + penHalf },
    ...(dual ? { penRight: { ...penRight } } : {}),
    // boss 右半场的镜像轴：`c → mirrorCol − c` 的不动点就是那条相接列，所以它是相接列 × 2（官方 2 × 10 = 20）
    mirrorCol: 2 * seam,
  };
}

/** 官方布局 —— 也是 `layoutForSize(OFFICIAL_SIZE)` 的结果（测试逐字段钉住这一点）。 */
export const OFFICIAL_LAYOUT = Object.freeze(layoutForSize(OFFICIAL_SIZE));

/**
 * 把作者声明（或记录里存下的）布局洗成完整的一份：**缺的键从默认布局取，越界的矩形退回默认**。
 * 洗不出来的一律当作「没声明」，因为一个越界的分区不是「另一种设计」，而是坏数据。
 *
 * 普通带那一块还决定**这张图的棋盘多大**：它的行数与列数（列只在「右缘就是那条相接列、且不比官方棋盘窄」时才算数）
 * 就是 `layoutForSize` 的第三个参数，其余矩形都由这一步解出来的默认布局兜底（见 `boardRectOf`）。
 * @param {object|null|undefined} v
 * @param {number[]} size
 */
export function normalizeLayout(v, size) {
  const [R, C] = clampSize(size);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return layoutForSize([R, C]);
  const win = [R, C];
  const dr = v.deployRects && typeof v.deployRects === 'object' ? v.deployRects : {};
  // 部署矩形是棋盘本身：行数必须是棋盘的深度（不对就不是棋盘 → 退回默认）；列由**同一条相接列**定出来 ——
  // 声明得出一套自洽的（这张图自己居中就是这类）就照它走，声明不出来就退回默认那套（官方 2–10 / 2–10 / 10–18）。
  const seam = seamOfDeployRects(dr, win) ?? DEFAULT_SEAM;
  // 声明了左右两半（两块都在、且自洽）⇒ 这张图的普通带就是一套左右半场（`dual`）；否则照旧的单块普通带。
  const dual = !!seamOfDeployRects(dr, win) && !!(toRectObj(dr.normalLeft) && toRectObj(dr.normalRight));
  const n = toRectObj(dr.normalLeft) || toRectObj(dr.normal);
  const nOk = !!(n && rectIn(n, win) && n.r1 - n.r0 + 1 >= BAND_ROWS);
  const shape = {
    rows: nOk ? n.r1 - n.r0 + 1 : BAND_ROWS,
    cols: nOk && n.c1 === seam && n.c1 - n.c0 + 1 >= BOARD_COLS ? n.c1 - n.c0 + 1 : BOARD_COLS,
    normalMargin: DEFAULT_BOARD.normalMargin,
  };
  const base = layoutForSize(win, seam, shape, dual);
  const out = { size: base.size, deployRects: {}, battle: {}, pen: base.pen, mirrorCol: base.mirrorCol };
  if (base.penRight) out.penRight = base.penRight;
  for (const key of Object.keys(base.deployRects)) {
    const r = toRectObj(dr[key]);
    const wantRows = key === 'bossLeft' || key === 'bossRight' ? BOSS_ROWS : shape.rows;
    out.deployRects[key] = r && rectIn(r, win) && r.r1 - r.r0 + 1 === wantRows
      ? [r.r0, r.r1, base.deployRects[key][2], base.deployRects[key][3]]
      : base.deployRects[key];
  }
  const bt = v.battle && typeof v.battle === 'object' ? v.battle : {};
  for (const key of Object.keys(base.battle)) {
    const r = toRectObj(bt[key]);
    out.battle[key] = r && rectIn(r, win) ? r : base.battle[key];
  }
  const pen = toRectObj(v.pen);
  out.pen = pen && rectIn(pen, win) ? pen : base.pen;
  if (dual) {
    const penR = toRectObj(v.penRight);
    out.penRight = penR && rectIn(penR, win) ? penR : base.penRight;
  }
  return out;
}

/** 地图的布局：记录里声明过就用声明，否则由 `size` 推出默认布局（官方记录走的就是这条路）。 */
export function layoutOf(stage) {
  return normalizeLayout(stage && stage.layout, sizeOf(stage));
}

/** Whether a layout is the official one — 决定用官方相机还是 `fitCamera`（render/projection.js）。 */
export function isOfficialLayout(layout) {
  return JSON.stringify(normalizeLayout(layout, sizeOf(layout))) === JSON.stringify(OFFICIAL_LAYOUT);
}

/** Whether a layout's ordinary band is the two-half one (left/right players side by side). */
export const isDualLayout = (layout) => {
  const l = layout || OFFICIAL_LAYOUT;
  return !!(l.deployRects && l.deployRects.normalLeft && l.deployRects.normalRight);
};

/** 部署矩形（授权形状 `[r0,r1,c0,c1]`）；未知名字给 normal，跟 board.js 的 fieldOf 一个口径。 */
export function deployRectOf(layout, name) {
  const l = layout || OFFICIAL_LAYOUT;
  return l.deployRects[deployRectName(name, l)] || l.deployRects.normalLeft || l.deployRects.normal;
}

/**
 * 部署场名 → 它读哪一块矩形。两个 boss 半场（`bossL` / `bossR`，board.js DEPLOY_FIELDS 的拼法）共用 `bossLeft`：
 * 矩形说的只是「棋盘落在地图的哪一块」，左右半场的差别全在列上的镜像（`mirrorCol`）。
 *
 * 一套左右两半的普通带（`layout.deployRects.normalLeft`/`normalRight`）里多了两个名字：`normalL` / `normalR` 各读
 * 自己那一块，**没有 `normal` 这一块** —— 「普通带」在那张图上就等于它的左半场（`normalL`），所以任何只认三个老名字的
 * 读者（不带 layout 的 `deployRectName('normal')`、`deployRectOf(L, 'normal')`）仍旧读到一块真的矩形。
 */
export function deployRectName(field, layout) {
  if (field === 'bossL' || field === 'bossR') return 'bossLeft';
  if (field === 'bossLeft' || field === 'bossRight') return field;
  const dual = isDualLayout(layout);
  if (field === 'normalL' || field === 'normalR') {
    if (!dual) return 'normal';
    return field === 'normalL' ? 'normalLeft' : 'normalRight';
  }
  if (!field || field === 'normal') return dual ? 'normalLeft' : 'normal';
  return field;
}

/**
 * 一张图**棋盘**在棋盘坐标里的那块矩形 —— 「一格的键该落在哪儿」的那块地，也是所有遍历棋盘的循环该走的范围。
 *
 * 形状由**这张图自己声明的部署矩形**定出来，位置锚在棋盘坐标里那两个不变的数字上：矩形的最上一行永远映射到棋盘第
 * 12 行、最左一列永远映射到棋盘第 2 列（`stageRowOfBoard` / `stageColOfBoard` 就是这么写的）。所以业主 2026-10-20
 * 「普通对战部署区从 4×9 扩大到 5×11」在这条式子里的意思就是**棋盘从 4×9 变成 5×11**：行 8–12、列 2–12。
 *
 * `field` 一起参与：两个 boss 半场比普通带窄（半场 9 列，而且 5 行里最上面那一行是它的整备区行），所以 `bossL` /
 * `bossR` 的棋盘永远是官方的 4×9 —— 一张普通带放大到 5×11 的图，超出去的那一行两列在 boss 半场上没有位置；
 * 换到 boss 场时 `PlayerState._evictIllegal` 会把站在那里的棋子收进手牌（既有的「换了部署场就撤走放不下的棋子」）。
 * 一套左右两半的普通带里，`normalL` / `normalR` 各自是**同样大的**一块（5×11），镜像摆放。
 * @param {object|null|undefined} layout 这张图的布局（`layoutOf(stage)`）；缺省 = 官方布局
 * @param {'normal'|'normalL'|'normalR'|'bossL'|'bossR'} [field]
 * @returns {{ r0: number, r1: number, c0: number, c1: number, rows: number, cols: number }}
 */
export function boardRectOf(layout, field = 'normal') {
  const l = layout || OFFICIAL_LAYOUT;
  const name = deployRectName(field, l);
  const r = (l.deployRects && l.deployRects[name]) || OFFICIAL_LAYOUT.deployRects[name];
  // boss 半场最上面那一行是它的整备区行；普通带（单块或左右半块）整整都用得上
  const rows = (r[1] - r[0] + 1) - (name === 'bossLeft' || name === 'bossRight' ? 1 : 0);
  const cols = r[3] - r[2] + 1;
  return {
    r0: GEO.FIELD.r1 - (rows - 1), r1: GEO.FIELD.r1,
    c0: GEO.FIELD.c0, c1: GEO.FIELD.c0 + (cols - 1),
    rows, cols,
  };
}

/** 一张图的**整备行**（`hand` 那 10 格站的那一行）在棋盘坐标里是第几行：棋盘最下面那一行再往上两行。 */
export const handRowOf = (layout, field = 'normal') => boardRectOf(layout, field).r0 - 2;
/** **临时整备区**那一行（`temp` 的 5 个可见格）：整备行的上一行。 */
export const tempRowOf = (layout, field = 'normal') => boardRectOf(layout, field).r0 - 1;

/**
 * 棋盘行 → 地图行：**部署矩形的第 r1 行就是棋盘第 12 行**（官方 normal [9,12] → 恒等；bossLeft [1,5] → 减 7）。
 * 这就是今天的 BOSS_ROW_OFFSET = −7 的一般式。棋盘第 12 行与第 2 列是**棋盘坐标里两个不变的数字**，换图也不变 ——
 * 变的只是棋盘自己有多大（`boardRectOf`）。
 */
export function stageRowOfBoard(layout, field, boardRow) {
  const rect = deployRectOf(layout, field);
  return rect[1] - (GEO.FIELD.r1 - boardRow);
}

/**
 * 棋盘列 → 地图列：普通/左半场是同一侧（矩形左边界 + 相对位移），右半场是**左半场那个位置过镜像轴**的镜像 ——
 * 是把**落位**翻过来，不是把列号本身翻过来；两者只在窗口正中列恰好是 col 10 时相等，也就是官方那一份。
 * 官方：c ↔ c；bossR：c ↔ 20 − c（逐格相等，故镜像公式仍是 `mirrorCol − c`）。
 */
export function stageColOfBoard(layout, field, boardCol) {
  const l = layout || OFFICIAL_LAYOUT;
  const mirrored = field === 'bossR' || field === 'normalR';
  if (!mirrored) return deployRectOf(l, field)[2] + (boardCol - GEO.FIELD.c0);
  // 右半场翻回它左半场那一侧的位置：bossR 落到 bossLeft 那块上，normalR 落到 normalLeft 那块上
  const baseName = field === 'normalR' ? 'normalLeft' : 'bossLeft';
  return l.mirrorCol - (deployRectOf(l, baseName)[2] + (boardCol - GEO.FIELD.c0));
}

/** 棋盘格 (r, c) 在部署场 `field` 里落在哪一格地图上。 */
export function fieldTileOf(layout, field, r, c) {
  return [stageRowOfBoard(layout, field, r), stageColOfBoard(layout, field, c)];
}

/** 上面那条映射的逆。 */
export function boardTileOf(layout, field, r, c) {
  const l = layout || OFFICIAL_LAYOUT;
  const rect = deployRectOf(l, field);
  const row = GEO.FIELD.r1 - (rect[1] - r);
  const mirrored = field === 'bossR' || field === 'normalR';
  const placed = mirrored ? l.mirrorCol - c : c;   // 右半场先翻回左半场那一侧的位置
  // 减去的是**落位所在那一块矩形的左界**：普通/左半场就是它自己的，右半场翻回来之后落到左半场那块上
  // （官方三块的左界都是 2，所以从前写死 bossLeft 也看不出差别；一张把普通带放得更宽的图就露出来了）。
  const base = !mirrored ? rect[2] : deployRectOf(l, field === 'normalR' ? 'normalLeft' : 'bossLeft')[2];
  return [row, GEO.FIELD.c0 + (placed - base)];
}

/** 部署矩形覆盖的地图行里，棋盘用不到的那一条（boss 场的整备区行：矩形顶行）。 */
export function benchRowOf(layout, field) {
  return deployRectOf(layout, field)[0];
}

/**
 * 取景/战斗矩形：`normal` `prep` `unite` `boss` `bossPrep` `pen`，或任意部署场名（→ 它的战斗矩形）。
 * 与 GEO.NORMAL_RECT 一族同名同形，所以调用方换过来时是「同一个东西，只是从地图读」。
 */
export function viewRectOf(layout, kind) {
  const l = layout || OFFICIAL_LAYOUT;
  if (kind === 'bossL' || kind === 'bossR') return { ...l.battle.boss };
  // 一套左右两半的普通带：两个半场站着同一块战场，取景窗口是它的战斗矩形（`battle.normal` 已经跨到相接列右边）
  if (kind === 'normalL' || kind === 'normalR') return { ...(l.battle.normal || l.pen) };
  return { ...(l.battle[kind] || l.pen) };
}

/** 这张图的一个等待区（`penLeft` / `penRight`），或它那一侧的半场；单块等待区的图两半都给它唯一那个。 */
export function penRectOf(layout, side = 'L') {
  const l = layout || OFFICIAL_LAYOUT;
  if (side === 'R' && l.penRight) return { ...l.penRight };
  return { ...l.pen };
}
