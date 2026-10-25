// public/js/render/board3d/decor.js — the stage's MANUAL decorations (`stage.decor`).
//
// The editor places props on the map grid (`kind` + tile), the stage record carries them through deriveStage, and this
// module turns them into board-space boxes for BoardScene. Nothing is generated automatically: an empty `decor` list
// draws nothing. Heights match the procedural tiles (board.grid via heightOf / classifyStage).
//
// Kinds (all axis-aligned, so no rotation field is needed):
//   block    a dark stone block, height derived from the tile hash (with a stacked cap on some tiles)
//   lantern  a stone lantern with a warm emissive paper lamp
//   crate    a supply crate with the theme atlas' own brown crate faces (top / sides) and warm lit panels
//   mark     white L corner brackets; sits on the block at that tile when there is one, else on the ground
//   edging   a low metal edge trim + four corner caps around the tile (place along a field edge)
//   hatch    a low glass-framed grate in the tile (the atlas' silver grid face), flush with the floor
//   stand    the official field's pale brush rest (a low stone tray with four brushes standing in it)
//   fence    a wooden fence: rails on every side whose neighbour is not fence, posts at the corners (auto-connects)
//   prop     one of the theme's OWN prop meshes (`v` = props id, themes.js `props`): the real extracted object,
//            recentered on the tile and standing on its top face

import { surfaceUV } from './atlas.js';
import { objToBoard } from './layout.js';

const FULL_UV = [0, 0, 1, 0, 1, 1, 0, 1];

// 主题自带摆件（themes.js `props`）的缓存：解析出来的 OBJ 只转一次坐标（objToBoard 会把整批顶点复制一遍），
// 同时记下它自己的包围盒中心/最低点，摆放时用它把模型对准格子中心、脚底贴到地块顶面。
const propCache = new WeakMap();
function propGeometry(m) {
  let g = propCache.get(m);
  if (g) return g;
  const b = objToBoard(m, 0.01);
  const p = b.position;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i];
    if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
    if (p[i + 2] < z0) z0 = p[i + 2];
  }
  g = { mesh: b, ox: (x0 + x1) / 2, oy: (y0 + y1) / 2, oz: z0 };
  propCache.set(m, g);
  return g;
}

/** 把一件真实摆件的几何搬到 (c, r, z)：脚底贴地块顶面、包围盒中心对准格子中心。 */
function pushProp(bucket, m, c, r, z) {
  const { mesh, ox, oy, oz } = propGeometry(m);
  const base = bucket.pos.length / 3;
  const p = mesh.position, n = mesh.normal, uv = mesh.uv, col = mesh.color;
  for (let k = 0; k * 3 < p.length; k++) {
    bucket.pos.push(c + p[k * 3] - ox, r + p[k * 3 + 1] - oy, z + p[k * 3 + 2] - oz);
    if (n) bucket.nrm.push(n[k * 3], n[k * 3 + 1], n[k * 3 + 2]); else bucket.nrm.push(0, 0, 1);
    if (uv) bucket.uv.push(uv[k * 2], uv[k * 2 + 1]); else bucket.uv.push(0, 0);
    if (col) bucket.col.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]); else bucket.col.push(1, 1, 1);
  }
  const ix = mesh.index;
  for (let i = 0; i < ix.length; i++) bucket.idx.push(base + ix[i]);
}
const NRM = { S: [0, -1, 0], E: [1, 0, 0], N: [0, 1, 0], W: [-1, 0, 0] };

function bucket() { return { pos: [], nrm: [], uv: [], col: [], idx: [] }; }

function quad(b, corners, uv, nrm, col) {
  const base = b.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    b.pos.push(p[0], p[1], p[2]);
    if (uv) b.uv.push(uv[i * 2], uv[i * 2 + 1]);
    b.nrm.push(nrm[0], nrm[1], nrm[2]);
    b.col.push(col[0], col[1], col[2]);
  }
  b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function sideCorners(dir, x0, x1, y0, y1, zb, zt) {
  switch (dir) {
    case 'S': return [[x0, y0, zb], [x1, y0, zb], [x1, y0, zt], [x0, y0, zt]];
    case 'N': return [[x1, y1, zb], [x0, y1, zb], [x0, y1, zt], [x1, y1, zt]];
    case 'E': return [[x1, y0, zb], [x1, y1, zb], [x1, y1, zt], [x1, y0, zt]];
    default: return [[x0, y1, zb], [x0, y0, zb], [x0, y0, zt], [x0, y1, zt]];
  }
}

function box(b, x0, y0, z0, x1, y1, z1, uv, col, uvSide) {
  const side = uvSide || uv;
  quad(b, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], uv, [0, 0, 1], col);
  for (const dir of ['S', 'E', 'N', 'W']) quad(b, sideCorners(dir, x0, x1, y0, y1, z0, z1), side, NRM[dir], col);
}

/** box() with the two corners in any order (signed offsets differ per corner). */
function boxBetween(b, xa, ya, za, xb, yb, zb, uv, col) {
  box(b, Math.min(xa, xb), Math.min(ya, yb), Math.min(za, zb), Math.max(xa, xb), Math.max(ya, yb), Math.max(za, zb), uv, col);
}

const hash = (r, c) => (((r * 73856093) ^ (c * 19349663)) >>> 0);
export const blockHeight = (r, c) => 0.55 + (hash(r, c) % 6) * 0.2;
const hasStack = (r, c) => ((hash(r, c) >> 3) % 2) === 0;
const stackHeight = (r, c) => 0.3 + ((hash(r, c) >> 9) % 3) * 0.16;
const stackWidth = (r, c) => 0.3 + ((hash(r, c) >> 6) % 3) * 0.05;

function finish(b) {
  if (!b.idx.length) return null;
  const verts = b.pos.length / 3;
  const out = {
    position: new Float32Array(b.pos),
    normal: new Float32Array(b.nrm),
    color: new Float32Array(b.col),
    index: verts > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx),
  };
  if (b.uv.length) out.uv = new Float32Array(b.uv);
  return out;
}

/**
 * @param {object} stage the stage record the board is showing (reads `stage.decor`, `stage.rows`)
 * @param {Array<Array<object>>} grid the classified tile grid from buildBoard (for tile tops)
 * @param {object} uvTable the theme's atlas UV table (`pack.uv`)
 * @param {Record<string, object>} [props] the theme's own prop meshes (`pack.props`, themes.js `props`)
 */
export function buildDecor(stage, grid, uvTable, props) {
  const list = Array.isArray(stage?.decor) ? stage.decor : null;
  if (!list || !list.length || !uvTable) return null;
  const R = grid?.length || stage.rows?.length || 0;
  const zAt = (r, c) => { const t = grid?.[r]?.[c]; return t && t.drawn ? t.h : 0; };
  const stoneUv = surfaceUV(uvTable.slats || uvTable.mech || uvTable.concrete);
  const metalUv = surfaceUV(uvTable.steel || uvTable.graySide || uvTable.concrete);
  // 天镜阁的图集里还有两张只能用在这类道具上的面：货箱的 `brown` 与玻璃栅格的 `padEquip`（themes.js `surfaces`）。
  const crateTopUv = surfaceUV(uvTable.crateTop || uvTable.brown || uvTable.concrete);
  const crateSideUv = surfaceUV(uvTable.crateSide || uvTable.brown || uvTable.concrete);
  const grateUv = surfaceUV(uvTable.padEquip || uvTable.grid || uvTable.concrete);
  const out = { board: bucket(), wood: bucket(), glow: bucket(), mark: bucket() };
  // 只保留**这次真的建出来的场地**里的装饰：BoardScene 的 area 会随镜头收窄（boss 整备只建当前那块 boss 场地），
  // 但 `decor` 是整张图的清单。不过滤的话，邻区/前景那些不在 area 内的摆件会悬在空地上，看起来像
  // 「别的 boss 区域叠进来了」。栅栏的「连成一片」判断也跟着这份清单走，免得界外栅栏让界内的横杆缺一根。
  // 编辑器整图预览（area = 整张图）依旧全部显示。
  const visible = grid ? list.filter((d) => { const r = Math.round(d.r), c = Math.round(d.c); const t = grid[r]?.[c]; return !!(t && t.drawn); }) : list;
  const byTile = new Set();
  for (const d of visible) if (d && d.kind === 'block') byTile.add(`${Math.round(d.r)},${Math.round(d.c)}`);
  // 木栅栏要「连成一片」：只有邻格不是栅栏的那一边才加横杆（官方 b 地块的围栏规则），四角立柱去重
  const fenceAt = new Set();
  for (const d of visible) if (d && d.kind === 'fence') fenceAt.add(`${Math.round(d.r)},${Math.round(d.c)}`);
  const isFence = (r, c) => fenceAt.has(`${r},${c}`);
  const fencePost = new Set();

  for (const d of visible) {
    if (!d || typeof d.kind !== 'string') continue;
    const r = Math.round(d.r), c = Math.round(d.c);
    if (!(r >= 0 && r < R && c >= 0)) continue;
    const z = zAt(r, c);
    if (d.kind === 'block') {
      const w = 0.46, h = blockHeight(r, c);
      box(out.board, c - w, r - w, z, c + w, r + w, z + h, stoneUv, [0.30, 0.32, 0.35]);
      if (hasStack(r, c)) {
        const w2 = stackWidth(r, c);
        box(out.board, c - w2, r - w2, z + h, c + w2, r + w2, z + h + stackHeight(r, c), stoneUv, [0.30, 0.32, 0.35]);
      }
    } else if (d.kind === 'lantern') {
      // stone pedestal + neck + paper lamp (the lamp is an unlit warm emissive material)
      box(out.wood, c - 0.15, r - 0.15, z, c + 0.15, r + 0.15, z + 0.5, FULL_UV, [0.8, 0.76, 0.7]);
      box(out.wood, c - 0.11, r - 0.11, z + 0.5, c + 0.11, r + 0.11, z + 0.62, FULL_UV, [0.8, 0.76, 0.7]);
      box(out.glow, c - 0.17, r - 0.17, z + 0.62, c + 0.17, r + 0.17, z + 0.94, null, [1, 1, 1]);
    } else if (d.kind === 'crate') {
      // the official supply crate's own atlas faces (brown top / brown side) instead of the wood-grain image
      box(out.board, c - 0.26, r - 0.26, z, c + 0.26, r + 0.26, z + 0.52, crateTopUv, [1, 0.97, 0.93], crateSideUv);
      box(out.glow, c - 0.17, r - 0.29, z + 0.12, c + 0.17, r - 0.25, z + 0.4, null, [1, 1, 1]);
      box(out.glow, c - 0.17, r + 0.25, z + 0.12, c + 0.17, r + 0.29, z + 0.4, null, [1, 1, 1]);
    } else if (d.kind === 'hatch') {
      // a low glass-framed grate in the tile (the theme atlas' 3×3 silver grid), flush with the floor
      box(out.board, c - 0.44, r - 0.44, z, c + 0.44, r + 0.44, z + 0.11, grateUv, [0.92, 0.96, 1], metalUv);
    } else if (d.kind === 'stand') {
      // 笔架：浅色石座 + 一排笔尖（官方天镜阁场地里每格一件的那种小摆件）
      box(out.board, c - 0.26, r - 0.17, z, c + 0.26, r + 0.17, z + 0.07, metalUv, [0.80, 0.78, 0.72]);
      box(out.board, c - 0.23, r - 0.11, z + 0.07, c + 0.23, r + 0.11, z + 0.13, metalUv, [0.74, 0.72, 0.67]);
      const hgt = [0.40, 0.50, 0.44, 0.36];
      const k = hash(r, c) % 2;
      for (let i = 0; i < 4; i++) {
        const x = c - 0.18 + i * 0.12;
        const hh = hgt[(i + k) % 4];
        box(out.board, x - 0.028, r - 0.028, z + 0.13, x + 0.028, r + 0.028, z + 0.13 + hh, metalUv, [0.87, 0.85, 0.79]);
      }
    } else if (d.kind === 'fence') {
      // 木栅栏：邻格不是栅栏的那一边才加两根横杆，四角加立柱（邻格共用一根，于是整片连成一道围栏）
      const col = [0.88, 0.78, 0.66];
      const e = 0.06, th = 0.07;
      const bars = [[z + 0.10, z + 0.17], [z + 0.28, z + 0.35]];
      const bar = (x0, y0, x1, y1) => { for (const [zb, zt] of bars) box(out.wood, x0, y0, zb, x1, y1, zt, FULL_UV, col); };
      if (!isFence(r - 1, c)) bar(c - 0.5, r - 0.5 + e, c + 0.5, r - 0.5 + e + th);
      if (!isFence(r + 1, c)) bar(c - 0.5, r + 0.5 - e - th, c + 0.5, r + 0.5 - e);
      if (!isFence(r, c - 1)) bar(c - 0.5 + e, r - 0.5, c - 0.5 + e + th, r + 0.5);
      if (!isFence(r, c + 1)) bar(c + 0.5 - e - th, r - 0.5, c + 0.5 - e, r + 0.5);
      const open = !isFence(r - 1, c) || !isFence(r + 1, c) || !isFence(r, c - 1) || !isFence(r, c + 1);
      if (open) for (const [sr, sc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        const key = `${r * 2 + sr},${c * 2 + sc}`;
        if (fencePost.has(key)) continue;
        fencePost.add(key);
        const x = c + sc * (0.5 - e), y = r + sr * (0.5 - e);
        box(out.wood, x - 0.05, y - 0.05, z, x + 0.05, y + 0.05, z + 0.44, FULL_UV, col);
      }
    } else if (d.kind === 'prop') {
      const m = props && typeof d.v === 'string' ? props[d.v] : null;
      if (m) pushProp(out.board, m, c, r, z);
    } else if (d.kind === 'mark') {
      // on the block at this tile (if any), else just above the tile
      let top = z + 0.02;
      if (byTile.has(`${r},${c}`)) top = z + blockHeight(r, c) + (hasStack(r, c) ? stackHeight(r, c) : 0) + 0.012;
      const w = 0.46, th = 0.035, len = 0.26;
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        const x = c + sx * w, y = r + sy * w;
        // two arms of the L, both pointing inward from this corner
        boxBetween(out.mark, x - sx * len, y - sy * 0.06, top, x + sx * 0.02, y + sy * 0.02, top + th, null, [1, 1, 1]);
        boxBetween(out.mark, x - sx * 0.06, y - sy * len, top, x + sx * 0.02, y + sy * 0.02, top + th, null, [1, 1, 1]);
      }
    } else if (d.kind === 'edging') {
      // a low metal frame around this tile (place several along a field edge for a continuous trim)
      const col = [0.55, 0.6, 0.66];
      box(out.board, c - 0.5, r - 0.5, z + 0.01, c + 0.5, r - 0.41, z + 0.15, metalUv, col);
      box(out.board, c - 0.5, r + 0.41, z + 0.01, c + 0.5, r + 0.5, z + 0.15, metalUv, col);
      box(out.board, c - 0.5, r - 0.41, z + 0.01, c - 0.41, r + 0.41, z + 0.15, metalUv, col);
      box(out.board, c + 0.41, r - 0.41, z + 0.01, c + 0.5, r + 0.41, z + 0.15, metalUv, col);
    }
  }
  return { board: finish(out.board), wood: finish(out.wood), glow: finish(out.glow), mark: finish(out.mark) };
}

export const DECOR_KINDS = Object.freeze(['block', 'lantern', 'crate', 'mark', 'edging', 'hatch', 'stand', 'fence', 'prop']);
