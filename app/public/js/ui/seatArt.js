// 名片干员: the portrait a doctor shows on the room's seat card (screens/room.js) and on the strategy draft's name-card rows
// (screens/bandDraft.js) — the operator the player picked (room.card; room.state seats[].card), else one of the 5★/6★
// operators chosen by the player id, the same on every client.
//
// 立绘走**唯一解析链**（`ui/portraitChain.js`，`owner` = **这一席是谁**）：一张座位卡画的正是「那个人长什么样」，
// 而换装（皮肤层）由引擎按座位记（`room.state` 的 `seats[].appearance.picks`，`main.js syncRoomAppearance` 并进
// `peerAppearance`）。从前这里直连 `chessPortraitUrl`，于是同房的人选了时装、座位卡上还是原版 —— 那恰好是
// `room.appearance` 这条消息存在的理由那一半。
import { portraitUrlOf, currentAppearanceLookup } from './portraitChain.js';

/** FNV-1a of a string (the portrait pick: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** 名片干员: the player's own pick (localStorage; sent as room.card where the server knows it). */
export const CARD_PREF = 'room.card';

/**
 * The operators a seat card can show: one record per charId (the elite form for its E2 art), 6★ first.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!c || c.isDiy || c.visible === false || typeof c.charId !== 'string') continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * The seat card's portrait: the operator the player picked (room.state seats[].card, or one's own pick), else one of
 * the 5★/6★ operators chosen by the player id — the same on every client (null before the data loads).
 * @param {any} seat room.state seat @param {{ pool: any[], byChar: Map<string, any>, m: any, myId: any, myCard: string }} ctx
 */
export function seatPortrait(seat, { pool, byChar, m, myId, myCard }) {
  if (!seat || seat.playerId == null) return null;
  const pick = (seat.playerId === myId && myCard) || seat.card;
  const rec = pick && byChar ? byChar.get(pick) : null;
  // 这一席是谁的选择就用谁的：`owner` = 座位的 `playerId`（我自己那一席由 `setMyPlayerId` 认出来，与
  // `owner === undefined` 等价）。没有换装时两步都落回 `chessPortraitUrl` 那条既有分支。
  const opts = { owner: seat.playerId, lookup: currentAppearanceLookup() };
  if (rec) return portraitUrlOf(m, rec, opts);
  if (!Array.isArray(pool) || !pool.length) return null;
  return portraitUrlOf(m, pool[hash32(seat.playerId) % pool.length], opts);
}
