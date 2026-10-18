// workshop/dossoles/meta/main.mjs — 「多索雷斯」的**休整期侧**逻辑（`pack.json.server.meta`，DESIGN §29）。
//
// 与哥伦比亚 / 雷姆必拓两个包同一套装配方式：引擎辅助函数只从 `registry.api` 取（meta 模块只许 import 本包文件），
// 通报的键写在 pack.json 的 `server.meta.registers` 里。这里注册五条装备处理器、一条持久效果、两条干员特质。
//
// 注册面：
//   item:chess_item_ws_dos_tourbadge        多索雷斯游客章（装备时销毁：N 资金 + 携带者所有盟约层数 +M）
//   item:chess_item_ws_dos_chico            奇科龙舌兰（装备时销毁：N 名随机 T 阶干员）
//   item:chess_item_ws_dos_chico_premium    奇科精品龙舌兰（装备时销毁 + 挂持久效果，之后每回合 +M 核心盟约层数）
//   item:chess_item_ws_dos_anton            安东龙舌兰（装备时销毁：N 名阶级 ≤ 调度中心的随机【多索雷斯】干员）
//   item:chess_item_ws_dos_coating          沙兹专业镀膜装置（<休整期结束时>携带者所有已激活盟约层数 +M）
//   effect:mod_dos_premium                  奇科精品龙舌兰挂上的持久效果（每回合开始 +M 核心盟约层数）
//   garrison:DOS_LIN_PREP_FALLBACK          林：上场战斗没触发过战斗侧特质 → <进入休整期时>自身已激活层数 +M
//   garrison:DOS_TAKILA_GIFT_ITEM           龙舌兰：<进入休整期时>获得 N 件阶级 ≤ 调度中心的随机知名商品标志物
//
// 一个容易踩的坑：`registry.item(key)` 的 key 必须是**去掉 `_a` / `_b` 的家族键**（`itemKeyOf`），
// 与 `g.equip` 内部查表用的键一致；写整条 id 会在装配时抛 `META_UNDECLARED_KEY`（`registers` 里也必须是家族键）。

/** 本包的盟约 id（与 `bonds.json` 的键一致）。 */
const BOND = 'dossolesShip';

/** 6 件「知名商品标志物」的普通版 id（装备池顺序即随机的候选顺序）。 */
const GIFT_ITEMS = [
  'chess_item_ws_dos_tourbadge_a',
  'chess_item_ws_dos_chico_a',
  'chess_item_ws_dos_chico_premium_a',
  'chess_item_ws_dos_anton_a',
  'chess_item_ws_dos_coating_a',
  'chess_item_ws_dos_jade_a',
];

/**
 * 一个**装备记录**（`ctx.source.item` / `ctx.gd.item(id)`）的 buff 参数表。
 *
 * 与 `tools/build-data.mjs` 的 `effectParams` 逐字同规：按 buff 顺序把 `{ ...bb, ...bbStr }` 铺平，先出现的键赢。
 * 装备记录自己的 `params` 就是这一份（引擎读的也是它），所以优先读 `rec.params`，读不到再兜底铺一遍。
 * @param {{ params?: object, buffs?: Array<object> }|null} rec
 * @returns {Record<string, any>}
 */
function itemParams(rec) {
  if (!rec) return {};
  if (rec.params && typeof rec.params === 'object') return rec.params;
  const out = {};
  for (const b of Array.isArray(rec.buffs) ? rec.buffs : []) {
    if (!b || typeof b !== 'object') continue;
    for (const [k, v] of Object.entries({ ...(b.bb || {}), ...(b.bbStr || {}) })) if (!(k in out)) out[k] = v;
  }
  return out;
}

/**
 * 注册本包的休整期处理器。
 * @param {any} registry 受限注册表（`GuardedMetaRegistry`）
 */
export function registerMeta(registry) {
  const { bondRecord } = registry.api;
  const int = (v, d = 0) => (Number.isFinite(v) ? Math.trunc(v) : (Number.isFinite(+v) ? Math.trunc(+v) : d));
  /** 装备记录：`ev.item` / `ctx.source.piece` 是一个**装备棋子**，记录要从 `ctx.gd.item(id)` 取。 */
  const recOf = (ctx, piece) => (piece && ctx.gd && typeof ctx.gd.item === 'function' ? ctx.gd.item(piece.id) : null);

  // =================================================================================================================
  // 多索雷斯游客章 —— 「装备时销毁，获得 N 资金并使携带者所属盟约层数 +M（无需激活盟约）」
  //
  // 与官方「盟约之币」（`equip_destory_gain_random_coin`）+「随身身份牌」（`use_equip_reward_char_chess_bond_layer`）
  // 两个内置处理器**逐字同规**；这里自己再注册一次，是为了不依赖「引擎内置处理器能不能看到工坊装备记录」这条
  // 装配顺序 —— 两边语义一样，谁生效都不会改变结算（注册是「后注册的赢」，本包的这次一定在引擎之后）。
  const tourBadge = () => ({
    onEquip(ctx, ev) {
      const p = itemParams(recOf(ctx, ev.item));
      const lo = Math.max(0, int(p.min, 1));
      const hi = Math.max(lo, int(p.max, lo));
      if (hi > 0) ctx.addFunds(lo + ctx.rng.int(hi - lo + 1), 'item');
      const n = int(p.layer, 2);
      if (n <= 0) return;
      // 「携带者所属盟约」= 记录自己的 bonds + 变形同构体授予（`ctx.pieceBonds` 就是这一份）；
      // 「无需激活盟约」= `requireActive: false`（与随身身份牌的内置处理器同一条写法）。
      for (const b of ctx.pieceBonds(ev.target.uid)) ctx.addLayers(b, n, { requireActive: false, reason: 'item' });
    },
  });

  // =================================================================================================================
  // 奇科龙舌兰 —— 「装备时销毁，获得 N 名随机 T 阶干员」
  //
  // 精确阶级优先，池里该阶级没有干员时回退到 ≤ 该阶级（与「开拓大地」/ 娜斯提同一条兜底写法）。
  // `ctx.rollChess` 是**权重抽取**（按共享池剩余份数），所以「随机 2 阶干员」与官方商店手感一致。
  const chico = () => ({
    onEquip(ctx, ev) {
      const p = itemParams(recOf(ctx, ev.item));
      const count = Math.max(1, int(p.count, 1));
      const tier = Math.max(1, int(p.tier, 2));
      for (let i = 0; i < count; i++) {
        const id = ctx.rollChess({ tier }) || ctx.rollChess({ maxTier: tier });
        if (!id || !ctx.grantChess(id)) break;
      }
    },
  });

  // =================================================================================================================
  // 奇科精品龙舌兰 —— 「装备时销毁，之后每回合开始时使已激活的核心盟约层数 +M」
  //
  // 装备本身被销毁（`kind: consume_on_equip`），效果必须留在玩家身上，所以走**持久 EffectRef** 通道
  // （与「精打细算玩偶」`effect:builtin_round_coin` 同一个口子）。`id` 里带装备 uid，避免两件互相覆盖。
  const chicoPremium = () => ({
    onEquip(ctx, ev) {
      const rec = recOf(ctx, ev.item);
      const p = itemParams(rec);
      const n = int(p.count, 2);
      if (n <= 0) return;
      ctx.addEffect({
        id: `dos:premium:${ev.item.uid}`,
        key: 'effect:mod_dos_premium',
        name: rec ? rec.name : '奇科精品龙舌兰',
        desc: rec ? rec.desc : '',
        iconKind: 'item',
        iconId: rec ? (rec.iconId || rec.id) : ev.item.id,
        battle: false, // 纯休整期效果，不进战斗输入
        params: { count: n },
      });
    },
  });

  /** 奇科精品龙舌兰留下的持久效果：每回合开始，给**每一条已激活的核心盟约** +count 层。 */
  const premiumEffect = () => ({
    onRoundStart(ctx) {
      const ref = ctx.source.ref;
      const n = int(ref && ref.params && ref.params.count, 2);
      if (n <= 0) return;
      const bonds = ctx.bonds(); // { [bondId]: { count, active, tier, layers } }
      for (const bondId of Object.keys(bonds)) {
        if (!ctx.bondActive(bondId)) continue;
        // 「核心盟约」= 记录里的 isCore（炎/萨尔贡/维多利亚/谢拉格/拉特兰/阿戈尔/叙拉古/卡西米尔；
        // 本包自己的【多索雷斯】是 SIDE_STORY，不是核心盟约，所以不在其中）。
        const rec = bondRecord(bondId);
        if (!rec || rec.isCore !== true) continue;
        ctx.addLayers(bondId, n, { requireActive: true, reason: 'item' });
      }
    },
  });

  // =================================================================================================================
  // 安东龙舌兰 —— 「装备时销毁，获得 N 名阶级不超过调度中心的随机【多索雷斯】盟约干员」
  //
  // 与哥伦比亚「沙盘·α」同一套写法，只是把 `tier` 换成 `maxTier`（文本是「不超过调度中心」而不是「等于」）。
  const anton = () => ({
    onEquip(ctx, ev) {
      const p = itemParams(recOf(ctx, ev.item));
      const count = Math.max(1, int(p.count, 1));
      const bond = typeof p.bond === 'string' && p.bond ? p.bond : BOND;
      const tier = Math.max(1, ctx.shopLevel());
      for (let i = 0; i < count; i++) {
        const id = ctx.rollChess({ bond, maxTier: tier });
        if (!id || !ctx.grantChess(id)) break;
      }
    },
  });

  // =================================================================================================================
  // 沙兹专业镀膜装置 —— 「携带者获得特质『<休整期结束时>自身已激活盟约层数 +M』」
  //
  // 文本说的是「获得特质」，但**特质是数据记录**（`chests[].garrisonIds` → `garrisons.json`），运行时没有往棋子上
  // 挂一条数据记录的通道 —— 所以这条效果由装备自己的 `onPrepEnd` 直接实现，与官方「涤火杰西卡」<休整期结束时>
  // 那一条走**同一条通道、同一个口径**（`ctx.addLayers(bond, n, { requireActive: true })`，遍历携带者的每一条盟约）。
  // 表现上完全一致：休整期结束时、按已激活盟约、每一条 +M 层。
  //
  // 记录里的 `giveBondId: 'dossolesShip'` 是**变形同构体**那一套（装备与变形同构体同时装备时，携带者视为
  // 【多索雷斯】盟约成员）—— 那是引擎的纯计算（`bondsMeta.pieceBonds`），不需要这里的任何代码。
  const coating = () => ({
    onPrepEnd(ctx) {
      const { piece, holder } = ctx.source;
      if (!piece || !holder || holder.kind !== 'chess') return;
      const n = int(itemParams(recOf(ctx, piece)).count, 5);
      if (n <= 0) return;
      for (const b of ctx.pieceBonds(holder.uid)) ctx.addLayers(b, n, { requireActive: true, reason: 'item' });
    },
  });

  // =================================================================================================================
  // 林 —— 「若没有触发<战斗中>特质，则在<进入休整期时>使自身已激活层数 +M」
  //
  // 战斗侧（`battle/main.mjs` 的 `DOS_LIN_ALLY_HIT`）在**这一份棋子触发过**时写 `setBattleMark(pid, 'dosLinFired', true)`；
  // 这里读同一个标记（`ctx.mark`）。标记是**每位玩家**一个键（`ps.marks`），所以同一名玩家场上有两枚林时，
  // 只要有一枚触发过，两枚都不再走这条兜底 —— 与官方「卡夫卡」<若没有陷入过再部署状态> 的同一条既有简化一致
  // （`COL_DEPLOY_LAYER_NOREDEPLOY_EQUIP` → `COL_KAFKA_PREP_EQUIP`），因为战斗结果里没有逐棋子的通道。
  const linPrepHalf = () => ({
    run(ctx) {
      const { bb, piece } = ctx.source;
      const n = int(bb.layer, 6);
      if (n <= 0) return;
      if (ctx.mark('dosLinFired') === true) return;
      const uid = piece && Number.isInteger(piece.uid) ? piece.uid : null;
      if (uid == null) return;
      for (const b of ctx.pieceBonds(uid)) ctx.addLayers(b, n, { requireActive: true, reason: 'garrison' });
    },
  });

  // =================================================================================================================
  // 龙舌兰 —— 「<进入休整期时>获得 N 件阶级不超过调度中心的随机知名商品标志物」
  //
  // 池子就是本包的 6 件装备（1..6 阶），按**装备记录的 tier** 过滤到 ≤ 调度中心（`ctx.shopLevel()`，最高 6），
  // 用对局的 meta 随机流（`ctx.rng`）等概率抽取 —— 允许重复（同名两件会自动合成进阶件，与官方道具池一致）。
  // 不走 `ctx.rollItem`（那是 choices.json 的道具池，本包不往官方池里塞东西）。
  const takilaGift = () => ({
    run(ctx) {
      const { bb } = ctx.source;
      const count = Math.max(1, int(bb.count, 1));
      const maxTier = Math.max(1, ctx.shopLevel());
      const pool = [];
      for (const id of GIFT_ITEMS) {
        const rec = ctx.gd && typeof ctx.gd.item === 'function' ? ctx.gd.item(id) : null;
        if (rec && Number.isInteger(rec.tier) && rec.tier <= maxTier) pool.push(id);
      }
      if (!pool.length) return;
      for (let i = 0; i < count; i++) ctx.grantItem(ctx.rng.pick(pool));
    },
  });

  registry.item('chess_item_ws_dos_tourbadge', tourBadge());
  registry.item('chess_item_ws_dos_chico', chico());
  registry.item('chess_item_ws_dos_chico_premium', chicoPremium());
  registry.item('chess_item_ws_dos_anton', anton());
  registry.item('chess_item_ws_dos_coating', coating());
  registry.effect('mod_dos_premium', premiumEffect());
  registry.garrison('DOS_LIN_PREP_FALLBACK', linPrepHalf());
  registry.garrison('DOS_TAKILA_GIFT_ITEM', takilaGift());
}
