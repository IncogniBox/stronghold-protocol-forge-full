// ui/gameLogic/camera.js — prep camera, boss-field tile mapping, owner band. Re-exported from ../gameLogic.js.

import { PHASE } from '../../../../shared/constants.js';
import { fieldTile as layoutFieldTile, boardTile as layoutBoardTile, mapRectOf } from '../../render/layout.js';
import { OFFICIAL_LAYOUT, isDualLayout, isOfficialLayout, bossAreaCount, bossAreaLayout, bossAreaPrepRect, bossAreaSeatPrepRect } from '../../../../shared/layout.js';
import { int, isObj } from './shared.js';

/** Server-owned random pairs. Seat inference is only for an older server without the field. */
function prepPair(pub, myId) {
  const alive = (Array.isArray(pub?.players) ? pub.players : []).filter(p => isObj(p) && p.alive !== false);
  if (!alive.some(p => p.playerId === myId)) return [];
  if (pub.bossPairs !== undefined) {
    return (Array.isArray(pub.bossPairs) ? pub.bossPairs : []).find(g => Array.isArray(g) && g.includes(myId)) || [];
  }
  const ids = alive.sort((a, b) => int(a.seat, 99) - int(b.seat, 99)).map(p => p.playerId);
  const i = ids.indexOf(myId);
  return ids.slice(i - i % 2, i - i % 2 + 2);
}

/**
 * 这位棋手在第几块 boss 场地（`layout.bossAreas` 的下标；第 1 块 = 0）与它在这块场地里的座位（0 / 1）—— 与服务器
 * `Match.bossAreaOf` 同一条：`pub.bossPairs` 的顺序就是分场顺序，配对内第二位坐 1 号位。
 * @returns {{ index: number, seat: number }}
 */
export function bossAreaOfPair(pub, myId, pair = prepPair(pub, myId), idx = pair.indexOf(myId)) {
  const pairs = Array.isArray(pub?.bossPairs) ? pub.bossPairs : [];
  const index = pairs.findIndex((g) => Array.isArray(g) && g.includes(myId));
  return { index: index >= 0 ? index : idx >= 0 ? Math.floor(idx / 2) : -1, seat: idx === 1 ? 1 : 0 };
}

/**
 * Camera of the own prep board (research 09 §1.2 "Final Assault, right side", DESIGN §15): in the prep of a boss round
 * (最终攻势 / 隐秘核心: `pub.round` is `bossRound` or `hiddenRound`) the pieces stand on the player's half of the shared
 * boss field — `{ kind: 'bossPrep', opts: { side } }`; the side follows the server's pairing (server/match/
 * finalAssault.js pairPlayers, sent in m.public.bossPairs; the second of a pair is on the mirrored
 * right half 'R', a lone player on 'L'). Any other prep: the own board `{ kind: 'prep', opts: { rect, side: 'L' } }`.
 * @param {any} pub m.public
 * @param {string|null} myId
 * @returns {{ kind: 'prep'|'bossPrep', opts: { rect?: { r0: number, r1: number, c0: number, c1: number }, side: 'L'|'R' } }}
 */
/**
 * The camera request of a map's own prep board: the map's `prep` rect (shared/layout.js `battle.prep` — the board plus
 * the bench row above it), or the whole boss field in a boss round's prep (`bossPrep`, framed on the player's half).
 * Official records give the historical `{ r0: 7, r1: 12, c0: 0, c1: 10 }`; a big map gives its own band.
 * @param {any} pub m.public
 * @param {string|null} myId
 * @param {any} [layout] the map's own layout (`layoutOf(stage)`); omitted → the official one
 * @returns {{ kind: 'prep'|'bossPrep', opts: { rect?: object, side: 'L'|'R' } }}
 */
export function prepCamera(pub, myId, layout = null) {
  const r = pub?.round;
  const bossRound = Number.isInteger(r) && r > 0 && (r === pub.bossRound || r === pub.hiddenRound);
  // 自己那张棋盘的取景**再推近一截**：官方 19×21 用 configBlackBoard 的固定机位（这个值不参与），
  // 只有按图自己的矩形 fit 出来的相机（自定义布局）读它 —— 取景框四周留白先按预设算，再把整体放大 1.5 倍。
  const framed = layout && !isOfficialLayout(layout) ? { zoom: 1.5 } : null;
  if (bossRound) {
    const pair = prepPair(pub, myId);
    const idx = pair.indexOf(myId);
    // an eliminated / unknown player owns no board of its own on the boss field: the ordinary prep
    if (idx >= 0) {
      const L = layout || OFFICIAL_LAYOUT;
      const { index: raw, seat } = bossAreaOfPair(pub, myId, pair, idx);
      // 组比声明的地块多（远超 8 人的房间）：与服务器 Match.bossAreaOf 同一条 —— 多出来的组退回第 1 块（左右两半、镜像）
      const index = raw < bossAreaCount(L) ? raw : 0;
      // 第 2… 块 boss 场地：每人一条自己的矩形（`bossAreaLayout`），整块区域一个取景 ⇒ side 恒 'L'、rect 是这块场地的
      // 整备矩形（地图声明的「boss 整备矩形」——它包含战斗矩形，比它多出整备行/整备列）；缺省同战斗矩形。
      // 左右并排的两半（`bossAreaSeatPrepRect` 有值）⇒ 像普通带一样各看自己那半，伙伴的半场不在画面里。
      if (index > 0) {
        const own = bossAreaSeatPrepRect(L, index, seat);
        return {
          kind: 'bossPrep',
          opts: { side: 'L', rect: own || bossAreaPrepRect(L, index), layout: bossAreaLayout(L, index, seat), area: index, ...(framed || {}) },
        };
      }
      // 第 1 块：声明了多块 boss 场地、且这块场地也是左右并排的两半时，同样各看自己那半（返回形状仍不带 area 键）；
      // 官方 19×21 那张（不声明 `bossAreas`）照旧整块 boss 场地一起看。
      const own0 = Array.isArray(L.bossAreas) ? bossAreaSeatPrepRect(L, 0, idx % 2 === 1 ? 1 : 0) : null;
      if (own0) return { kind: 'bossPrep', opts: { side: idx % 2 === 1 ? 'R' : 'L', rect: own0, ...(framed || {}) } };
      return { kind: 'bossPrep', opts: { side: idx % 2 === 1 ? 'R' : 'L', ...(framed || {}) } };
    }
  }
  // 普通带的左右两半（shared/layout.js `isDualLayout`）：同一套按座位两两一组的配对，第 1 位 'R'（与服务器
  // Match.normalSideOf 同一条规则）。单块普通带的图恒 'L'，revert 到历史那条 `{ rect: battle.prep, side: 'L' }`。
  const side = ordinarySide(pub, myId, layout);
  return { kind: 'prep', opts: { rect: ordinaryPrepRect(layout, side), side, ...(framed || {}) } };
}

/** The seat-order pairing of a two-half ordinary band: the 1st alive player by seat → 'L', the 2nd → 'R' (per field). */
function ordinarySide(pub, myId, layout) {
  if (!isDualLayout(layout)) return 'L';
  const alive = (Array.isArray(pub?.players) ? pub.players : []).filter((p) => isObj(p) && p.alive !== false);
  const ids = alive.slice().sort((a, b) => int(a.seat, 99) - int(b.seat, 99)).map((p) => p.playerId);
  const i = ids.indexOf(myId);
  return i >= 0 && i % 2 === 1 ? 'R' : 'L';
}

/**
 * The prep band one side of an ordinary band frames: the map's own `battle.prep` (unchanged) on a single-band map; on a
 * two-half map the own half — the board plus the two bench rows above it — mirrored about the axis for the right side.
 */
function ordinaryPrepRect(layout, side) {
  const L = layout || OFFICIAL_LAYOUT;
  if (!isDualLayout(L)) return mapRectOf(L, 'prep');
  const n = L.deployRects.normalLeft;
  const p = L.battle.prep;
  // 行带与靠外的列都按地图声明的整备矩形（`battle.prep`），不是写死的「棋盘下两行」——
  // 一张把板凳画得离场地远一行的图，那两行板凳都要在画面里。相接列仍是自己那半的 `normalLeft.c1`。
  const own = { r0: Math.min(p.r0, n[0] - 2), r1: Math.max(p.r1, n[1]), c0: Math.min(p.c0, n[2] - 2), c1: n[3] };
  return side === 'R' ? { ...own, c0: L.mirrorCol - own.c1, c1: L.mirrorCol - own.c0 } : own;
}

const BOSS_PREP_PHASES = new Set([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP]);

/**
 * The players framed in green on the team panel (community report of 2026-10-06, item 51: 「同组两个玩家屏幕左边的头像也像原版
 * 那样用绿框框起来」 — the official co-op frame, ui/battle `bg_team_border`): in a boss round (最终攻势 / 隐秘核心) the viewer
 * and its pair partner — from the round's start (回合开始 / 机变 / 休整期: the pairing `prepCamera` reads, the players still
 * in the server's saved pairs — server/match/finalAssault.js pairPlayers) through the fight (the boss field listing the
 * viewer). Empty for a lone player, an eliminated player or a spectator seat (no pair of its own) and in every other
 * round. PR #191 framed the partner alone, in gold (not merged).
 * @param {any} pub m.public @param {string|null} myId
 * @returns {Set<string>}
 */
export function teamFrameIds(pub, myId) {
  const none = new Set();
  if (!pub || !myId) return none;
  const players = Array.isArray(pub.players) ? pub.players.filter(isObj) : [];
  const me = players.find((p) => p.playerId === myId);
  if (!me || me.alive === false) return none;
  const r = pub.round;
  const bossRound = Number.isInteger(r) && r > 0 && (r === pub.bossRound || r === pub.hiddenRound);
  if (pub.phase === PHASE.FINAL_ASSAULT || pub.phase === PHASE.HIDDEN_CORE) {
    const f = (Array.isArray(pub.fields) ? pub.fields : []).find((x) => isObj(x) && (x.kind === 'boss' || x.kind === 'hidden') && Array.isArray(x.players) && x.players.includes(myId));
    return f && f.players.length > 1 ? new Set(f.players) : none;
  }
  if (!bossRound || !BOSS_PREP_PHASES.has(pub.phase)) return none;
  const pair = prepPair(pub, myId);
  return pair.length > 1 ? new Set(pair) : none;
}

/**
 * The own prep board's camera request with the shop bar's state (public issue #5 "准备阶段，收起商店界面时，界面并不会进行
 * 缩放"): `prepCamera` plus `shop: !folded` — a folded shop (收起) takes the official shop-collapsed camera
 * (configBlackBoard left_prepare_camera_param / *_boss_prepare_*, render/projection.js presetCamera `shop: false`) and
 * the folded shop's HUD band (ui/fieldHost.js hudBands), an open one the shop camera. `folded` = the shop bar is shown
 * and folded (an eliminated player's board, which shows no bar, keeps the shop camera).
 * @returns {{ kind: 'prep'|'bossPrep', opts: { rect?: object, side: 'L'|'R', shop: boolean } }}
 */
export function prepCameraFor(pub, myId, folded = false, layout = null) {
  const c = prepCamera(pub, myId, layout);
  return { kind: c.kind, opts: { ...c.opts, shop: !folded } };
}

/**
 * The camera request a fold / unfold of the shop bar needs right now (public issue #5), or null: only while the own prep
 * board is on screen (`ownPrep`: prep, not a teammate's scouted board, not a battle), never over the enemy pen (`pen`: it
 * folds the shop itself and returns to the camera it left), deferred while a piece is dragged or its direction is chosen
 * (`busy`: the drop target and the wheel sit on tiles of the camera in use — the caller asks again once that ends), and
 * nothing when the current request (`current` { kind, opts }) already has that shop state.
 * @param {{ pub: any, myId: string|null, ownPrep: boolean, folded: boolean, pen?: boolean, busy?: boolean,
 *   current?: { kind: string, opts?: { shop?: boolean } }|null, layout?: any }} s
 * @returns {{ kind: 'prep'|'bossPrep', opts: object }|null}
 */
export function foldCamera(s) {
  if (!s || !s.ownPrep || s.pen || s.busy) return null;
  const want = prepCameraFor(s.pub, s.myId, !!s.folded, s.layout || null);
  const cur = s.current;
  if (cur && cur.kind === want.kind && (cur.opts?.shop !== false) === want.opts.shop) return null;
  return want;
}

/**
 * Whether a deploy interaction temporarily folds the shop and zooms the own prep board (public issue #602 "部署干员、
 * 装备时棋盘缩放": the official client folds the shop and takes the shop-collapsed prep camera while a piece is picked
 * up for 部署干员 / 装备 / repositioning, and while the dropped piece's direction wheel is open, then gives the
 * player's own shop state back — the board was too small to aim on phones): the viewer edits the own prep board
 * (`ownPrep`, `editable`), the camera is not over the enemy pen (`pen`), and a piece is dragged (`drag`) or the
 * direction wheel of a legal drop is open (`facing`; equipment and summons skip the wheel and restore on drop).
 * Unlike a hand-made fold this one never waits for the interaction to end — it zooms as the piece is picked up. It is
 * derived from the interaction state and never writes the player's 收起/展开 state. `enabled` omitted stays on (callers
 * and the default of 设置「部署时收起商店」). Only an explicit false turns the temporary fold off. [ASSUMED] that label.
 * @param {{ ownPrep?: boolean, editable?: boolean, pen?: boolean, drag?: boolean, facing?: boolean, enabled?: boolean }|null|undefined} o
 * @returns {boolean}
 */
export function deployFoldsShop(o) {
  if (!o || o.enabled === false) return false;
  return !!o.ownPrep && !!o.editable && !o.pen && (!!o.drag || !!o.facing);
}

/**
 * Whether this frame's deploy fold should zoom the board, and whether a zoom already applied must be given back now.
 * `zoomed` is the previous frame's deploy zoom (the caller remembers it). Turning 设置「部署时收起商店」 off while a
 * piece is still held (`deployFold` becomes false) releases that zoom on this one frame — later frames of the same
 * drag do not, so a hand-made 收起 during the rest of the drag still waits (issue #5).
 * @param {boolean} zoomed
 * @param {boolean} deployFold
 * @returns {{ release: boolean, zoomed: boolean }}
 */
export function deployZoomStep(zoomed, deployFold) {
  return { release: !!zoomed && !deployFold, zoomed: !!deployFold };
}

/**
 * Whether the deploy zoom is still owed after this frame (`deployZoomedRef`). `step` is `deployZoomStep`;
 * `frame.next` is what `prepDeployCamera` returned for that same step and `frame.pen` is the enemy pen.
 * Turning 设置「部署时收起商店」 off asks for the player's camera on one frame. Opening 敌方情报 during the
 * held drag makes that frame return null (`foldCamera` while `pen`), and forgetting the zoom there left an
 * open shop on the still-zoomed board until the drag ended. A null because the pen is open keeps the zoom
 * owed, so closing the pen still passes `releaseDeploy` while the piece is held. A null only because the
 * camera already matches the player's own fold spends it, so a later hand-made 收起 in that drag still waits.
 * [ASSUMED] no official source settles opening the pen during a held deploy drag.
 * @param {{ release?: boolean, zoomed?: boolean }|null|undefined} step
 * @param {{ next?: object|null, pen?: boolean }|null|undefined} [frame]
 * @returns {boolean}
 */
export function deployZoomRemember(step, frame) {
  if (step?.zoomed) return true;
  return !!step?.release && !frame?.next && !!frame?.pen;
}

/**
 * The prep camera this frame: the deploy zoom when `deployFold` (GitHub #602), else the shop fold's camera
 * (`foldCamera`). `releaseDeploy` skips the busy deferral for the one frame a deploy zoom is given back, so turning
 * the setting off mid-drag cannot leave the camera zoomed. A hand-made fold while the setting is off and no deploy
 * zoom is in effect still defers (`busy`).
 * @param {{ pub: any, myId: string|null, deployFold?: boolean, releaseDeploy?: boolean, folded: boolean,
 *   ownPrep: boolean, pen?: boolean, busy?: boolean, layout?: any,
 *   current?: { kind: string, opts?: { shop?: boolean } }|null }|null|undefined} s
 * @returns {{ kind: 'prep'|'bossPrep', opts: object }|null}
 */
export function prepDeployCamera(s) {
  if (!s) return null;
  if (s.deployFold) {
    const want = prepCameraFor(s.pub, s.myId, true, s.layout || null);
    const cur = s.current;
    if (cur && cur.kind === want.kind && cur.opts?.shop === false) return null;
    return want;
  }
  return foldCamera({
    pub: s.pub, myId: s.myId, folded: s.folded, ownPrep: s.ownPrep, pen: s.pen,
    busy: !!s.busy && !s.releaseDeploy, current: s.current, layout: s.layout || null,
  });
}

/**
 * The field the own pieces are deployed on (server/match/Match.js deployFieldOf): 'bossL' / 'bossR' in the prep of a
 * boss round (the same pairing as `prepCamera`), else 'normal'. Placement legality (`placementContext` → `deployMap`
 * with `field`) reads that field's tiles.
 * @returns {'normal'|'bossL'|'bossR'}
 */
export function deployFieldOf(pub, myId, layout = null) {
  const cam = prepCamera(pub, myId, layout);
  if (cam.kind === 'bossPrep') return cam.opts.area > 0 ? 'bossL' : cam.opts.side === 'R' ? 'bossR' : 'bossL';
  // 一张左右两半的图：普通回合也在自己的半场上（服务器 Match.deployFieldOf → 'normalL' / 'normalR'）
  if (isDualLayout(layout)) return cam.opts.side === 'R' ? 'normalR' : 'normalL';
  return 'normal';
}

/**
 * 这位棋手自己的布局：第 2… 块 boss 场地每人一条矩形（`prepCamera` 已经算好），其余就是地图自己的布局
 * （服务器 `Match.deployLayoutOf` 同一条）。放置合法性（placementContext → deployMap）与棋盘几何都读它。
 */
export function deployLayoutOf(pub, myId, layout = null) {
  const cam = prepCamera(pub, myId, layout);
  return cam.opts && cam.opts.layout ? cam.opts.layout : layout;
}

/**
 * The map tile [row, col] of board tile (r, c) on deploy field `field` (server/match/board.js fieldTile): the boss
 * prep's display transform (render/prepfield.js bossPrepField: the row shift the map's own boss rect gives, the right
 * half mirrored about its mirror column), a two-half ordinary band's halves, and the ordinary band itself on a map
 * whose board does not sit where the official one does (45×60: board rows 8–12 = map rows 34–38). `layout` omitted
 * keeps meaning "the official 19×21 map" — the historical identity — because `layoutFieldTile` reproduces it there.
 */
export function fieldTile(field, r, c, layout = null) {
  return layoutFieldTile(field, r, c, layout || undefined);
}

/** The board tile of map tile (r, c) on deploy field `field` (server/match/board.js boardTileOf). */
export function boardTileOf(field, r, c, layout = null) {
  return layoutBoardTile(field, r, c, layout || undefined);
}

/** The band (策略) a player picked, from m.public.players[].bandId (Match.js marksPublic) — the detail card shows it
 *   on a teammate's unit (user playtest #2 item 2: watching a teammate revealed nothing about their 策略). */
export function ownerBandId(pub, ownerId) {
  const p = Array.isArray(pub?.players) ? pub.players.find((x) => x && x.playerId === ownerId) : null;
  return typeof p?.bandId === 'string' && p.bandId ? p.bandId : null;
}
