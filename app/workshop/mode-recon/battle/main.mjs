// workshop/mode-recon/battle/main.mjs — 重构模拟的**战斗侧载荷**（`pack.json.server.battle`，DESIGN §28.17）。
// (i18n-ignore-file: 本模块的说明文字是给作者/引擎读的契约注释，不是客户端界面文案)
//
// 预重构交上来的两项选择里有四条是**战场上的数**（另外两条在 `meta/main.mjs`：盟约重构的 +10 层与装备重构的补装备）：
//   数据重构（协助）  场上干员的基础攻击力 / 基础防御力 / 基础生命上限 +25%、法术抗性 +25
//   数据负载          敌人的同四项 +25% / +25 点
//   盟约负载          三类中最高层盟约**每层**使敌人的生命上限 +0.1%
//   装备负载          未携带装备的干员伤害 -25%；装备阶级高于携带者的那件装备**效果 -50%**
//
// 选择怎么到这里：`PlayerState.battleInput()` 把 `battle !== false` 的效果按 `playerEffects` 交给每一份 BattleSpec，
// 本模块的 `install(battle)` 从每个玩家的 `playerEffects` 里认 `key === 'effect:recon_protocol'` 那一条、读它的 `params`
// （物化那一份在 `meta/main.mjs` 的 `publishChoice`；两处必须是同一个字符串）。
//
// 两条实现口径（写清楚，免得以后被当成 bug）：
//   * **同名规则取最高、不叠加**：联防的一张战场上可能有两名博士选了同一条负载，两条各按**最强的**那一份生效
//     （同一件装备的两份效果叠在一批敌人身上没有意义）。
//   * **「装备效果 -50%」只算属性那一半**：装备的属性贡献由引擎的 `itemStatMods` 给出，这里挂一条**补偿 buff**
//     把要减掉的半个减回去（加法项 -0.5v；乘法项 `redeployMul` 用 (v+1)/(2v)，见 `halfNegated`）。装备的
//     **触发类**效果（hook / 骑手伤害 / 不死窗口一类）没法这样缩 —— 引擎没有「缩放某一件装备效果」的通道，
//     所以那部分照旧全额生效。

import * as S from '@battle/mod.js';

/** 与 `meta/main.mjs` 的 `EFFECT_KEY` 必须是同一个字符串（meta 写、这里读）。 */
const EFFECT_KEY = 'effect:recon_protocol';

const ASSIST_DATA = 'recon_assist_data';
const LOAD_DATA = 'recon_load_data';
const LOAD_BOND = 'recon_load_bond';
const LOAD_EQUIP = 'recon_load_equip';

/** 数值（业主给定，逐字照抄）。 */
const DATA_PCT = 0.25;
const DATA_RES = 25;
const BOND_LOAD_PER_LAYER = 0.001;
const BARE_DAMAGE_MUL = 0.75;
const KINDS = Object.freeze(['core', 'addon', 'story']);
const SIDE_STORY = 'SIDE_STORY';

/** 一个玩家的选择（`playerEffects` 里那一条；没有 = 这一局没交过 / 不是这个模式）。 */
function planOf(battle, playerId) {
  const p = S.player(battle, playerId);
  const refs = p && Array.isArray(p.playerEffects) ? p.playerEffects : null;
  if (!refs) return null;
  for (const ref of refs) {
    if (ref && ref.key === EFFECT_KEY && ref.params && typeof ref.params === 'object') return ref.params;
  }
  return null;
}

/** 三类里各取「已激活且层数最高」的那一条的层数（与 `meta/main.mjs` 的 `topLayersByKind` 同一条口径）。 */
function topLayersByKind(battle, playerId) {
  const out = { core: 0, addon: 0, story: 0 };
  for (const bondId of S.activeBondIds(battle, playerId)) {
    const kind = kindOf(S.bondRecord(bondId));
    const layers = S.bondLayers(battle, playerId, bondId);
    if (!kind || layers <= out[kind]) continue;
    out[kind] = layers;
  }
  return out;
}

function kindOf(rec) {
  if (!rec) return null;
  if (rec.isCore === true) return 'core';
  return rec.bondType === SIDE_STORY ? 'story' : 'addon';
}

/** 把「效果减半」翻译成一条补偿 buff：加法项减掉一半，乘法项（`*Mul`）用它该去的那个比例。 */
function halfNegated(mods) {
  const out = {};
  for (const [k, v] of Object.entries(mods || {})) {
    if (!Number.isFinite(v) || v === 0) continue;
    if (k.endsWith('Mul')) out[k] = v > 0 ? (v + 1) / (2 * v) : 1; // 1+x 那一半：想落到 1+x/2
    else out[k] = -0.5 * v;
  }
  return Object.keys(out).length ? out : null;
}

/** 敌方那一条 buff（数据负载 + 盟约负载合并成一条 hpPct，省一次挂 buff）。 */
function enemyModsOf(battle, plans) {
  let pct = 0;
  let res = 0;
  let hp = 0;
  for (const [playerId, plan] of plans) {
    if (plan.load === LOAD_DATA) { pct = Math.max(pct, DATA_PCT); res = Math.max(res, DATA_RES); }
    if (plan.load === LOAD_BOND) {
      const top = topLayersByKind(battle, playerId);
      hp = Math.max(hp, (top.core + top.addon + top.story) * BOND_LOAD_PER_LAYER);
    }
  }
  if (!pct && !hp) return null;
  const mods = {};
  if (pct) { mods.atkPct = pct; mods.defPct = pct; }
  if (res) mods.resFlat = res;
  const hpPct = pct + hp;
  if (hpPct) mods.hpPct = hpPct;
  return Object.keys(mods).length ? mods : null;
}

/** 我方的两条（数据重构 + 装备负载），一个单位部署时算一次（`passiveBuff` 同键替换，重复部署不会叠加）。 */
function applyAlly(battle, unit, plan) {
  if (!plan || !S.isOp(unit)) return;
  if (plan.assist === ASSIST_DATA) {
    S.passiveBuff(battle, unit, 'recon:assist_data', S.directMods({ atk: DATA_PCT, def: DATA_PCT, hp: DATA_PCT }, { resFlat: DATA_RES }));
  }
  if (plan.load === LOAD_EQUIP) {
    if (!S.itemsOf(unit).length) S.passiveBuff(battle, unit, 'recon:load_bare', { dmgDealtMul: BARE_DAMAGE_MUL });
    const tier = S.tierOf(unit);
    for (const itemId of S.itemsOf(unit)) {
      const rec = S.itemRecord(itemId);
      if (!rec || rec.itemType !== 'EQUIP' || !(Number(rec.tier) > tier)) continue;
      const half = halfNegated(S.itemStatMods(rec));
      if (half) S.passiveBuff(battle, unit, `recon:load_half:${itemId}`, half);
    }
  }
}

/** 每个战场建起来时跑一次（`sim/content/index.js installContent` 在官方内容模块之后调用）。 */
export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  installReconBosses(battle);
  const plans = new Map();
  for (const p of battle.players) {
    const playerId = p && p.playerId;
    if (!playerId) continue;
    const plan = planOf(battle, playerId);
    if (plan && (plan.assist || plan.load)) plans.set(playerId, plan);
  }
  if (!plans.size) return;
  const enemyMods = enemyModsOf(battle, plans);
  if (enemyMods) {
    const apply = (enemy) => { if (enemy && enemy.side !== 'ally') S.passiveBuff(battle, enemy, 'recon:load', enemyMods); };
    battle.on('enemySpawn', (ctx) => apply(ctx && ctx.enemy));
    for (const e of battle.enemyUnits || []) apply(e);
  }
  battle.on('deploy', (ctx) => {
    const unit = ctx && ctx.unit;
    if (unit && unit.side === 'ally') applyAlly(battle, unit, plans.get(unit.ownerId));
  });
  // 建场时已经站在场上的（今天的部署是逐波来的，install 时通常一个都没有 —— 这一趟是防御性的）
  for (const u of battle.allyUnits || []) if (u && u.deployed) applyAlly(battle, u, plans.get(u.ownerId));
}

/** 供测试与诊断：本模块认的四条规则与它们的数值（一条真相）。 */
export const RECON_BATTLE_RULES = Object.freeze({
  EFFECT_KEY, ASSIST_DATA, LOAD_DATA, LOAD_BOND, LOAD_EQUIP, DATA_PCT, DATA_RES, BOND_LOAD_PER_LAYER, BARE_DAMAGE_MUL, KINDS,
});

// ---------------------------------------------------------------------------------------------------------------
// ·重构 首领（11 个：第 4 回合 5 个 + 第 8 回合 6 个）—— 数据在 `workshop/mode-recon/enemies.json`
//
// 十一个「·重构」都是官方首领的**变体**：`enemies.json` 里那条记录逐字照抄官方记录（第 8 回合的 大亚当 取自官方
// enemy_database，因为 data/enemies.json 没有它），只把 `name` 加上「·重构」、`abilities` 追加一行【重构】，并
// （W 与没有引擎 kit 的那几只除外）写上 `effectRef` = 官方 key。引擎取 kit 时读的是
//   `const kit = KITS[e.def.raw?.effectRef ?? e.defId];`   （server/sim/content/enemies.js:176）
// 而 `e.def.raw` 就是那条记录（simdata.js:304 `raw: e`）—— 所以一条带 `effectRef` 的工坊怪物记录**免费继承官方首领
// 的整套 kit**，本包只是往上**叠加**。这是本包零引擎改动做出「·重构」首领的唯一通道。
//
// **哪些是数据、哪些是本包代码**（第 8 回合，逐条写清）：
//   * 大亚当·重构          **纯数据**：记录里把 maxHp ×2、atk ×1.5（`be`/`attrPower` 随之重算）；没有任何引擎 kit
//                          可继承（`enemy_1001_bigbo` 在 STATS_ONLY、`_2` 更不在表里）⇒ **不写 effectRef**，也没有本包代码。
//   * 自在·重构            **纯数据**：`ShieldBurst` / `ShieldBurstReborn` 的 `bb.duration`（破桎而出的蓄力时间）÷2、
//                          `bb.dynamic`（屏障可吸收的伤害数值）×2 —— kitXi 直接读这两个 bb（leaders.js:469-479）。
//   * 杰斯顿·威廉姆斯·重构 **纯数据**：`ironsandstorm.bb.stun` 3→6、`armorpiercing.bb.def_penetrate` 0.6→1.0 ——
//                          kitWarden 读这两个 bb（leaders.js:419/441）。
//   * 梅菲斯特·重构 / 浮士德·重构  见下面「第 8 回合的·重构首领」一节（**本包代码**；官方 1507/1508 没有引擎 kit）。
//   * 锏·重构              数据（`skills[].cooldown` 全部 ÷2，kitMace 读 `cd`）+ 本包代码（攻击 10% 冻结）。
//
// W·重构 是第 4 回合的例外：官方 W 的 kit（content/enemies/leaders.js:126-138）把 C4 的目标数硬编码成
// `n = hpRatio < 0.5 ? 2 : 1`，而「不许改引擎」意味着那一行动不了。于是 W·重构 **不写 effectRef**、C4 整个由本包实现
// （官方 W 的 kit 里只有 C4，所以没有别的东西会丢）；记录里把 C4 的 `cooldown` 减半（`initCooldown` 不动），本包读那个
// 数当自己的计时器。
//
// 本模块只用**战场句柄**（`battle.on/addBuff/applyStatus/dealDamage/spawnEnemy/heal/after/fx/allies/alliesInRadius/time/rng/enemies`）
// —— SDK（`@battle/mod.js`）不导出敌人的 kit 助手（elem/hurt/targetsNear/byPriority 都在 server/sim/content 内部）。
// 钩子优先级：引擎自己的 `enemySpawn` 是 100、`damaged`/`attack`/`tick` 是 50（server/sim/battle/hooks.js:37 高优先级先跑），
// 本模块一律用**默认 0**，于是都在它们**之后**跑，可以覆盖引擎先写下的值（百夫长·重构 的 maxTargets）。
//
// ⚠ 三处**刻意的近似**（写清楚，别当成 bug）：
//   * W 的索敌顺序：引擎按 targeting.js sortAllyTargets「阻挡者 → 仇恨值（嘲讽/最晚部署）→ 最早出现」排序，本包用
//     「阻挡者优先 → 距离最近」近似 —— 少了嘲讽与部署序两个键。
//   * C4 的溅射范围：引擎用 areaAllies（隐匿 / 无法选中 / 起飞 都排除）；本包用 alliesInRadius + 排除飞行/无法选中，
//     **被锁定的那个目标一定吃到**（引擎 targetAndArea 同一条：锁定目标不因之后的选择规则被排除）。
//   * 碎骨·重构 只处理**被阻挡**的那一路：引擎的官方 kit 已经在**未被阻挡**时发射榴弹（splashAttack），本包叠加的
//     是「近战（被阻挡）再多一发」。

const BOSS_SKULSR = 'enemy_ws_recon_skulsr';
const BOSS_LSLIME = 'enemy_ws_recon_lslime';
const BOSS_CQBW = 'enemy_ws_recon_cqbw';
const BOSS_MDROCK = 'enemy_ws_recon_mdrock';
const BOSS_DEMONK = 'enemy_ws_recon_demonk';

// 第 8 回合的三只（机制在包代码里；大亚当 / 自在 / 杰斯顿·威廉姆斯 三只纯数据改动，没有本包的代码）
const BOSS_MEPHI = 'enemy_ws_recon_mephi';
const BOSS_FAUST = 'enemy_ws_recon_faust';
const BOSS_BLKSWB = 'enemy_ws_recon_blkswb';

/** 泥岩巨像（data/enemies.json）：泥岩·重构「首次跌破半血」时召唤的那一只（普通单位，不是 part/boss tag）。 */
const MDGINT_KEY = 'enemy_1092_mdgint';

/** 宿主敌人池（`data/enemies.json` 里名字含「宿主」的那三只：宿主士兵 / 宿主重装士兵 / 狂暴宿主组长）—— 梅菲斯特·重构 召唤的对象。 */
const HOST_KEYS = Object.freeze(['enemy_1043_zomsbr', 'enemy_1061_zomshd', 'enemy_1062_rager_2']);
/** 梅菲斯特·重构 的召唤周期与每周期只数（业主：每 10 秒 3 只）。 */
const MEPHI_INTERVAL = 10;
const MEPHI_PER_TICK = 3;
/** 浮士德·重构 被击倒后，梅菲斯特·重构 一次召唤 10 只（业主原文）。 */
const MEPHI_AVENGE = 10;
/** 浮士德·重构 的额外范围伤害：50% 攻击力、3×3（Chebyshev ≤ 1 的格块，与碎骨榴弹同一口径）。 */
const FAUST_SPLASH_SCALE = 0.5;

// 梅菲斯特 / 浮士德 的**官方 kit**（引擎的 `KITS` 里没有 enemy_1507_mephi / enemy_1508_faust ⇒ 本包按官方数据补）。
/** 梅菲斯特·重构 的官方「普通攻击」治疗目标数：图鉴文本「普通攻击能够同时治疗3名敌方单位」（官方数据没有这个数的 bb）。 */
const MEPHI_HEAL_TARGETS = 3;
/** 治疗光环的续期周期（s）：引擎的 hpRegen 光环都是「短时长 buff + 每 tick 续一次」（kits/ops/chess_char_2_14-flower.js 的 `duration: 0.5`）。 */
const AURA_REFRESH = 1;

/** 锏·重构 攻击冻结的概率（业主：10%）。随机数走战场自己的种子流 `battle.rng`（确定性；绝不用 Math.random）。 */
const BLKSWB_FREEZE_PROB = 0.1;
/** 冻结时长沿用引擎既有值：`COLD_FREEZE_DURATION` = 3 s（server/sim/constants.js:177）[ASSUMED: 冻结时长沿用引擎既有值 3 s，业主未指定]。 */
const FREEZE_DURATION = 3;

/** 碎骨榴弹：PRTS 天赋「相当于攻击力26%的物理伤害…5秒内防御力下降50%」——与引擎 leaders.js:31 同一组数。 */
const GRENADE_SCALE = 0.26;
const GRENADE_DEFDOWN_DUR = 5;
/** 三条「·重构」共用的半血阈值（碎骨/庞贝/W 的官方 kit 都读 0.5）。 */
const HALF_HP = 0.5;

/** W 的 C4 引信与爆炸半径（引擎 leaders.js:49 的 C4_FUSE / C4_RADIUS，[ASSUMED]）。 */
const C4_FUSE = 1;
const C4_RADIUS = 1;

/** 本包在战场便签里的命名空间（引擎 SDK 的 battleStore，每场一份）。 */
const BOSS_STORE = 'recon:bosses';

/**
 * 战场便签：W 的 C4 计时器（每只 W 一条）、泥岩·重构 的「已召唤」标记、梅菲斯特·重构 的召唤倒计时与治疗倒计时（每只一条）、
 * 浮士德·重构 的致命一击状态（每只一条）。
 */
function bossStore(battle) {
  return S.battleStore(battle, BOSS_STORE, () => ({
    c4: new Map(), summoned: new WeakSet(), mephi: new Map(), mephiHeal: new Map(), faust: new Map(),
    reid: new Map(), talula: new Map(), frstar: new Map(), patrt: new Map(), mirbst: new Map(),
    mandra: new Map(), bld: new Map(), morphis: new Map(), dirctr: new Map(), wang: new Map(),
  }));
}

/** 敌人能否行动：与引擎 helpers.js canCast 同口径（活着、在场、不晕、不因沉默封技能、不在失衡里）。 */
function canAct(battle, e) {
  return !!(e && e.alive && !e.hidden && !e.s.flags.stun && !e.s.flags.silence && !(battle.time < e.unbalanceUntil - 1e-9));
}

/** 梅菲斯特·重构 的治疗光环 buff key；浮士德·重构 的登场无敌与「无法被阻挡」buff key（每单位一条，同键 replace）。 */
const MEPHI_AURA_KEY = 'recon:mephi_aura';
const FAUST_INV_KEY = 'recon:faust_inv';
const FAUST_BLOCKFREE_KEY = 'recon:faust_blockfree';

/** 场上活着的、`defId` 匹配的敌人。 */
function liveEnemies(battle, defId) {
  return (battle.enemies || []).filter((x) => x && x.alive && x.defId === defId);
}

/** `e.def.raw.talents.bb[key]` 的一个数（缺省 / 非数时给 fallback）。 */
function talentOf(e, key, fallback) {
  const bb = e && e.def && e.def.raw && e.def.raw.talents ? e.def.raw.talents.bb : null;
  const v = bb ? bb[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** `e.def.raw.skills` 里 prefabKey 匹配的那一条（W·重构 的 C4）。 */
function skillOf(e, prefabKey) {
  const list = e && e.def && e.def.raw ? e.def.raw.skills : null;
  return Array.isArray(list) ? (list.find((s) => s && s.prefabKey === prefabKey) ?? null) : null;
}

/** 「周围八格」的格块取我方（Chebyshev ≤ n）—— 与引擎 helpers.js alliesInTiles 同一条口径。 */
function alliesInBox(battle, r, c, n) {
  const out = [];
  const rr = Math.round(r), cc = Math.round(c);
  for (const a of battle.allies()) {
    if (a.hidden) continue;
    if (Math.max(Math.abs(Math.round(a.tileR) - rr), Math.abs(Math.round(a.tileC) - cc)) <= n) out.push(a);
  }
  return out;
}

/**
 * 1. 碎骨·重构：**被阻挡**的普通攻击额外发射一枚榴弹（官方 kit 只在「未被阻挡」时发射，那一路已经归引擎）。
 * 落点是「目标 + 其 3×3 格块」内的每一个我方单位；每人都吃 ATK×0.26 物理，并挂 5 s 防御力下降。
 * 「defdown.def」在数据里是 −0.5，而引擎的 `applyStatus('defDown', { value })` 收的是**正数减益量**
 * （buffs.js:115 `defDown: { mods: (v) => ({ defMul: 1 - clamp01(v) }) }`），所以这里取反 —— 与引擎 leaders.js:118
 * 的 `dd = -(T(ab, 'defdown.def') ?? 0)` 一字不差。
 */
function installSkulsr(battle) {
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_SKULSR || c.isSkill || !a.blockedBy) return;
    const t = c.targets && c.targets[0];
    if (!t || !t.alive) return;
    const dd = -(talentOf(a, 'defdown.def', -0.5));
    battle.fx('grenade', { x: t.x, y: t.y, r: 1.5, kind: 'grenade' });
    for (const u of alliesInBox(battle, t.tileR, t.tileC, 1)) {
      battle.dealDamage(a, u, { amount: a.s.atk * GRENADE_SCALE, type: 'phys', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'splash'] });
      if (u.alive && dd) battle.applyStatus(u, 'defDown', { duration: GRENADE_DEFDOWN_DUR, source: a, value: dd });
    }
  });
}

/**
 * 2. 庞贝·重构：每次普通攻击对**每一个**被打到的目标追加一次「灼燃」（element burn）——伤害 100% 攻击力。
 * `burn` = 灼燃（server/sim/constants.js ELEMENTS）；`ignoreSelect` 让这次伤害无视目标可选性（与引擎 elem() 同口径）。
 * 官方 kit 原有的灼烧 DoT（ab:burnDot）不受影响 —— 这一条是**额外**的。
 */
function installLslime(battle) {
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_LSLIME || c.isSkill) return;
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      battle.dealDamage(a, t, { type: 'element', element: 'burn', amount: a.s.atk * 1.0, canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    }
  });
}

/** W·重构 的可选目标：范围内**非飞行、非无法选中**的我方，阻挡者优先、其后最近（见文件头的近似说明）。 */
function c4Targets(battle, e, r) {
  const bl = e.blockedBy;
  const d2 = (a) => (a.x - e.x) ** 2 + (a.y - e.y) ** 2;
  return battle.alliesInRadius(e.x, e.y, r)
    .filter((a) => !a.isFlying && !a.s.flags.untargetable)
    .sort((a, b) => (a === bl ? 0 : 1) - (b === bl ? 0 : 1) || d2(a) - d2(b));
}

/** 落一枚 C4：先 telegraph（引信 1 s），到点爆炸、对**锁定目标 + 其半径 1 内的我方**造成 ATK×scale 物理伤害。 */
function plantC4(battle, e, t, scale) {
  const x = t.x, y = t.y;
  battle.fx('telegraph', { x, y, r: C4_RADIUS, dur: C4_FUSE, kind: 'c4' });
  battle.after(C4_FUSE, () => {
    battle.fx('explode', { x, y, r: C4_RADIUS, kind: 'c4' });
    for (const u of battle.alliesInRadius(x, y, C4_RADIUS)) {
      // 锁定目标一定吃到（引擎 targetAndArea 的同一条）；其余才是范围选择
      if (u !== t && (u.hidden || u.isFlying || u.s.flags.untargetable)) continue;
      battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
    }
  });
}

/**
 * 3. W·重构：本包自有的 C4。计时器（每只 W 一条）在 `enemySpawn` 时以记录的 `initCooldown` 起算，`tick` 里递减，
 * 能行动且场上有可选目标时开火、重置为记录的 `cooldown`（记录里**已经**减半）。目标数 = 官方的
 * `hpRatio < 0.5 ? 2 : 1` 再 +1（重构的「额外选择1名干员」）。
 */
function installCqbw(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_CQBW) return;
    const sk = skillOf(e, 'C4');
    const icd = sk && Number.isFinite(sk.initCooldown) && sk.initCooldown > 0 ? sk.initCooldown : (sk && sk.cooldown) || 0;
    bossStore(battle).c4.set(e, { left: icd });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.c4.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.c4) {
      if (!e.alive) { st.c4.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      s.left -= dt;
      if (s.left > 1e-9) continue;
      const sk = skillOf(e, 'C4');
      const scale = sk && sk.bb && Number.isFinite(sk.bb.atk_scale) ? sk.bb.atk_scale : 1;
      const range = sk && sk.bb && Number.isFinite(sk.bb.range_radius) ? sk.bb.range_radius : e.base.rangeRadius;
      const cands = c4Targets(battle, e, range);
      if (!cands.length) continue;
      const n = (e.hpRatio < HALF_HP ? 2 : 1) + 1;
      for (const t of cands.slice(0, n)) plantC4(battle, e, t, scale);
      s.left = sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0 ? sk.cooldown : 20;
    }
  });
}

/** 4. 泥岩·重构：生命值**首次**跌破 50% 时召唤一只泥岩巨像（每只只召唤一次；WeakSet 记「已召唤」）。 */
function installMdrock(battle) {
  battle.on('damaged', (c) => {
    const t = c && c.target;
    if (!t || t.defId !== BOSS_MDROCK || !(t.hpRatio < HALF_HP)) return;
    const st = bossStore(battle);
    if (st.summoned.has(t)) return;
    st.summoned.add(t);
    battle.spawnEnemy(MDGINT_KEY, { pos: [t.y, t.x], ownerPlayerId: t.ownerId ?? null, sourcePlayerId: t.sourcePlayerId ?? null });
    battle.fx('summon', { x: t.x, y: t.y, id: t.id, key: MDGINT_KEY, n: 1 });
  });
}

/**
 * 5. 萨卡兹百夫长·重构：
 *   (a) 可同时攻击的目标数 +1 —— 官方 kit 写 2（special.js:360 `maxTargets(2)`），本模块在它之后把 profile 改成 3；
 *   (b) 造成伤害时回复伤害 50% 的生命值 —— 走引擎 heal 管线（damage.js:643；self 治疗不受 noHeal 影响、会发 heal 事件），
 *       比直接改 hp 更贴引擎语义，并同样发一个 heal fx。
 */
function installDemonk(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (e && e.defId === BOSS_DEMONK) e.profile.maxTargets = 3;
  });
  battle.on('damaged', (c) => {
    const s = c && c.source, t = c && c.target, dmg = c && c.dmg;
    if (!s || s.defId !== BOSS_DEMONK || !t || t.side !== 'ally' || !(dmg && dmg.isAttack)) return;
    const amount = c.amount;
    if (!(amount > 0)) return;
    const healed = battle.heal(s, s, amount * 0.5, { self: true });
    if (healed > 0) {
      s.markDirty();
      battle.fx('heal', { x: s.x, y: s.y, id: s.id });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 第 8 回合的·重构首领（梅菲斯特 / 浮士德 / 锏）—— 数据在 `workshop/mode-recon/enemies.json`
//
// 三只里有两只是**伙伴**：第 8 回合第 3 项一次刷「梅菲斯特·重构 + 浮士德·重构」，它们的机制互相点名
// （浮士德被击倒 ⇒ 梅菲斯特召唤 10 只宿主；梅菲斯特被击倒 ⇒ 浮士德攻击间隔 −50%），所以两边的 hooks 都按
// `death` 事件找**活着的伙伴**——伙伴不在场（或没被选）时那一条什么也不做。
//
// 宿主池是 data/enemies.json 里名字含「宿主」的三只（宿主士兵 / 宿主重装士兵 / 狂暴宿主组长）；随机抽签走战场
// 自己的种子流 `battle.rng`（引擎 content 模块用的同一口流），所以服务端与浏览器两端同一局抽到同一批。

/** 把 `n` 只在宿主池里用战场 rng 随机抽到的普通敌人放到 `e` 的脚下（与泥岩·重构 的 summon 同一条通道），每只一条 summon fx。 */
function summonHosts(battle, e, n) {
  for (let i = 0; i < n; i++) {
    const key = battle.rng.pick(HOST_KEYS);
    battle.spawnEnemy(key, { pos: [e.y, e.x], ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
    battle.fx('summon', { x: e.x, y: e.y, id: e.id, key, n: 1 });
  }
}

/**
 * 6. 梅菲斯特·重构：**官方 kit（引擎没有 enemy_1507_mephi 的 kit ⇒ 本包按官方数据补）** + 业主给的两条·重构机制。
 *
 * 官方 kit（每一项标出数据来源；`e` 的 `bat` / `atk` / `talents.bb` 直接读记录）：
 *   (a) **治疗光环**：图鉴「全场的敌方单位的自然生命回复速度加倍」。给每个敌方单位续一条 `hpRegen` = **它自己的**
 *       `base.hpRecoveryPerSec` 的短命 buff，于是自然回复 ×2（宿主士兵 80→160、宿主重装士兵 200→400；本来为 0 的仍是 0）。
 *       数据里这条天赋的那一格是 `talents.bb['healaura.hp_recovery_per_sec'] = 1`；[ASSUMED] 它读作「额外一份自然回复速度」
 *       （即 ×2），与图鉴文本「加倍」一致 —— 官方没有别的 bb 能给出这条效果。buff 时长只有 AURA_REFRESH(1 s)、每 tick 续一次，
 *       所以梅菲斯特 倒下后光环在 1 s 内自行消退（引擎的 hpRegen 光环都是这条做法，省掉一条 removeBuff 通道）。
 *   (b) **普通攻击 = 治疗**：图鉴「普通攻击能够同时治疗3名敌方单位」。记录里 `applyWay: NONE` / `dmgType: 'none'`，引擎不给他
 *       派攻击，所以本包按 `bat`(6 s) 自己计时：每 6 s 治疗**生命比例最低**的至多 3 名敌方单位，每人 `atk`(500) 点，
 *       走引擎的 heal 管线（`source` = 他自己；他自己也是候选）。[ASSUMED] 目标 = 最需要治疗的 3 名（按 hpRatio 升序）——
 *       官方数据里没有选目标的 bb。
 *
 * ·重构 机制（业主给定）：
 *   (c) 每 10 s 召唤 3 只随机宿主 —— 每只一条自己的倒计时（战场便签），到点重置；活着才走表。
 *   (d) 浮士德·重构 被击倒后，场上每只活着的梅菲斯特·重构 一次召唤 10 只。
 */
function installMephi(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MEPHI) return;
    const st = bossStore(battle);
    st.mephi.set(e, MEPHI_INTERVAL);
    st.mephiHeal.set(e, e.s.bat);
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    // (a) 治疗光环：场上有活着的梅菲斯特·重构 时，给每个自然回复 > 0 的敌方单位续一条 hpRegen buff
    const src = (battle.enemies || []).find((x) => x.alive && x.defId === BOSS_MEPHI);
    if (src) {
      for (const o of battle.enemies) {
        if (!o.alive) continue;
        const rate = o.base && o.base.hpRecoveryPerSec;
        if (!(rate > 0)) continue;
        battle.addBuff(o, { key: MEPHI_AURA_KEY, duration: AURA_REFRESH, refresh: 'extend', source: src, mods: { hpRegen: rate } });
      }
    }
    // (b) 治疗：每 bat 秒一次，治疗最缺血的至多 3 名敌方单位
    for (const [e, left] of st.mephiHeal) {
      if (!e.alive) { st.mephiHeal.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      const next = left - dt;
      if (next > 1e-9) { st.mephiHeal.set(e, next); continue; }
      st.mephiHeal.set(e, e.s.bat);
      const wounded = battle.enemies.filter((o) => o.alive && o.hp < o.s.maxHp)
        .sort((a, b) => a.hpRatio - b.hpRatio).slice(0, MEPHI_HEAL_TARGETS);
      for (const o of wounded) {
        const healed = battle.heal(e, o, e.s.atk);
        if (healed > 0) { o.markDirty(); battle.fx('heal', { x: o.x, y: o.y, id: o.id }); }
      }
    }
    // (c) 每 10 s 召唤 3 只随机宿主
    for (const [e, left] of st.mephi) {
      if (!e.alive) { st.mephi.delete(e); continue; }
      const next = left - dt;
      if (next > 1e-9) { st.mephi.set(e, next); continue; }
      st.mephi.set(e, MEPHI_INTERVAL);
      summonHosts(battle, e, MEPHI_PER_TICK);
    }
  });
  battle.on('death', (c) => {
    const u = c && c.unit;
    if (!u || u.defId !== BOSS_FAUST) return;
    for (const e of liveEnemies(battle, BOSS_MEPHI)) summonHosts(battle, e, MEPHI_AVENGE);
  });
}

/**
 * 7. 浮士德·重构：**官方 kit（引擎没有 enemy_1508_faust 的 kit ⇒ 本包按官方数据补）** + 业主给的两条·重构机制。
 *
 * 官方 kit（数据来源都写在条目上）：
 *   (a) 「**无法被阻挡且登场时一段时间内无敌**」（图鉴）：登场时按天赋 `talents.bb['invincible.duration']`（150 s）挂一条
 *       `flags.invulnerable` 的 buff（与引擎 reborn 的无敌窗口同一个旗标，archetypes.js:361），并挂一条常驻的
 *       `flags.unblockable` —— `blocking.js:29` 的 `_checkBlock` 读的就是这个旗标（PRTS 异常效果 BLOCK_FREE「无法阻挡」）。
 *   (b) 「**会释放能使攻击力加倍的特殊弩箭**」= 记录里的技能 `CriticalHit`（`bb.atk_scale: 2`）：每只自己一条倒计时，
 *       按记录的 `initCooldown`(17 s) 起算、开火后按 `cooldown`(8.5 s，·重构 已减半) 重置；到点时**下一次普通攻击**
 *       额外造成 `atk × (atk_scale − 1) = atk × 1` 点物理伤害（普通攻击本身已经给了 1×，这一击合计 2×），并发一个 `crit` fx。
 *   (c) 「**每隔一段时间会召唤战场中隐藏的弩炮台**」= 记录里的技能 `SummonBallis`（`bbStr.branch_id: 'faust_ballis'`）：
 *       **本安装的数据里没有弩炮台**（`data/*.json` 与官方 `enemy_database` / `enemy_handbook_table` 里都查无 ballis，
 *       它是 5-10 关卡的分支装置而不是敌人），所以这一条**没有实现** —— 记录照旧带着那条技能（忠实的数据），
 *       但场上不会出现弩炮台。见 README「已知口径」。
 *
 * ·重构 机制（业主给定）：
 *   (d) 普通攻击**命中时**额外造成一次 50% 攻击力的 3×3 范围物理伤害（被打中的目标 + 其 3×3 格块内的每个我方单位；
 *       与碎骨·重构 的榴弹同一套 `alliesInBox` 判定，被锁定的目标一定吃到）。
 *   (e) 梅菲斯特·重构 被击倒后，场上每只活着的浮士德·重构 挂一条 `batPct −0.5` 的持久 buff（攻击间隔 ×0.5）。
 */
function installFaust(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_FAUST) return;
    // (a) 登场无敌 + 无法被阻挡
    const inv = talentOf(e, 'invincible.duration', 0);
    if (inv > 0) battle.addBuff(e, { key: FAUST_INV_KEY, duration: inv, visible: true, flags: { invulnerable: true } });
    battle.addBuff(e, { key: FAUST_BLOCKFREE_KEY, persist: true, visible: true, flags: { unblockable: true } });
    // (b) 致命一击的计时器：按记录的 initCooldown 起算
    const sk = skillOf(e, 'CriticalHit');
    const icd = sk && Number.isFinite(sk.initCooldown) && sk.initCooldown > 0 ? sk.initCooldown : (sk && sk.cooldown) || 0;
    bossStore(battle).faust.set(e, { left: icd, ready: false });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.faust.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.faust) {
      if (!e.alive) { st.faust.delete(e); continue; }
      if (s.ready || !canAct(battle, e)) continue;
      s.left -= dt;
      if (s.left <= 1e-9) { s.left = 0; s.ready = true; }
    }
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_FAUST || c.isSkill) return;
    // (b) 致命一击：这一击额外补上 (atk_scale − 1) × ATK
    const s = bossStore(battle).faust.get(a);
    if (s && s.ready) {
      const sk = skillOf(a, 'CriticalHit');
      const scale = sk && sk.bb && Number.isFinite(sk.bb.atk_scale) ? sk.bb.atk_scale : 1;
      const extra = a.s.atk * Math.max(0, scale - 1);
      if (extra > 0) {
        for (const t of c.targets || []) {
          if (!t || !t.alive) continue;
          battle.dealDamage(a, t, { amount: extra, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
        }
        battle.fx('crit', { x: a.x, y: a.y, id: a.id });
      }
      s.ready = false;
      s.left = sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0 ? sk.cooldown : 0;
    }
    // (d) 命中时额外一次 50% 攻击力的 3×3 范围物理伤害
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      battle.fx('grenade', { x: t.x, y: t.y, r: 1.5, kind: 'grenade' });
      for (const u of alliesInBox(battle, t.tileR, t.tileC, 1)) {
        battle.dealDamage(a, u, { amount: a.s.atk * FAUST_SPLASH_SCALE, type: 'phys', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'splash'] });
      }
    }
  });
  battle.on('death', (c) => {
    const u = c && c.unit;
    if (!u || u.defId !== BOSS_MEPHI) return;
    for (const e of liveEnemies(battle, BOSS_FAUST)) {
      battle.addBuff(e, { key: 'recon:faust_haste', persist: true, visible: true, mods: { batPct: -0.5 } });
    }
  });
}

/**
 * 8. 锏·重构：普通攻击每次有 10% 概率使被打到的目标**冻结**（`freeze` 状态，时长沿用引擎既有值 3 s）。每次攻击
 * 只抽一次签（先判 key 再抽签 ⇒ 场上没有锏·重构 时一个随机数都不动）。
 */
function installBlkswb(battle) {
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_BLKSWB || c.isSkill) return;
    if (!battle.rng.chance(BLKSWB_FREEZE_PROB)) return;
    for (const t of c.targets || []) if (t && t.alive) battle.applyStatus(t, 'freeze', { duration: FREEZE_DURATION, source: a });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 第 12 回合的五名·重构首领（塔露拉 / 霜星“冬痕” / 爱国者 / “复仇者” / 狂躁异质裂兽）
//
// 这五只与第 8 回合那三只的差别：**只有“复仇者”在引擎的 KITS 里**（server/sim/content/enemies/leaders.js:213），
// 其余四只（enemy_1503_talula / enemy_1510_frstar2 / enemy_1506_patrt / enemy_1571_mirbst）在本引擎里从来没有 kit。
// 所以那四只的官方行为由本包按 `workshop/enemy-ext/enemies.json` 的记录补上（数值一律读记录），重构增量里属于数据的
// 一半已经写进了 `workshop/mode-recon/enemies.json` 的那五条记录（攻半径、日冕冷却、寒冷时长、生命献祭 / 献祭间隔 /
// 投枪冷却），本模块只做数据表达不了的那一半。
//
// ⚠ 刻意的近似（别当成 bug，README「已知口径」同一条）：
//   * 塔露拉「被阻挡时造成真实伤害」：引擎只在命中结算时允许 kit 改伤害类型（content/enemies.js:187 读 `mem.ab.atkType`），
//     本包给这条记录补一个**空 kit 壳**（`list: []`），`beforeAttack` 时按是否被阻挡切换成 'true' —— 于是被阻挡的那次
//     普通攻击结算为真实伤害，与官方同一条语义。
//   * 霜星「冰环」官方数据只有 `bb.freeze`；本包按业主给的措辞把它当作**寒冷**施加（引擎的 cold-on-cold 会配成冻结，
//     所以第二次冰环起就吃「对被冻结目标伤害加倍」）。「冻结 / 冻结［重生］封印部署地面」这条本模式没有地形系统，
//     因此**没有可移除的东西**（记录照旧，机制为空操作）。
//   * 爱国者「大幅强化敌军攻击与防御力」是给**所有敌方单位**续一条短命 buff（与梅菲斯特的治疗光环同一条做法）；
//     「4 连击」= 普通攻击结算后本包再补 3 次同额物理伤害（引擎的 attack 钩子在伤害之后，见 ai.js:1026）。
//   * 狂躁异质裂兽的「攻击无视敌我」在本模式里没有友方敌人可打，只做**同时攻击周围至多 3 名我方**；「逃跑」整段按业主
//     的重构要求**删掉**（狂怒结束 ⇒ 直接第二阶段），所以 RunToNearestHole 一行都不实现。
//   * 爱国者毁灭姿态的防御力 / 法抗增量、狂躁异质裂兽的「来自自身的伤害大幅提升」都按引擎现有通道近似（见各函数注释）。

const BOSS_TALULA = 'enemy_ws_recon_talula';
const BOSS_FRSTAR2 = 'enemy_ws_recon_frstar2';
const BOSS_PATRT = 'enemy_ws_recon_patrt';
const BOSS_REID = 'enemy_ws_recon_reid';
const BOSS_MIRBST = 'enemy_ws_recon_mirbst';

/** 塔露拉·重构：攻击半径 +0.5（记录里已经加在 stats 上，这里给技能半径也加同一份）、灼燃 50%。 */
const TALULA_RANGE_BONUS = 0.5;
const TALULA_BURN_SCALE = 0.5;
/** “复仇者”·重构：每次攻击 batPct −5%，全部叠加的下限 −90%（units.js:7 的 ΣbatPct 下限同值）。 */
const REID_BAT_STEP = 0.05;
const REID_BAT_CAP = 0.9;
/** 狂躁异质裂兽·重构：狂怒结束条件 = 生命 20% 或登场 240 s；结束后回 50% 生命并直接进入第二阶段。 */
const MIRBST_CRAZY_HP = 0.2;
const MIRBST_CRAZY_DURATION = 240;
const MIRBST_PHASE2_HEAL = 0.5;
/** 阶段切换的模型动作（客户端 FORMS 的 form2 一套）。 */
const FORM2 = { form: 'form2' };

/** 技能记录的 initCooldown（缺省回落到 cooldown）。 */
function icdOf(sk) {
  if (!sk) return 0;
  if (Number.isFinite(sk.initCooldown) && sk.initCooldown > 0) return sk.initCooldown;
  return Number.isFinite(sk.cooldown) && sk.cooldown > 0 ? sk.cooldown : 0;
}

/** 一个技能记录里的 bb 数（缺省 fallback）。 */
function skNum(sk, key, fallback) {
  const v = sk && sk.bb ? sk.bb[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 给「没有引擎 kit」的敌人补一个空 kit 壳，只为了借 `mem.ab.atkType` 这条伤害类型通道（list 永远是空的）。 */
function ensureKitShell(e) {
  if (e.mem.ab) return e.mem.ab;
  e.mem.ab = { key: e.defId, t: {}, tS: {}, sk: {}, list: [], times: null, hitShield: 0, atkType: null, immune: null, origMaxHp: e.base.maxHp };
  return e.mem.ab;
}

/**
 * 9. 塔露拉·重构
 * 官方（记录 `enemy_1503_talula` + 图鉴）：
 *   (a) 【日冕】每 cooldown 秒对半径内所有我方造成 `atk × atk_scale` 法术伤害（半血后用 [Half] 那一条，冷却 15 s；
 *       记录里已按重构减半：40→20 / 15→7.5）；
 *   (b) 【烈焚灼息】每 cooldown 秒点一名我方，挂 30.5 s 的递增真实伤害（每秒 50 起、30 s 内加到 230）；
 *   (c) 被阻挡时普通攻击造成真实伤害（`beforeAttack` 切 `mem.ab.atkType`）；
 *   (d) 半血：防御 +100%、法抗 +80%（`halfhp.def` / `halfhp.magic_resistance`）。
 * 重构：攻击半径 +0.5（记录 stats + 这里给日冕半径同一份）、每次攻击附带 50% 攻击力灼燃、日冕冷却 −50%（记录里）。
 */
function installTalula(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_TALULA) return;
    ensureKitShell(e);
    bossStore(battle).talula.set(e, { corona: icdOf(skillOf(e, 'DanceFire')), dragon: icdOf(skillOf(e, 'DragonFire')), half: false });
  });
  battle.on('beforeAttack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_TALULA || !a.mem.ab) return;
    a.mem.ab.atkType = a.blockedBy ? 'true' : null;
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_TALULA || c.isSkill) return;
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      battle.dealDamage(a, t, { type: 'element', element: 'burn', amount: a.s.atk * TALULA_BURN_SCALE, canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.talula.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.talula) {
      if (!e.alive) { st.talula.delete(e); continue; }
      if (!s.half && e.hpRatio < HALF_HP) {
        s.half = true;
        const def = talentOf(e, 'halfhp.def', 1);
        const res = talentOf(e, 'halfhp.magic_resistance', 0.8);
        battle.addBuff(e, { key: 'recon:talula_half', persist: true, visible: true, mods: { defPct: def, resFlat: e.base.res * res } });
      }
      if (!canAct(battle, e)) continue;
      // (a) 日冕
      s.corona -= dt;
      if (s.corona <= 1e-9) {
        const sk = skillOf(e, s.half ? 'DanceFire[Half]' : 'DanceFire') || skillOf(e, 'DanceFire');
        s.corona = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 20;
        const scale = skNum(sk, 'atk_scale', 1);
        const radius = Math.max(0, skNum(sk, 'range_radius', e.base.rangeRadius)) + TALULA_RANGE_BONUS;
        battle.fx('explode', { x: e.x, y: e.y, r: radius, kind: 'corona' });
        for (const u of battle.alliesInRadius(e.x, e.y, radius)) {
          battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
        }
      }
      // (b) 烈焚灼息：一名我方身上的递增真实伤害
      s.dragon -= dt;
      if (s.dragon <= 1e-9) {
        const sk = skillOf(e, s.half ? 'DragonFire[Half]' : 'DragonFire') || skillOf(e, 'DragonFire');
        s.dragon = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 19;
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable);
        const t = cands.length ? battle.rng.pick(cands) : null;
        if (t) {
          const dur = skNum(sk, 'dragon_fire.duration', 30.5);
          const base = skNum(sk, 'dragon_fire.baseDamage', 50);
          const addOn = skNum(sk, 'dragon_fire.addOnDamage', 180);
          const addOnDur = Math.max(1, skNum(sk, 'dragon_fire.addOnDuration', 30));
          let elapsed = 0;
          battle.addBuff(t, {
            key: 'recon:talula_dragon', duration: dur, source: e, visible: true, interval: 1,
            onTick: ({ battle: b, unit }) => {
              elapsed += 1;
              const amount = base + addOn * Math.min(1, elapsed / addOnDur);
              b.dealDamage(e.alive ? e : null, unit, { amount, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            },
          });
          battle.fx('ignite', { x: t.x, y: t.y, id: t.id, kind: 'talula' });
        }
      }
    }
  });
}

/**
 * 10. 霜星，“冬痕”·重构
 * 官方（记录 `enemy_1510_frstar2`）：普通攻击附带寒冷（`attackfreeze.freeze`）；【冰环】每 10.5 s 对周围造成法术伤害，
 * 对被冻结的目标伤害加倍（`frstar2_s.atk_scale`），并施加寒冷（`bb.freeze`）；【冰盾】每 35 s 补满 2 层（重生后 3 层），
 * 每层挡下一次法术伤害；生命归零 ⇒ 10 s 重生，重生后 20 s 无敌、攻击力 +50%、改用 [Reborn] 两条技能。
 * 重构：寒冷 +5 s（记录里 attackfreeze.freeze 5→10、IceBurst*.bb.freeze 10→15）；「封印部署地面」本模式无地形 ⇒ 空操作。
 */
function installFrstar(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_FRSTAR2) return;
    bossStore(battle).frstar.set(e, {
      burst: icdOf(skillOf(e, 'IceBurst')), shield: icdOf(skillOf(e, 'IceShield')),
      charges: 0, form2: false, reborn: false,
    });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_FRSTAR2 || c.isSkill) return;
    const dur = talentOf(a, 'attackfreeze.freeze', 5);
    if (!(dur > 0)) return;
    for (const t of c.targets || []) if (t && t.alive) battle.applyStatus(t, 'cold', { duration: dur, source: a });
  });
  battle.on('hit', (c) => {
    const t = c && c.target, dmg = c && c.dmg;
    if (!t || t.defId !== BOSS_FRSTAR2 || !dmg || dmg.type !== 'arts') return;
    const s = bossStore(battle).frstar.get(t);
    if (!s || !(s.charges > 0)) return;
    dmg.cancel = true;
    s.charges -= 1;
    battle.fx('shieldBreak', { x: t.x, y: t.y, id: t.id });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.frstar.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.frstar) {
      if (!e.alive) { st.frstar.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      // 冰盾：满层数由记录给出（2 / 重生后 3）
      s.shield -= dt;
      if (s.shield <= 1e-9) {
        const sk = skillOf(e, s.form2 ? 'IceShield[Reborn]' : 'IceShield') || skillOf(e, 'IceShield');
        s.shield = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 35;
        const max = skNum(sk, 'max_cnt', 2);
        if (s.charges < max) {
          s.charges = max;
          battle.addBuff(e, { key: 'recon:frstar_shield', persist: true, visible: true });
        }
      }
      // 冰环
      s.burst -= dt;
      if (s.burst <= 1e-9) {
        const sk = skillOf(e, s.form2 ? 'IceBurst[Reborn]' : 'IceBurst') || skillOf(e, 'IceBurst');
        s.burst = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 10.5;
        const radius = Math.max(2, e.base.rangeRadius);
        const cold = skNum(sk, 'freeze', 10);
        const double = skNum(sk, 'frstar2_s.atk_scale', 2);
        battle.fx('explode', { x: e.x, y: e.y, r: radius, kind: 'iceBurst' });
        for (const u of battle.alliesInRadius(e.x, e.y, radius)) {
          const frozen = !!(u.findBuff && (u.findBuff('freeze') || u.findBuff('cold')));
          battle.dealDamage(e, u, { amount: e.s.atk * skNum(sk, 'atk_scale', 1) * (frozen ? double : 1), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          if (u.alive && cold > 0) battle.applyStatus(u, 'cold', { duration: cold, source: e });
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_FRSTAR2) return;
    const s = bossStore(battle).frstar.get(e);
    if (!s || s.reborn) return;
    s.reborn = true;
    const dur = talentOf(e, 'reborn.duration', 10);
    const inv = talentOf(e, 'reborn.reborn_invincible.duration', 20);
    const atkUp = talentOf(e, 'reborn.atk', 0.5);
    e.hp = 1; // 正数 ⇒ Battle.kill 认作「已被复活」，不再走移除（deploy.js:88）
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:frstar_reborn', duration: Math.max(0.1, dur), visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        s.form2 = true;
        s.burst = icdOf(skillOf(e, 'IceBurst[Reborn]'));
        s.shield = icdOf(skillOf(e, 'IceShield[Reborn]'));
        if (atkUp) b.addBuff(e, { key: 'recon:frstar_form2', persist: true, visible: true, mods: { atkPct: atkUp } });
        if (inv > 0) b.addBuff(e, { key: 'recon:frstar_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: Math.max(0.1, dur), kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/**
 * 11. 爱国者·重构
 * 官方（记录 `enemy_1506_patrt`）：
 *   (a) 「大幅强化敌军攻击与防御力」= 全场敌方 +`strength.atk` 攻击、+`strength.def` 防御（短命 buff 每 tick 续，同梅菲斯特光环）；
 *   (b) 行军姿态：攻击 +`shield.atk`、防御 +`shield.def`、法抗 +`shield.magic_resistance`、仇恨 +`taunt.taunt_level`，普通攻击 4 连击；
 *   (c) 生命归零 ⇒ 重生 `reborn.duration` 秒（记录里已按重构改为 15），期间每 `immo_trigger[reborning].interval` 秒对周围
 *       造成 `atk × atk` 真实伤害；结束后进入毁灭姿态（回满生命）；
 *   (d) 毁灭姿态：远程（射程 2）、每 `throwspear[Rage].cooldown` 秒对**最远的高台干员**投枪（`atk_scale` 物理），
 *       每 `immo_trigger[rage].interval` 秒对周围造成 `atk × atk` 真实伤害（记录里已按重构改为 0.4）。
 * 重构：毁灭姿态防御 +100%、法抗 +50%（本包 buff）。
 */
const PATRT_AURA_RADIUS = 1.5;
const PATRT_RAGE_RANGE = 2;

function patrtSkill(e, key) { return skillOf(e, key); }

function installPatrt(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_PATRT) return;
    bossStore(battle).patrt.set(e, { phase: 'shield', spear: icdOf(patrtSkill(e, 'throwspear[Rage]')), aura: 0, reborn: false });
    // (b) 行军姿态
    battle.addBuff(e, {
      key: 'recon:patrt_shield', persist: true, visible: true,
      mods: {
        atkPct: talentOf(e, 'shield.atk', 0.5),
        defPct: talentOf(e, 'shield.def', 2),
        resFlat: e.base.res * talentOf(e, 'shield.magic_resistance', 1),
        taunt: talentOf(e, 'taunt.taunt_level', 2),
      },
    });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_PATRT || c.isSkill) return;
    const s = bossStore(battle).patrt.get(a);
    if (!s || s.phase !== 'shield') return;
    // (b) 4 连击：普通攻击已结算 1 次，这里补 3 次同额物理伤害
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      for (let i = 0; i < 3 && t.alive; i++) {
        battle.dealDamage(a, t, { amount: a.s.atk, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
      }
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.patrt.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    // (a) 全场敌方的攻防强化（有活着的爱国者·重构 才续）
    const src = (battle.enemies || []).find((x) => x.alive && x.defId === BOSS_PATRT);
    if (src) {
      const atk = talentOf(src, 'strength.atk', 0.2);
      const def = talentOf(src, 'strength.def', 200);
      for (const o of battle.enemies) {
        if (!o.alive) continue;
        battle.addBuff(o, { key: 'recon:patrt_strength', duration: AURA_REFRESH, refresh: 'extend', source: src, mods: { atkPct: atk, defFlat: def } });
      }
    }
    for (const [e, s] of st.patrt) {
      if (!e.alive) { st.patrt.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      // (c) 重生阶段：持续真实伤害
      if (s.phase === 'reborn') {
        const sk = patrtSkill(e, 'immo_trigger[reborning]');
        const iv = Math.max(0.1, skNum(sk, 'interval', 0.8));
        const scale = skNum(sk, 'atk', 0.2);
        s.aura -= dt;
        if (s.aura <= 1e-9) {
          s.aura = iv;
          for (const u of battle.alliesInRadius(e.x, e.y, PATRT_AURA_RADIUS)) {
            battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          }
        }
        continue;
      }
      if (s.phase !== 'rage') continue;
      // (d) 毁灭姿态：主动技能投枪 + 脚下的持续真实伤害
      const iv = Math.max(0.1, talentOf(e, 'immo_trigger[rage].interval', 0.8)); // 重构：0.8 → 0.4
      s.aura -= dt;
      if (s.aura <= 1e-9) {
        s.aura = iv;
        for (const u of battle.alliesInRadius(e.x, e.y, PATRT_AURA_RADIUS)) {
          battle.dealDamage(e, u, { amount: e.s.atk * 0.2, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
        }
      }
      s.spear -= dt;
      if (s.spear <= 1e-9) {
        const sk = patrtSkill(e, 'throwspear[Rage]');
        s.spear = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 20;
        const high = battle.allies().filter((u) => u.alive && u.kind === 'op' && u.def && u.def.position === 'RANGED');
        let best = null, bestD = -1;
        for (const u of high) {
          const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
          if (d > bestD) { bestD = d; best = u; }
        }
        if (best) {
          battle.fx('explode', { x: best.x, y: best.y, r: 0.5, kind: 'spear', id: e.id });
          battle.dealDamage(e, best, { amount: e.s.atk * skNum(sk, 'atk_scale', 1.35), type: 'phys', canDodge: false, tags: ['enemyAbility'] });
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_PATRT) return;
    const s = bossStore(battle).patrt.get(e);
    if (!s || s.reborn) return;
    s.reborn = true;
    s.phase = 'reborn';
    const dur = Math.max(0.1, talentOf(e, 'reborn.duration', 60));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:patrt_reborn', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        s.phase = 'rage';
        s.aura = 0;
        s.spear = icdOf(patrtSkill(e, 'throwspear[Rage]'));
        e.profile.noAttack = false;
        e.profile.melee = false;          // ai.js:933 —— 毁灭姿态可以远程攻击
        e.base.rangeRadius = PATRT_RAGE_RANGE;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        b.addBuff(e, {
          key: 'recon:patrt_rage', persist: true, visible: true,
          mods: {
            atkPct: 0.2 + talentOf(e, 'immo_trigger[rage].atk', 0.2),
            defPct: 1,                                   // 重构：毁灭姿态防御力 +100%
            defFlat: talentOf(e, 'immo_trigger[rage].def', 200),
            resFlat: e.base.res * 0.5,                   // 重构：法术抗性 +50%
            moveMul: 1 + talentOf(e, 'immo_trigger[rage].move_speed', 0.1),
          },
        });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/**
 * 12. “复仇者”·重构：官方 kit 由 `effectRef` 继承（leaders.js:213 —— 半血加攻、冲锋、首次击倒重生）。
 * 重构：**每次攻击后**攻击间隔 −5%，可叠加到 −90%（ΣbatPct 的下限在 units.js:7，正好同值）。
 */
function installReid(battle) {
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_REID || c.isSkill) return;
    const st = bossStore(battle);
    const n = Math.min(REID_BAT_CAP, (st.reid.get(a) ?? 0) + REID_BAT_STEP);
    st.reid.set(a, n);
    battle.addBuff(a, { key: 'recon:reid_haste', persist: true, visible: true, mods: { batPct: -n } });
  });
}

/**
 * 13. 狂躁异质裂兽·重构
 * 官方（记录 `enemy_1571_mirbst`）：第一形态攻击为二连击、并让目标受到来自自身的伤害大幅提升；【狂怒】期间攻速 +200、
 * 移速 +2、受到的物理 / 法术伤害减半、同时攻击至多 3 名我方；狂怒在 120 s 或半血时结束，随后逃跑 10 s、进入第二形态
 * （60 s 狂怒、攻击 +100%、受伤再降 60%）；【落石】每 20 s 向对它造成最多伤害的单位投石（`atk_scale` 物理 + 10 s 眩晕）。
 * 重构：狂怒结束条件改为 **20% 生命或 240 s**；结束后**不再逃跑**，直接进入第二阶段、回复 50% 生命、并重新获得狂怒。
 */
function installMirbst(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MIRBST) return;
    const st = bossStore(battle);
    st.mirbst.set(e, {
      phase: 1, crazy: MIRBST_CRAZY_DURATION, stone: icdOf(skillOf(e, 'ThrowStone')), hitBy: new Map(), raged: true,
    });
    e.profile.maxTargets = Number(talentOf(e, 'AttackParam.attack@max_target', 3));
    battle.addBuff(e, {
      key: 'recon:mirbst_crazy', persist: true, visible: true,
      mods: {
        aspd: talentOf(e, 'M0CrazyBonus.attack_speed', 200),
        moveFlat: talentOf(e, 'M0CrazyBonus.move_speed', 2),
        physTakenMul: 1 - talentOf(e, 'M0CrazyBonus.damage_resistance', 0.5),
        artsTakenMul: 1 - talentOf(e, 'M0CrazyBonus.damage_resistance', 0.5),
      },
    });
  });
  battle.on('damaged', (c) => {
    const t = c && c.target, s = c && c.source, amount = c && c.amount;
    if (!t || t.defId !== BOSS_MIRBST || !s || s.side !== 'ally' || !(amount > 0)) return;
    const st = bossStore(battle).mirbst.get(t);
    if (!st) return;
    st.hitBy.set(s, (st.hitBy.get(s) ?? 0) + amount);
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_MIRBST || c.isSkill) return;
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      // 二连击：普通攻击已结算 1 次，这里补 1 次同额物理伤害
      battle.dealDamage(a, t, { amount: a.s.atk, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
      // 「受到来自自身的伤害大幅提升」：引擎没有「来源限定」的减伤通道，按 20 s 内受伤 ×`IncreasedDamage.damage_scale` 近似
      const scale = talentOf(a, 'IncreasedDamage.damage_scale', 2);
      if (scale > 1) battle.addBuff(t, { key: 'recon:mirbst_mark', duration: talentOf(a, 'IncreasedDamage.damage_scale_duration', 20), refresh: 'extend', source: a, mods: { dmgTakenMul: scale } });
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.mirbst.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.mirbst) {
      if (!e.alive) { st.mirbst.delete(e); continue; }
      // 狂怒结束：生命 ≤20% 或 240 s 到点（重构口径）
      if (s.phase === 1 && s.raged) {
        s.crazy -= dt;
        if (e.hpRatio <= MIRBST_CRAZY_HP || s.crazy <= 1e-9) enterMirbstPhase2(battle, e, s);
        if (!s.raged) continue;
      }
      if (!canAct(battle, e)) continue;
      // 第二形态的 60 s 狂怒结束后回到常态（重构要求里没有第三形态）
      if (s.phase === 2) {
        s.crazy -= dt;
        if (s.crazy <= 1e-9) {
          s.raged = false;
          e.profile.maxTargets = 1;
          battle.removeBuff(e, 'recon:mirbst_phase2');
        }
      }
      // 【落石】
      s.stone -= dt;
      if (s.stone <= 1e-9) {
        const sk = skillOf(e, 'ThrowStone');
        s.stone = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 20;
        let best = null, bestDmg = 0;
        for (const [u, dmg] of s.hitBy) if (u.alive && dmg > bestDmg) { bestDmg = dmg; best = u; }
        if (best) {
          s.hitBy.clear();
          battle.fx('explode', { x: best.x, y: best.y, r: 0.5, kind: 'stone', id: e.id });
          battle.dealDamage(e, best, { amount: e.s.atk * skNum(sk, 'atk_scale', 1.5), type: 'phys', canDodge: false, tags: ['enemyAbility', 'stone'] });
          if (best.alive && skNum(sk, 'stun', 10) > 0) battle.applyStatus(best, 'stun', { duration: skNum(sk, 'stun', 10), source: e });
        }
      }
    }
  });
}

/** 狂躁异质裂兽·重构：狂怒结束 ⇒ **不逃跑**，直接第二阶段、回 50% 生命、重新获得狂怒。 */
function enterMirbstPhase2(battle, e, s) {
  s.phase = 2;
  s.raged = true;
  s.crazy = talentOf(e, 'M2LimitCrazyBonus.duration', 60);
  battle.removeBuff(e, 'recon:mirbst_crazy');
  e.hp = Math.min(e.s.maxHp, e.hp + e.s.maxHp * MIRBST_PHASE2_HEAL);
  e.markDirty();
  battle.fx('heal', { x: e.x, y: e.y, id: e.id });
  e.profile.maxTargets = Number(talentOf(e, 'AttackParam.attack@max_target', 3));
  battle.addBuff(e, {
    key: 'recon:mirbst_phase2', persist: true, visible: true,
    mods: {
      atkPct: talentOf(e, 'M2LimitCrazyBonus.atk', 1),
      aspd: talentOf(e, 'M0CrazyBonus.attack_speed', 200),
      moveFlat: talentOf(e, 'M0CrazyBonus.move_speed', 2),
      physTakenMul: 1 - talentOf(e, 'M2LimitCrazyBonus.damage_resistance', 0.6),
      artsTakenMul: 1 - talentOf(e, 'M2LimitCrazyBonus.damage_resistance', 0.6),
    },
  });
  battle.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'mirbst', ...FORM2 });
}

// ---------------------------------------------------------------------------------------------------------------
// 第 16 回合的五名·重构首领（蔓德拉 / 血骑士狄开俄波利斯 / 莫菲丝 / “酒神” / “望”）
//
// 这五只在引擎里**都没有 kit**，官方记录在 `workshop/enemy-ext/enemies.json`（莫菲丝不在任何已装数据里 —— 本包按
// PRTS 的 /w/莫菲丝?action=raw 补了一条：60000/680/580/35 · 0.7 速 · 2.8 攻隔 · 射程 2.5 · 免疫晕眩/沉默/沉睡/冻结）。
// 重构增量里能落到数据的一律已写进 `enemies.json`；数据表达不了的一半在这里。
//
// 业主明确「凝血之刃、瑕做进来，其他装置不用」：所以本段只实现这两只召唤物（`enemy_ws_recon_bldbld` /
// `enemy_ws_recon_xia`），破碎支柱 / 摄影机 / 安眠伴随兽 / 布景小丑 / 瑕的棋子地形全部不实现。
//
// ⚠ 已知近似（README 同一条）：
//   * 莫菲丝的【蓝线】需要「其他敌人」分担伤害；本模式的试炼场通常只有她自己，所以蓝线只按「0 根」处理，
//     减伤 / 均摊不生效；**有效【线】的攻击力加成**只数【红线】（连接我方的那些），重构要求是 25%/根。
//   * 蔓德拉的【石之盾】= 受物理/法术伤害 ×(1 − StoneSkin.damage_resistance)；「受到破碎支柱伤害后失效」不实现。
//   * 血骑士的「减伤对阻挡自身的单位无效」按 `hit` 钩子补回（挡她的那一次伤害不吃减伤）。
//   * 酒神的神经损伤改写只作用于「相邻我方」（第一形态 4 格、第二形态 8 格），目标本身不再眩晕。
//   * “望”的瑕只做「每秒 100% 攻击力法术伤害 / 在望周围时改为单体攻击 + 1 s 眩晕」，棋子地形与「失气」不实现。

const BOSS_MANDRA = 'enemy_ws_recon_mandra';
const BOSS_BLDKGT = 'enemy_ws_recon_bldkgt';
const BOSS_MORPHIS = 'enemy_ws_recon_morphis';
const BOSS_DIRCTR = 'enemy_ws_recon_dirctr';
const BOSS_DYWQGS = 'enemy_ws_recon_dywqgs';
/** 两只召唤物（官方 key 分别是 enemy_1186_bldbld / enemy_2101_dyspll，记录由本包按 PRTS 数据补）。 */
const SUMMON_BLDBLD = 'enemy_ws_recon_bldbld';
const SUMMON_XIA = 'enemy_ws_recon_xia';

/** 引擎的最低伤害比例（damage.js:192-198 的 MIN_DAMAGE_RATIO）。 */
const WEAKNESS_MIN_RATIO = 0.05;
/** 血骑士的复活姿态：业主给定 15 s；回到第一形态的门槛读 `CheckTrigger.hp_ratio`（重构已改 0.5）。 */
const BLDKGT_REVIVE_DURATION = 15;
/** 莫菲丝的【线】与屏障。 */
const MORPHIS_LINE_TICK = 0.4;
const MORPHIS_MOUNT_DURATION = 8;
/** 酒神：神经损伤爆发的延迟（图鉴「短暂延迟后」）[ASSUMED]。 */
const DIRCTR_BURST_DELAY = 0.5;
/** “望”的瑕部署间隔（重构：重生期间 30 → 5）。 */
const WANG_XIA_INTERVAL = 5;

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/** 引擎的减伤公式（damage.js:189-205 的 phys / arts 两段），供「弱点伤害」比较用。 */
function mitigatedBy(amount, type, target, dmg) {
  const ss = target && target.s ? target.s : null;
  if (!ss) return amount;
  if (type === 'phys') {
    const eff = Math.max(0, (ss.def ?? 0) * (1 - clamp01(dmg.defIgnorePct)) - (dmg.defIgnoreFlat ?? 0));
    return Math.max(amount - eff, WEAKNESS_MIN_RATIO * amount);
  }
  const eff = Math.max(0, (ss.res ?? 0) * (1 - clamp01(dmg.resIgnorePct)) - (dmg.resIgnoreFlat ?? 0));
  return Math.max(amount * (1 - Math.min(100, eff) / 100), WEAKNESS_MIN_RATIO * amount);
}

/** 弱点伤害：这一击按「物理 / 法术里对目标更疼的那一种」结算（garrisons/battle.js:524 的同一条判据）。 */
function weaknessType(source, target, dmg) {
  if (!target || !target.s) return dmg.type;
  const ph = mitigatedBy(dmg.amount, 'phys', target, dmg) * (source && source.s ? (source.s.physDealtMul ?? 1) : 1) * (target.s.physTakenMul ?? 1);
  const ar = mitigatedBy(dmg.amount, 'arts', target, dmg) * (source && source.s ? (source.s.artsDealtMul ?? 1) : 1) * (target.s.artsTakenMul ?? 1);
  if (ar > ph + 1e-9) return 'arts';
  if (ph > ar + 1e-9) return 'phys';
  return dmg.type;
}

/** 「周围 N 格」的我方（Chebyshev 判定，与 alliesInBox 同一条口径），`skip` 排除自己。 */
function alliesAroundBox(battle, r, c, n, skip = null) {
  const out = [];
  const rr = Math.round(r), cc = Math.round(c);
  for (const a of battle.allies()) {
    if (a === skip || a.hidden) continue;
    if (Math.max(Math.abs(Math.round(a.tileR) - rr), Math.abs(Math.round(a.tileC) - cc)) <= n) out.push(a);
  }
  return out;
}

/**
 * 14. 蔓德拉·重构
 * 官方：第一形态【石之盾】减伤（`StoneSkin.damage_resistance`，重构 60% → 80%）；【蔓德拉的注目】点攻击最高的我方，
 * 造成法术伤害并降攻速；第二形态额外近地悬浮、每秒对周围造成法术溅射（`StoneSkin_2.*`），技能更频繁。
 * 重构：第二形态的远程攻击与【石之盾】溅射都转为**弱点伤害**；「注目使所在地块损毁」在本模式无地形 ⇒ 空操作。
 */
function installMandra(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MANDRA) return;
    const dr = talentOf(e, 'StoneSkin.damage_resistance', 0.6);
    battle.addBuff(e, { key: 'recon:mandra_stone', persist: true, visible: true, mods: { physTakenMul: 1 - dr, artsTakenMul: 1 - dr } });
    bossStore(battle).mandra.set(e, { ray: icdOf(skillOf(e, 'PetrifiedRay')), form2: false, reborn: false, aura: 0 });
  });
  battle.on('hit', (c) => {
    const s = c && c.source, dmg = c && c.dmg;
    if (!s || s.defId !== BOSS_MANDRA || !dmg || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
    const st = bossStore(battle).mandra.get(s);
    if (!st || !st.form2) return;
    dmg.type = weaknessType(s, c.target, dmg);
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.mandra.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.mandra) {
      if (!e.alive) { st.mandra.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      // 【石之盾】第二形态：每秒对周围造成弱点伤害
      if (s.form2) {
        const sk = skillOf(e, 'SummonStoneSkin_2');
        const iv = Math.max(0.1, skNum(sk, 'interval', talentOf(e, 'StoneSkin_2.interval', 1)));
        const radius = talentOf(e, 'StoneSkin_2.range_radius', 1.7);
        const scale = talentOf(e, 'StoneSkin_2.atk_scale', 0.3);
        s.aura -= dt;
        if (s.aura <= 1e-9) {
          s.aura = iv;
          battle.fx('explode', { x: e.x, y: e.y, r: radius, kind: 'stoneSkin' });
          for (const u of battle.alliesInRadius(e.x, e.y, radius)) {
            const dmg = { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true };
            dmg.type = weaknessType(e, u, dmg);
            battle.dealDamage(e, u, { ...dmg, tags: ['enemyAbility', 'weakness'] });
          }
        }
      }
      // 【蔓德拉的注目】
      s.ray -= dt;
      if (s.ray <= 1e-9) {
        const sk = skillOf(e, 'PetrifiedRay');
        s.ray = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 15;
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable);
        let best = null, bestAtk = -1;
        for (const u of cands) if (u.s.atk > bestAtk) { bestAtk = u.s.atk; best = u; }
        if (best) {
          battle.fx('beam', { from: [e.x, e.y], to: [best.x, best.y], kind: 'mandraRay', id: e.id });
          battle.dealDamage(e, best, { amount: e.s.atk * skNum(sk, 'atk_scale', 1), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          const aspd = skNum(sk, 'attack_speed', -0.7) * 100;
          if (best.alive && aspd) battle.addBuff(best, { key: 'recon:mandra_ray', duration: skNum(sk, 'mandra_ray[cd].duration', 7.1), source: e, visible: true, mods: { aspd } });
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_MANDRA) return;
    const s = bossStore(battle).mandra.get(e);
    if (!s || s.reborn) return;
    s.reborn = true;
    const dur = Math.max(0.1, talentOf(e, 'Reborn.duration', 5));
    const inv = talentOf(e, 'Reborn.mandra_p2_invinsible.duration', 3);
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:mandra_reborn', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        s.form2 = true;
        s.ray = icdOf(skillOf(e, 'PetrifiedRay'));
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        b.addBuff(e, { key: 'recon:mandra_float', persist: true, visible: true, flags: { unblockable: true, float: true } });
        if (inv > 0) b.addBuff(e, { key: 'recon:mandra_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/** 血骑士的减伤：第一形态 25%、第二形态 50%（`Passive.damage_scale` / `Passive2.damage_scale`）。 */
function bldkgtScale(e, phase) {
  return phase === 2 ? talentOf(e, 'Passive2.damage_scale', 0.5) : talentOf(e, 'Passive.damage_scale', 0.75);
}

/**
 * 15. 血骑士狄开俄波利斯·重构
 * 官方：受伤害降低（对阻挡者无效）；【血归】晕眩目标并每秒造成法术伤害；生命归零进入复活姿态（无敌、持续召唤
 * 凝血之刃），复活姿态下回满生命回到第一形态，否则进入第二形态（攻击力 +50%、远程、减伤 50%）。
 * 重构：血归目标 +1（2 名）；复活姿态回第一形态的门槛 100% → **50%**；复活姿态持续 **15 s**。
 */
function installBldkgt(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_BLDKGT) return;
    battle.addBuff(e, { key: 'recon:bldkgt_reduce', persist: true, visible: true, mods: { physTakenMul: bldkgtScale(e, 1), artsTakenMul: bldkgtScale(e, 1) } });
    bossStore(battle).bld.set(e, { blood: icdOf(skillOf(e, 'BloodPool')), phase: 1, reborn: false, reviveLeft: 0, summonLeft: 2, healAcc: 0 });
  });
  battle.on('hit', (c) => {
    const t = c && c.target, s = c && c.source, dmg = c && c.dmg;
    if (!t || t.defId !== BOSS_BLDKGT || !s || !dmg || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
    // 「减伤效果对阻挡自身的单位无效」：把引擎已乘上的那一份补回来
    if (s === t.blockedBy) {
      const st = bossStore(battle).bld.get(t);
      const scale = bldkgtScale(t, st ? st.phase : 1);
      if (scale > 0) dmg.mul = (dmg.mul ?? 1) / scale;
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.bld.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.bld) {
      if (!e.alive) { st.bld.delete(e); continue; }
      // 复活姿态：回血、召唤凝血之刃；到 50% 回第一形态，15 s 到点进第二形态
      if (s.phase === 'revive') {
        s.reviveLeft -= dt;
        s.healAcc += e.s.maxHp * 0.1 * dt;               // 每秒 10%（Devour.hp_ratio）
        if (s.healAcc >= 1) {
          const add = Math.floor(s.healAcc);
          s.healAcc -= add;
          e.hp = Math.min(e.s.maxHp, e.hp + add);
          e.markDirty();
        }
        const threshold = talentOf(e, 'CheckTrigger.hp_ratio', 1);
        if (e.hpRatio >= threshold) {
          s.phase = 1;
          e.profile.noAttack = false;
          battle.removeBuff(e, 'recon:bldkgt_reborn');
          battle.addBuff(e, { key: 'recon:bldkgt_reduce', persist: true, visible: true, mods: { physTakenMul: bldkgtScale(e, 1), artsTakenMul: bldkgtScale(e, 1) } });
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'revived' });
          continue;
        }
        s.summonLeft -= dt;
        if (s.summonLeft <= 1e-9) {
          s.summonLeft = Math.max(1, (skillOf(e, 'SummonBldbld') || {}).cooldown || 10);
          battle.spawnEnemy(SUMMON_BLDBLD, { pos: [e.y, e.x - 1], ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
          battle.fx('summon', { x: e.x, y: e.y, id: e.id, key: SUMMON_BLDBLD, n: 1 });
        }
        if (s.reviveLeft <= 1e-9) {
          s.phase = 2;
          e.profile.noAttack = false;
          battle.removeBuff(e, 'recon:bldkgt_reborn');
          battle.addBuff(e, { key: 'recon:bldkgt_form2', persist: true, visible: true, mods: { atkPct: talentOf(e, 'Passive2.atk', 0.5) } });
          battle.removeBuff(e, 'recon:bldkgt_reduce');
          battle.addBuff(e, { key: 'recon:bldkgt_reduce', persist: true, visible: true, mods: { physTakenMul: bldkgtScale(e, 2), artsTakenMul: bldkgtScale(e, 2) } });
          e.profile.melee = false;
          e.base.rangeRadius = 2;
          e.hp = e.s.maxHp;
          e.atkCd = 0;
          const inv = talentOf(e, 'Passive2.invincible_time', 6);
          if (inv > 0) battle.addBuff(e, { key: 'recon:bldkgt_inv', duration: inv, visible: true, flags: { invulnerable: true } });
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
        }
        continue;
      }
      if (!canAct(battle, e)) continue;
      // 【血归】：重构后一次选 2 名（原 1 名）
      s.blood -= dt;
      if (s.blood <= 1e-9) {
        const sk = skillOf(e, s.phase === 2 ? 'BloodPool2' : 'BloodPool') || skillOf(e, 'BloodPool');
        s.blood = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 15;
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable)
          .sort((a, b) => b.s.atk - a.s.atk).slice(0, 2);
        for (const u of cands) {
          battle.applyStatus(u, 'stun', { duration: skNum(sk, 'stun', 10), source: e });
          let elapsed = 0;
          battle.addBuff(u, {
            key: 'recon:bldkgt_blood', duration: 10, visible: true, source: e, interval: skNum(sk, 'interval', 1),
            onTick: ({ battle: b, unit }) => {
              elapsed += 1;
              if (elapsed > 10) return;
              b.dealDamage(e.alive ? e : null, unit, { amount: skNum(sk, 'damage', 200), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            },
          });
        }
      }
    }
  });
  // 凝血之刃：走到血骑士身边即消失并回复他 10% 生命上限（Devour.hp_ratio）
  battle.on('tick', (c) => {
    const list = (battle.enemies || []).filter((x) => x.alive && x.defId === SUMMON_BLDBLD);
    if (!list.length) return;
    const boss = (battle.enemies || []).find((x) => x.alive && x.defId === BOSS_BLDKGT);
    if (!boss) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const blade of list) {
      const dx = boss.x - blade.x, dy = boss.y - blade.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.8) {
        // 凝血之刃没有自己的路径（它是被召唤出来的）：这里让它径直扑向血骑士（[ASSUMED] 2 格/秒）
        const step = Math.min(dist, 2 * dt);
        blade.x += (dx / Math.max(1e-9, dist)) * step;
        blade.y += (dy / Math.max(1e-9, dist)) * step;
        continue;
      }
      const healed = battle.heal(boss, boss, boss.s.maxHp * talentOf(blade, 'Devour.hp_ratio', 0.1), { self: true });
      if (healed > 0) { boss.markDirty(); battle.fx('heal', { x: boss.x, y: boss.y, id: boss.id }); }
      battle.kill(blade, null);
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_BLDKGT) return;
    const s = bossStore(battle).bld.get(e);
    if (!s || s.reborn) return;
    s.reborn = true;
    s.phase = 'revive';
    s.reviveLeft = BLDKGT_REVIVE_DURATION;
    s.summonLeft = 2;
    s.healAcc = 0;
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.removeBuff(e, 'recon:bldkgt_reduce');
    battle.addBuff(e, {
      key: 'recon:bldkgt_reborn', duration: BLDKGT_REVIVE_DURATION, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: false, noMove: true, stun: true },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: BLDKGT_REVIVE_DURATION, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/**
 * 16. 莫菲丝·重构（记录按 PRTS /w/莫菲丝?action=raw 补；引擎没有她的 kit）
 * 官方：每根有效【线】+10% 攻击（重构 **25%**）；【蓝线】减伤与伤害均摊；【红线】连接最远我方，每 0.4 s 造成
 * `atk × atk_scale` 法术伤害并持续 10 s；【梦境的演变】骑乘形态 8 s，获得 20000 点屏障（重构：**自身 10% 生命上限**）；
 * 生命归零 → 重生形态（30 s 内回满、每 4 s 全场法术伤害；重构：**10 s**）。
 * 本模式通常没有「其他敌人」可连接【蓝线】，所以蓝线按 0 根处理（见文件头）。
 */
function installMorphis(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MORPHIS) return;
    bossStore(battle).morphis.set(e, {
      red: 18, evolve: 20, phase: 1, reborn: false, rebornLeft: 0,
      barrier: 0, barrierLeft: 0, mounted: false, hitAcc: 0, lines: 0,
    });
  });
  battle.on('hit', (c) => {
    const t = c && c.target, dmg = c && c.dmg;
    if (!t || t.defId !== BOSS_MORPHIS || !dmg || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
    const s = bossStore(battle).morphis.get(t);
    if (!s || !(s.barrier > 0)) return;
    if (s.barrier >= dmg.amount) {
      dmg.cancel = true;
      s.barrier -= dmg.amount;
    } else {
      dmg.amount -= s.barrier;
      s.barrier = 0;
    }
    if (s.barrier <= 1e-9) exitMorphisMount(battle, t, s);
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.morphis.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.morphis) {
      if (!e.alive) { st.morphis.delete(e); continue; }
      // 重生形态：10 s 内线性回满，每 4 s 全场法术伤害
      if (s.reborn) {
        s.rebornLeft -= dt;
        s.hitAcc += dt;
        const perSec = e.s.maxHp / Math.max(0.1, talentOf(e, 'Reborn.duration', 10));
        e.hp = Math.min(e.s.maxHp, e.hp + perSec * dt);
        e.markDirty();
        if (s.hitAcc >= talentOf(e, 'Reborn.hit_interval', 4)) {
          s.hitAcc = 0;
          for (const u of battle.allies()) {
            battle.dealDamage(e, u, { amount: e.s.atk, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          }
          battle.fx('explode', { x: e.x, y: e.y, r: 8, kind: 'morphisReborn', id: e.id });
        }
        if (s.rebornLeft <= 1e-9) enterMorphisForm2(battle, e, s);
        continue;
      }
      if (!canAct(battle, e)) continue;
      // 骑乘形态：8 s 后自行结束（屏障提前破碎时在 hit 里结束）
      if (s.mounted) {
        s.barrierLeft -= dt;
        if (s.barrierLeft <= 1e-9) exitMorphisMount(battle, e, s);
        continue;
      }
      // 有效【线】的攻击力加成（重构：每根 25%）
      const lineAtk = talentOf(e, 'EnemyLineT.atk', 0.25);
      // 【红线】连接最远我方
      s.red -= dt;
      if (s.red <= 1e-9) {
        const radius = s.phase === 2 ? 99 : 2.45;
        s.red = 15;
        const taken = new Set();
        for (const u of battle.allies()) if (u.findBuff && u.findBuff('recon:morphis_red')) taken.add(u);
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable && !taken.has(u));
        let best = null, bestD = -1;
        const inR = (u) => (u.x - e.x) ** 2 + (u.y - e.y) ** 2 <= radius * radius;
        for (const u of cands) {
          if (!inR(u)) continue;
          const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
          if (d > bestD) { bestD = d; best = u; }
        }
        if (best) {
          const scale = s.phase === 2 ? talentOf(e, 'RedLine.atk_scale_2', 0.6) : talentOf(e, 'RedLine.atk_scale', 0.5);
          let ticks = 0;
          battle.fx('beam', { from: [e.x, e.y], to: [best.x, best.y], kind: 'morphisRed', id: e.id });
          battle.addBuff(best, {
            key: 'recon:morphis_red', duration: talentOf(e, 'RedLine.duration', 10), visible: true, source: e,
            interval: talentOf(e, 'RedLine.interval', MORPHIS_LINE_TICK),
            onTick: ({ battle: b, unit }) => {
              ticks += 1;
              b.dealDamage(e.alive ? e : null, unit, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            },
          });
        }
      }
      // 【梦境的演变】
      s.evolve -= dt;
      if (s.evolve <= 1e-9) {
        s.evolve = 18;
        enterMorphisMount(battle, e, s);
      }
      // 线与攻击力：红线每根 +25%（蓝线 0 根）
      const lines = battle.allies().filter((u) => u.findBuff && u.findBuff('recon:morphis_red')).length;
      s.lines = lines;
      battle.addBuff(e, { key: 'recon:morphis_lines', persist: true, visible: true, mods: { atkPct: lineAtk * lines } });
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_MORPHIS) return;
    const s = bossStore(battle).morphis.get(e);
    if (!s || s.reborn) return;
    s.reborn = true;
    s.rebornLeft = Math.max(0.1, talentOf(e, 'Reborn.duration', 10));
    s.hitAcc = 0;
    if (s.mounted) exitMorphisMount(battle, e, s);
    for (const u of battle.allies()) if (u.findBuff && u.findBuff('recon:morphis_red')) battle.removeBuff(u, 'recon:morphis_red');
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:morphis_reborn', duration: s.rebornLeft, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: s.rebornLeft, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/** 莫菲丝进入骑乘形态：不可阻挡、+0.7 移速、获得 10% 生命上限的屏障，持续 8 s。 */
function enterMorphisMount(battle, e, s) {
  if (s.mounted) return;
  s.mounted = true;
  s.barrier = e.s.maxHp * talentOf(e, 'Shield.dynamic_ratio', 0.1);
  s.barrierLeft = Math.max(0.1, talentOf(e, 'Shield.interval', MORPHIS_MOUNT_DURATION));
  battle.addBuff(e, {
    key: 'recon:morphis_mount', duration: s.barrierLeft, visible: true,
    flags: { unblockable: true, noAttack: true }, mods: { moveFlat: talentOf(e, 'Shield.move_speed', 0.7) },
  });
  battle.addBuff(e, { key: 'recon:morphis_barrier', duration: s.barrierLeft, visible: true });
  battle.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'morphisMount' });
}

/** 退出骑乘形态（屏障破碎或到点）：清屏障与不可阻挡。 */
function exitMorphisMount(battle, e, s) {
  if (!s.mounted) return;
  s.mounted = false;
  s.barrier = 0;
  s.barrierLeft = 0;
  battle.removeBuff(e, 'recon:morphis_mount');
  battle.removeBuff(e, 'recon:morphis_barrier');
}

/** 莫菲丝第二形态：生命回满、攻击 +10%、攻击间隔 −0.2 s、攻击范围扩大至全场。 */
function enterMorphisForm2(battle, e, s) {
  s.reborn = false;
  s.phase = 2;
  e.profile.noAttack = false;
  e.hp = e.s.maxHp;
  e.atkCd = 0;
  e.base.rangeRadius = 99;
  battle.removeBuff(e, 'recon:morphis_reborn');
  battle.addBuff(e, {
    key: 'recon:morphis_form2', persist: true, visible: true,
    mods: { atkPct: talentOf(e, 'Reborn.atk', 0.1), batPct: Math.max(-0.9, talentOf(e, 'Reborn.base_attack_time', -0.2) / Math.max(0.1, e.base.bat || 2.8)) },
  });
  battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
}

/**
 * 17. “酒神”·重构
 * 官方：神经损伤爆发时【戏剧化】延迟后炸周围（并再造成神经损伤）；生命归零重生。
 * 重构：**常态隐匿**；神经损伤爆发不再眩晕目标，而是对目标的相邻我方造成 **5 s 眩晕 + 50% 生命上限真实伤害**；
 * 重生时间 **10 s**（记录里 Reborn.duration 20 → 10）。
 */
function installDirctr(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_DIRCTR) return;
    battle.addBuff(e, { key: 'recon:dirctr_hidden', persist: true, visible: true, flags: { stealth: true } });
    bossStore(battle).dirctr.set(e, { reborn: false, form2: false });
  });
  battle.on('elementBurst', (c) => {
    const t = c && c.target, el = c && c.element;
    if (!t || t.side !== 'ally' || el !== 'neural') return;
    if (!(battle.enemies || []).some((x) => x.alive && x.defId === BOSS_DIRCTR)) return;
    const src = (battle.enemies || []).find((x) => x.alive && x.defId === BOSS_DIRCTR);
    battle.after(DIRCTR_BURST_DELAY, () => {
      if (!t.alive) return;
      const st = bossStore(battle).dirctr.get(src);
      const n = 1; // 相邻一圈（第一形态 4 格 / 第二形态 8 格都按 Chebyshev ≤ 1 处理）
      battle.fx('explode', { x: t.x, y: t.y, r: 1.5, kind: 'dirctrBurst', id: src.id });
      for (const u of alliesAroundBox(battle, t.tileR, t.tileC, n, t)) {
        battle.dealDamage(src.alive ? src : null, u, { amount: u.s.maxHp * 0.5, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
        if (u.alive) battle.applyStatus(u, 'stun', { duration: 5, source: src, ignoreSelect: true });
      }
    });
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_DIRCTR) return;
    const st = bossStore(battle).dirctr.get(e);
    if (!st || st.reborn) return;
    st.reborn = true;
    const dur = Math.max(0.1, talentOf(e, 'Reborn.duration', 10));
    const inv = talentOf(e, 'Reborn.invincible', 10);
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:dirctr_reborn', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        st.form2 = true;
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        if (inv > 0) b.addBuff(e, { key: 'recon:dirctr_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/**
 * 18. “望”·重构
 * 官方：初始形态每部署单位在其周围放一枚“瑕”、每 30 s 随机放一枚；重生 30 s，重生后第二形态无敌 60 s。
 * 重构：重生 **15 s**、重生后无敌 **10 s**、重生期间部署瑕的间隔 **30 → 5 s**（三处都已写进记录）。
 */
function installDywqgs(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_DYWQGS) return;
    bossStore(battle).wang.set(e, { reborn: false, rebornLeft: 0, xiaLeft: WANG_XIA_INTERVAL, form2: false });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.wang.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.wang) {
      if (!e.alive) { st.wang.delete(e); continue; }
      if (!s.reborn) continue;
      s.rebornLeft -= dt;
      s.xiaLeft -= dt;
      if (s.xiaLeft <= 1e-9) {
        s.xiaLeft = Math.max(1, talentOf(e, 'RebornSpawn.interval', WANG_XIA_INTERVAL));
        spawnXia(battle, e);
      }
      if (s.rebornLeft <= 1e-9) {
        s.reborn = false;
        s.form2 = true;
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        const inv = talentOf(e, 'Reborn.invincible_duration', 60);
        if (inv > 0) battle.addBuff(e, { key: 'recon:wang_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        battle.addBuff(e, {
          key: 'recon:wang_form2', persist: true, visible: true,
          mods: { aspd: talentOf(e, 'FinalAttributeUp.attack_speed', 100), atkPct: talentOf(e, 'FinalAttributeUp.attack@atk_scale', 1) - 1 },
        });
        e.profile.maxTargets = Math.max(1, Math.floor(talentOf(e, 'FinalAttributeUp.attack@max_target', 3)));
        spawnXia(battle, e);
        battle.removeBuff(e, 'recon:wang_reborn');
        battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_DYWQGS) return;
    const s = bossStore(battle).wang.get(e);
    if (!s || s.reborn) return;
    s.reborn = true;
    s.rebornLeft = Math.max(0.1, talentOf(e, 'Reborn.duration', 15));
    s.xiaLeft = Math.max(1, talentOf(e, 'RebornSpawn.interval', WANG_XIA_INTERVAL));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:wang_reborn', duration: s.rebornLeft, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: s.rebornLeft, kind: 'reborn', id: e.id, form: 'reborn' });
  });
  // 瑕：常态每秒对周围 4 格我方造成 100% 攻击力法术伤害；处在“望”周围时改为单体攻击 + 1 s 眩晕
  battle.on('tick', (c) => {
    const xias = (battle.enemies || []).filter((x) => x.alive && x.defId === SUMMON_XIA);
    if (!xias.length) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    const wangs = (battle.enemies || []).filter((x) => x.alive && x.defId === BOSS_DYWQGS);
    for (const x of xias) {
      x._reconAcc = (x._reconAcc ?? 0) + dt;
      if (x._reconAcc < 1) continue;
      x._reconAcc -= 1;
      const near = wangs.find((w) => (w.x - x.x) ** 2 + (w.y - x.y) ** 2 <= talentOf(x, 'ActiveChessDamage.range_radius', 1.6) ** 2);
      if (near) {
        const cands = alliesAroundBox(battle, x.tileR, x.tileC, 1);
        if (cands.length) {
          const t = battle.rng.pick(cands);
          battle.fx('beam', { from: [x.x, x.y], to: [t.x, t.y], kind: 'xia' });
          battle.dealDamage(x, t, { amount: x.s.atk, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
          if (t.alive) battle.applyStatus(t, 'stun', { duration: 1, source: x });
        }
      } else {
        for (const u of alliesAroundBox(battle, x.tileR, x.tileC, 1)) {
          battle.dealDamage(x, u, { amount: x.s.atk, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
        }
      }
    }
  });
}

/** 在一名随机我方周围的可部署位置放一枚“瑕”（没有我方时放在望的脚下偏一格）。 */
function spawnXia(battle, e) {
  const cands = battle.allies().filter((u) => u.alive && u.deployed);
  const near = cands.length ? battle.rng.pick(cands) : null;
  const r = near ? Math.round(near.tileR) : Math.round(e.y);
  const c = near ? Math.max(0, Math.min(20, Math.round(near.tileC) + 1)) : Math.max(0, Math.round(e.x) - 1);
  battle.spawnEnemy(SUMMON_XIA, { pos: [r, c], ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
  battle.fx('summon', { x: c, y: r, id: e.id, key: SUMMON_XIA, n: 1 });
}

// ---------------------------------------------------------------------------------------------------------------
// 第 20 回合的五名·重构首领（“不死的黑蛇” / 奎隆 / 伊莎玛拉 / 玻利瓦尔 / 朔壳）
//
// 这五只在引擎里都没有 kit（记录来自 workshop/enemy-ext）—— 本包按记录 + 业主给的重构增量补上能实现的那一半：
//   * 黑蛇：点燃 15 s / 引爆 20 s（记录里已改），攻击真实伤害、烈焚灼息、引爆、击倒后的全场火与狂暴（本包代码）
//   * 奎隆：惩五戒冷却 −50%（记录），普通攻击 3 连击（本包代码）；「仅保留无忧觉阶段」在没有 kit 的引擎里无阶段可删
//   * 伊莎玛拉：初始生命 ×1.5、变身倍率 →100%（记录），治疗 3 名 + 30 s 变身（本包代码）
//   * 玻利瓦尔：技能只留灾厄形态的 Fire（记录）；「灾厄之口」的打断条件需要那套技能，引擎没有 ⇒ 见 README
//   * 朔壳：暴武闪避 75%（记录），非阻挡者的物理/法术伤害按概率闪避（本包代码）；溯律/宿傲/敛傲不实现
//
// 首领回合的**预选替换**在 reconTrials.js 的 reconBossWaveFor（把波次里 tag:'boss' 的那条 spawn 换成候选 key），
// 本段只挂这五只的战场机制。

const BOSS_BSNAKE = 'enemy_ws_recon_bsnake';
const BOSS_SKZJKL = 'enemy_ws_recon_skzjkl';
const BOSS_SYSKAD = 'enemy_ws_recon_syskad';
const BOSS_SHCHMR = 'enemy_ws_recon_shchmr';
const BOSS_DYCYUE = 'enemy_ws_recon_dycyue';

/** 黑蛇：点燃 / 引爆的固定周期（记录里已按重构减半之类改过；这里直接读记录）。 */
const BSNAKE_FIRE_DURATION = 30.5;
/** 伊莎玛拉：变身前的充能时长 [ASSUMED]（官方由“伊莎玛拉之泪”充能，本模式没有那套召唤物）。 */
const SYSKAD_TRANSFORM_AT = 30;
const SYSKAD_HEAL_TARGETS = 3;

/** 20 回合首领的战场便签。 */
function bossStore20(battle) {
  return S.battleStore(battle, BOSS_STORE + ':r20', () => ({ bsnake: new Map(), syskad: new Map() }));
}

/** 黑蛇的烈焚灼息：每秒真实伤害，30 s 内从 50 递增到 230（与塔露拉同一条读法）。 */
function applyBsnameFire(battle, e, target) {
  if (!target || !target.alive || target.findBuff('recon:bsnake_fire')) return;
  const base = talentOf(e, 'fire.attack@dragon_fire.baseDamage', 50);
  const addOn = talentOf(e, 'fire.attack@dragon_fire.addOnDamage', 180);
  const addOnDur = Math.max(1, talentOf(e, 'fire.attack@dragon_fire.addOnDuration', 30));
  let elapsed = 0;
  battle.addBuff(target, {
    key: 'recon:bsnake_fire', duration: talentOf(e, 'fire.attack@dragon_fire.duration', BSNAKE_FIRE_DURATION),
    visible: true, source: e, interval: 1,
    onTick: ({ battle: b, unit }) => {
      elapsed += 1;
      b.dealDamage(e.alive ? e : null, unit, { amount: base + addOn * Math.min(1, elapsed / addOnDur), type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    },
  });
}

/**
 * 19. “不死的黑蛇”·重构
 * 记录已改：点燃 19→15 s、引爆 35→20 s。本包补：普通攻击真实伤害、攻击附带烈焚灼息、周期对 2 名我方施加、
 * 引爆（目标 + 四格，法术）与击倒后的全场火 + 狂暴（生命 50% / 攻击 +50%）。
 */
function installBsname(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_BSNAKE) return;
    ensureKitShell(e).atkType = 'true'; // 「攻击造成真实伤害」
    const st = bossStore20(battle);
    st.bsnake.set(e, { ignite: icdOf(skillOf(e, 'Ignite')), explode: icdOf(skillOf(e, 'DragonFireExplode')), reborn: false });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_BSNAKE || c.isSkill) return;
    for (const t of c.targets || []) applyBsnameFire(battle, a, t);
  });
  battle.on('tick', (c) => {
    const st = bossStore20(battle);
    if (!st.bsnake.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.bsnake) {
      if (!e.alive) { st.bsnake.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      s.ignite -= dt;
      if (s.ignite <= 1e-9) {
        s.ignite = (skillOf(e, 'Ignite') || {}).cooldown || 15;
        const free = battle.allies().filter((u) => u.alive && !u.hidden && !u.findBuff('recon:bsnake_fire'));
        for (const u of battle.rng.pick(free.length ? free : battle.allies().filter((x) => x.alive)) ? [] : []) void u; // no-op guard
        const picks = [];
        while (picks.length < 2 && free.length) picks.push(...free.splice(battle.rng.int ? battle.rng.int(free.length) : 0, 1));
        for (const u of picks) applyBsnameFire(battle, e, u);
      }
      s.explode -= dt;
      if (s.explode <= 1e-9) {
        const sk = skillOf(e, 'DragonFireExplode');
        s.explode = (sk && sk.cooldown) || 20;
        const scale = skNum(sk, 'atk_scale', 1);
        for (const u of battle.allies()) {
          if (!u.alive || !u.findBuff('recon:bsnake_fire')) continue;
          battle.fx('explode', { x: u.x, y: u.y, r: 1, kind: 'bsnakeFire' });
          for (const o of alliesInBox(battle, u.tileR, u.tileC, 1)) {
            battle.dealDamage(e, o, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            if (o.alive) applyBsnameFire(battle, e, o);
          }
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_BSNAKE) return;
    const s = bossStore20(battle).bsnake.get(e);
    if (!s || s.reborn) return;
    s.reborn = true;
    const hpRatio = talentOf(e, 'reborn.max_hp', 0.5);
    const atkUp = talentOf(e, 'reborn.atk', 0.5);
    const dur = Math.max(0.1, talentOf(e, 'reborn.duration', 5));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    for (const u of battle.allies()) {
      battle.dealDamage(e, u, { amount: e.s.atk * 3, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    }
    battle.fx('explode', { x: e.x, y: e.y, r: 12, kind: 'bsnakeRage', id: e.id });
    battle.addBuff(e, {
      key: 'recon:bsnake_reborn', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        e.profile.noAttack = false;
        e.hp = e.s.maxHp * hpRatio;
        e.atkCd = 0;
        if (atkUp) b.addBuff(e, { key: 'recon:bsnake_rage', persist: true, visible: true, mods: { atkPct: atkUp } });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
  });
}

/** 20. 奎隆：普通攻击 3 连击（另外两条记录里：惩五戒冷却 −50%）。 */
function installSkzjkl(battle) {
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_SKZJKL || c.isSkill) return;
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      for (let i = 0; i < 2 && t.alive; i++) {
        battle.dealDamage(a, t, { amount: a.s.atk, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
      }
    }
  });
}

/**
 * 21. 伊莎玛拉，腐化之心：记录里初始生命 ×1.5、变身倍率全部 →100%。
 * 本包补：普通攻击治疗 3 名敌方单位（图鉴）；30 s 后变身（同时攻击 3 个目标、真实伤害）。
 */
function installSyskad(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SYSKAD) return;
    bossStore20(battle).syskad.set(e, { heal: e.s.bat, transform: SYSKAD_TRANSFORM_AT, form2: false });
  });
  battle.on('tick', (c) => {
    const st = bossStore20(battle);
    if (!st.syskad.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.syskad) {
      if (!e.alive) { st.syskad.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      if (!s.form2) {
        s.heal -= dt;
        if (s.heal <= 1e-9) {
          s.heal = e.s.bat;
          const wounded = battle.enemies.filter((o) => o.alive && o.hp < o.s.maxHp)
            .sort((a, b) => a.hpRatio - b.hpRatio).slice(0, SYSKAD_HEAL_TARGETS);
          for (const o of wounded) {
            const healed = battle.heal(e, o, e.s.atk);
            if (healed > 0) { o.markDirty(); battle.fx('heal', { x: o.x, y: o.y, id: o.id }); }
          }
        }
        s.transform -= dt;
        if (s.transform <= 1e-9) {
          s.form2 = true;
          e.profile.dmgType = 'true';
          e.base.dmgType = 'true';
          e.profile.maxTargets = 3;
          battle.fx('phase', { x: e.x, y: e.y, id: e.id, ...FORM2 });
        }
      }
    }
  });
}

/** 23. 朔壳：暴武 —— 非自身阻挡单位的物理 / 法术伤害有 75% 概率闪避（记录里的 MasterBlcok.prob）。 */
function installDycyue(battle) {
  battle.on('hit', (c) => {
    const t = c && c.target, s = c && c.source, dmg = c && c.dmg;
    if (!t || t.defId !== BOSS_DYCYUE || !s || !dmg || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
    if (s === t.blockedBy) return;
    if (battle.rng.chance(talentOf(t, 'MasterBlcok.prob', 0.75))) {
      dmg.cancel = true;
      battle.fx('dodge', { x: t.x, y: t.y, id: t.id });
    }
  });
}

/** 十一个·重构首领的机制：与预重构的选择无关，只看场上有没有这些 key，所以无条件挂上。 */
function installReconBosses(battle) {
  installSkulsr(battle);
  installLslime(battle);
  installCqbw(battle);
  installMdrock(battle);
  installDemonk(battle);
  installMephi(battle);
  installFaust(battle);
  installBlkswb(battle);
  installTalula(battle);
  installFrstar(battle);
  installPatrt(battle);
  installReid(battle);
  installMirbst(battle);
  installMandra(battle);
  installBldkgt(battle);
  installMorphis(battle);
  installDirctr(battle);
  installDywqgs(battle);
  installBsname(battle);
  installSkzjkl(battle);
  installSyskad(battle);
  installDycyue(battle);
}

/** 供测试与诊断：本模块叠加的全部·重构首领 key（一条真相）。 */
export const RECON_BOSS_KEYS = Object.freeze({
  skulsr: BOSS_SKULSR, lslime: BOSS_LSLIME, cqbw: BOSS_CQBW, mdrock: BOSS_MDROCK, demonk: BOSS_DEMONK,
  mephi: BOSS_MEPHI, faust: BOSS_FAUST, blkswb: BOSS_BLKSWB,
  talula: BOSS_TALULA, frstar2: BOSS_FRSTAR2, patrt: BOSS_PATRT, reid: BOSS_REID, mirbst: BOSS_MIRBST,
  mandra: BOSS_MANDRA, bldkgt: BOSS_BLDKGT, morphis: BOSS_MORPHIS, dirctr: BOSS_DIRCTR, dywqgs: BOSS_DYWQGS,
  bsnake: BOSS_BSNAKE, skzjkl: BOSS_SKZJKL, syskad: BOSS_SYSKAD, shchmr: BOSS_SHCHMR, dycyue: BOSS_DYCYUE,
  bldbld: SUMMON_BLDBLD, xia: SUMMON_XIA,
});

/** 供测试与诊断：第 8 回合那三只的机制数值、宿主池与两条官方 kit 的常数（一条真相）。 */
export const RECON_BOSS_RULES = Object.freeze({
  HOST_KEYS, MEPHI_INTERVAL, MEPHI_PER_TICK, MEPHI_AVENGE, FAUST_SPLASH_SCALE, BLKSWB_FREEZE_PROB, FREEZE_DURATION,
  MEPHI_HEAL_TARGETS, AURA_REFRESH, MEPHI_AURA_KEY, FAUST_INV_KEY, FAUST_BLOCKFREE_KEY,
  TALULA_RANGE_BONUS, TALULA_BURN_SCALE, REID_BAT_STEP, REID_BAT_CAP,
  MIRBST_CRAZY_HP, MIRBST_CRAZY_DURATION, MIRBST_PHASE2_HEAL, PATRT_AURA_RADIUS, PATRT_RAGE_RANGE,
  BLDKGT_REVIVE_DURATION, MORPHIS_LINE_TICK, MORPHIS_MOUNT_DURATION, DIRCTR_BURST_DELAY, WANG_XIA_INTERVAL,
  BSNAKE_FIRE_DURATION, SYSKAD_TRANSFORM_AT, SYSKAD_HEAL_TARGETS,
});


