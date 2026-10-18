// server/match/player/conflict.js — 「干员冲突兼容」的**玩家侧**：**这一个玩家**挑哪一份记录上场。
//
// 背景（`shared/workshop.js`）：两个包各贡献了**同一个 id** 时，合并层按包 id 字典序只留赢家、输家整个丢掉
// （`PACK_ID_COLLISION`）—— 一份合并结果是对的（客户端与服务端都只看得见一份），但玩家从此不知道还有另一份。
// 现在丢掉的那几份留在 `data.workshopConflicts` 里（`{ [file]: { [id]: { winner, packs: [{ pack, record }…] } } }`，
// `packs[0]` 是赢家），`room.conflict { picks }`（`shared/protocol.js`）就是玩家从里面挑一个的决定。
//
// 这一条是 **per-player 的记录替换**，与两条既有轨道同构 —— 复用的是它们的地基，不是新造一层：
//   * 补位（0.2.0，`player/basics.js` 的 `fieldRecord` / `gd.standIn`）：一条棋子的**身份**归棋子，**身体**归替补干员；
//   * 自选编队（0.2.0，`player/diy.js` 的 `diyGameData`）：**这一个玩家的** `GameData` 视图，`view.chess(id)`
//     返回他自己挑的那份合成记录，其余查询落到比赛那一份。
// 我们走的是第二条：`conflictGameData` 只是又一层 `Object.create(gd)` 的视图，把挑选过的 id 换掉。
//
// **顺序**：`rebuildPlayerView` 是唯一的装配点（DIY 先叠、冲突后叠，后叠的赢）—— `setDiy` 与 `setConflict` 都调它，
// 所以两条设置各自改动都不会把对方的视图冲掉（两个 setter 自己拼视图是这一层最容易出的错）。

import { checkConflictPicks } from '../../../shared/protocol.js';
import { diyGameData } from './diy.js';

/**
 * The player's view of the match's GameData: `records` maps a conflicted chess id to the candidate THIS player picked;
 * every other lookup is the view it wraps (the player's DIY view, or the match's own).
 * @param {import('../gamedata.js').GameData} gd
 * @param {Map<string, object>} records
 * @returns {import('../gamedata.js').GameData}
 */
export function conflictGameData(gd, records) {
  const view = Object.create(gd);
  Object.defineProperties(view, {
    /** the match's own GameData (the view is per player) */
    matchData: { value: gd.matchData || gd },
    chess: { value: (id) => (typeof id === 'string' && records.has(id) ? records.get(id) : gd.chess(id)) },
  });
  return view;
}

export class PlayerConflict {
  /**
   * Rebuild this player's data view from the match's own: DIY picks first, the conflict picks last (the last layer
   * wins). The ONE place the view is assembled — both setters call it (see the header).
   */
  rebuildPlayerView() {
    let view = this.m.gd;
    if (this._diyRecords && this._diyRecords.size) view = diyGameData(view, this._diyRecords);
    if (this._conflictRecords && this._conflictRecords.size) view = conflictGameData(view, this._conflictRecords);
    this.gd = view;
  }

  /**
   * Fix this player's conflict picks for the match (see the header): the seat's picks re-checked against this match's
   * data (`checkConflictPicks` — an id that is not conflicted here, or a pack that did not contribute that record, is
   * dropped item by item). An empty result leaves every chess on the merged winner.
   * @param {any} picks `{ [chessId]: packId }`
   * @returns {boolean} false when the picks are malformed (nothing changes) or the player is a bot
   */
  setConflict(picks) {
    if (this.isBot) return false;
    const data = this.m.gd.raw;
    const res = checkConflictPicks(picks, data);
    if (!res || res.error) {
      this.m.log?.warn?.(`[match ${this.m.roomCode}] conflict picks of ${this.playerId} ignored: ${res && res.detail}`);
      return false;
    }
    const byId = data && data.workshopConflicts && data.workshopConflicts.chess ? data.workshopConflicts.chess : {};
    const kept = {};
    const records = new Map();
    for (const [chessId, packId] of Object.entries(res.picks)) {
      const entry = Object.hasOwn(byId, chessId) ? byId[chessId] : null;
      const cand = entry && Array.isArray(entry.packs) ? entry.packs.find((p) => p && p.pack === packId) : null;
      if (!cand || !cand.record) continue;
      kept[chessId] = packId;
      records.set(chessId, cand.record);
    }
    this.conflict = Object.freeze(kept);
    this._conflictRecords = records;
    this.rebuildPlayerView();
    return true;
  }
}
