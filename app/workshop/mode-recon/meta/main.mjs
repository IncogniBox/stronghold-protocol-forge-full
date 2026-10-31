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
//   熔芯负载（全局减益，预重构屏上交的是**要排除的那一条**，另外两条同时生效 —— 业主 2026-10-30）：
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
const LOAD_DATA = 'recon_load_data';

/** 三条负载的 id：交上来的是「被排除的那一条」，本模块只做敌人看不见的那半（装备负载的倒计时）。 */
const LOAD_IDS = Object.freeze([LOAD_BOND, LOAD_EQUIP, LOAD_DATA]);

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
  // 装备负载生效 ⇔ 这一局交过三条之一、且交的不是它自己（预重构屏上的选择 = 要**排除**的那一条）
  if (!c || !LOAD_IDS.includes(c.load) || c.load === LOAD_EQUIP) return;
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

// ---------------------------------------------------------------------------------------------------------------
// 萨尔贡（业主 2026-10-30）：森蚺的黄沙罗盘与狮蝎的盟约之币 —— 两条都读**战斗 → 休整期的通用标记**
// （战斗侧 `battle/main.mjs` 的 `setBattleMark`：本场【萨尔贡】开启技能次数 / 战斗结束时持有隐匿的干员数）。
// 数值取特质记录自己的 `bb`（`casts` / `count` / `max`），所以改数据不必改这里。
// ---------------------------------------------------------------------------------------------------------------

/** 标记键（与 `battle/main.mjs` 同一份字符串）。 */
const MARK_SARGON_CASTS = 'reconSargonCasts';
const MARK_STEALTH_HOLDERS = 'reconStealthHolders';
/** 特质记录 id 前缀（`_a` 普通 / `_b` 精锐）。 */
const ZUMAMA_GARRISON = 'recon_garrison_zumama';
const MANTIC_GARRISON = 'recon_garrison_mantic';
/** 两件奖励（固定给件，`requirePool: false`：与 SERVER_GAIN_EQUIP 同一条，不占随机池的复制数）。 */
const COMPASS_ID = 'chess_item_6_07_e_a';
const COIN_ID = 'chess_item_1_03_e_a';

const intOf = (v, d = 0) => (Number.isFinite(v) ? Math.floor(v) : typeof v === 'string' && Number.isFinite(+v) ? Math.floor(+v) : d);

/** 棋盘上一名干员当前的特质记录 id（`ctx.garrisonsOf` 认 `pieceGarrisonIds` 的授予）。 */
function garrisonIdsOfPiece(ctx, p) {
  const list = typeof ctx.garrisonsOf === 'function' ? ctx.garrisonsOf(p.uid) : null;
  return Array.isArray(list) ? list.map((g) => g && g.garrisonId).filter(Boolean) : [];
}

/**
 * 休整期结算（`<进入休整期时>`）：
 *   * 森蚺：本场【萨尔贡】开启技能次数 ≥ `bb.casts` ⇒ 黄沙罗盘 `bb.count` 件（普通 1 / 精锐 2）；
 *   * 狮蝎：战斗结束时持有隐匿的干员数 ⇒ 最多 `bb.max` 件盟约之币（普通 2 / 精锐 4）。
 * 只在重构对局里跑（这些特质记录本身也只在重构模拟里出现）。
 */
function sargonPrepRewards(ctx) {
  if (!ctx.gd || ctx.gd.isRecon !== true) return;
  const take = (id, n) => { for (let i = 0; i < n; i++) ctx.grantItem(id, { requirePool: false }); };
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess' || p.uid == null) continue;
    for (const gid of garrisonIdsOfPiece(ctx, p)) {
      const elite = /_b$/.test(gid);
      if (gid === `${ZUMAMA_GARRISON}_a` || gid === `${ZUMAMA_GARRISON}_b`) {
        const bb = (ctx.gd.garrison(gid) || {}).bb || {};
        if (intOf(ctx.mark(MARK_SARGON_CASTS), 0) < intOf(bb.casts, 20)) continue;
        const n = Math.max(1, intOf(bb.count, elite ? 2 : 1));
        take(COMPASS_ID, n);
      } else if (gid === `${MANTIC_GARRISON}_a` || gid === `${MANTIC_GARRISON}_b`) {
        const bb = (ctx.gd.garrison(gid) || {}).bb || {};
        const n = Math.min(Math.max(0, intOf(ctx.mark(MARK_STEALTH_HOLDERS), 0)), Math.max(0, intOf(bb.max, elite ? 4 : 2)));
        if (n > 0) take(COIN_ID, n);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 维多利亚（业主 2026-10-30）：傀影的维式重锤 —— 读**战斗 → 休整期的通用标记**（战斗侧 `battle/main.mjs`
// 把「本场这名傀影的非移动部署次数」按玩家取最大值写进 `reconPhantomDeploys`）。
// 奖励从 `pool_equip_vict` 那四件「带随机效果」的维式重锤里当场抽（战栗 / 坚固 / 加速 / 灼燃），
// `requirePool: false`（与黄沙罗盘 / 盟约之币同一条：固定给件，不占随机池的复制数）。
// ---------------------------------------------------------------------------------------------------------------

/** 标记键（与 `battle/main.mjs` 同一份字符串）。 */
const MARK_PHATOM_DEPLOYS = 'reconPhantomDeploys';
/** 特质记录 id 前缀（`_a` 普通 / `_b` 精锐）。 */
const PHATOM_GARRISON = 'recon_garrison_phatom';
/** 四件带特殊效果的维式重锤（`data/choices.json` 的 `pool_equip_vict`，与战斗侧 hammer 的运行时分型同源）。 */
const VICT_WEAPONS = Object.freeze(['chess_item_2_03_e_a', 'chess_item_3_09_e_a', 'chess_item_3_10_e_a', 'chess_item_4_09_e_a']);

/**
 * 休整期结算（`<进入休整期时>`）：本场部署次数 ≥ `bb.deploys` ⇒ 随机一件维式重锤（普通 1 / 精锐 `bb.count` 件）。
 * 只在重构对局里跑（这些特质记录本身也只在重构模拟里出现）。
 */
function victoriaPrepRewards(ctx) {
  if (!ctx.gd || ctx.gd.isRecon !== true) return;
  const deploys = intOf(ctx.mark(MARK_PHATOM_DEPLOYS), 0);
  if (deploys <= 0) return;
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess' || p.uid == null) continue;
    for (const gid of garrisonIdsOfPiece(ctx, p)) {
      if (gid !== `${PHATOM_GARRISON}_a` && gid !== `${PHATOM_GARRISON}_b`) continue;
      const bb = (ctx.gd.garrison(gid) || {}).bb || {};
      if (deploys < intOf(bb.deploys, 3)) continue;
      const n = Math.max(1, intOf(bb.count, /_b$/.test(gid) ? 2 : 1));
      for (let i = 0; i < n; i++) {
        const id = ctx.rng && typeof ctx.rng.pick === 'function' ? ctx.rng.pick(VICT_WEAPONS) : VICT_WEAPONS[0];
        if (id) ctx.grantItem(id, { requirePool: false });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 谢拉格（业主 2026-10-30）：讯使 —— `<进入休整期时>获得1件（精锐2件）简易通讯机（需要激活【谢拉格】盟约）`。
// 触发条件与件数都在棋盘上的棋子特质记录里（`recon_garrison_courier_a/b`，`SERVER_PREP_START`）；盟约没激活就不发。
// `requirePool: false`（与黄沙罗盘 / 盟约之币 / 维式重锤同一条：固定给件，不占随机池的复制数）。
// ---------------------------------------------------------------------------------------------------------------

/** 谢拉格盟约 id（与战斗侧同名常量同一份字符串）。 */
const KJERAG_BOND = 'kjeragShip';
/** 特质记录 id 前缀（`_a` 普通 / `_b` 精锐）。 */
const COURIER_GARRISON = 'recon_garrison_courier';
/** 简易通讯机（2 阶装备，`data/items.json` 的普通版）。 */
const COMMS_ID = 'chess_item_2_06_e_a';

/**
 * 休整期结算：棋盘上有讯使（任意形态）且【谢拉格】已激活 ⇒ 按 `bb.count` 发简易通讯机。
 * 只在重构对局里跑（这些特质记录本身也只在重构模拟里出现）。
 */
function kjeragPrepRewards(ctx) {
  if (!ctx.gd || ctx.gd.isRecon !== true) return;
  if (typeof ctx.bondActive !== 'function' || !ctx.bondActive(KJERAG_BOND)) return;
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess' || p.uid == null) continue;
    for (const gid of garrisonIdsOfPiece(ctx, p)) {
      if (gid !== `${COURIER_GARRISON}_a` && gid !== `${COURIER_GARRISON}_b`) continue;
      const bb = (ctx.gd.garrison(gid) || {}).bb || {};
      const n = Math.max(1, intOf(bb.count, /_b$/.test(gid) ? 2 : 1));
      for (let i = 0; i < n; i++) ctx.grantItem(COMMS_ID, { requirePool: false });
    }
  }
}

/** 玩家交上来的选择只在这一局有效：这里注册的是**这一局**注册表上的处理器（`registerMeta(registry)`，DESIGN §29.3）。 */

// ---------------------------------------------------------------------------------------------------------------
// 拉特兰（业主 2026-10-30）：
//   * 菲亚梅塔 —— `<战斗中>【拉特兰】干员消耗弹药 ≥ bb.ammo` ⇒ 进入休整期时获得 1 件拉特兰桥夹
//     （战斗侧 `battle/main.mjs` 把本场弹药消耗总数按玩家写进 `reconLateranoAmmo`）；
//   * 空构 —— `<休整期结束时>使身后一名【拉特兰】干员已激活的盟约层数+2 / +4`（`onPrepEnd`，只看身后一格）。
// ---------------------------------------------------------------------------------------------------------------

const LATERANO_BOND = 'lateranoShip';
const PHENXI_AMMO_GARRISON = 'recon_garrison_phenxi_ammo';
const KONGGOU_GARRISON = 'recon_garrison_konggou';
/** 拉特兰桥夹（4 阶装备，`data/items.json` 的普通版）。 */
const BRIDGE_ID = 'chess_item_4_08_e_a';
/** 标记键（与 `battle/main.mjs` 同一份字符串）。 */
const MARK_LATERANO_AMMO = 'reconLateranoAmmo';
/** 朝向 → 前进向量（与引擎 `dir.js` 同一张表；缺省 RIGHT）。 */
const DIR_VEC = Object.freeze({ UP: [1, 0], RIGHT: [0, 1], DOWN: [-1, 0], LEFT: [0, -1] });

/**
 * 休整期结算（`<进入休整期时>`）：本场【拉特兰】弹药消耗 ≥ `bb.ammo` ⇒ 每名菲亚梅塔发 `bb.count` 件拉特兰桥夹。
 * 只在重构对局里跑（这些特质记录本身也只在重构模拟里出现）。
 */
function lateranoPrepRewards(ctx) {
  if (!ctx.gd || ctx.gd.isRecon !== true) return;
  const ammo = intOf(ctx.mark(MARK_LATERANO_AMMO), 0);
  if (ammo <= 0) return;
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess' || p.uid == null) continue;
    for (const gid of garrisonIdsOfPiece(ctx, p)) {
      if (gid !== `${PHENXI_AMMO_GARRISON}_a` && gid !== `${PHENXI_AMMO_GARRISON}_b`) continue;
      const bb = (ctx.gd.garrison(gid) || {}).bb || {};
      if (ammo < intOf(bb.ammo, 200)) continue;
      const n = Math.max(1, intOf(bb.count, 1));
      for (let i = 0; i < n; i++) ctx.grantItem(BRIDGE_ID, { requirePool: false });
    }
  }
}

/** 身后一格（沿棋子朝向的反方向一步；朝向缺省 RIGHT）。 */
function behindPieceOf(ctx, p) {
  if (!p || !Number.isInteger(p.row) || !Number.isInteger(p.col)) return null;
  if (typeof ctx.pieceAt !== 'function') return null;
  const [dr, dc] = DIR_VEC[p.dir] || DIR_VEC.RIGHT;
  return ctx.pieceAt(p.row - dr, p.col - dc);
}

/**
 * 空构：`<休整期结束时>使身后一名【拉特兰】干员已激活的盟约层数+2 / +4`。
 * 目标只取**身后一格**的那名干员（不是她自己）；得是【拉特兰】成员，加的是**它**的已激活盟约（同一层数池）。
 */
function konggouPrepEnd(ctx) {
  if (!ctx.gd || ctx.gd.isRecon !== true) return;
  if (typeof ctx.bondActive !== 'function' || !ctx.bondActive(LATERANO_BOND)) return;
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess' || p.uid == null) continue;
    for (const gid of garrisonIdsOfPiece(ctx, p)) {
      if (gid !== `${KONGGOU_GARRISON}_a` && gid !== `${KONGGOU_GARRISON}_b`) continue;
      const bb = (ctx.gd.garrison(gid) || {}).bb || {};
      const other = behindPieceOf(ctx, p);
      if (!other || other.kind !== 'chess' || other.uid === p.uid) continue;
      const bonds = typeof ctx.pieceBonds === 'function' ? ctx.pieceBonds(other.uid, other) : [];
      if (!Array.isArray(bonds) || !bonds.includes(LATERANO_BOND)) continue;
      const n = Math.max(1, intOf(bb.layers, /_b$/.test(gid) ? 4 : 2));
      for (const b of bonds) if (ctx.bondActive(b)) ctx.addLayers(b, n, { requireActive: true, reason: 'garrison' });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 卡西米尔（业主 2026-10-30）：薇薇安娜 —— 骑士储蓄罐被装备销毁时，极小概率（精锐小概率）不获得资金，
// 而是获得 1 件天马之盔或 1 件天马之枪。官方把「装备时销毁，随机获得 1~6 资金」写死在 `item:chess_item_3_12_e`
// 的处理器里（`builtinMeta.js` 的 `equip_destory_gain_random_coin`），**没有取消资金的钩子** —— 所以这一格由本包
// 覆盖同一个 item 处理器：没有薇薇安娜（或不是重构对局）时逐字执行官方那一条；场上有她时按特质记录的概率掷骰。
// ---------------------------------------------------------------------------------------------------------------

/** 骑士储蓄罐（itemKey 去 `_a/_b`）。 */
const SAVINGS_ITEM = 'chess_item_3_12_e';
/** 天马之盔 / 天马之枪（普通版；`grantItem` 与官方「获得件」同一条）。 */
const HELMET_ID = 'chess_item_5_09_e_a';
const LANCE_ID = 'chess_item_6_01_e_a';

/** 场上薇薇安娜的概率（多条取最大；没有薇薇安娜 / 不是重构对局 ⇒ 0）。 */
function vvanaChance(ctx) {
  if (!ctx.gd || ctx.gd.isRecon !== true) return 0;
  if (typeof ctx.garrisonsOf !== 'function') return 0;
  let best = 0;
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess' || p.uid == null) continue;
    for (const g of ctx.garrisonsOf(p.uid)) {
      if (!g || !/^recon_garrison_vvana_/.test(g.garrisonId || '')) continue;
      const prob = Number(g.bb && g.bb.prob);
      if (Number.isFinite(prob) && prob > best) best = prob;
    }
  }
  return best;
}

/** 骑士储蓄罐的 onEquip（覆盖官方：官方先发资金，这里把「改发天马」的概率放在它前面）。 */
const VVANA_SAVINGS = {
  onEquip(ctx, ev) {
    const item = ev && ev.item;
    const rec = item ? ctx.gd.item(item.id) : null;
    const params = rec && rec.params && typeof rec.params === 'object' ? rec.params : {};
    const lo = intOf(params.min, 1);
    const hi = Math.max(lo, intOf(params.max, lo));
    const prob = vvanaChance(ctx);
    if (prob > 0 && ctx.rng && typeof ctx.rng.chance === 'function' && ctx.rng.chance(prob)) {
      const id = ctx.rng.pick([HELMET_ID, LANCE_ID]);
      if (id) { ctx.grantItem(id, { requirePool: false }); return; }
    }
    ctx.addFunds(lo + ctx.rng.int(hi - lo + 1), 'item');
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 叙拉古（业主 2026-10-31）：贝洛内 / 伺夜 的休整期互惠 ——
//   贝洛内：`<进入休整期时>若伺夜在场且携带叙拉古正装，则获得 1 / 2 件叙拉古正装`
//   伺夜：  `<进入休整期时>若贝洛内在场且携带叙拉古正装，获得 1 / 2 件家族徽章`
// 两条都由本模块处理（发放件数取特质记录自己的 `bb.count`）。「在场」= 棋盘（不是手牌）；「携带」= 该棋子的
// `items` 里有叙拉古正装（普通 / 精锐都算）。
// ---------------------------------------------------------------------------------------------------------------

/** 叙拉古正装（itemKey 去 `_a/_b`）与要发的那一件（普通版）。 */
const SUIT_ITEM = 'chess_item_3_01_e';
const SUIT_ID = 'chess_item_3_01_e_a';
/** 家族徽章（普通版）。 */
const EMBLEM_ID = 'chess_item_6_11_e_a';
/** 互惠的两名干员（charId，自选格里也是同一个）。 */
const DEMETR_CHAR = 'char_4037_demetr';
const VIGIL_CHAR = 'char_427_vigil';
/** 两条特质记录 id 前缀（`_a` 普通 / `_b` 精锐）。 */
const BELLONE_PREP = 'recon_garrison_bellone_prep';
const VIGIL_PREP = 'recon_garrison_vigil_prep';

/** 棋子携带了叙拉古正装（普通 / 精锐都算）。 */
function carriesSuit(ctx, p) {
  return (Array.isArray(p.items) ? p.items : []).some((it) => itemKeyOf(ctx.gd.item(it.id), it.id) === SUIT_ITEM);
}

/** 棋盘上「携带叙拉古正装」且 charId 命中的干员（不在场 / 没带 ⇒ null）。 */
function suitedMate(ctx, charId) {
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess' || p.uid == null || !carriesSuit(ctx, p)) continue;
    const rec = typeof ctx.chessRecord === 'function' ? ctx.chessRecord(p.id) : null;
    if (rec && rec.charId === charId) return p;
  }
  return null;
}

/**
 * 休整期互惠：棋盘 / 手牌上的贝洛内、伺夜各自按自己那条特质记录发件（对方的在场与携带由 `suitedMate` 判断）。
 * 只在重构对局里跑（这些特质记录本身也只在重构模拟里出现）。
 */
function siracusaPrepRewards(ctx) {
  if (!ctx.gd || ctx.gd.isRecon !== true) return;
  // 两条条件在**发放任何装备之前**各判一次：先发的那一件可能触发装备合并（手里 + 身上的同种普通件合成进阶），
  // 把另一条要吃的那件「叙拉古正装」从对方身上挪走 —— 那样第二条就永远看不到「携带」。
  const vigilSuited = !!suitedMate(ctx, VIGIL_CHAR);   // 伺夜在场且携带 ⇒ 贝洛内发正装
  const demetrSuited = !!suitedMate(ctx, DEMETR_CHAR); // 贝洛内在场且携带 ⇒ 伺夜发徽章
  for (const p of [...ctx.board(), ...ctx.hand()]) {
    if (!p || p.kind !== 'chess' || p.uid == null) continue;
    for (const gid of garrisonIdsOfPiece(ctx, p)) {
      const bellone = gid === `${BELLONE_PREP}_a` || gid === `${BELLONE_PREP}_b`;
      const vigil = gid === `${VIGIL_PREP}_a` || gid === `${VIGIL_PREP}_b`;
      if (!bellone && !vigil) continue;
      if (!(bellone ? vigilSuited : demetrSuited)) continue;
      const bb = (ctx.gd.garrison(gid) || {}).bb || {};
      const n = Math.max(1, intOf(bb.count, 1));
      const item = bellone ? SUIT_ID : EMBLEM_ID;
      for (let i = 0; i < n; i++) ctx.grantItem(item, { requirePool: false });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 阿戈尔（业主 2026-10-31）：深海色（售出时给随机 2 阶装备）与安哲拉（休整期把阶级最低的装备替换成三选一）。
// ---------------------------------------------------------------------------------------------------------------

const DEEPCL_SOLD = 'RECON_DEEPCL_SOLD';
const CUTTLE_REPLACE = 'RECON_CUTTLE_REPLACE';
/** 安哲拉的三件替换（较大概率 70% / 较小概率 20% / 小概率 10%）。 */
const CUTTLE_DROPS = Object.freeze([
  { id: 'chess_item_3_07_e_a', w: 0.7 }, // 阿戈尔重刃
  { id: 'chess_item_5_08_e_a', w: 0.2 }, // 突变细胞
  { id: 'chess_item_6_04_e_a', w: 0.1 }, // 海沟实验体
]);

/** 深海色：`<售出时>获得 1 / 2 件随机 2 阶装备`（件数与阶级都取特质记录自己的 `bb`）。 */
const DEEPCL_SELL = {
  onSold(ctx) {
    if (!ctx.gd || ctx.gd.isRecon !== true) return;
    const bb = (ctx.source && ctx.source.bb) || {};
    const n = Math.max(1, intOf(bb.count, 1));
    const tier = intOf(bb.tier, 2);
    for (let i = 0; i < n; i++) {
      const id = ctx.rollItem({ tier });
      if (id) ctx.grantItem(id, { requirePool: false });
    }
  },
};

/** 三选一（70 / 20 / 10）。 */
function cuttleDrop(ctx) {
  const r = ctx.rng();
  let acc = 0;
  for (const d of CUTTLE_DROPS) { acc += d.w; if (r < acc) return d.id; }
  return CUTTLE_DROPS[CUTTLE_DROPS.length - 1].id;
}

/**
 * 安哲拉：`<进入休整期时>` 携带的装备 ≥ `bb.min_items` 时，随机取 `bb.pick` 件**阶级最低**的装备，各自替换成
 * 三件之一。替换 = 销毁旧件 → 发新件（`requirePool: false`）→ `ctx.equipDirect` 直接装回同一名干员。
 */
const CUTTLE_SWAP = {
  onRoundStart(ctx) {
    if (!ctx.gd || ctx.gd.isRecon !== true) return;
    const piece = ctx.source && ctx.source.piece;
    const bb = (ctx.source && ctx.source.bb) || {};
    const items = Array.isArray(piece && piece.items) ? piece.items.slice() : [];
    const minItems = Math.max(1, intOf(bb.min_items, 2));
    if (!(items.length >= minItems)) return;
    const want = Math.min(items.length, Math.max(0, intOf(bb.pick, 2)));
    if (!(want > 0)) return;
    const tierOf = (it) => { const rec = ctx.gd.item(it.id); return rec && Number.isInteger(rec.tier) ? rec.tier : 99; };
    const chosen = [];
    const rest = items.slice();
    while (chosen.length < want && rest.length) {
      let lowest = Infinity;
      for (const it of rest) lowest = Math.min(lowest, tierOf(it));
      const pool = rest.filter((it) => tierOf(it) === lowest);
      const k = Math.min(pool.length - 1, Math.max(0, Math.floor(ctx.rng() * pool.length)));
      const pick = pool[k];
      chosen.push(pick);
      rest.splice(rest.indexOf(pick), 1);
    }
    for (const it of chosen) {
      ctx.destroyItem(it.uid, { reason: 'garrison' });
      const got = ctx.grantItem(cuttleDrop(ctx), { requirePool: false });
      if (got && got.uid != null) ctx.equipDirect(got.uid, piece.uid);
    }
  },
};

export function registerMeta(registry) {
  registry.item(SAVINGS_ITEM, VVANA_SAVINGS);
  registry.garrison(DEEPCL_SOLD, DEEPCL_SELL);
  registry.garrison(CUTTLE_REPLACE, CUTTLE_SWAP);

  registry.global('recon', {
    onPrepStart(ctx) {
      offerDecision(ctx);
    },
    onRoundStart(ctx) {
      publishChoice(ctx);
      syncLoadDoom(ctx);
      decisionFunds(ctx);
      sargonPrepRewards(ctx);
      victoriaPrepRewards(ctx);
      kjeragPrepRewards(ctx);
      lateranoPrepRewards(ctx);
      siracusaPrepRewards(ctx);
    },
    onPrepEnd(ctx) {
      bondAssist(ctx);
      konggouPrepEnd(ctx);
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
