// server/match/match/reconPools.js — 重构模拟的两条「按玩家收窄」规则（业主 2026-10-26）。
//
// 1. **同场共享卡池**：不再全房间共用一个棋子池，而是**普通带同场的一对**（存活座位两两配对，与 Match.normalGroups
//    同一条顺序）共用一个 `SharedPool`。配对在开局时定下、整局不变（有人淘汰也不重排），所以池子不会中途迁移。
//    只有重构对局会建它们；其它模式 `reconPools` 是 null，`mainPool()` 照旧回 `m.pool`。
//
// 2. **自主禁用盟约**：每名玩家在预重构里可以禁 1 个盟约，判据与官方「本局禁用盟约」**同一条**（pool.js
//    drawDisabledBonds）：一枚棋子身上**每一种盟约都被禁**（全局抽签禁用 ∪ 模式静态禁用 ∪ 这名玩家自己禁的）
//    才不进这名玩家的卡池。它只作用于这名玩家的**抽卡**（商店 / 晋升奖励 / 内容 rollChess）与自选编队库存 ——
//    共享池里的拷贝原样保留，队友照常可以买到；盟约本身、战斗效果、棋子身上的盟约都不动。
//
// 实现方式：`PlayerState.mainPool()` 给别人看的是「配对池」，给这名玩家自己看的是一条 `roll` 被过滤过的
// **只读视图**（Object.create(pool)），于是所有既有抽卡调用点（它们都只走 `.roll`）自动带上这条规则，不必逐个改。

import { SharedPool } from '../pool.js';

/** 本局全部「被禁盟约」的集合：全局抽签禁用 ∪ 模式静态禁用 ∪ 这名玩家自己禁的。 */
function offBondsOf(m, ban) {
  return new Set([...(m.disabledBonds || []), ...(m.staticInactiveBonds || []), ...(ban ? [ban] : [])]);
}

/** 与 pool.js drawDisabledBonds 末尾同一判据：全身盟约都在 `off` 里的可见棋子。 */
function chessAllOff(gd, off) {
  const out = new Set();
  for (const id of gd.visibleChess) {
    const c = gd.chess(id);
    const bonds = Array.isArray(c && c.bonds) ? c.bonds : [];
    if (bonds.length > 0 && bonds.every((b) => off.has(b))) out.add(id);
  }
  return out;
}

export class MatchReconPools {
  /**
   * 建这一局的重构配对池（只在 `gd.isRecon` 时）。配对 = 存活座位两两一组，与 `normalGroups` 同一条顺序；
   * 一组至少一人（奇数座位最后一位自成一组）。池子的禁用棋子 / 助战拷贝与 `m.pool` 同一份输入。
   */
  _initReconPools() {
    if (!this.gd || !this.gd.isRecon) return;
    const byPlayer = new Map();
    /** @type {Map<string, { pool: SharedPool, players: string[] }>} */
    const byKey = new Map();
    const seated = this.order.slice().sort((a, b) => a.seat - b.seat);
    for (let i = 0; i < seated.length; i += 2) {
      const pair = seated.slice(i, i + 2);
      const players = pair.map((p) => p.playerId);
      const key = players.join('+');
      const pool = new SharedPool(this.gd, { banned: this.bannedChess || [], support: this.supportSupply || [] });
      byKey.set(key, { pool, players });
      for (const id of players) byPlayer.set(id, pool);
    }
    /** @type {{ byPlayer: Map<string, SharedPool>, byKey: Map<string, { pool: SharedPool, players: string[] }> }} */
    this.reconPools = { byPlayer, byKey };
  }

  /** 这名玩家这一局抽卡读的配对池；非重构对局 / 没建池 ⇒ null（调用方回落到旧路径）。 */
  reconPoolFor(ps) {
    if (!ps || !this.reconPools) return null;
    return this.reconPools.byPlayer.get(ps.playerId) || null;
  }

  /**
   * 这名玩家「自主禁用」后**从自己的卡池里消失**的棋子集合；没交 / 不是重构 ⇒ null。
   * 按 ban id 缓存：预重构阶段改选会换一份新的 Set（同一份数据、同一个顺序）。
   * @param {import('../PlayerState.js').PlayerState} ps
   * @returns {Set<string>|null}
   */
  reconSelfBannedChess(ps) {
    if (!this.gd || !this.gd.isRecon || !ps) return null;
    const own = this.reconChoices && typeof this.reconChoices === 'object' ? this.reconChoices[ps.playerId] : null;
    const ban = own && typeof own.ban === 'string' ? own.ban : null;
    if (!ban) return null;
    if (!this._reconSelfBanCache) this._reconSelfBanCache = new Map();
    const hit = this._reconSelfBanCache.get(ps.playerId);
    if (hit && hit.ban === ban) return hit.set;
    const set = chessAllOff(this.gd, offBondsOf(this, ban));
    this._reconSelfBanCache.set(ps.playerId, { ban, set });
    return set;
  }

  /**
   * 预重构结束、第 1 回合之前：按「自主禁用」重建这名玩家的自选编队库存（库存也是他自己的卡牌池）。
   * 这一刻谁都还没有棋子 / 库存拷贝，重建不会丢掉任何东西。
   */
  applyReconSelfBans() {
    if (!this.gd || !this.gd.isRecon) return;
    for (const ps of this.order) {
      const own = this.reconChoices && typeof this.reconChoices === 'object' ? this.reconChoices[ps.playerId] : null;
      const ban = own && typeof own.ban === 'string' ? own.ban : null;
      if (!ban || typeof ps.initDiyStock !== 'function') continue;
      ps.initDiyStock(offBondsOf(this, ban));
    }
  }
}
