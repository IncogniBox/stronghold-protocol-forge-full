// server/match/match/reconChannel.js — 重构模拟的**跨战斗共享状态通道**（match 层，一场 boss 战一份）。
//
// 背景：一场 boss 战会被拆成多块战场（`layout.bossAreas`，一块 = 一个 boss 组 = 2 名玩家）。每块战场是**独立**的
// `Battle`，包侧战斗模块（workshop/mode-recon/battle/main.mjs）只能看到自己这一块。R21 的 AMa-10 三只要跨区域
// 联动（共享血量 / 伤害转移 / 终始倒下让另外两只退场 / 击杀奖励给别的区域），所以需要有这一层。
//
// 形状（刻意最小）：
//   * **池（pool）**：`{ key → { hp, maxHp } }`，由 match 开账。包侧读写都走这里 —— `damage` / `heal` 是**唯一**
//     的扣血通道，多个战场同时打到同一个池只扣一次。
//   * **事件（broadcast）**：`emit(kind, data)` 把一条事件投递到**每一块战场**的收件箱；每块战场在自己的 tick 里
//     `drain(area)` 取走。事件只用于「让别的战场改状态」（退场 / 结束假死 / 奖励），池的数值仍然以 pool 为准。
//   * **分区（areas）**：`playerId → areaIndex`，让包侧判断「这名干员属于哪块区域」。
//
// 只在 **server-run 战场** 里生效：clientCombat 下战场在浏览器里跑，这个对象过不去（`battle.opts.reconChannel`
// 缺席 ⇒ 包侧回落到单战场近似，行为不变）。因此 match 侧只在 `!this.clientCombat` 时开账。

/** 一条事件只带最小字段；`area` 由投递方决定（缺省 = 广播给全部区域）。 */
const EMPTY = Object.freeze([]);

export class ReconChannel {
  /**
   * @param {{ areas?: Record<string, number>, pools?: Record<string, { maxHp: number, hp?: number }> }} init
   */
  constructor({ areas = {}, pools = {} } = {}) {
    /** @type {Map<string, number>} */
    this.areas = new Map(Object.entries(areas).filter(([, v]) => Number.isInteger(v)));
    /** @type {Map<string, { hp: number, maxHp: number }>} */
    this.pools = new Map();
    for (const [key, v] of Object.entries(pools)) {
      const maxHp = Math.max(1, Number(v && v.maxHp) || 0);
      const hp = Number.isFinite(v && v.hp) ? Math.max(0, Math.min(maxHp, v.hp)) : maxHp;
      this.pools.set(key, { hp, maxHp });
    }
    /** @type {Map<number, Array<object>>} */
    this.queues = new Map();
    /** 事件流水（诊断 / 测试用，最多 200 条）。 */
    this.log = [];
  }

  /** 这名棋手在**第几块** boss 场地（缺省第 1 块）。 */
  areaOf(playerId) {
    return this.areas.has(playerId) ? this.areas.get(playerId) : 0;
  }

  /** 池的当前值（没有这个池 ⇒ null）。包侧只读，不直接写。 */
  pool(key) {
    return this.pools.get(key) ?? null;
  }

  /** 从池里扣血，返回**实际**扣掉的量（池见底时只扣剩下的）。见底会广播 `{kind: '<key>Down'}`。 */
  damage(key, amount) {
    const p = this.pools.get(key);
    const n = Number(amount);
    if (!p || !(n > 0)) return 0;
    const applied = Math.min(p.hp, n);
    p.hp -= applied;
    if (p.hp <= 0) {
      p.hp = 0;
      this.broadcast({ kind: `${key}Down`, key });
    }
    return applied;
  }

  /** 直接设定池的值（夹在 0..maxHp）—— 假死锁血这类「不是伤害」的写入。 */
  setHp(key, hp) {
    const p = this.pools.get(key);
    const n = Number(hp);
    if (!p || !Number.isFinite(n)) return p ? p.hp : 0;
    p.hp = Math.max(0, Math.min(p.maxHp, n));
    return p.hp;
  }

  /** 给池回血，返回实际回复量。 */
  heal(key, amount) {
    const p = this.pools.get(key);
    const n = Number(amount);
    if (!p || !(n > 0)) return 0;
    const applied = Math.min(p.maxHp - p.hp, n);
    p.hp += applied;
    return applied;
  }

  /**
   * 「全局只回一次」的回复：多块战场同时给同一个池回血时，`window` 游戏秒内只认**第一个**调用者
   * （各战场的战场时钟按同一节奏推进，先 tick 的那块会一直赢 —— 它倒下后下一块自然接手）。
   * 用于 AMa-10 / 异构体的假死回复：它们分处两块战场，若各按自己的 tick 回 1%/s 就会翻倍。
   * @param {string} key
   * @param {number} amount
   * @param {number} time 调用者战场的当前游戏时间
   * @param {number} [window] 去重窗口（游戏秒）
   */
  healOnce(key, amount, time, window = 0.5) {
    const t = Number(time);
    if (!Number.isFinite(t)) return 0;
    if (!this.lastOps) this.lastOps = new Map();
    const prev = this.lastOps.get(key);
    if (prev != null && t >= prev && t - prev < window) return 0;
    this.lastOps.set(key, t);
    return this.heal(key, amount);
  }

  /** 投递一条事件（缺省广播给所有区域）。 */
  emit(kind, data = null, area = null) {
    this.broadcast({ kind: String(kind), data, area });
  }

  broadcast(ev) {
    const entry = { kind: ev.kind, data: ev.data ?? null, area: ev.area ?? null, seq: this.log.length + 1 };
    this.log.push(entry);
    if (this.log.length > 200) this.log.shift();
    const targets = new Set([0, ...this.areas.values(), ...this.queues.keys()]);
    for (const area of targets) {
      if (entry.area != null && entry.area !== area) continue;
      if (!this.queues.has(area)) this.queues.set(area, []);
      this.queues.get(area).push(entry);
    }
  }

  /** 取走这块战场的事件（没有就空数组）。 */
  drain(area) {
    const a = Number.isInteger(area) ? area : 0;
    const q = this.queues.get(a);
    if (!q || !q.length) {
      if (!this.queues.has(a)) this.queues.set(a, []);
      return EMPTY;
    }
    this.queues.set(a, []);
    return q.slice();
  }
}

/**
 * 把通道里的一条池**当作战场的共享血池**用（`battle.opts.sharedBoss` 的形状：`maxHp` / `hp` / `damage` / `byPlayer`）。
 *
 * 为什么需要它（交接 §5.5）：AMa-10 三只本来就有普通 `SharedBossPool` 与通道池两份，包侧再扣一次通道 ⇒ **同一伤害记两次**。
 * 接上这个适配器以后，引擎那一次扣血直接落到通道池上（`before - hp` 就是实际扣除量），包侧不再重复扣；
 * 每块战场按自己守的那只取 `core`（终始）或 `ama`（AMa-10 / 异构体），同一伤害只走一条池。
 */
export class ChannelBossPool {
  /**
   * @param {ReconChannel} channel
   * @param {string} key 池名（'ama' / 'core'）
   * @param {{ onHit?: (playerId: string|null, dealt: number) => void }} [opts]
   */
  constructor(channel, key, { onHit = null } = {}) {
    this.channel = channel;
    this.key = String(key);
    /** playerId → 对这条池造成的伤害（本场；BOSS_HIT 播报的份额） */
    this.byPlayer = new Map();
    this.onHit = onHit;
  }

  get maxHp() {
    const p = this.channel.pool(this.key);
    return p ? p.maxHp : 1;
  }

  get hp() {
    const p = this.channel.pool(this.key);
    return p ? p.hp : 0;
  }

  /** 扣血（转给通道；返回值 = 实际扣掉的量）。 */
  damage(playerId, amount) {
    const before = this.hp;
    const a = Number(amount);
    if (!(a > 0) || before <= 0) return 0;
    this.channel.damage(this.key, a);
    const dealt = Math.max(0, before - this.hp);
    if (playerId != null) this.byPlayer.set(playerId, (this.byPlayer.get(playerId) || 0) + dealt);
    if (this.onHit) {
      try { this.onHit(playerId, dealt); } catch { /* reported by the caller */ }
    }
    return dealt;
  }
}
