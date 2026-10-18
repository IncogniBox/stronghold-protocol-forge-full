// workshop/dossoles/battle/main.mjs — 「多索雷斯」故事集盟约的**战斗侧效果**（`pack.json.server.battle`，DESIGN §28.17）。
//
// 这一条盟约的全部效果都在这里，用引擎**通用**的盟约 installer 通道实现（`registerBondInstaller`，`sim/content/bonds/core.js`）：
// 它是**一个 bondId 一个 installer、先到先得**，所以本包给自己这一条盟约注册，不碰别人的槽位。
//
// ── 效果（阈值 2 / 2 人，取自多索雷斯假日活动的「水蚀」）─────────────────────────────────
//   特殊水地形  := **所有【多索雷斯】干员的攻击范围格子的并集**（「攻击范围视为特殊水地形」的直接读法 ——
//                  引擎没有 per-tile 的自定义地形状态，这样读「处于特殊水地形中」才可判定）。
//
//   第 1 档（2 人）：①【多索雷斯】干员处于特殊水地形中时，攻击附带 攻击力×(10% + 0.1%×层数) 的**侵蚀损伤**；
//        ②敌人处于特殊水地形中时，移动速度与攻击速度降低 10% + 0.5%×层数。
//   第 2 档（同为 2 人）：③敌人受到**侵蚀损伤爆发**时，防御力额外降低 50 + 2×层数 点（在引擎自带的 −120 之外，按爆发的次数叠加）；
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
// `ROWS` / `COLS` 是**整张战场画布**的尺寸（19×21）：假日威龙陈「攻击范围扩大至全场」用的就是它。
import { ROWS, COLS } from '@sim/constants.js';

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

/** battle 句柄的 `every` 参数下限保护（0 或负数会变成每帧）。 */
const everySec = (v, fallback) => {
  const n = num(v, fallback);
  return n > 0 ? n : fallback;
};

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
  /** 人数门槛（两档同为 2 人）：`reached` 是引擎自己的判据（人数够，或层数已到对应阈值）。 */
  const atLeast = (cnt) => reached(battle, pid, BOND, num(cnt, 0));
  /** 场上的成员（`members` 是布战时刻的那一份，之后可能被击倒）。 */
  const alive = () => members.filter((u) => u && u.alive && u.deployed);

  // ── 特殊水地形：所有在场成员攻击范围格子的并集（每 `refresh` 秒重算一次：干员会移动、会阵亡）──────
  /** @type {Set<number>} */
  const water = new Set();
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

  // ── ② 敌人处于特殊水地形中：移动 / 攻击速度降低 ─────────────────────────────────────
  //    每 `refresh` 秒重判一次「在不在水里」：在 → 铺 buff，不在 → 摘掉。
  const slowEnemies = () => {
    const on = atLeast(bb.power_bond_char_cnt);
    const pct = num(bb.water_slow, 0) + num(bb.water_slow_per_stack, 0) * layers();
    for (const e of battle.enemies) {
      if (!e || !e.alive) continue;
      if (!on || !water.has(tileKey(e))) { battle.removeBuff(e, KEY_WATER); continue; }
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

/**
 * 假日威龙陈：「自身攻击范围扩大至全场的特殊水地形；<战斗中>每消耗4发弹药，使已激活的【多索雷斯】【精准】层数+2」。
 *
 * * **攻击范围扩大至全场**：把整张战场的绝对格键并进该单位的 `extraRangeKeys`（引擎的公开口子
 *   `battle.setExtraRange`，`sim/battle/queries.js`）—— 它会在每次范围重建时被并进去，所以移动 / 再部署后依然成立，
 *   这里只要在每次 `deploy` 之后重下一次。全场范围同时就是本盟约的「特殊水地形」（盟约 installer 的球地形 = 所有
 *   在场成员攻击范围格子的并集），所以她一个人就让全图算作特殊水地形 —— 这正是文本那句「全场的特殊水地形」。
 * * **每消耗 N 发弹药**：`ammoUsed` 每次消耗一发都会派发（`{ unit, left, skill }`），累计到 N 的整数倍就加一层。
 */
registerGarrisonInstaller('DOS_CHEN2_AMMO_FULLRANGE', (battle, list) => {
  const ALL_TILES = [];
  for (let k = 0; k < ROWS * COLS; k++) ALL_TILES.push(k);
  for (const it of list) {
    const u = it.unit;
    if (!isOp(u)) continue;
    const widen = () => { if (u.alive && u.deployed) battle.setExtraRange(u, ALL_TILES); };
    battle.on('deploy', (c) => { if (c.unit === u) widen(); }, { owner: u });
    widen();
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