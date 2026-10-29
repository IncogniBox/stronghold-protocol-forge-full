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
// 3. **盟约倾向**（业主 2026-10-27）：预重构里选的主 / 副 / 故事集盟约提高**自己干员的出现占比**，同组其余
//    盟约按比例分摊同一份降幅（组内总和恒为 1）。总提升：核心 10% / 附加 20% / 故事集 10%；一条盟约的倍率 =
//    调整后份额 ÷ 原份额（8 条核心选 1 条 ⇒ 所选 ×1.8、其余 ×0.886）；干员权重取它携带各盟约倍率的平均。
//    只作用于抽卡（商店 / 晋升与合成奖励 / 内容 rollChess），不改池里的拷贝、不改队友。
//
// 实现方式：`PlayerState.mainPool()` 给别人看的是「配对池」，给这名玩家自己看的是一条 `roll` 被过滤 / 加权过的
// **只读视图**（Object.create(pool)），于是所有既有抽卡调用点（它们都只走 `.roll`）自动带上这两条规则，不必逐个改。

import { SharedPool } from '../pool.js';
import { RECON_BOND_ID } from '../../../shared/reconModes.js';

const SIDE_STORY = 'SIDE_STORY';

/**
 * 盟约倾向的三组与它们**组内概率总和不变**的提升（业主 2026-10-27）：核心 10% / 附加 20% / 故事集 10%。
 * 选中 k 条的组里，每条所选多拿 `bonus / k`，剩下 `n - k` 条平分同样的降幅 —— 组内份额总和恒为 1。
 */
const LEAN_GROUPS = Object.freeze([
  { kind: 'core', bonus: 0.1, of: (b) => b.isCore === true },
  { kind: 'addon', bonus: 0.2, of: (b) => b.isCore !== true && b.bondType !== SIDE_STORY },
  { kind: 'story', bonus: 0.1, of: (b) => b.bondType === SIDE_STORY },
]);

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
   * 「盟约倾向」的抽卡权重（业主 2026-10-27）：选中的盟约，其干员在抽卡里的出现占比提高，同组其余盟约按比例分摊
   * 同一份降幅 —— 组内概率总和恒为 1（核心总提升 10% / 附加 20% / 故事集 10%）。
   *
   * 换算：组里 n 条盟约、选中 k 条 ⇒ 每条所选份额 `1/n + bonus/k`，未选份额 `1/n - bonus/(n-k)`；
   * 一条盟约的**倍率** = 调整后份额 ÷ 原份额（官方 8 条核心选 1 条 ⇒ 所选 ×1.8、其余 ×0.886）。
   * **n 取的是合并后的盟约表**（`gd.bondIds`，含工坊包新增的盟约）：装了 mod 后核心是 11 条，所选就是
   * `(1/11 + 0.1) / (1/11) = ×2.1`，未选按同一把 n 分摊 —— 与预重构屏的候选池同一条名单。
   * 干员权重 = 它携带的各盟约倍率的**平均**（多盟约干员只吃部分提升；没有倾向时每条盟约都是 1 ⇒ 权重恒 1，
   * 抽卡与原版逐字节相同）。
   *
   * 作用点是 `PlayerState.mainPool()` 的 `roll` 视图 —— 商店、晋升 / 合成奖励、内容 `rollChess` 都走那一条。
   * @param {import('../PlayerState.js').PlayerState} ps
   * @returns {Map<string, number>|null} 棋子 id → 权重倍数；没倾向 / 非重构 ⇒ null
   */
  reconBondLeanWeights(ps) {
    if (!this.gd || !this.gd.isRecon || !ps) return null;
    const own = this.reconChoices && typeof this.reconChoices === 'object' ? this.reconChoices[ps.playerId] : null;
    if (!own) return null;
    const picks = {
      core: Array.isArray(own.major) ? own.major : [],
      addon: Array.isArray(own.minor) ? own.minor : [],
      story: typeof own.story === 'string' ? [own.story] : [],
    };
    const sig = `${picks.core.join(',')}|${picks.addon.join(',')}|${picks.story.join(',')}`;
    if (sig === '||') return null;
    if (!this._leanWeightCache) this._leanWeightCache = new Map();
    const hit = this._leanWeightCache.get(ps.playerId);
    if (hit && hit.sig === sig) return hit.map;
    /** 盟约 id → 倍率（只装组内层；跨组互不影响） */
    const mult = new Map();
    let anyPick = false;
    for (const g of LEAN_GROUPS) {
      const ids = this.gd.bondIds.filter((id) => {
        if (id === RECON_BOND_ID || this.gd.modeInactiveBonds.has(id)) return false;
        const b = this.gd.bond(id);
        return !!b && g.of(b);
      });
      const n = ids.length;
      const chosen = new Set(picks[g.kind].filter((id) => ids.includes(id)));
      // 组内先一律记 1（没选这条的组也有一条「原样」的倍率，好让多盟约干员的平均不是只看被选的组）
      for (const id of ids) mult.set(id, 1);
      if (!n || !chosen.size) continue;
      anyPick = true;
      const s0 = 1 / n;
      const gain = g.bonus / chosen.size;
      const loss = n > chosen.size ? Math.max(0, s0 - g.bonus / (n - chosen.size)) : s0;
      for (const id of ids) mult.set(id, (chosen.has(id) ? s0 + gain : loss) / s0);
    }
    if (!anyPick) {
      this._leanWeightCache.set(ps.playerId, { sig, map: null });
      return null;
    }
    const map = new Map();
    for (const id of this.gd.visibleChess) {
      const c = this.gd.chess(id);
      const bonds = Array.isArray(c && c.bonds) ? c.bonds : [];
      let sum = 0, count = 0;
      for (const b of bonds) {
        const m = mult.get(b);
        if (m != null) { sum += m; count++; }
      }
      if (count) map.set(id, sum / count);
    }
    this._leanWeightCache.set(ps.playerId, { sig, map });
    return map;
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
