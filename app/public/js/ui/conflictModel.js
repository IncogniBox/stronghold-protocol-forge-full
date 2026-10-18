// 干员冲突兼容 (operator conflict, 2026-10-16) — pure logic of the source switch the 干员调配 detail card shows, shared
// with the sync (ui/loadoutSync.js) and the tests.
//
// 背景（`shared/workshop.js` 的 `PACK_ID_COLLISION`）：两个包各贡献了**同一个 id** 时，合并层按包 id 字典序只留赢家、
// 输家整个丢掉 —— 一份合并结果是对的（客户端与服务端都只看得见一份），但玩家从此不知道**还有另一份**。引擎把丢掉
// 的那几份留在 `data.workshopConflicts` 里（`{ [file]: { [id]: { winner, packs: [{ pack, record }…] } } }`，`packs[0]`
// 恒是赢家），`public` 侧从只读路由 `/workshop-conflicts.json` 读到同一份索引（`server/http/routes.js`）。
//
// 玩家的决定只有一格：**这个干员本局用哪个包的那一份记录**，形状 `{ [chessId]: packId }`，走 C2S `room.conflict
// { picks }`（`shared/protocol.js`，判据宽松：过期的选择逐项丢掉，绝不让整条消息变 BAD_MSG）。不挑 = 用今天实际生效
// 的那一份（赢家），所以**赢家不进这个表**（表里只留「和缺省不一样」的那几格，与 `entries` / `diy` 同一条纪律）。
//
// 每浏览器的设置存在 localStorage（`sp.pref.conflict` = `{ v: 1, picks }`）；局外设置，下一局生效。

import { CONFLICT_LIMITS, checkConflictPicks } from '../../../shared/protocol.js';

/** localStorage key (store.js loadPref/savePref prefix `sp.pref.`) and format version. */
export const CONFLICT_PREF = 'conflict';
export const CONFLICT_VERSION = 1;

const ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;
const UNSAFE_IDS = new Set(['__proto__', 'constructor', 'prototype']);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && ID_RE.test(v) && !UNSAFE_IDS.has(v);

/**
 * Structurally valid picks of a raw map (junk dropped; at most CONFLICT_LIMITS.picks entries): each value is a pack id.
 * @param {any} raw
 * @returns {Record<string, string>}
 */
export function cleanConflictPicks(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [chessId, packId] of Object.entries(raw)) {
    if (Object.keys(out).length >= CONFLICT_LIMITS.picks) break;
    if (isId(chessId) && isId(packId)) out[chessId] = packId;
  }
  return out;
}

/** Parse a stored setting (any junk → {}): `{ v, picks }`. @param {any} raw */
export function parseStoredConflict(raw) {
  return isObj(raw) ? cleanConflictPicks(raw.picks) : {};
}

/** Serialised form for localStorage. */
export const toStoredConflict = (picks) => ({ v: CONFLICT_VERSION, picks: cleanConflictPicks(picks) });

/**
 * The candidates of a chess id in the conflict index: `[{ pack, record }…]` with the winner first, or null when that id
 * is not conflicted (unknown id, one pack only, or no index at all) — null means the detail card shows no switch.
 * @param {any} conflicts the index (`data.workshopConflicts`) @param {string} chessId
 * @returns {Array<{ pack: string, record: any }>|null}
 */
export function conflictCandidates(conflicts, chessId) {
  const chess = isObj(conflicts) ? conflicts.chess : null;
  const entry = isObj(chess) && Object.hasOwn(chess, chessId) ? chess[chessId] : null;
  const packs = entry && Array.isArray(entry.packs) ? entry.packs.filter((p) => p && isId(p.pack)) : null;
  return packs && packs.length >= 2 ? packs : null;
}

/**
 * The winner of a conflicted chess id (the entry's first candidate — the pack the merge kept).
 * @param {any} conflicts @param {string} chessId @returns {string|null}
 */
export function conflictWinner(conflicts, chessId) {
  const packs = conflictCandidates(conflicts, chessId);
  return packs ? packs[0].pack : null;
}

/**
 * The pack a chess id's records currently come from: the player's pick, else the winner (`null` without a conflict).
 * @param {any} conflicts @param {string} chessId @param {Record<string, string>} picks @returns {string|null}
 */
export function effectiveConflictor(conflicts, chessId, picks) {
  const packs = conflictCandidates(conflicts, chessId);
  if (!packs) return null;
  const picked = picks && typeof picks[chessId] === 'string' ? picks[chessId] : null;
  return picked && packs.some((p) => p.pack === picked) ? picked : packs[0].pack;
}

/**
 * Set (or with null, clear) one chess id's pack. Returns a new map (the input is not changed); clearing the winner is
 * the same as "use the default", so a pick equal to the winner is removed instead of stored (the map stays minimal).
 * @param {Record<string, string>} picks @param {string} chessId @param {string|null} packId
 * @param {string|null} [winner] the id's default pack (kept out of the map when picked)
 * @returns {Record<string, string>}
 */
export function withConflictPick(picks, chessId, packId, winner = null) {
  const next = { ...cleanConflictPicks(picks) };
  if (isId(chessId) && isId(packId) && packId !== winner) next[chessId] = packId;
  else delete next[chessId];
  return next;
}

/**
 * The picks the server would keep (checkConflictPicks: an id that is not conflicted here, or a pack that did not
 * contribute that record, is dropped). Used to keep the stored setting from carrying stale picks.
 * @param {Record<string, string>} picks @param {any} conflicts the index
 * @returns {Record<string, string>}
 */
export function sanitizeConflictPicks(picks, conflicts) {
  const res = checkConflictPicks(cleanConflictPicks(picks), { workshopConflicts: conflicts });
  return res && res.ok ? res.picks : {};
}
