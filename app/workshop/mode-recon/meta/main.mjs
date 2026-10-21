// workshop/mode-recon/meta/main.mjs — 重构模拟的**对局元载荷**（`pack.json.server.meta`，DESIGN §29）。
// (i18n-ignore-file: 本模块的说明文字是给作者/引擎读的契约注释，不是客户端界面文案)
//
// 预重构阶段（PHASE.PRE_RECON）交上来的两项选择在这里落地 —— 那是**这一局**属于这名玩家的规则，不是一件装备、
// 一条盟约或一个特质，所以挂在一个 `global:` 处理器上（它拿到每一名玩家的每一个钩子），而不是挂在某个 id 上。
//
// 六条规则（文案由业主给定，数值逐字照抄）：
//   重构协助（全局增益，单选）：
//     recon_assist_bond  盟约重构 —— <修整期结束时>已激活层数最高的核心/附加/故事集盟约各 +10 层      → onPrepEnd
//     recon_assist_equip 装备重构 —— 每回合前 3 次销毁装备时，获得 1 件不低于该装备阶级的随机装备        → onDestroy
//     recon_assist_data  数据重构 —— 场上干员基础攻/防/生命上限 +25%、法术抗性 +25                    → 战斗侧（battle/main.mjs）
//   熔芯负载（全局减益，单选）：
//     recon_load_bond    盟约负载 —— 三类中最高层的盟约每层使敌人生命上限 +0.1%                        → 战斗侧
//     recon_load_equip   装备负载 —— 未携带装备伤害 -25%；装备阶级高于携带者时该装备效果 -50%、3 回合后销毁 → 本模块 + 战斗侧
//     recon_load_data    数据负载 —— 敌人基础攻/防/生命上限 +25%、法术抗性 +25                          → 战斗侧
//
// 两条通道：
//   * **选择怎么到战斗侧**：本模块在回合开始时把选择物化成一条 EffectRef（`ctx.addEffect`，`battle: true`、`hidden: true`）。
//     `PlayerState.battleInput()` 会把 `battle !== false` 的效果按 `playerEffects` 交给每一份 BattleSpec，战斗侧据此生效
//     （`server/sim/content/choices.js` 读 `choice:<effectId>` 是同一套做法）。`hidden` 只为不让这条技术性条目出现在
//     玩家的「效果」列表里（那两个选项本身已经在预重构屏上写清楚了），它不影响 battle 那一份。
//     **为什么不是 `onRoundStart` 里现算**：`ctx.recon()` 读的是 `Match.reconChoices`（预重构阶段落的账），回合开始时它已经定了。
//   * **装备负载的倒计时**：按 item uid 记一个「到期回合」的玩家级 counter（`recon.doom.<uid>`），回合开始时扫一遍
//     在身上的装备 —— 到期就 `ctx.destroyItem`（引擎新加的那一格，能销毁**已装备**的装备），仍然「阶级高于携带者」
//     就补记一次，条件不再成立就清掉。豁免的两件（源石辅助仪 = 哥伦比亚包的 `chess_item_6_13_e`、变形同构体 =
//     `chess_item_6_09_e`）不参与。
//
// 纪律：**只用 `ctx`**（meta 模块只许 import 包内相对文件），counter 键一律带 `recon.` 前缀（同名键会与别的包撞车）。

/** 选择物化出来的 EffectRef id / key（战斗侧按 key 认这一条 —— 两处必须是同一个字符串）。 */
const EFFECT_ID = 'recon_protocol';
const EFFECT_KEY = `effect:${EFFECT_ID}`;

/** 六个选项 id（与 `public/js/screens/preRecon.js` 的两张表、`shared/protocol.js` 的 g.reconChoice 同一个命名空间）。 */
const ASSIST_BOND = 'recon_assist_bond';
const ASSIST_EQUIP = 'recon_assist_equip';
const LOAD_BOND = 'recon_load_bond';
const LOAD_EQUIP = 'recon_load_equip';

/** 数值（业主给定，逐字照抄）。 */
const BOND_ASSIST_LAYERS = 10;
const ASSIST_DESTROYS_PER_ROUND = 3;
const LOAD_EQUIP_ROUNDS = 3;

/** 盟约负载的层数口径与盟约重构同一条：三类各取「已激活且层数最高」的那一条。 */
const BOND_KINDS = Object.freeze(['core', 'addon', 'story']);
const SIDE_STORY = 'SIDE_STORY';

/**
 * 装备负载「3 回合后自动销毁」的豁免：源石辅助仪（工坊包 columbia 的装备）与变形同构体（官方）。
 * 比的是 **itemKey**（没有 `_a` / `_b` 后缀的那种写法，与引擎 `itemKeyOf` 同一套）。
 */
const LOAD_EQUIP_EXEMPT = Object.freeze(['chess_item_6_13_e', 'chess_item_6_09_e']);

/** counter 键：本包自己的命名空间（对的，就是 `recon.` 前缀 —— 撞键会让两条规则互相看到对方的数）。 */
const KILL_ROUND = 'recon.destroy.round';
const KILL_COUNT = 'recon.destroy.count';
const doomKey = (uid) => `recon.doom.${uid}`;

/** itemKey：记录的 `effectRef` 优先，再去掉 `_a` / `_b` 后缀（引擎 `support/index.js itemKeyOf` 同一套）。 */
const itemKeyOf = (rec, id) => String((rec && rec.effectRef) || id || '').replace(/_[ab]$/, '');

/** 这名玩家这一局的预重构选择（`ctx.recon()`；非该模式 / 没交过 = null）。 */
const choiceOf = (ctx) => (typeof ctx.recon === 'function' ? ctx.recon() : null);

/** 盟约按 isCore / bondType 分三类（与预重构屏的候选池同一条口径）。 */
function kindOf(rec) {
  if (!rec) return null;
  if (rec.isCore === true) return 'core';
  return rec.bondType === SIDE_STORY ? 'story' : 'addon';
}

/**
 * 三类里各取「已激活且层数最高」的那一条的层数（没激活 / 一层都没有的一类算 0）。
 * @returns {{ core: number, addon: number, story: number }}
 */
function topLayersByKind(ctx) {
  const out = { core: 0, addon: 0, story: 0 };
  const bonds = ctx.bonds();
  for (const bondId of Object.keys(bonds)) {
    if (!ctx.bondActive(bondId)) continue;
    const kind = kindOf(ctx.gd.bond(bondId));
    if (!kind) continue;
    const layers = ctx.layers(bondId);
    if (layers > out[kind]) out[kind] = layers;
  }
  return out;
}

/** 身上带装备的那些棋子（棋盘 + 手牌 + 临时整备区）。 */
function holders(ctx) {
  const out = [];
  for (const list of [ctx.board(), ctx.hand(), ctx.temp()]) {
    for (const p of list) if (p && p.kind === 'chess' && Array.isArray(p.items) && p.items.length) out.push(p);
  }
  return out;
}

/** 把这一局的选择写成一条 battle EffectRef（`addEffect` 按 id 覆盖，所以每回合重写是幂等的）。 */
function publishChoice(ctx) {
  const c = choiceOf(ctx);
  const assist = c && typeof c.assist === 'string' ? c.assist : null;
  const load = c && typeof c.load === 'string' ? c.load : null;
  if (!assist && !load) { ctx.removeEffect(EFFECT_ID); return; }
  ctx.addEffect({ id: EFFECT_ID, key: EFFECT_KEY, hidden: true, battle: true, params: { assist, load } });
}

/**
 * 盟约重构（`<修整期结束时>`）：三类盟约各 +10 层，只加**已经激活**的那一条（`requireActive`，与官方
 * 「使已激活的…」同一条口径）。
 */
function bondAssist(ctx) {
  const c = choiceOf(ctx);
  if (!c || c.assist !== ASSIST_BOND) return;
  const top = topLayersByKind(ctx);
  for (const kind of BOND_KINDS) {
    if (top[kind] <= 0) continue;
    const bondId = topBondId(ctx, kind);
    if (bondId) ctx.addLayers(bondId, BOND_ASSIST_LAYERS, { requireActive: true });
  }
}

/** 某一类里「已激活且层数最高」的那一条盟约 id（并列时让步给先读到的那一条 —— 同一批数据、同一个顺序）。 */
function topBondId(ctx, kind) {
  let best = null;
  for (const bondId of Object.keys(ctx.bonds())) {
    if (!ctx.bondActive(bondId)) continue;
    if (kindOf(ctx.gd.bond(bondId)) !== kind) continue;
    const layers = ctx.layers(bondId);
    if (layers <= 0) continue;
    if (!best || layers > best.layers) best = { bondId, layers };
  }
  return best ? best.bondId : null;
}

/**
 * 装备重构：每回合**前 3 次**销毁装备时，补一件**不低于被销毁装备阶级**的随机装备。
 *
 * 只数 `itemType === 'EQUIP'` 的装备（法术不是装备）；被顶替掉的那一件也走 `onDestroy`，所以同样算数。
 */
function destroyAssist(ctx, ev) {
  const c = choiceOf(ctx);
  if (!c || c.assist !== ASSIST_EQUIP) return;
  const rec = ev && ev.item ? ctx.gd.item(ev.item.id) : null;
  if (!rec || rec.itemType !== 'EQUIP') return;
  // 每回合的计数器：round 变了就归零（counter 是玩家级、跨回合持久的，所以把「哪一回合」也记下来）
  if (ctx.counter(KILL_ROUND) !== ctx.round) {
    ctx.setCounter(KILL_ROUND, ctx.round);
    ctx.setCounter(KILL_COUNT, 0);
  }
  if (ctx.counter(KILL_COUNT) >= ASSIST_DESTROYS_PER_ROUND) return;
  ctx.incCounter(KILL_COUNT);
  const tier = Number.isInteger(rec.tier) && rec.tier > 0 ? rec.tier : 1;
  const id = ctx.rollItem({ minTier: tier });
  if (id) ctx.grantItem(id);
}

/**
 * 装备负载的两件事，每回合开始时各扫一遍（`onEquip` 也调一次，装上就进倒计时，不必等到下一个回合）：
 *   * 到期（到点的 `recon.doom.<uid>`）→ `ctx.destroyItem`（能销毁已装备的装备）；
 *   * 仍然「装备阶级 > 携带者阶级」→ 记下「三回合后到期」；条件不再成立（被卸下 / 换了人 / 销毁了）→ 清掉。
 */
function syncLoadDoom(ctx) {
  const c = choiceOf(ctx);
  if (!c || c.load !== LOAD_EQUIP) return;
  for (const holder of holders(ctx)) {
    const tier = Number.isInteger(holder.tier) ? holder.tier : 0;
    for (const it of holder.items) {
      const rec = ctx.gd.item(it.id);
      if (!rec || rec.itemType !== 'EQUIP') continue;
      const key = doomKey(it.uid);
      if (LOAD_EQUIP_EXEMPT.includes(itemKeyOf(rec, it.id)) || !(Number(rec.tier) > tier)) { ctx.setCounter(key, 0); continue; }
      const due = ctx.counter(key);
      if (due > 0 && ctx.round >= due) {
        ctx.setCounter(key, 0);
        ctx.destroyItem(it.uid, { reason: 'recon_load' });
        continue;
      }
      if (due <= 0) ctx.setCounter(key, ctx.round + LOAD_EQUIP_ROUNDS);
    }
  }
}

/** 玩家交上来的选择只在这一局有效：这里注册的是**这一局**注册表上的处理器（`registerMeta(registry)`，DESIGN §29.3）。 */
export function registerMeta(registry) {
  registry.global('recon', {
    onRoundStart(ctx) {
      publishChoice(ctx);
      syncLoadDoom(ctx);
    },
    onPrepEnd(ctx) {
      bondAssist(ctx);
    },
    onEquip(ctx) {
      syncLoadDoom(ctx);
    },
    onDestroy(ctx, ev) {
      destroyAssist(ctx, ev);
    },
  });
}

/** 供测试与诊断：本模块认的六个选项 id 与三条数值（一条真相，测试按它们断言）。 */
export const RECON_RULES = Object.freeze({
  EFFECT_ID, EFFECT_KEY, ASSIST_BOND, ASSIST_EQUIP, LOAD_BOND, LOAD_EQUIP,
  BOND_ASSIST_LAYERS, ASSIST_DESTROYS_PER_ROUND, LOAD_EQUIP_ROUNDS, LOAD_EQUIP_EXEMPT,
});
