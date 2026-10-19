// workshop/dossoles/battle/main.mjs — 「多索雷斯」故事集盟约的**战斗侧效果**（`pack.json.server.battle`，DESIGN §28.17）。
//
// 这一条盟约的全部效果都在这里，用引擎**通用**的盟约 installer 通道实现（`registerBondInstaller`，`sim/content/bonds/core.js`）：
// 它是**一个 bondId 一个 installer、先到先得**，所以本包给自己这一条盟约注册，不碰别人的槽位。
//
// ── 效果（阈值 2 / 4 人，取自多索雷斯假日活动的「水蚀」）─────────────────────────────────
//   特殊水地形  := **所有【多索雷斯】干员的攻击范围格子的并集**（「攻击范围视为特殊水地形」的直接读法 ——
//                  引擎没有 per-tile 的自定义地形状态，这样读「处于特殊水地形中」才可判定）。
//                  这一份格子每 `water_refresh` 秒重算一次，并且**画出来**（`battle.fx('dosWater', { tiles })`：
//                  浅蓝波纹覆盖地块，`public/js/render/fx/kinds.js`）—— 不画玩家看不见哪里算水地形。
//
//   第 1 档（2 人）：①【多索雷斯】干员处于特殊水地形中时，攻击附带 攻击力×(10% + 0.1%×层数) 的**侵蚀损伤**；
//        ②敌人处于特殊水地形中时，移动速度与攻击速度降低 min(80%, 10% + 0.5%×层数)（`bb.water_slow_cap`）。
//   第 2 档（4 人）：③敌人受到**侵蚀损伤爆发**时，防御力额外降低 50 + 2×层数 点（在引擎自带的 −120 之外，按爆发的次数叠加）；
//        ④敌人处于**损伤爆发期间**时，每 0.5 秒受到一次 元素伤害 = 场上攻击力最高的【多索雷斯】干员 × (50% + 1%×层数)。
//
// ── 用到的引擎通用能力（全部来自 `@battle/mod.js` 与 battle 句柄）───────────────────────
//   registerBondInstaller(bondId, fn)   fn(battle, pid, bb, members) —— 每个玩家 × 每个已激活盟约一次
//   bondTier / bondLayers(battle, pid, bondId)   该玩家这条盟约的**到达层数 / 盟约层数**（层数 = 「每层」那一轴）
//   tileKey(u)                        单位脚下的格子键（友方用 tileR/COLS+tileC，敌人用 round(x/y)）
//   battle.refreshRange(u)            按当前位置重建 `u.rangeKeySet`（只对友方；移动后范围键会变）
//   battle.dealDamage(src, tgt, dmg)  type:'element' = 元素**损伤**（充能条），type:'elemental' = 元素**伤害**（走元素抗性）
//   battle.addBuff / battle.removeBuff  敌人减益（mods：`moveMul` 倍率、`aspd` 加算、`defFlat` 固定值）
//   battle.every(seconds, fn)         战场自己的时钟（禁 `setTimeout` —— 真实计时器会让服务端复算对不上）

import {
  registerBondInstaller, registerItemBehaviour, registerGarrisonInstaller, onLayers,
  reached, bondLayers, gainLayers, setBattleMark, isOp, unitBonds, num, tileKey,
} from '@battle/mod.js';
// `COLS` 是每行的格数：绝对格键（`r × COLS + c`，`tileKey`）反算回 `[r, c]` 给地块覆盖用。
import { COLS } from '@sim/constants.js';

/** 本包的盟约 id（与 `bonds.json` 的键一致）。 */
const BOND = 'dossolesShip';
/** 「侵蚀」在引擎里的元素键（`shared/constants.js` 的 `ELEMENTS`）。 */
const EL = 'erosion';
/** 敌人身上的「水地形减速」buff 键（离开水地形就摘掉）。 */
const KEY_WATER = `bond:${BOND}:water`;
/** 敌人身上的「爆发额外降防」buff 键（与引擎自己的 `erosionDown` 并存）。 */
const KEY_SUNDER = `bond:${BOND}:sunder`;
/** 引擎给元素爆发上的冷却锁 buff 键（`<el>Burst`，`sim/damage.js` 的 `resolveBurst`）。 */
const BURST_KEY = `${EL}Burst`;
/** 「特殊水地形」地块覆盖的重发间隔（战场时间 s）：`tileFlash` 是一段淡出的闪光，不重发就消失了。 */
const PAINT_SEC = 0.6;
/** 一次 fx 最多带多少格（`fx/zones.js tileFlash` 取前 60 格），所以超过就分包发。 */
const PAINT_CHUNK = 60;
/** 地块覆盖的存活时长（战场时间 s）：略长于重发间隔，两块之间不留空档。 */
const PAINT_DUR = 1.2;
/** 干员的「攻击范围＝特殊水地形」跟随并集的间隔（战场时间 s，与 `water_refresh` 同量级）。 */
const FOLLOW_SEC = 0.25;

/** battle 句柄的 `every` 参数下限保护（0 或负数会变成每帧）。 */
const everySec = (v, fallback) => {
  const n = num(v, fallback);
  return n > 0 ? n : fallback;
};

/**
 * 每个战场 × 每个玩家的「特殊水地形」格子集合（绝对格键）。
 *
 * 盟约 installer 算出这一份并集，**假日威龙陈**的特质（`DOS_CHEN2_WATER_RANGE`）把它当自己的攻击范围读 ——
 * 两边必须看**同一份**（各自算一遍就是第二个会漂的真相），所以集合本身按引用共享、由 installer 原地维护。
 * @param {any} battle @param {string} pid
 * @returns {Set<number>}
 */
function waterTiles(battle, pid) {
  let m = WATER.get(battle);
  if (!m) WATER.set(battle, (m = new Map()));
  let set = m.get(pid);
  if (!set) m.set(pid, (set = new Set()));
  return set;
}
/** battle → Map<pid, Set<tileKey>>（见 `waterTiles`）。 */
const WATER = new WeakMap();

/**
 * 把「特殊水地形」画在战场上：浅蓝色的波纹覆盖每一格（fx 种类 `dosWater`，`public/js/render/fx/kinds.js`）。
 *
 * 一格一 zone 会让事件量随格子数爆炸，所以走 `telegraph` 那条**显式地块表**通道（引擎自己的「火墙」「预警框」
 * 同一条）：一次 fx 带一串 `tiles`，`fx` 每 `PAINT_SEC` 秒重发一次，超过 `PAINT_CHUNK` 格就分包。
 * `x` / `y` 只喂给锚点（显式 `tiles` 与它无关），`r` 必须小于 12 —— `telegraph` 在 `r ≥ 12` 时改画全屏闪光。
 * @param {any} battle @param {Set<number>} tiles
 */
function paintWater(battle, tiles) {
  const list = [...tiles];
  for (let i = 0; i < list.length; i += PAINT_CHUNK) {
    const chunk = list.slice(i, i + PAINT_CHUNK);
    const body = chunk.map((k) => [Math.floor(k / COLS), k % COLS]);
    battle.fx('dosWater', { x: 0, y: 0, r: 1, tiles: body, n: body.length, dur: PAINT_DUR });
  }
}


/** 一名干员当前是否处于「该元素」的损伤爆发期间（引擎的 `<el>Burst` 冷却锁，或爆发正在结算）。 */
function bursting(u) {
  if (!u || !u.alive) return false;
  if (u.burstPending && u.burstPending[EL]) return true;
  const list = u.buffs;
  if (Array.isArray(list)) for (const b of list) if (b && b.key === BURST_KEY) return true;
  return false;
}

/**
 * 注册本包盟约的效果（模块顶层一次 —— `registerBondInstaller` 是全局表，install() 每次战斗都会跑）。
 * @param {any} battle 战斗句柄
 * @param {string} pid 这一份盟约属于哪个玩家
 * @param {any} bb 盟约的黑板（`bonds.json` 的 `bb` / `buffs[].bb`）
 * @param {any[]} members 该玩家在场（已部署）的【多索雷斯】干员
 */
function installDossoles(battle, pid, bb, members) {
  if (!battle || !Array.isArray(members) || !members.length) return;
  const refresh = everySec(bb.water_refresh, 0.25);
  const pulse = everySec(bb.burst_hit_interval, 0.5);
  /** 层数（「每层」那一轴）现取现用：叠层/层数变化不需要重挂 hook。 */
  const layers = () => bondLayers(battle, pid, BOND);
  /** 人数门槛（第 1 档 2 人、第 2 档 4 人）：`reached` 是引擎自己的判据（人数够，或层数已到对应阈值）。 */
  const atLeast = (cnt) => reached(battle, pid, BOND, num(cnt, 0));
  /** 场上的成员（`members` 是布战时刻的那一份，之后可能被击倒）。 */
  const alive = () => members.filter((u) => u && u.alive && u.deployed);
  /** 「移动与攻击速度降低 x%」的层数总量，夹在 `bb.water_slow_cap`（80%）以下 —— 卡片印的就是这个数。 */
  const slowPct = () => {
    const raw = num(bb.water_slow, 0) + num(bb.water_slow_per_stack, 0) * layers();
    const cap = num(bb.water_slow_cap, 1);
    return Math.max(0, Math.min(raw, cap > 0 ? cap : 1));
  };

  // ── 特殊水地形：所有在场成员攻击范围格子的并集（每 `refresh` 秒重算一次：干员会移动、会阵亡）──────
  //    这一份集合**按引用共享**（`waterTiles`）：假日威龙陈的攻击范围直接读它。
  const water = waterTiles(battle, pid);
  const refreshWater = () => {
    water.clear();
    if (!atLeast(bb.power_bond_char_cnt)) return;
    for (const u of alive()) {
      // 范围键是「绝对格子」，干员换位后必须重建（引擎会自己维护，这里只在缺失时兜底）
      if (!u.rangeKeySet && typeof battle.refreshRange === 'function') battle.refreshRange(u);
      const keys = u.rangeKeySet || u.rangeKeys;
      if (keys) for (const k of keys) water.add(k);
    }
  };
  refreshWater();
  battle.every(refresh, refreshWater);
  // 地块覆盖（浅蓝波纹）：每 `PAINT_SEC` 秒重发一次，玩家才看得见「哪里是特殊水地形」
  battle.every(PAINT_SEC, () => { if (water.size) paintWater(battle, water); });

  // ── ① 攻击附带侵蚀损伤：成员造成伤害时，给目标补一次 `erosion` 元素损伤 ──────────────────
  //    与引擎自带的「附带损伤」同形（`sim/content/tokens.js` 里「炎佑」的灼燃损伤就是这样挂的）：
  //    过滤掉元素损伤 / 元素伤害本身，避免自我触发。
  for (const u of members) {
    battle.on('damaged', (ctx) => {
      if (!ctx || ctx.source !== u) return;
      const t = ctx.target;
      if (!t || !t.alive || t.side !== 'enemy') return;
      if (ctx.type === 'element' || ctx.type === 'elemental') return;
      if (!(ctx.amount > 0)) return;
      if (!atLeast(bb.power_bond_char_cnt)) return;
      if (!water.has(tileKey(u))) return; // 干员自己得站在特殊水地形里
      const ratio = num(bb.erosion_ratio, 0) + num(bb.erosion_ratio_per_stack, 0) * layers();
      const amount = num(u.atk, 0) * ratio;
      if (amount > 0) battle.dealDamage(u, t, { type: 'element', element: EL, amount, tags: [BOND] });
    }, { owner: u });
  }

  // ── ② 敌人处于特殊水地形中：移动 / 攻击速度降低（层数越高越强，**至多 bb.water_slow_cap = 80%**）──────────
  //    每 `refresh` 秒重判一次「在不在水里」：在 → 铺 buff，不在 → 摘掉。
  const slowEnemies = () => {
    const on = atLeast(bb.power_bond_char_cnt);
    const pct = slowPct();
    for (const e of battle.enemies) {
      if (!e || !e.alive) continue;
      if (!on || pct <= 0 || !water.has(tileKey(e))) { battle.removeBuff(e, KEY_WATER); continue; }
      battle.addBuff(e, {
        key: KEY_WATER, refresh: 'replace', persist: true, allowDead: true,
        // 攻速是加算键：把百分比换成「点」（−10% ⇒ −10）；四舍五入到 3 位小数，免得出现 −15.000000000000002
        mods: { moveMul: Math.max(0, 1 - pct), aspd: -Number((pct * 100).toFixed(3)) },
      });
    }
  };
  battle.every(refresh, slowEnemies);

  // ── ③ 侵蚀损伤爆发：额外降防（按爆发次数叠加，与引擎自己的 `erosionDown` −120 并存）──────────
  battle.on('elementBurst', (ctx) => {
    if (!ctx || ctx.element !== EL) return;
    const t = ctx.target;
    if (!t || t.side !== 'enemy') return;
    if (!atLeast(bb.ex_bond_char_cnt)) return;
    const flat = num(bb.burst_def_down, 0) + num(bb.burst_def_down_per_stack, 0) * layers();
    if (!(flat > 0)) return;
    battle.addBuff(t, {
      key: KEY_SUNDER, refresh: 'stack', stacks: 1, maxStacks: 1e6, visible: true, persist: true, allowDead: true,
      mods: { defFlat: -flat },
    });
  });

  // ── ④ 损伤爆发期间：每 `pulse` 秒一次元素伤害（基准 = 场上攻击力最高的【多索雷斯】干员）──────
  const strongest = () => {
    let best = null;
    for (const u of alive()) if (!best || num(u.atk, 0) > num(best.atk, 0)) best = u;
    return best;
  };
  battle.every(pulse, () => {
    if (!atLeast(bb.ex_bond_char_cnt)) return;
    const src = strongest();
    if (!src) return;
    const ratio = num(bb.burst_hit_ratio, 0) + num(bb.burst_hit_ratio_per_stack, 0) * layers();
    const amount = num(src.atk, 0) * ratio;
    if (!(amount > 0)) return;
    for (const e of battle.enemies) {
      if (!e || !e.alive || !e.deployed) continue;
      if (!bursting(e)) continue;
      battle.dealDamage(src, e, { amount, type: 'elemental', element: EL, canDodge: false, sourceless: true, tags: [BOND] });
    }
  });
}

registerBondInstaller(BOND, installDossoles);

// =====================================================================================================================
// 装备（战斗侧）：翡翠庭院至臻

/**
 * 翡翠庭院至臻（`chess_item_ws_dos_jade`，T6）：「获得等于【多索雷斯】盟约层数 × atk_per_layer 的**基础攻击力**」。
 *
 * 注册键是 buff 的 **`bbStr.key`**（`mod_dos_jade`），不是 item key —— `installItem` 先过 `hasBattleEffect(rec)`，
 * 而它只认 STAT_BUFFS / BY_BUFF / EXTRA_BUFFS 里的 buff 键；用 item key 注册会落进 EXTRA_ITEMS，而
 * `hasBattleEffect` 为 false 时 `installItem` 直接返回，这段行为永远不会执行（哥伦比亚「同行者」的注释里记着同一个坑）。
 *
 * 用的是 `atkFlat` 而不是 `atkPct`：文本说的是**基础攻击力**，而引擎的公式是
 * `atk = (base.atk + ΣatkFlat) × (1 + ΣatkPct) …`（`sim/units.js _recalc`）——`atkFlat` 正好加在百分比之前。
 * 层数变化时用 `onLayers` 重算（与哥伦比亚「源石辅助仪」同一条写法）。
 */
registerItemBehaviour('mod_dos_jade', (battle, u, p, scope) => {
  if (!u || !isOp(u)) return;
  const per = num(p && p.atk_per_layer, 0);
  if (!(per > 0)) return;
  const apply = () => {
    const layers = bondLayers(battle, u.ownerId, BOND);
    const flat = layers * per;
    if (flat > 0) scope.stat('atk', { atkFlat: flat });
    else battle.removeBuff(u, scope.key('atk'));
  };
  apply();
  onLayers(battle, u.ownerId, BOND, apply);
});

// =====================================================================================================================
// 干员特质（战斗侧 IN_BATTLE）

/** 「使已激活的【X】【Y】层数 +N」：给列表里的每一条盟约加层（`requireActive` = 「已激活」）。 */
function gainBondLayers(battle, u, bonds, n, reason = 'garrison') {
  let total = 0;
  for (const b of bonds) {
    if (typeof b !== 'string' || !b) continue;
    total += gainLayers(battle, { playerId: u.ownerId, bonds: b, n, requireActive: true, source: u, reason });
  }
  return total;
}

/** garrison 黑板里的盟约列表（`bond_1` / `bond_2`），跳过空值。 */
const bondsOf = (bb) => [bb && bb.bond_1, bb && bb.bond_2].filter((b) => typeof b === 'string' && b);

/** 绝对格键 → 面朝 RIGHT 的相对偏移（`server/sim/dir.js toLocal` 的等价实现；本包不新增 import 面）。 */
function toLocal(ar, ac, d) {
  const D = typeof d === 'string' ? d.toUpperCase() : 'RIGHT';
  if (D === 'UP') return [0 - ac, ar];
  if (D === 'LEFT') return [0 - ar, 0 - ac];
  if (D === 'DOWN') return [ac, 0 - ar];
  return [ar, ac];
}

/**
 * 假日威龙陈：「自身攻击范围扩大至**特殊水地形**（= 本盟约算出来的那份并集）；<战斗中>每消耗4发弹药，使已激活的
 * 【多索雷斯】【精准】层数+2」。
 *
 * * **攻击范围＝特殊水地形**：把并集的绝对格键交给 `battle.setExtraRange(u, keys)`（引擎的公开口子，
 *   `sim/battle/queries.js`）—— 它并进 `rangeKeys`/`rangeKeySet`，于是**普通攻击**的选目标（`ai.js`
 *   `enemiesInKeys(u.rangeKeys, …)`）就能打到任何站在水地形上的敌人。并集每 `water_refresh` 秒重算一次
 *   （盟约 installer 原地维护同一个 Set），这里按 `FOLLOW_SEC` 跟着重下一次；水地形空（盟约没激活 / 成员全下场）
 *   就把延伸清掉。
 *   ⚠ **不许把整张战场塞给她**：并集 = 所有在场成员攻击范围的并集，而她自己也是成员 —— 全场会自我闭环成整块战场
 *   （前一版就是这样，导致全图算水地形、她也打到全图）。并集只在她站在水里时才有自己那几格，所以是**有界**的：
 *   `water ⊆ ∪(所有成员的攻击范围)`，第二次重算与第一次相同。
 * * **技能在敌人处于特殊水地形时就会释放**：技能的 DEFAULT 触发判据读 `baseRangeKeys`（本体网格 + 永久 rangeExtend，
 *   **不含** `extraRangeKeys`，`sim/skills.js _defaultCondition`），所以只放宽攻击范围还不够 —— 再挂一条**内容触发
 *   范围**（`skill.addTriggerRange` → `_extraTriggerSatisfied`）：敌人站在任何水地形格子上即满足触发条件，不必走进
 *   她本体的 2-5 攻击范围。`u.skill` 是每次装配单位时新建的 `SkillRuntime`，所以按运行时登记（WeakSet 去重）。
 * * **详情卡的攻击范围**：`_refreshRange` 有意让 `liveRangeGrid` 不含 `extraRangeKeys`（卡片画本体网格），延伸后
 *   再把实际范围按当前朝向反算回相对网格写回去，卡片上才看得见（与哥伦比亚「丰川祥子」同一条写法，纯展示）。
 * * **每消耗 N 发弹药**：`ammoUsed` 每次消耗一发都会派发（`{ unit, left, skill }`），累计到 N 的整数倍就加一层。
 */
registerGarrisonInstaller('DOS_CHEN2_WATER_RANGE', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!isOp(u)) continue;
    /** 这一份并集（盟约 installer 原地维护）；空集合 ⇒ 她只剩本体范围。 */
    const water = () => waterTiles(battle, u.ownerId);
    // ---- 攻击范围 = 特殊水地形 -------------------------------------------------------------------------------------
    const widen = () => {
      if (!u.alive || !u.deployed) return;
      const set = water();
      battle.setExtraRange(u, set.size ? [...set] : []);
      // 卡片（`liveRangeGrid`）也画成实际范围：把当前 `rangeKeys` 按朝向反算回相对网格写回去（纯展示，不改结算）
      if (!Array.isArray(u.rangeKeys) || !u.rangeKeys.length) return;
      const seen = new Set();
      const grid = [];
      for (const k of u.rangeKeys) {
        const r = Math.floor(k / COLS), c = k % COLS;
        const [dr, dc] = toLocal(r - u.tileR, c - u.tileC, u.dir);
        const id = `${dr},${dc}`;
        if (seen.has(id)) continue;
        seen.add(id);
        grid.push([dr, dc]);
      }
      if (grid.length) u.liveRangeGrid = grid;
    };
    battle.on('deploy', (c) => { if (c.unit === u) widen(); }, { owner: u });
    battle.every(FOLLOW_SEC, widen);
    widen();
    // ---- 技能触发范围 = 特殊水地形 ---------------------------------------------------------------------------------
    const armed = new WeakSet();
    const arm = () => {
      const sk = u.skill;
      if (!sk || armed.has(sk) || typeof sk.addTriggerRange !== 'function') return;
      armed.add(sk);
      sk.addTriggerRange(() => {
        const set = water();
        return set.size ? [{ keys: [...set], profile: u.profile }] : [];
      });
    };
    arm();
    battle.on('deploy', () => arm(), { owner: u });
    battle.every(FOLLOW_SEC, arm);
    // ---- 每消耗 N 发弹药 → 盟约层数 ---------------------------------------------------------------------------------
    const per = Math.max(1, num(it.bb.consume_count, 4));
    const layers = Math.max(1, num(it.bb.layer, 2));
    const bonds = bondsOf(it.bb);
    if (!bonds.length) continue;
    let used = 0;
    battle.on('ammoUsed', (c) => {
      if (c.unit !== u) return;
      used += 1;
      if (used % per !== 0) return;
      gainBondLayers(battle, u, bonds, layers);
    }, { owner: u });
  }
});

/**
 * 林：「<战斗中>攻击范围内有干员受到攻击时，其已激活盟约的层数+1（同一名干员最多6次）」。
 *
 * 「同一名干员最多 6 次」按**位干员 × 这一枚林**计数（同一名干员被另一枚林照顾时另有 6 次，与「每名干员单独」的
 * 官方写法一致）。层数加在**被打的那名干员所属玩家**身上（联防场上可能是队友）。
 * 触发过就在这里落一个战斗 → 休整期的标记（`setBattleMark`，值只能是标量），休整期的
 * `DOS_LIN_PREP_FALLBACK` 读同一个键；没触发才走「+12 层」那条兜底。
 */
registerGarrisonInstaller('DOS_LIN_ALLY_HIT', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!isOp(u)) continue;
    const per = Math.max(1, num(it.bb.layer, 1));
    const cap = Math.max(1, num(it.bb.max, 6));
    /** 被打的干员 → 已经加过的次数（这一枚林自己的计数）。 */
    const counts = new Map();
    battle.on('damaged', (c) => {
      const t = c.target;
      if (!t || t === u || t.side !== 'ally' || !isOp(t) || !t.alive) return;
      if (!(c.amount > 0)) return;
      if (!u.alive || !u.deployed) return;
      if (!u.rangeKeySet || !u.rangeKeySet.has(tileKey(t))) return;
      const n = counts.get(t) || 0;
      if (n >= cap) return;
      counts.set(t, n + 1);
      let total = 0;
      for (const b of unitBonds(t)) total += gainLayers(battle, { playerId: t.ownerId, bonds: b, n: per, requireActive: true, source: u, reason: 'garrison' });
      if (total > 0) setBattleMark(battle, u.ownerId, 'dosLinFired', true);
    }, { owner: u });
  }
});

/**
 * 羽毛笔：「<战斗中>击倒敌人时，使已激活的【多索雷斯】【不屈】层数+1」。
 *
 * `kill` 的 ctx 是 `{ killer, victim }`（`sim/content/garrisons/battle.js` 的 `_selfkillenemy` 同一条）；
 * 只看敌方目标（`victim.side === 'enemy'`），且击杀者就是这一枚羽毛笔。
 */
registerGarrisonInstaller('DOS_CROW_KILL', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!isOp(u)) continue;
    const per = Math.max(1, num(it.bb.layer, 1));
    const bonds = bondsOf(it.bb);
    if (!bonds.length) continue;
    battle.on('kill', (c) => {
      if (!c || c.killer !== u || !c.victim || c.victim.side !== 'enemy') return;
      gainBondLayers(battle, u, bonds, per);
    }, { owner: u });
  }
});

/**
 * 每场战斗一次（`sim/content/index.js installContent` 在官方内容模块之后调用，逐包 try/catch）。
 * 本包的注册都在模块顶层完成（它们挂在引擎的全局表上，模块只 import 一次），这里不需要每场的逻辑 ——
 * 保留导出是为了与 `pack.json.server.battle` 的模块契约一致（引擎要求这个模块有 `install(battle)`）。
 * @param {any} _battle
 */
export function install(_battle) {}