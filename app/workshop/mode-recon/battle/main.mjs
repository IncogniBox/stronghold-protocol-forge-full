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
// ·重构 首领（现存 7 个：第 4 回合 5 个 + 第 8 回合的锏 + 第 12 回合的“复仇者”）—— 数据在
// `workshop/mode-recon/enemies.json`
//
// 每个「·重构」都是官方首领的**变体**：`enemies.json` 里那条记录逐字照抄官方记录（第 8 回合的 大亚当 取自官方
// enemy_database，因为 data/enemies.json 没有它），只把 `name` 加上「·重构」、`abilities` 追加一行【重构】，并
// （W 与没有引擎 kit 的那几只除外）写上 `effectRef` = 官方 key。引擎取 kit 时读的是
//   `const kit = KITS[e.def.raw?.effectRef ?? e.defId];`   （server/sim/content/enemies.js:176）
// 而 `e.def.raw` 就是那条记录（simdata.js:304 `raw: e`）—— 所以一条带 `effectRef` 的工坊怪物记录**免费继承官方首领
// 的整套 kit**，本包只是往上**叠加**。这是本包零引擎改动做出「·重构」首领的唯一通道。
//
// **哪些是数据、哪些是本包代码**：
//   * 大亚当·重构          **纯数据**：记录里把 maxHp ×2、atk ×1.5（`be`/`attrPower` 随之重算）；没有任何引擎 kit
//                          可继承（`enemy_1001_bigbo` 在 STATS_ONLY、`_2` 更不在表里）⇒ **不写 effectRef**，也没有本包代码。
//   * 自在·重构            **纯数据**：`ShieldBurst` / `ShieldBurstReborn` 的 `bb.duration`（破桎而出的蓄力时间）÷2、
//                          `bb.dynamic`（屏障可吸收的伤害数值）×2 —— kitXi 直接读这两个 bb（leaders.js:469-479）。
//   * 杰斯顿·威廉姆斯·重构 **纯数据**：`ironsandstorm.bb.stun` 3→6、`armorpiercing.bb.def_penetrate` 0.6→1.0 ——
//                          kitWarden 读这两个 bb（leaders.js:419/441）。
//   * 锏·重构              数据（`skills[].cooldown` 全部 ÷2，kitMace 读 `cd`）+ 本包代码（攻击 10% 冻结）。
//
// W·重构 是第 4 回合的例外：官方 W 的 kit（content/enemies/leaders.js:126-138）把 C4 的目标数硬编码成
// `n = hpRatio < 0.5 ? 2 : 1`，而「不许改引擎」意味着那一行动不了。于是 W·重构 **不写 effectRef**、C4 整个由本包实现
// （官方 W 的 kit 里只有 C4，所以没有别的东西会丢）；记录里把 C4 的 `cooldown` 减半（`initCooldown` 不动），本包读那个
// 数当自己的计时器。
//
// 已移除（等重新制作）：梅菲斯特 / 浮士德 / 塔露拉 / 霜星“冬痕” / 爱国者 / 狂躁异质裂兽 / 蔓德拉 / 血骑士 /
// 莫菲丝 / “酒神” / “望” / “不死的黑蛇” / 奎隆 / 伊莎玛拉 / 玻利瓦尔 / 朔壳 —— 共 16 只。
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

// 第 8 回合的锏·重构（数据 + 本包代码；大亚当 / 自在 / 杰斯顿·威廉姆斯 三只纯数据改动，没有本包的代码）
const BOSS_BLKSWB = 'enemy_ws_recon_blkswb';

/** 泥岩巨像（data/enemies.json）：泥岩·重构「首次跌破半血」时召唤的那一只（普通单位，不是 part/boss tag）。 */
const MDGINT_KEY = 'enemy_1092_mdgint';

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

/** 战场便签：W 的 C4 计时器（每只 W 一条）、泥岩·重构 的「已召唤」标记、“复仇者”·重构 的攻击间隔叠层（每只一条）。 */
function bossStore(battle) {
  return S.battleStore(battle, BOSS_STORE, () => ({
    c4: new Map(), summoned: new WeakSet(), reid: new Map(),
  }));
}

/** 敌人能否行动：与引擎 helpers.js canCast 同口径（活着、在场、不晕、不因沉默封技能、不在失衡里）。 */
function canAct(battle, e) {
  return !!(e && e.alive && !e.hidden && !e.s.flags.stun && !e.s.flags.silence && !(battle.time < e.unbalanceUntil - 1e-9));
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

/**
 * `['cast', id, slot]`（引擎 `content/enemies/helpers.js` castSlot 的包侧版本）：本包自实现的技能开火时给客户端一个
 * **官方特效窗口**（display only —— 不改任何战斗状态、不掷随机；slot = 该 prefabKey 在记录 skills[] 里的下标，与引擎
 * helpers.js:95 的口径一字不差）。`battle._ev` 是 sim 的事件总线（damage.js:434 同一条）；golden 不含 recon 对局。
 */
function castSkill(battle, e, sk) {
  if (!battle || !e || !sk || sk.prefabKey == null) return;
  const list = e.def && e.def.raw && Array.isArray(e.def.raw.skills) ? e.def.raw.skills : [];
  const at = list.findIndex((x) => x && x.prefabKey === sk.prefabKey);
  if (at < 0) return;
  // cast 窗口 = 技能时长（bb.duration）；没有时长就交给客户端的 ENEMY_GRACE 处理。
  const d = sk.bb && typeof sk.bb.duration === 'number' && sk.bb.duration > 0 ? Math.round(sk.bb.duration * 100) / 100 : 0;
  battle._ev(d > 0 ? ['cast', e.id, at, d] : ['cast', e.id, at]);
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
      castSkill(battle, e, sk);
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
// 第 12 回合的·重构首领（“复仇者”）
//
// 塔露拉 / 霜星“冬痕” / 爱国者 / 狂躁异质裂兽 四只的重构版已整体移除，等重新制作；“复仇者”保留。
// “复仇者”在引擎的 KITS 里（server/sim/content/enemies/leaders.js:213），官方 kit 由 effectRef 继承，本包只叠加
// 重构增量（每次攻击后攻击间隔 −5%，可叠加到 −90%）。
const BOSS_REID = 'enemy_ws_recon_reid';

/** “复仇者”·重构：每次攻击 batPct −5%，全部叠加的下限 −90%（units.js:7 的 ΣbatPct 下限同值）。 */
const REID_BAT_STEP = 0.05;
const REID_BAT_CAP = 0.9;

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
// ---------------------------------------------------------------------------------------------------------------

/** 保留的·重构首领的机制：与预重构的选择无关，只看场上有没有这些 key，所以无条件挂上。 */
function installReconBosses(battle) {
  installSkulsr(battle);
  installLslime(battle);
  installCqbw(battle);
  installMdrock(battle);
  installDemonk(battle);
  installBlkswb(battle);
  installReid(battle);
}

/** 供测试与诊断：本模块叠加的全部·重构首领 key（一条真相）。 */
export const RECON_BOSS_KEYS = Object.freeze({
  skulsr: BOSS_SKULSR, lslime: BOSS_LSLIME, cqbw: BOSS_CQBW, mdrock: BOSS_MDROCK, demonk: BOSS_DEMONK,
  blkswb: BOSS_BLKSWB, reid: BOSS_REID,
});

/** 供测试与诊断：保留首领的机制数值（一条真相）。 */
export const RECON_BOSS_RULES = Object.freeze({
  BLKSWB_FREEZE_PROB, FREEZE_DURATION, REID_BAT_STEP, REID_BAT_CAP,
});

