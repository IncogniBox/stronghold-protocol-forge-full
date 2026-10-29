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
/**
 * 装备重构的**玩家级拆卸许可**（另一条技术性 ref）：引擎 `PlayerState.unequip` 认 `effects[].unequip === true`
 * （`server/match/player/items.js playerUnequipAllowed`）。整间房不开 `unequip: "allow"`，只给选了这一项的人。
 */
const UNEQUIP_EFFECT_ID = 'recon_unequip';

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

// ---------------------------------------------------------------------------------------------------------------
// 重构决策（业主 2026-10-28）：每回合休整期开始时，每名玩家**自己**抽 3 个候选、选 1 个（不共享）。候选池在包
// `choices.json` 的 `reconDecisions.rounds[<回合>]`；选中后写一条常驻效果（效果列表里和策略一样列出来），
// 战斗侧的攻势 / 守备 / 削弱由 `battle/main.mjs` 从 `playerEffects` 读；资金 / 复苏 / 盟约在这里落地。
// 数值由业主给定，逐字照抄。之后回合的池子补进 `rounds` 即可，不需要改引擎。
// ---------------------------------------------------------------------------------------------------------------

/** 池子的数据键与效果条目的 id 前缀（战斗侧按 `effect:recon_decision` 这个 key 认）。 */
const DECISION_DATA_KEY = 'reconDecisions';
const DECISION_EFFECT_PREFIX = 'recon.dec.';
const DECISION_BATTLE_KEY = 'effect:recon_decision';

/** R1 的六条（id 即接口；后续回合的池子在 `choices.json` 里补）。 */
const DECISION_FUNDS = 'recon_decision_funds';
const DECISION_ASSAULT = 'recon_decision_assault';
const DECISION_BOND = 'recon_decision_bond';
const DECISION_GUARD = 'recon_decision_guard';
const DECISION_REVIVE = 'recon_decision_revive';
const DECISION_WEAKEN = 'recon_decision_weaken';

const DECISION_FUNDS_GAIN = 2;
const DECISION_LP_GAIN = 3;
const DECISION_BOND_LAYERS = 3;
const DECISION_BOND_PER_ROUND = 10;

/** 已选决策的玩家级计数器（跨回合持久，所以同一条不会再被抽到）。 */
const chosenKey = (id) => `recon.dec.chosen.${id}`;
const BOND_DECISION_ROUND = 'recon.dec.bond.round';
const BOND_DECISION_COUNT = 'recon.dec.bond.count';
const BOND_DECISION_MATCH = 'recon.dec.bond.match';

/** 这一回合这名玩家还能选的决策（没有池子 / 非重构对局 ⇒ 空）。 */
function decisionsForRound(ctx) {
  if (!ctx.gd || ctx.gd.isRecon !== true) return [];
  const rec = ctx.gd.choices && ctx.gd.choices[DECISION_DATA_KEY];
  const rounds = rec && rec.rounds && typeof rec.rounds === 'object' ? rec.rounds : null;
  const pool = rounds && Array.isArray(rounds[String(ctx.round)]) ? rounds[String(ctx.round)] : null;
  if (!pool) return [];
  const out = [];
  const seen = new Set();
  for (const d of pool) {
    if (!d || typeof d.id !== 'string' || seen.has(d.id) || ctx.counter(chosenKey(d.id)) > 0) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/** 休整期开始：有池子就给这名玩家一次 3 选 1（引擎洗牌；已有别的私密选择时它会拒绝，这里不处理）。 */
function offerDecision(ctx) {
  const pool = decisionsForRound(ctx);
  if (!pool.length) return;
  ctx.offerReconDecision(pool);
}

/** 所有回合池子里的决策记录（id → card，供按已选 id 读它们的效果参数）。 */
function decisionCatalog(ctx) {
  const rec = ctx.gd.choices && ctx.gd.choices[DECISION_DATA_KEY];
  const rounds = rec && rec.rounds && typeof rec.rounds === 'object' ? rec.rounds : {};
  const out = new Map();
  for (const list of Object.values(rounds)) {
    if (!Array.isArray(list)) continue;
    for (const c of list) if (c && typeof c.id === 'string' && !out.has(c.id)) out.set(c.id, c);
  }
  return out;
}

/** 这名玩家已经选过的决策记录。 */
function chosenDecisions(ctx) {
  const out = [];
  for (const [id, card] of decisionCatalog(ctx)) if (ctx.counter(chosenKey(id)) > 0) out.push(card);
  return out;
}

/**
 * 选中的一条：记下来（不再抽到）+ 常驻效果条目（战斗侧带 key/params）+ 立刻生效的部分。
 * 效果参数全写在数据里（`meta.funds / meta.lp / meta.bondLayers`，`battle.ally / battle.enemy` 的原样进战斗），
 * 所以**后续回合只补 `choices.json`**，这里与战斗侧都不必改。
 */
function applyDecision(ctx, card) {
  if (!card || typeof card.id !== 'string') return;
  ctx.setCounter(chosenKey(card.id), 1);
  const battle = card.battle && typeof card.battle === 'object' ? card.battle : null;
  ctx.addEffect({
    id: `${DECISION_EFFECT_PREFIX}${card.id}`,
    ...(battle ? { key: DECISION_BATTLE_KEY, battle: true, params: { id: card.id, ...battle } } : { battle: false }),
    name: card.name || card.id,
    desc: card.desc || '',
    iconKind: 'recon',
    iconId: card.id,
  });
  const meta = card.meta && typeof card.meta === 'object' ? card.meta : {};
  if (Number.isFinite(meta.funds)) ctx.addFunds(meta.funds);
  if (Number.isFinite(meta.lp)) ctx.addLp(meta.lp);
}

/** 资金类决策：选中的那一回合先给一次；之后每个回合开始的「进入休整期时」再给（`meta.fundsEachRound`）。 */
function decisionFunds(ctx) {
  let sum = 0;
  for (const card of chosenDecisions(ctx)) {
    const meta = card.meta && typeof card.meta === 'object' ? card.meta : {};
    if (meta.fundsEachRound === true && Number.isFinite(meta.funds)) sum += meta.funds;
  }
  if (sum) ctx.addFunds(sum);
}

/**
 * 盟约类决策：获得干员时，该干员身上的每条盟约加上已选决策的层数之和（无需激活），每回合最多 10 次。
 * `ctx.pieceBonds` 与引擎的 `pieceBonds` 同一条口径（含自选 / 补位解析）。
 */
function decisionBond(ctx, ev) {
  let layers = 0;
  let limit = DECISION_BOND_PER_ROUND;
  let matchScope = false;
  for (const card of chosenDecisions(ctx)) {
    const meta = card.meta && typeof card.meta === 'object' ? card.meta : {};
    if (Number.isFinite(meta.bondLayers) && meta.bondLayers > 0) layers += Math.floor(meta.bondLayers);
    if (meta.bondTriggerScope === 'match' && Number.isFinite(meta.bondTriggerLimit)) {
      matchScope = true;
      limit = Math.max(limit, Math.floor(meta.bondTriggerLimit));
    }
  }
  if (!layers) return;
  if (!matchScope && ctx.counter(BOND_DECISION_ROUND) !== ctx.round) {
    ctx.setCounter(BOND_DECISION_ROUND, ctx.round);
    ctx.setCounter(BOND_DECISION_COUNT, 0);
  }
  const counterKey = matchScope ? BOND_DECISION_MATCH : BOND_DECISION_COUNT;
  if (ctx.counter(counterKey) >= limit) return;
  const piece = ev && ev.piece;
  if (!piece || piece.kind !== 'chess') return;
  const bonds = ctx.pieceBonds(piece.uid, piece);
  if (!bonds || !bonds.length) return;
  for (const bondId of bonds) ctx.addLayers(bondId, layers, { requireActive: false, reason: 'recon_decision' });
  ctx.incCounter(counterKey);
}

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

/**
 * 把这一局的选择写成一条 battle EffectRef（`addEffect` 按 id 覆盖，所以每回合重写是幂等的）。
 * 装备重构另发一条**玩家级拆卸许可**（`unequip: true`）—— 它不进战斗，也不进效果列表；改选别的协助时要撤掉。
 */
function publishChoice(ctx) {
  const c = choiceOf(ctx);
  const assist = c && typeof c.assist === 'string' ? c.assist : null;
  const load = c && typeof c.load === 'string' ? c.load : null;
  if (assist === ASSIST_EQUIP) {
    ctx.addEffect({ id: UNEQUIP_EFFECT_ID, key: `effect:${UNEQUIP_EFFECT_ID}`, hidden: true, battle: false, unequip: true });
  } else {
    ctx.removeEffect(UNEQUIP_EFFECT_ID);
  }
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
    onPrepStart(ctx) {
      offerDecision(ctx);
    },
    onRoundStart(ctx) {
      publishChoice(ctx);
      syncLoadDoom(ctx);
      decisionFunds(ctx);
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
    onGain(ctx, ev) {
      decisionBond(ctx, ev);
    },
    onChoicePick(ctx, ev) {
      if (ev && ev.kind === 'recon') applyDecision(ctx, ev.card);
    },
  });
}

/** 供测试与诊断：本模块认的六个选项 id、三条数值与重构决策的接口（一条真相，测试按它们断言）。 */
export const RECON_RULES = Object.freeze({
  EFFECT_ID, EFFECT_KEY, UNEQUIP_EFFECT_ID, ASSIST_BOND, ASSIST_EQUIP, LOAD_BOND, LOAD_EQUIP,
  BOND_ASSIST_LAYERS, ASSIST_DESTROYS_PER_ROUND, LOAD_EQUIP_ROUNDS, LOAD_EQUIP_EXEMPT,
  DECISION_DATA_KEY, DECISION_EFFECT_PREFIX, DECISION_BATTLE_KEY,
  DECISION_FUNDS, DECISION_ASSAULT, DECISION_BOND, DECISION_GUARD, DECISION_REVIVE, DECISION_WEAKEN,
  DECISION_FUNDS_GAIN, DECISION_LP_GAIN, DECISION_BOND_LAYERS, DECISION_BOND_PER_ROUND,
});
