// tools/scene-from-stage.mjs — build a CUSTOM official-format battlefield scene from a stage record.
//
// A scene (render/board3d/load.js loadScenePack) is pure data:
//   <out>/scene/<id>/scene.json   { version, stage, light, lightmaps, lightRange, lightEncoding, materials, groups, chunks, binBytes }
//   <out>/scene/<id>/scene.bin    per chunk: position f32×3, uv f32×2, lightmap uv f32×2, normal i8×4,
//                                 colour u8×4, indices u16|u32 (padded to 4 bytes) — 36 bytes a vertex
//   <out>/scene/<id>/lm<i>.png    a lightmap page (RGB = baked light · range, A = shadow mask)
//   <out>/scene/tex/<name>.png    the materials' albedo maps (shared by every scene)
// and data/local-assets.json lists the files under the groups scene/<id> and scene/tex.
//
// This tool makes one from a stage record + a board theme (public/js/render/board3d/themes.js): a flat top per tile
// at the stage's own height (render/style.js TILE_H), side faces down to the neighbour tile, the theme atlas' UVs for
// every surface, and a lightmap page whose per-tile brightness is a simple ambient-occlusion bake (darker at the feet
// of raised blocks). It is geometry + baked light, NOT an official Unity extraction — the point is a custom map that
// reads like a scene: baked light instead of the board's live lighting, and the map's own full geometry.
//
// Usage:
//   node tools/scene-from-stage.mjs --stage workshop/mode-recon/stages.json --id my_map --theme skymirror
//     --stage   a stages.json whose <id> record to build (default data/stages.json)
//     --id      the stage id (must equal the scene id the game asks for: sceneGroup(stage.id))
//     --theme   a themes.js id (default autochess)
//     --out     output root (default public/assets/local)
//     --manifest data/local-assets.json to register the files in (default data/local-assets.json)
//   Files are overwritten; the manifest groups are merged (other groups kept) and `count` recomputed.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { crc32 } from '../shared/zip.js';
import { classifyStage } from '../public/js/render/board3d/layout.js';
import { resolveUvTable, surfaceUV, sideRect } from '../public/js/render/board3d/atlas.js';
import { BOARD_THEMES } from '../public/js/render/board3d/themes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Scene format version (scenes.py SCENE_VERSION) — the mesh layout loadScenePack requires. */
const SCENE_VERSION = 1;
/** Albedo maps this build needs, per theme: the tile atlas + (optional) the theme's own high-ground image. */
const TEX = { D: 'TX_MyMap_D', wood: 'TX_MyMap_Wood', glow: 'TX_MyMap_Glow' };
/** Material names in scene.json. */
const MAT = { base: 'MT_MyMap', dark: 'MT_MyMapDark', wood: 'MT_MyMapWood', glow: 'MT_MyMapGlow', metal: 'MT_MyMapMetal', mark: 'MT_MyMapMark' };
/**
 * 场景主光，取值与官方场景（act1autochess_m01 / m03）一致：暖白、从左上前方打下来。
 * intensity 是官方标准灯光装置（scene.js LIGHTING.key）的默认强度。
 */
const LIGHT = { dir: [0.36121, 0.44604, 0.81889], color: [1, 0.9312, 0.87131], intensity: 2.6 };
/** Lightmap page size (square; one tile maps to one cell, sampled at its centre). */
const LM_SIZE = 512;
/**
 * 官方场景的光照约定：`lightRange 8`，光贴图 RGB = 环境光（display 亮度），A = 阴影遮罩（主光被挡掉多少）。
 * 这里沿用同一套约定，不再对存盘值套任何中间调曲线。
 *   LM_BASE   开阔地面的环境光（铺装石面很暗，环境光要抬到能看清）
 *   LM_RAISED 抬高块顶面的环境光（材质本身更亮，配低一档的环境光）
 *   SHADOW_*  主光的遮罩：开阔处全亮，抬高块顶面自遮挡，块脚一圈投影
 */
const LM_RANGE = 8;
const LM_BASE = 1.5, LM_RAISED = 0.55;
const SHADOW_OPEN = 255, SHADOW_RAISED = 200, SHADOW_FOOT = 190;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ── PNG (8-bit RGBA, no dependency) ─────────────────────────────────────────────────────────────────────────

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])) >>> 0, 8 + body.length);
  return out;
}

/** Encode RGBA pixels (`Uint8Array`, row-major, top row first) as a PNG. */
export function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── mesh ──────────────────────────────────────────────────────────────────────────────────────────────────

const NRM = { S: [0, -1, 0], E: [1, 0, 0], N: [0, 1, 0], W: [-1, 0, 0] };

/** Corners (BL, BR, TR, TL seen from outside) of a side face, exactly board3d/layout.js sideCorners. */
function sideCorners(dir, x0, x1, y0, y1, zb, zt) {
  switch (dir) {
    case 'S': return [[x0, y0, zb], [x1, y0, zb], [x1, y0, zt], [x0, y0, zt]];
    case 'N': return [[x1, y1, zb], [x0, y1, zb], [x0, y1, zt], [x1, y1, zt]];
    case 'E': return [[x1, y0, zb], [x1, y1, zb], [x1, y1, zt], [x1, y0, zt]];
    default: return [[x0, y1, zb], [x0, y0, zb], [x0, y0, zt], [x0, y1, zt]];
  }
}

const i8 = (v) => Math.max(-128, Math.min(127, Math.round(v * 127)));

/** UV corners of a whole texture, in the face order pushQuad/pushBox use (BL, BR, TR, TL). */
const FULL_UV = [0, 0, 1, 0, 1, 1, 0, 1];

/** One material's accumulating geometry: positions/uv/lm/normal per vertex + triangle indices. */
function newChunk() { return { pos: [], uv: [], lm: [], nrm: [], idx: [], bounds: null }; }

function pushQuad(chunk, corners, uv, normal, lmUv) {
  const base = chunk.pos.length / 3;
  for (let i = 0; i < 4; i++) {
    const p = corners[i];
    chunk.pos.push(p[0], p[1], p[2]);
    chunk.uv.push(uv[i * 2], uv[i * 2 + 1]);
    chunk.lm.push(lmUv[0], lmUv[1]);
    chunk.nrm.push(i8(normal[0]), i8(normal[1]), i8(normal[2]), 0);
    const b = chunk.bounds;
    chunk.bounds = b
      ? [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.min(b[2], p[2]), Math.max(b[3], p[0]), Math.max(b[4], p[1]), Math.max(b[5], p[2])]
      : [p[0], p[1], p[2], p[0], p[1], p[2]];
  }
  chunk.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  return chunk;
}

/** A five-face box (top + four sides) in board space; `uv` is used on every face (small props). */
function pushBox(chunk, x0, y0, z0, x1, y1, z1, uv, lmUv) {
  pushQuad(chunk, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], uv, [0, 0, 1], lmUv);
  for (const [dir] of [['S'], ['E'], ['N'], ['W']]) {
    pushQuad(chunk, sideCorners(dir, x0, x1, y0, y1, z0, z1), uv, NRM[dir], lmUv);
  }
}

/** Surface record with a tile's own turn, and the UV corners for a face. */
const uvOf = (surface, t) => surfaceUV({ ...surface, rot: ((surface.rot | 0) + (t.rot | 0)) % 360, flipX: !!surface.flipX !== !!t.flipX });

const avg = (tint) => (tint[0] + tint[1] + tint[2]) / 3;
/** The material of a tile's TOP face: the theme's wood image for its high-ground surfaces, else the atlas. */
function topMaterial(theme, surfaceName, tint) {
  const woodOn = new Set(Array.isArray(theme.atlas.woodOn) && theme.atlas.woodOn.length ? theme.atlas.woodOn : ['hatch']);
  if (theme.atlas.wood && woodOn.has(surfaceName)) return 'wood';
  return avg(tint) < 0.6 ? 'dark' : 'base';
}

// ── build ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} stage a stage record (rows / tiles / size / layout)
 * @param {string} themeId a themes.js id
 * @returns {{ doc: object, bin: Buffer, lm: Buffer, chunks: number }}
 */
export function buildScene(stage, themeId) {
  const theme = BOARD_THEMES[themeId] || BOARD_THEMES.autochess;
  if (!theme.atlas) throw new Error(`theme "${themeId}" carries no atlas: a scene needs the theme's own diffuse atlas`);
  const uvTable = resolveUvTable({ board3d: theme.atlas.surfaces }, theme.atlas.sources);
  const grid = classifyStage(stage, null);
  const R = grid.length, C = grid[0].length;

  // 1. material buckets
  const mats = { base: newChunk(), dark: newChunk(), wood: newChunk(), glow: newChunk(), metal: newChunk(), mark: newChunk() };
  // 2. per-tile lightmap: RGB = ambient light, A = how much of the key light reaches the tile (官方做法).
  //     Environment light is the same for every tile; only its level differs between open ground and raised tops.
  //     The occlusion at the feet of the raised blocks is the key light's shadow, so it goes into A, not into RGB.
  const light = Array.from({ length: R }, () => new Float32Array(C));
  const shadow = Array.from({ length: R }, () => new Float32Array(C));
  const raised = (r, c) => { const t = grid[r]?.[c]; return !!t && t.drawn && t.h > 0.08; };
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const t = grid[r][c];
    if (!t || !t.drawn) continue;
    let near = false;
    for (let dr = -1; dr <= 1 && !near; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      if (raised(r + dr, c + dc)) { near = true; break; }
    }
    const up = t.h > 0.08;
    light[r][c] = up ? LM_RAISED : LM_BASE;
    shadow[r][c] = (up ? SHADOW_RAISED : near ? SHADOW_FOOT : SHADOW_OPEN) / 255;
  }
  // 3. one flat top quad + the visible side faces of every drawn tile
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const t = grid[r][c];
    if (!t || !t.drawn) continue;
    const x0 = c - 0.5, x1 = c + 0.5, y0 = r - 0.5, y1 = r + 0.5, z = t.h;
    const lmV = [(c + 0.5) / C, (r + 0.5) / R];
    const surf = uvTable[t.surf] || uvTable.concrete;
    const uv = uvOf(surf, t);
    const top = topMaterial(theme, t.surf, t.tint);
    pushQuad(mats[top], [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], uv, [0, 0, 1], lmV);
    // sides: where this tile's top stands above the neighbour's (an edge of the island drops to 0)
    for (const [dir, dr, dc] of [['S', 0, -1], ['E', 1, 0], ['N', 0, 1], ['W', -1, 0]]) {
      const n = grid[r + dr]?.[c + dc];
      const hz = n && n.drawn ? n.h : 0;
      if (z <= hz + 0.02) continue;
      const sn = t.side || 'graySide';
      const ssurf = uvTable[sn] || uvTable.graySide;
      const suv = surfaceUV(ssurf, sideRect(ssurf, Math.max(1e-3, 1), z - hz));
      pushQuad(mats.dark, sideCorners(dir, x0, x1, y0, y1, hz, z), suv, NRM[dir], lmV);
    }
  }
  // 3a. OPTIONAL automatic decor (legacy): kept behind SP_SCENE_AUTO=1 for comparison only. Decorations are authored
  //     by hand in the map editor now (`stage.decor`, rendered live by public/js/render/board3d/decor.js).
  if (process.env.SP_SCENE_AUTO === '1') {
  const lmVOf = (r, c) => [(c + 0.5) / C, (r + 0.5) / R];
  const L0 = stage.layout || {};
  const guard = [];
  for (const b of [L0.battle?.normal, L0.battle?.boss, L0.battle?.unite, L0.battle?.prep, L0.pen, L0.penRight]) if (b && Number.isFinite(b.r0)) guard.push(b);
  for (const a of Array.isArray(L0.bossAreas) ? L0.bossAreas : []) if (a && a.battle) guard.push(a.battle);
  const insideField = (r, c) => guard.some((b) => r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1);
  // the 1-tile band right outside a field carries the railing / walkway / crates; the block rim starts behind it
  const edgeBand = (r, c) => guard.some((b) => r >= b.r0 - 1 && r <= b.r1 + 1 && c >= b.c0 - 1 && c <= b.c1 + 1);
  const nearField = (r, c) => guard.some((b) => r >= b.r0 - 3 && r <= b.r1 + 3 && c >= b.c0 - 3 && c <= b.c1 + 3);
  const hash2 = (r, c) => (((r * 73856093) ^ (c * 19349663)) >>> 0);
  const blockUv = surfaceUV(uvTable.slats || uvTable.mech);
  const steelUv = surfaceUV(uvTable.steel || uvTable.graySide);
  const pn = L0.battle?.normal;
  const walkRow = pn && Number.isFinite(pn.r1) ? pn.r1 + 1 : -1;
  const blocked = new Set(); // tiles the rim already occupies (lanterns keep off them)
  const tallBlocks = [];     // rim blocks that get the white corner markers
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const t = grid[r][c];
    if (!t || !t.drawn || insideField(r, c) || edgeBand(r, c) || !nearField(r, c)) continue;
    const h = hash2(r, c);
    if (h % 4 === 0) continue;
    if (r === walkRow && pn && c >= pn.c0 - 1 && c <= pn.c1 + 1) continue;
    const z = t.h, w = 0.46;
    const hgt = 0.55 + (h % 6) * 0.2;
    const lm = lmVOf(r, c);
    pushBox(mats.dark, c - w, r - w, z, c + w, r + w, z + hgt, blockUv, lm);
    let top = z + hgt;
    if ((h >> 3) % 2 === 0) {
      const w2 = 0.3 + ((h >> 6) % 3) * 0.05;
      const h2 = 0.3 + ((h >> 9) % 3) * 0.16;
      pushBox(mats.dark, c - w2, r - w2, top, c + w2, r + w2, top + h2, blockUv, lm);
      top += h2;
    }
    blocked.add(`${r},${c}`);
    if (hgt > 0.95 && ((h >> 5) % 2) === 0) tallBlocks.push({ r, c, w, top, lm });
  }
  // white corner brackets on the taller blocks (the official maps' pale L-marks)
  for (const b of tallBlocks) {
    const { r, c, w, top, lm } = b, t2 = top + 0.012, th = 0.035;
    pushBox(mats.mark, c + w - 0.26, r + w - 0.06, t2, c + w, r + w + 0.02, t2 + th, FULL_UV, lm);
    pushBox(mats.mark, c + w - 0.06, r + w - 0.26, t2, c + w + 0.02, r + w, t2 + th, FULL_UV, lm);
  }
  // metal edge trim + corner guards — the official maps' "wrapped" platform edge: a low metal strip hugging the
  // boundary, L-shaped caps at the four corners and small clamps along the run (no tall posts / hand rails)
  const trimH = (r, c, z) => pushBox(mats.metal, c - 0.5, r - 0.09, z + 0.01, c + 0.5, r + 0.09, z + 0.15, steelUv, lmVOf(r, c));
  const trimV = (r, c, z) => pushBox(mats.metal, c - 0.09, r - 0.5, z + 0.01, c + 0.09, r + 0.5, z + 0.15, steelUv, lmVOf(r, c));
  /** An L-shaped corner cap: a square collar plus two short arms running along the two edges away from the corner. */
  const cornerCap = (r, c, z, sx, sy) => {
    const lm = lmVOf(r, c);
    pushBox(mats.metal, c - 0.17, r - 0.17, z, c + 0.17, r + 0.17, z + 0.34, steelUv, lm);
    if (sx) pushBox(mats.metal, c + (sx > 0 ? 0.17 : -0.6), r - 0.09, z + 0.22, c + (sx > 0 ? 0.6 : -0.17), r + 0.09, z + 0.34, steelUv, lm);
    if (sy) pushBox(mats.metal, c - 0.09, r + (sy > 0 ? 0.17 : -0.6), z + 0.22, c + 0.09, r + (sy > 0 ? 0.6 : -0.17), z + 0.34, steelUv, lm);
  };
  const edgeClampH = (r, c, z) => pushBox(mats.metal, c - 0.12, r - 0.14, z, c + 0.12, r + 0.14, z + 0.24, steelUv, lmVOf(r, c));
  const edgeClampV = (r, c, z) => pushBox(mats.metal, c - 0.14, r - 0.12, z, c + 0.14, r + 0.12, z + 0.24, steelUv, lmVOf(r, c));
  const railRing = (b) => {
    if (!b || !Number.isFinite(b.r0) || !Number.isFinite(b.c1)) return;
    const c0 = Math.max(0, b.c0 - 1), c1 = Math.min(C - 1, b.c1 + 1);
    const r0 = Math.max(0, b.r0 - 1), r1 = Math.min(R - 1, b.r1 + 1);
    for (const r of [r0, r1]) {
      for (let c = c0; c < c1; c++) trimH(r, c + 0.5, grid[r]?.[c]?.h || 0);
      for (let c = c0 + 3; c <= c1 - 3; c += 6) edgeClampH(r, c, grid[r]?.[c]?.h || 0);
    }
    for (const c of [c0, c1]) {
      for (let r = r0; r < r1; r++) trimV(r + 0.5, c, grid[r]?.[c]?.h || 0);
      for (let r = r0 + 3; r <= r1 - 3; r += 6) edgeClampV(r, c, grid[r]?.[c]?.h || 0);
    }
    const zc = (r, c) => grid[r]?.[c]?.h || 0;
    // arms point INTO the field, so the L wraps the outside corner of the platform
    cornerCap(r0, c0, zc(r0, c0), 1, 1);
    cornerCap(r0, c1, zc(r0, c1), 1, -1);
    cornerCap(r1, c0, zc(r1, c0), -1, 1);
    cornerCap(r1, c1, zc(r1, c1), -1, -1);
  };
  railRing(L0.battle?.normal);
  railRing(L0.battle?.boss);
  for (const a of Array.isArray(L0.bossAreas) ? L0.bossAreas : []) railRing(a && a.battle);
  // supply crates along the near edge, with a warm lit panel (the reference's glowing crate fronts)
  const crate = (r, c) => {
    const z = grid[r]?.[c]?.drawn ? grid[r][c].h : 0;
    const lm = lmVOf(r, c);
    pushBox(mats.wood, c - 0.26, r - 0.26, z, c + 0.26, r + 0.26, z + 0.52, FULL_UV, lm);
    pushBox(mats.glow, c - 0.17, r - 0.29, z + 0.12, c + 0.17, r - 0.25, z + 0.4, FULL_UV, lm);
    pushBox(mats.glow, c - 0.17, r + 0.25, z + 0.12, c + 0.17, r + 0.29, z + 0.4, FULL_UV, lm);
  };
  if (walkRow >= 0 && walkRow < R && pn) {
    for (let c = Math.max(0, pn.c0); c <= Math.min(C - 1, pn.c1); c += 12) crate(walkRow, c);
  }
  // a few more along the far edge / flanks, where the camera can actually see them
  const crateRing = (b) => {
    if (!b || !Number.isFinite(b.r0)) return;
    for (let c = Math.ceil(b.c0 + 3); c <= b.c1 - 3; c += 10) {
      if (b.r0 - 1 >= 0) crate(b.r0 - 1, c);
      if (b.r1 + 1 < R) crate(b.r1 + 1, c);
    }
    for (let r = Math.ceil(b.r0 + 3); r <= b.r1 - 3; r += 10) {
      if (b.c0 - 1 >= 0) crate(r, b.c0 - 1);
      if (b.c1 + 1 < C) crate(r, b.c1 + 1);
    }
  };
  crateRing(L0.battle?.normal);
  crateRing(L0.battle?.boss);
  for (const a of Array.isArray(L0.bossAreas) ? L0.bossAreas : []) crateRing(a && a.battle);
  if (walkRow >= 0 && walkRow < R) {
    for (let c = Math.max(0, pn.c0 - 1); c <= Math.min(C - 1, pn.c1 + 1); c++) {
      const t = grid[walkRow]?.[c];
      const z = t && t.drawn ? t.h : 0;
      pushBox(mats.wood, c - 0.48, walkRow - 0.48, z + 0.01, c + 0.48, walkRow + 0.48, z + 0.08, FULL_UV, lmVOf(walkRow, c));
    }
  }
  // 3b. decor: wooden corner posts on the raised platforms and standing lanterns one tile outside every field.
  //     Purely visual (the scene never blocks the sim).
  const lower = (t, rr, cc) => { const n = grid[rr]?.[cc]; return !n || !n.drawn || n.h < t.h - 0.05; };
  const lantern = (r, c) => {
    const t = grid[r]?.[c];
    const z = t && t.drawn ? t.h : 0;
    const lm = lmVOf(r, c);
    // a chunky stone lantern: wide pedestal + the paper lamp sitting directly on it (a thin post reads as floating
    // at the game's zoom, so the pedestal is the part that makes it stand)
    pushBox(mats.wood, c - 0.15, r - 0.15, z, c + 0.15, r + 0.15, z + 0.5, FULL_UV, lm);
    pushBox(mats.wood, c - 0.11, r - 0.11, z + 0.5, c + 0.11, r + 0.11, z + 0.62, FULL_UV, lm);
    pushBox(mats.glow, c - 0.17, r - 0.17, z + 0.62, c + 0.17, r + 0.17, z + 0.94, FULL_UV, lm);
  };
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const t = grid[r][c];
    if (!t || !t.drawn || t.h < 0.25) continue;
    // a post where two adjacent sides of this tile drop away (the outer corner of a platform)
    for (const [dx, dy, a, b] of [[-1, -1, lower(t, r, c - 1), lower(t, r - 1, c)], [1, -1, lower(t, r, c + 1), lower(t, r - 1, c)],
      [1, 1, lower(t, r, c + 1), lower(t, r + 1, c)], [-1, 1, lower(t, r, c - 1), lower(t, r + 1, c)]]) {
      if (!a || !b) continue;
      const x = c + dx * 0.5, y = r + dy * 0.5;
      pushBox(mats.wood, x - 0.07, y - 0.07, t.h, x + 0.07, y + 0.07, t.h + 0.62, FULL_UV, lmVOf(r, c));
    }
  }
  // The decor is placed where the camera actually looks: a lantern ring around every field (one tile outside its
  // playable rect) and the platform corner posts above. A tile the rim already occupies is skipped.
  const placeLantern = (r, c) => {
    const rr = Math.round(r), cc = Math.round(c);
    if (rr >= 0 && rr < R && cc >= 0 && cc < C && !blocked.has(`${rr},${cc}`)) lantern(rr, cc);
  };
  const lanternRing = (b) => {
    if (!b || !Number.isFinite(b.r0) || !Number.isFinite(b.c1)) return;
    for (let c = Math.ceil(b.c0 - 1); c <= b.c1 + 1; c += 8) { placeLantern(b.r0 - 1, c); placeLantern(b.r1 + 1, c); }
    for (let r = Math.ceil(b.r0); r <= b.r1; r += 8) { placeLantern(r, b.c0 - 1); placeLantern(r, b.c1 + 1); }
  };
  // one ring per PLAYABLE field — the prep/unite rects overlap the normal one and would triple the props
  lanternRing(L0.battle?.normal);
  lanternRing(L0.battle?.boss);
  for (const a of Array.isArray(L0.bossAreas) ? L0.bossAreas : []) lanternRing(a && a.battle);
  }
  // 4. pack the chunks
  const chunks = [];
  const parts = [];
  let offset = 0;
  for (const [name, ch] of Object.entries(mats)) {
    const verts = ch.pos.length / 3;
    if (!verts) continue;
    const index32 = verts > 65535;
    const vbuf = Buffer.alloc(verts * 36 + ch.idx.length * (index32 ? 4 : 2) + 4);
    // scene.bin is ATTRIBUTE-major (load.js parseSceneChunks reads n×3 positions, then n×2 uv, n×2 lightmap uv,
    // n×4 normals, n×4 colours, then the indices) — NOT one interleaved vertex record
    let p = 0;
    for (let i = 0; i < ch.pos.length; i++) { vbuf.writeFloatLE(ch.pos[i], p); p += 4; }
    for (let i = 0; i < ch.uv.length; i++) { vbuf.writeFloatLE(ch.uv[i], p); p += 4; }
    for (let i = 0; i < ch.lm.length; i++) { vbuf.writeFloatLE(ch.lm[i], p); p += 4; }
    for (let i = 0; i < ch.nrm.length; i++) { vbuf.writeInt8(ch.nrm[i], p); p += 1; }
    for (let i = 0; i < verts * 4; i++) { vbuf[p++] = 255; }
    for (let i = 0; i < ch.idx.length; i++) {
      if (index32) vbuf.writeUInt32LE(ch.idx[i], p + i * 4);
      else vbuf.writeUInt16LE(ch.idx[i], p + i * 2);
    }
    chunks.push({
      material: MAT[name], lightmap: 0, group: '',
      verts, tris: ch.idx.length / 3, offset, index32,
      bounds: ch.bounds ? ch.bounds.map((v) => Math.round(v * 1000) / 1000) : [0, 0, 0, 0, 0, 0],
    });
    parts.push(vbuf);
    offset += vbuf.length;
  }
  const bin = Buffer.concat(parts);

  // 5. lightmap page
  const rgba = new Uint8Array(LM_SIZE * LM_SIZE * 4);
  for (let y = 0; y < LM_SIZE; y++) for (let x = 0; x < LM_SIZE; x++) {
    const u = (x + 0.5) / LM_SIZE, v = 1 - (y + 0.5) / LM_SIZE;
    const c = Math.min(C - 1, Math.floor(u * C)), r = Math.min(R - 1, Math.floor(v * R));
    // 官方页面的口径（lightEncoding 缺省）：存盘值 = (display 光 / lightRange)^(1/2.2)，
    // 着色器按「最大通道 × 各通道比值的 2.2 次方」还原，再乘 lightRange^(1/2.2)。
    // 这里的页面是中性灰，反算就等于 光 / lightRange^(1/2.2)。
    const v0 = Math.max(0, Math.min(1, (light[r][c] || LM_BASE) / Math.pow(LM_RANGE, 1 / 2.2)));
    const g = Math.round(255 * v0);
    const o = (y * LM_SIZE + x) * 4;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = g;
    rgba[o + 3] = Math.round(255 * (shadow[r][c] ?? 1)); // shadow mask: how much key light the tile receives
  }
  const lm = encodePng(LM_SIZE, LM_SIZE, rgba);

  // 6. scene.json
  const matRecord = (map) => ({
    shader: 'Torappu/Scene/StandardRealtimeShadow',
    keywords: [],
    textures: { _MainTex: { texture: map, scale: [1, 1], offset: [0, 0] } },
    // 官方落地材质的常用档位（Torappu/Scene/StandardRealtimeShadow）
    floats: { _BumpScale: 1, _Metallic: 0, _Glossiness: 0, _ShadowStrength: 0.5 },
    colors: { _Color: [1, 1, 1, 1] },
    kind: 'lit',
    map,
  });
  // 分隔带/墙侧面的材质：官方用同一张 albedo，只靠主光的 N·L 压暗；这里保留一个偏中性的底色。
  const darkMat = matRecord(TEX.D);
  darkMat.colors._Color = [0.46, 0.46, 0.45, 1];
  // 地面顶面：天镜阁的石面本身偏蓝（_D 的 navy 块 R18/G28/B41），官方实时灯光靠天空反射把它拉成中性灰；
  // 烘焙场景没有反射探针，只能用材质色补回同样的观感（R↑ / B↓），并用环境光抬到编辑器预览的亮度。
  const baseMat = matRecord(TEX.D);
  baseMat.colors._Color = [1.65, 1.1, 0.8, 1];
  const woodMat = matRecord(TEX.wood);
  woodMat.colors._Color = [0.95, 0.95, 0.95, 1];
  // the lanterns' warm light: a white 8×8 map + _EMISSION, so the lamp reads as a lit paper lantern at night
  const glowMat = matRecord(TEX.glow);
  glowMat.keywords = ['_EMISSION'];
  // loadScenePack looks the emission map up as a TOP-LEVEL `emissionMap` on the material record
  glowMat.emissionMap = TEX.glow;
  glowMat.textures._EmissionMap = { texture: TEX.glow, scale: [1, 1], offset: [0, 0] };
  // no albedo light at all: the lamp is the emission alone (a white base would add the key light and read as white)
  glowMat.colors._Color = [0, 0, 0, 1];
  glowMat.colors._EmissionColor = [1, 0.55, 0.2, 1];
  glowMat.floats._Cutoff = 0;
  // the railings read as pale metal: the white sheet, not the dark atlas (toned down so they don't glow white)
  const metalMat = matRecord(TEX.glow);
  metalMat.colors._Color = [0.42, 0.46, 0.52, 1];
  const markMat = matRecord(TEX.glow);
  markMat.colors._Color = [0.85, 0.87, 0.9, 1];
  const doc = {
    version: SCENE_VERSION,
    stage: stage.id,
    bundle: 'custom',
    light: LIGHT,
    lightmaps: 1,
    // 官方场景的口径：lightRange 8，页面按 RGBM 旧格式存（lightEncoding 缺省），A = 主光阴影遮罩
    lightRange: LM_RANGE,
    materials: { [MAT.base]: baseMat, [MAT.dark]: darkMat, [MAT.wood]: woodMat, [MAT.glow]: glowMat, [MAT.metal]: metalMat, [MAT.mark]: markMat },
    groups: [''],
    chunks,
    binBytes: bin.length,
  };
  return { doc, bin, lm, chunks: chunks.length };
}

// ── manifest + files ─────────────────────────────────────────────────────────────────────────────────────

const readJson = (abs) => JSON.parse(fs.readFileSync(abs, 'utf8'));
const minJson = (v) => `${JSON.stringify(v, null, 0)}\n`;

function entryCount(groups) {
  let n = 0;
  for (const g of Object.values(groups || {})) if (isObj(g)) n += Object.keys(g).length;
  return n;
}

export function installScene({ stageFile, stageId, themeId, outDir, manifestFile }) {
  const stage = readJson(stageFile)[stageId];
  if (!isObj(stage)) throw new Error(`${stageFile} has no stage "${stageId}"`);
  const { doc, bin, lm } = buildScene(stage, themeId);
  const theme = BOARD_THEMES[themeId] || BOARD_THEMES.autochess;

  const sceneDir = path.join(outDir, 'scene', stageId);
  const texDir = path.join(outDir, 'scene', 'tex');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.mkdirSync(texDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'scene.json'), minJson(doc));
  fs.writeFileSync(path.join(sceneDir, 'scene.bin'), bin);
  fs.writeFileSync(path.join(sceneDir, 'lm0.png'), lm);

  // the theme's own images, copied under this scene's names (scene/tex is the shared texture group)
  const themeDir = path.join(outDir, ...theme.bg[0].split('/'));
  const copyTex = (name, dest) => {
    for (const ext of ['png', 'webp']) {
      const from = path.join(themeDir, `${name}.${ext}`);
      if (!fs.existsSync(from)) continue;
      fs.copyFileSync(from, path.join(texDir, `${dest}.${ext}`));
      return `${dest}.${ext}`;
    }
    throw new Error(`theme image ${name} is not installed under ${themeDir}`);
  };
  const dFile = copyTex(theme.atlas.d, TEX.D);
  const woodFile = theme.atlas.wood ? copyTex(theme.atlas.wood[0], TEX.wood) : null;
  // a tiny white sheet for the lanterns' emission (it carries no colour of its own; _EmissionColor does)
  const glowRgba = new Uint8Array(8 * 8 * 4).fill(255);
  fs.writeFileSync(path.join(texDir, `${TEX.glow}.png`), encodePng(8, 8, glowRgba));

  // manifest: this scene's group + the shared textures; other groups are untouched
  const manifest = readJson(manifestFile);
  manifest.groups = isObj(manifest.groups) ? manifest.groups : {};
  manifest.groups[`scene/${stageId}`] = {
    bin: { path: `/assets/local/scene/${stageId}/scene.bin`, kind: 'SceneData', bytes: bin.length },
    lm0: { path: `/assets/local/scene/${stageId}/lm0.png`, w: LM_SIZE, h: LM_SIZE, kind: 'Lightmap' },
    scene: { path: `/assets/local/scene/${stageId}/scene.json`, kind: 'Scene', chunks: doc.chunks.length },
  };
  const tex = isObj(manifest.groups['scene/tex']) ? manifest.groups['scene/tex'] : {};
  const src = theme.atlas.sources?.D || { w: 1024, h: 1024 };
  tex[TEX.D] = { path: `/assets/local/scene/tex/${dFile}`, w: src.w, h: src.h, kind: 'Texture2D' };
  if (woodFile) tex[TEX.wood] = { path: `/assets/local/scene/tex/${woodFile}`, w: theme.atlas.wood[1], h: theme.atlas.wood[2], kind: 'Texture2D' };
  tex[TEX.glow] = { path: `/assets/local/scene/tex/${TEX.glow}.png`, w: 8, h: 8, kind: 'Texture2D' };
  manifest.groups['scene/tex'] = tex;
  manifest.count = entryCount(manifest.groups);
  manifest.version = Number.isInteger(manifest.version) ? manifest.version : 1;
  fs.writeFileSync(manifestFile, minJson(manifest));

  return { sceneDir, files: ['scene.json', 'scene.bin', 'lm0.png'], chunks: doc.chunks.length, bytes: bin.length, count: manifest.count };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────────

function main(argv) {
  const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const stageFile = path.resolve(ROOT, arg('stage', 'data/stages.json'));
  const stageId = arg('id', '');
  if (!stageId) { console.error('--id is required (the stage id / scene id)'); return 2; }
  const themeId = arg('theme', 'autochess');
  const outDir = path.resolve(ROOT, arg('out', 'public/assets/local'));
  const manifestFile = path.resolve(ROOT, arg('manifest', 'data/local-assets.json'));
  if (!BOARD_THEMES[themeId]) { console.error(`unknown theme "${themeId}" (themes.js: ${Object.keys(BOARD_THEMES).join(', ')})`); return 2; }
  const r = installScene({ stageFile, stageId, themeId, outDir, manifestFile });
  console.log(`lightRange: ${LM_RANGE} (ambient ${LM_BASE}/${LM_RAISED}, shadow in A)`);
  console.log(`scene/${stageId}: ${r.chunks} chunk(s), ${r.bytes} bytes of scene.bin → ${path.relative(ROOT, r.sceneDir)}`);
  console.log(`data/local-assets.json: ${r.count} entries`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
