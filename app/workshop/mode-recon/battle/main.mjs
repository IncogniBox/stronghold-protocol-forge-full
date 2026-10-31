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
//   * **「装备效果 -50%」按引擎的缩放通道落地**（`S.setItemEffectScale`，0.3.1 新增）：引擎把该装备的黑板数值
//     缩一半后**重新装一遍**（旧 grant 先 dispose），于是属性 buff 与**触发类**效果（hook / 骑手伤害 / 不死窗口
//     …）一起减半 —— 从前只缩属性、触发类全额生效的那条口径已废。

import * as S from '@battle/mod.js';

/** 赤刃明霄陈·重构（业主 2026-10-30）：攻击附带「已激活【炎】层数 × 当前生命百分比」的固定真实伤害。 */
const CHEN3_TRUE_DMG = 'RECON_CHEN3_TRUE_DMG';
const YAN_BOND = 'yanShip';

/**
 * 赤刃明霄陈·重构的特质（`garrisons.json` 的 `recon_garrison_chen3_a/b`，`eventType: IN_BATTLE`）：
 * 每次命中（`hit`，来源是这名干员）追加一笔**真实伤害** = 已激活【炎】层数 × `hp_pct` × 目标**当前**生命值。
 * 精英 `hp_pct` = 0.00002（0.002%），普通 0.00001（0.001%）；层数读 `S.bondLayers`（盟约没激活就是 0）。
 * 追加的那一笔带 `garrison` 标签 —— 它自己也会走 `hit`，靠这个标签挡掉递归。
 */
S.registerGarrisonInstaller(CHEN3_TRUE_DMG, (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!u) continue;
    const pct = S.num(it.bb.hp_pct, 0);
    if (!(pct > 0)) continue;
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== u || !target || target.side !== 'enemy' || !dmg) return;
      if (!dmg.isAttack) return; // 「攻击附带」：技能 DoT / 元素损伤那类不算
      if (Array.isArray(dmg.tags) && dmg.tags.includes('garrison')) return; // 追加的那一笔不递归
      const layers = S.bondLayers(battle, u.ownerId, YAN_BOND);
      const hp = target.bossPool ? target.bossPool.hp : target.hp;
      const amount = layers * pct * Math.max(0, S.num(hp, 0));
      if (amount > 0) battle.dealDamage(u, target, { amount, type: 'true', canDodge: false, tags: ['garrison', 'addition'] });
    }, { owner: u });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 萨尔贡（业主 2026-10-30）：娜仁图亚 / 森蚺 / 狮蝎 三名新干员的战斗内特质（`garrisons.json` 的
// `recon_garrison_narant_a/b`、`recon_garrison_zumama_a/b`、`recon_garrison_mantic_a/b`，全部 `IN_BATTLE`）。
// 两条与休整期有关的数走**战斗 → 休整期的通用标记**（`S.setBattleMark`，`meta/main.mjs` 的 sargonPrepRewards 读）。
// ---------------------------------------------------------------------------------------------------------------

/** 萨尔贡盟约 id（三名特质都按「这名干员是不是萨尔贡干员」判定）。 */
const SARGON_BOND = 'sargonShip';
const NARANT_SHARE = 'RECON_NARANT_SHARE';
const ZUMAMA_LAYERS = 'RECON_ZUMAMA_LAYERS';
const MANTIC_STEALTH = 'RECON_MANTIC_STEALTH';
/** 狮蝎给的隐匿 buff 键（同一个键在同一名干员身上只保留一份）。 */
const MANTIC_STEALTH_KEY = 'recon:mantic:stealth';
/** 战斗 → 休整期标记的键（与 `meta/main.mjs` 同一份字符串）。 */
const MARK_SARGON_CASTS = 'reconSargonCasts';
const MARK_STEALTH_HOLDERS = 'reconStealthHolders';

/**
 * 娜仁图亚：`【萨尔贡】干员技能开启后，携带装备的效果共享至相邻四格 / 周围八格【萨尔贡】干员（持续60秒）`。
 * 触发者是**开启技能的那名萨尔贡干员本人**（共享的是它携带的装备，引擎的 `lendItemEffects` 就是为此而备）；
 * 特质主人娜仁图亚只要在同一名玩家的场上即可，多个副本取「格数最大」的那一份。
 */
S.registerGarrisonInstaller(NARANT_SHARE, (battle, list) => {
  battle.on('skillStart', ({ unit }) => {
    if (!unit || unit.kind !== 'op' || !S.isMember(battle, unit, SARGON_BOND)) return;
    const carriers = list.filter((it) => it.unit && it.unit.ownerId === unit.ownerId && S.onField(it.unit));
    if (!carriers.length) return;
    let best = carriers[0];
    for (const it of carriers) if (S.num(it.bb.tiles, 4) > S.num(best.bb.tiles, 4)) best = it;
    const tiles = S.num(best.bb.tiles, 4) >= 8 ? S.N8 : S.N4;
    const duration = S.num(best.bb.duration, 60);
    const maxTier = S.num(best.bb.max_tier, 6);
    if (!(duration > 0)) return;
    let n = 0;
    for (const a of S.alliesAround(battle, unit, tiles)) {
      if (!S.isOp(a) || !S.onField(a) || !S.isMember(battle, a, SARGON_BOND)) continue;
      if (S.lendItemEffects(battle, unit, a, { maxTier, duration })) n++;
    }
    if (n) S.fxOn(battle, 'bondShare', unit, 'recon:narant', 'share', { n, duration });
  });
});

/**
 * 森蚺：`【萨尔贡】干员每开启1次技能，使已激活的【萨尔贡】【坚守】层数+6`；本场开启次数 ≥20 时，
 * 进入休整期获得黄沙罗盘（精锐 2 件，休整期那一半在 `meta/main.mjs`）。计数按玩家分开记。
 */
S.registerGarrisonInstaller(ZUMAMA_LAYERS, (battle, list) => {
  const casts = new Map();
  const bonds = ['sargonShip', 'steadShip'];
  battle.on('skillStart', ({ unit }) => {
    if (!unit || unit.kind !== 'op' || unit.ownerId == null || !S.isMember(battle, unit, SARGON_BOND)) return;
    const carrier = list.find((it) => it.unit && it.unit.ownerId === unit.ownerId && S.onField(it.unit));
    if (!carrier) return;
    casts.set(unit.ownerId, (casts.get(unit.ownerId) ?? 0) + 1);
    const n = S.num(carrier.bb.layers, 6);
    if (n > 0) S.gainLayers(battle, { playerId: unit.ownerId, bonds, n, requireActive: true, source: carrier.unit, reason: 'garrison' });
  });
  battle.on('battleEnd', () => {
    for (const it of list) {
      const ownerId = it.unit && it.unit.ownerId;
      if (ownerId == null) continue;
      S.setBattleMark(battle, ownerId, MARK_SARGON_CASTS, casts.get(ownerId) ?? 0);
    }
  });
});

/**
 * 狮蝎：`<战斗开始时>使自身与相邻四格 / 周围8格的干员获得隐匿（持续999秒，受到敌人攻击后解除）`；
 * `<进入休整期时>`按上回合战斗结束时持有隐匿的干员数给盟约之币（最多 2 / 4 件，休整期那一半在 meta）。
 * 解除只在**敌人的攻击**命中时发生（技能 DoT / 流失不算）。
 */
S.registerGarrisonInstaller(MANTIC_STEALTH, (battle, list) => {
  const watched = new Set();
  battle.on('battleStart', () => {
    for (const it of list) {
      const u = it.unit;
      if (!u || !S.onField(u)) continue;
      const tiles = S.num(it.bb.tiles, 4) >= 8 ? S.N8 : S.N4;
      const duration = S.num(it.bb.duration, 999);
      if (!(duration > 0)) continue;
      const targets = [u, ...S.alliesAround(battle, u, tiles).filter((a) => S.isOp(a) && S.onField(a))];
      for (const t of targets) {
        battle.addBuff(t, { key: MANTIC_STEALTH_KEY, duration, flags: { stealth: true }, status: 'stealth' });
        watched.add(t);
      }
    }
  });
  battle.on('hit', ({ target, source, dmg }) => {
    if (!target || !watched.has(target) || !dmg || !dmg.isAttack || dmg.cancel) return;
    if (!source || source.side !== 'enemy') return;
    watched.delete(target);
    battle.removeBuff(target, MANTIC_STEALTH_KEY);
  });
  battle.on('battleEnd', () => {
    for (const it of list) {
      const ownerId = it.unit && it.unit.ownerId;
      if (ownerId == null) continue;
      let n = 0;
      for (const a of S.playerOps(battle, ownerId)) if (S.onField(a) && a.s && a.s.flags && a.s.flags.stealth) n++;
      S.setBattleMark(battle, ownerId, MARK_STEALTH_HOLDERS, n);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 维多利亚（业主 2026-10-30）：澄闪 / 死芒 / 傀影 三名新干员的战斗内特质（`garrisons.json` 的
// `recon_garrison_gdglow_a/b`、`recon_garrison_necras_a/b`、`recon_garrison_phatom_a/b`，全部 `IN_BATTLE`）。
// 三名干员的技能本体是官方自选 kit（棋子记录的 `kitRef` = 官方 charId，`content/index.js kitOf` 照搬），
// 所以这里只叠加特质。傀影的「本回合部署次数 ≥3 → 维式重锤」走**战斗 → 休整期的通用标记**
// （`meta/main.mjs` 的 victoriaPrepRewards 读）。
// ---------------------------------------------------------------------------------------------------------------

const VICTORIA_BOND = 'victoriaShip';
const GDGLOW_DRONES = 'RECON_GDGLOW_DRONES';
const NECRAS_FIELD = 'RECON_NECRAS_FIELD';
const PHATOM_DEPLOY = 'RECON_PHATOM_DEPLOY';
/** 战斗 → 休整期标记的键（与 `meta/main.mjs` 同一份字符串）。 */
const MARK_PHATOM_DEPLOYS = 'reconPhantomDeploys';

/**
 * 澄闪：`已激活的【维多利亚】盟约每有200层（精锐100），技能开启时召唤的浮游单元+1`。
 * 浮游单元由官方 kit 在技能 `onStart` 里建好（`unit.mem.gdDrones`）—— `skills.js` 先跑 `onStart`、
 * 再 `emit('skillStart')`，所以这里读到的数组已经存在，往后追加的单元与 kit 建的同形（`{ i, lock, cd, rampId, ramp }`）。
 */
S.registerGarrisonInstaller(GDGLOW_DRONES, (battle, list) => {
  battle.on('skillStart', ({ unit }) => {
    if (!unit || unit.kind !== 'op') return;
    const it = list.find((x) => x.unit === unit);
    if (!it) return;
    const per = S.num(it.bb.layers, 200);
    if (!(per > 0) || !S.bondActive(battle, unit.ownerId, VICTORIA_BOND)) return;
    const extra = Math.floor(S.bondLayers(battle, unit.ownerId, VICTORIA_BOND) / per);
    const D = unit.mem && unit.mem.gdDrones;
    if (!(extra > 0) || !Array.isArray(D)) return;
    const n0 = D.length;
    for (let i = n0; i < n0 + extra; i++) D.push({ i, lock: null, cd: 0, rampId: null, ramp: 0 });
    S.fxOn(battle, 'drones', unit, 'recon:gdglow', 'extra', { n: extra });
  });
});

/**
 * 死芒：`自身与召唤物造成的伤害提升【维多利亚】盟约层数×0.5%（精锐×1%）`，
 * `普通攻击与技能攻击范围扩大为场上【维多利亚】干员攻击范围的总和`。
 *   * 伤害：`hit` 里按**实时**层数乘 `dmg.mul`（自身与自己的召唤物都算，`source.ownerUnit`）；
 *   * 范围：`setExtraRange`（绝对格键，技能的 `targeting.rangeGrid` 也叠加），每 0.5 秒与每次部署 / 阵亡重算。
 */
S.registerGarrisonInstaller(NECRAS_FIELD, (battle, list) => {
  const itOf = (source) => {
    if (!source) return null;
    return list.find((x) => x.unit && (source === x.unit || (source.kind === 'token' && source.ownerUnit === x.unit))) ?? null;
  };
  battle.on('hit', ({ source, target, dmg }) => {
    if (!target || target.side !== 'enemy' || !dmg || dmg.cancel) return;
    const it = itOf(source);
    if (!it || it.unit.ownerId == null) return;
    const bond = (it.bbStr && it.bbStr.bond) || 'victoriaShip';
    const pct = S.num(it.bb.pct, 0);
    if (!(pct > 0) || !S.bondActive(battle, it.unit.ownerId, bond)) return;
    const layers = S.bondLayers(battle, it.unit.ownerId, bond);
    if (layers <= 0) return;
    const mul = typeof dmg.mul === 'number' && Number.isFinite(dmg.mul) ? dmg.mul : 1;
    dmg.mul = mul * (1 + layers * pct);
  });
  /** 场上每一名【维多利亚】干员当前攻击范围的并集（绝对格键）→ 这名死芒的额外攻击范围。 */
  const refreshRange = () => {
    for (const it of list) {
      const u = it.unit;
      if (!u || !u.alive || !u.deployed || u.ownerId == null) continue;
      const keys = new Set();
      for (const a of S.playerOps(battle, u.ownerId, { fieldOnly: true })) {
        if (!S.isMember(battle, a, VICTORIA_BOND)) continue;
        for (const k of a.rangeKeys || []) keys.add(k);
      }
      battle.setExtraRange(u, [...keys]);
    }
  };
  battle.every(0.5, refreshRange);
  battle.on('deploy', refreshRange);
  battle.on('death', refreshRange);
  battle.on('battleStart', refreshRange);
});

/**
 * 傀影：`<部署时>使自身已激活的盟约层数+4（精锐+8，最多5次）`；
 * `本回合部署次数≥3时，获得1件（精锐2件）带有随机效果的维式重锤`（休整期那一半在 `meta/main.mjs`）。
 * 部署计数按**棋子**（同一名傀影的第 n 次非移动部署），上限 `bb.max_times`；标记按玩家取所有副本的最大值。
 */
S.registerGarrisonInstaller(PHATOM_DEPLOY, (battle, list) => {
  const counts = new Map();
  battle.on('deploy', ({ unit, move }) => {
    if (!unit || unit.kind !== 'op' || move) return;
    const it = list.find((x) => x.unit === unit);
    if (!it) return;
    const cap = Math.max(0, S.num(it.bb.max_times, 5));
    const n = counts.get(unit) ?? 0;
    if (n >= cap) return;
    counts.set(unit, n + 1);
    const layers = S.num(it.bb.layers, 4);
    if (!(layers > 0) || unit.ownerId == null) return;
    S.gainLayers(battle, { playerId: unit.ownerId, bonds: S.unitBonds(unit), n: layers, requireActive: true, source: unit, reason: 'garrison' });
  });
  battle.on('battleEnd', () => {
    for (const it of list) {
      const pid = it.unit && it.unit.ownerId;
      if (pid == null) continue;
      let max = 0;
      for (const [unit, n] of counts) if (unit.ownerId === pid) max = Math.max(max, n);
      S.setBattleMark(battle, pid, MARK_PHATOM_DEPLOYS, max);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// 谢拉格（业主 2026-10-30）：极光 / 讯使 两名新干员与 雪猎 / 圣聆初雪 两名重构。
// 雪猎的重构只是数据（新的 SERVER_ADD_BOND_CHESS_ALL 特质记录，层数 3 / 6），不需要代码；讯使的休整期那一半在
// `meta/main.mjs`（`kjeragPrepRewards`）。这里的三段：
//   * 极光：盟约激活后每秒回技力 + 每 3 次寒冷给【谢拉格】【不屈】加层；
//   * 圣聆初雪：攻击寒冷 / 冻结的敌人时，下一次攻击多无视 1 / 2 点法抗（最多 25 层）；
//   * 两名新干员在本机没有官方 kit（`char_422_aurora` / `char_198_blackd` 不在 `kits/ops` 里），技能走引擎的
//     generic kit —— 这里只补它推导不出的两处：讯使 S2 的部署费用 / 防御力，与极光 S2 的「目标冻结时才提高攻击力」。
// ---------------------------------------------------------------------------------------------------------------

/** 谢拉格 / 不屈 盟约 id。 */
const KJERAG_BOND = 'kjeragShip';
const INDOM_BOND = 'indomShip';
const AURORA_TRAIT = 'RECON_AURORA_TRAIT';
const SBELL2_PIERCE = 'RECON_SBELL2_PIERCE';
/** 圣聆初雪的法抗穿透层数 buff 键（同一名干员身上只保留一份，层数上限 `bb.max`）。 */
const SBELL2_PIERCE_KEY = 'recon:sbell2:pierce';
/** 讯使 S2 的防御力 buff 键（技能结束时摘掉）。 */
const COURIER_DEF_KEY = 'recon:courier:s2def';
/** 两名新干员的 S2 skillId（`data/chess.json` 另一版记录里的 id，逐字保留在包里）。 */
const AURORA_S2 = 'skchr_aurora_2';
const COURIER_S2 = 'skchr_blackd_2';

/**
 * 极光：`【谢拉格】盟约激活后，每秒获得1技力（精锐2）`；
 * `每对敌人造成3次寒冷，使已激活的【谢拉格】【不屈】层数+2（精锐+4）`。
 *   * 技力给**极光自己**（`unit.skill.gainSp`），盟约没激活就跳过；
 *   * 寒冷在 `beforeStatus` 里数**这名玩家**对敌人施加的次数：`source` 是自家干员，或 `source` 为空时敌人属于这名
 *     玩家的半场（谢拉格 6 人的寒风就是无来源、按 `ownerId` 只吹自己这半边）；满 3 次给两条盟约各加 `bb.layers` 层。
 */
S.registerGarrisonInstaller(AURORA_TRAIT, (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!u) continue;
    const sp = S.num(it.bb.sp, 0);
    if (sp > 0) {
      battle.every(1, () => {
        if (!u.alive || !u.deployed || u.ownerId == null || !u.skill) return;
        if (!S.bondActive(battle, u.ownerId, KJERAG_BOND)) return;
        u.skill.gainSp(sp, 'trait');
      });
    }
    const need = Math.max(1, S.num(it.bb.cold, 3));
    const layers = S.num(it.bb.layers, 2);
    if (!(layers > 0)) continue;
    let n = 0;
    battle.on('beforeStatus', (c) => {
      if (!c || c.cancel || c.status !== 'cold') return;
      const target = c.target;
      if (!target || !target.alive || target.side !== 'enemy' || u.ownerId == null) return;
      const src = c.source;
      if (src ? !(src.side === 'ally' && src.ownerId === u.ownerId) : target.ownerId !== u.ownerId) return;
      if (++n < need) return;
      n = 0;
      S.gainLayers(battle, { playerId: u.ownerId, bonds: [KJERAG_BOND, INDOM_BOND], n: layers, requireActive: true, source: u, reason: 'garrison' });
    }, { owner: u });
    // generic kit 把 S2 的 `atk_scale`（2.5 / 3）当成**每次攻击**的倍率；官方口径是「目标已冻结才提高到 250% / 300%」，
    // 所以目标没有冻结时把这一笔倍率退回去（`hit` 在减伤之前，`dmg.amount` 可改）。
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== u || !dmg || !dmg.isAttack || !target || target.side !== 'enemy') return;
      const sk = u.skill;
      if (!sk || !sk.active || sk.id !== AURORA_S2) return;
      if (target.s.flags.freeze) return;
      const sc = S.num(sk.bb && sk.bb.atk_scale, 1);
      if (sc > 1 && S.num(dmg.amount, 0) > 0) dmg.amount /= sc;
    }, { owner: u });
  }
});

/**
 * 圣聆初雪：`<战斗中>攻击处于寒冷、冻结的敌人时，使自身下次攻击造成的伤害无视敌人1点法术抗性（精锐2，可叠加25层）`。
 * 每满足一次就叠一层（`refresh: 'stack'` + `maxStacks`），层数即 `resIgnoreFlat` 数值（引擎的加法 mod 按层数放大）；
 * 在 `damaged` 里叠层，所以**这一击不受益**，下一击起自动带上（单位三围在 `markDirty` 后重算）。
 */
S.registerGarrisonInstaller(SBELL2_PIERCE, (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!u) continue;
    const per = S.num(it.bb.res, 0);
    const max = Math.max(1, S.num(it.bb.max, 25));
    if (!(per > 0)) continue;
    battle.on('damaged', ({ source, target, dmg }) => {
      if (source !== u || !dmg || !dmg.isAttack) return;
      if (!target || target.side !== 'enemy') return;
      const f = target.s.flags;
      if (!f.cold && !f.freeze) return;
      battle.addBuff(u, {
        key: SBELL2_PIERCE_KEY, mods: { resIgnoreFlat: per }, maxStacks: max, refresh: 'stack',
        duration: Infinity, persist: true, allowDead: true, tags: ['garrison'],
      });
    }, { owner: u });
  }
});

/**
 * 讯使 S2 `冲锋号令·防御`（本机没有 `char_198_blackd` 的官方 kit，generic kit 认不出 `blackd_s_2[period].*`）：
 * 开启时立即获得 `once.cost` 点部署费用，随后每 `period.interval` 秒获得 `period.cost` 点（`trig_cnt` 次），
 * 持续期间防御力 +`period.def`（与技能同时结束）。S1 `skcom_charge_cost[2]` 的 9 点费用 generic kit 已经能读（平键 `cost`）。
 * 讯使的特质记录是 `SERVER_PREP_START`（只进休整期，不进 `IN_BATTLE` 的特质表），所以这一段挂在包自己的
 * `install(battle)` 上，按棋子的正式 id 认人。
 */
function installCourierSkills(battle) {
  for (const u of battle.allyUnits || []) {
    if (!u || u.kind !== 'op') continue;
    const base = String(u.def?.baseId ?? u.defId ?? '');
    if (!base.includes('chess_ws_recon_courier_')) continue;
    battle.on('skillStart', ({ unit }) => {
      if (unit !== u || !u.skill || u.skill.id !== COURIER_S2 || u.ownerId == null) return;
      const bb = u.skill.bb || {};
      const once = S.num(bb['blackd_s_2[once].cost'], 3);
      if (once > 0) {
        battle.addDp(u.ownerId, once);
        S.fxOn(battle, 'dp', u, 'recon:courier', 's2', { n: once });
      }
      const period = Math.max(0.01, S.num(bb['blackd_s_2[period].interval'], 1.87));
      let left = Math.max(0, Math.floor(S.num(bb['blackd_s_2[period].trig_cnt'], 8)));
      if (left > 0) {
        const timer = battle.every(period, () => {
          if (left <= 0 || !u.alive || !u.skill || !u.skill.active) { timer.cancel(); return; }
          left--;
          battle.addDp(u.ownerId, S.num(bb['blackd_s_2[period].cost'], 1));
        });
      }
      const def = S.num(bb['blackd_s_2[period].def'], 0);
      if (def > 0) battle.addBuff(u, { key: COURIER_DEF_KEY, mods: { defPct: def }, duration: S.num(u.skill.duration, 15), refresh: 'replace', tags: ['garrison'] });
    }, { owner: u });
    battle.on('skillEnd', ({ unit }) => { if (unit === u) battle.removeBuff(u, COURIER_DEF_KEY); }, { owner: u });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 拉特兰（业主 2026-10-30）：菲亚梅塔的弹药计数（战斗 → 休整期）与蕾缪安的两条战斗内特质。
//   * 菲亚梅塔的 `<获得时>` 一半是纯数据（官方 `SERVER_GAIN_EQUIP`），这里只数「【拉特兰】干员消耗了多少弹药」；
//   * 蕾缪安的新特质：技能开启期间射程内敌人速度 -90%、自身受到伤害按【拉特兰】层数 ×2% / ×4% 降低。
// ---------------------------------------------------------------------------------------------------------------

const LATERANO_BOND = 'lateranoShip';
const PHENXI_AMMO = 'RECON_PHENXI_AMMO';
const LEMUEN_FIELD = 'RECON_LEMUEN_FIELD';
/** 战斗 → 休整期标记的键（与 `meta/main.mjs` 同一份字符串）。 */
const MARK_LATERANO_AMMO = 'reconLateranoAmmo';

/**
 * 菲亚梅塔：`<战斗中>【拉特兰】干员消耗弹药 ≥ bb.ammo` ⇒ 进入休整期时获得 1 件拉特兰桥夹。
 * `ammoUsed` 一条 = 一发（多名【拉特兰】干员的弹药都算）；战斗结束时按玩家把总数写进标记，由
 * `meta/main.mjs` 的 `lateranoPrepRewards` 对照特质记录的 `bb.ammo` 发件（阈值在数据里，普通 200 / 精锐 100）。
 */
S.registerGarrisonInstaller(PHENXI_AMMO, (battle) => {
  const spent = new Map();
  battle.on('ammoUsed', ({ unit }) => {
    if (!unit || unit.kind !== 'op' || unit.ownerId == null) return;
    if (!S.isMember(battle, unit, LATERANO_BOND)) return;
    spent.set(unit.ownerId, (spent.get(unit.ownerId) ?? 0) + 1);
  });
  battle.on('battleEnd', () => {
    for (const [playerId, n] of spent) S.setBattleMark(battle, playerId, MARK_LATERANO_AMMO, n);
  });
});

/**
 * 蕾缪安：`<战斗中>技能开启期间，攻击范围内的敌人速度-90%，自身受到的伤害降低【拉特兰】层数×2%（精锐×4%）`。
 *   * 减速：每 0.2 秒给射程内的敌人补一层 0.3 秒的 `moveMul`（离开射程就到期；技能一开立刻补一次）；
 *   * 减伤：`hit` 里按**实时**层数乘 `dmg.mul`（自身受到的任何伤害都算，层数读到多少就减多少）。
 */
S.registerGarrisonInstaller(LEMUEN_FIELD, (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!u) continue;
    const slow = S.num(it.bb.slow, 0.9);
    const pct = S.num(it.bb.pct, 0);
    const slowKey = `recon:lemuen:slow:${u.id}`;
    const pulse = () => {
      if (!u.alive || !u.deployed || !u.skill || !u.skill.active) return;
      const mul = Math.max(0, 1 - slow);
      if (!(mul < 1)) return;
      for (const e of battle.enemies || []) {
        if (!e || !e.alive || !S.inRange(u, e)) continue;
        battle.addBuff(e, { key: slowKey, duration: 0.3, refresh: 'replace', mods: { moveMul: mul }, source: u, tags: ['garrison'] });
      }
    };
    battle.on('skillStart', ({ unit }) => { if (unit === u) pulse(); }, { owner: u });
    battle.every(0.2, pulse);
    if (pct > 0) {
      battle.on('hit', ({ target, dmg }) => {
        if (target !== u || !dmg || dmg.cancel) return;
        if (!u.skill || !u.skill.active || u.ownerId == null) return;
        const cut = S.bondLayers(battle, u.ownerId, LATERANO_BOND) * pct;
        if (cut <= 0) return;
        dmg.mul = cut >= 1 ? 0 : S.num(dmg.mul, 1) * (1 - cut);
      }, { owner: u });
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 卡西米尔（业主 2026-10-30）：白金的攻速叠层与玛恩纳的固定伤害齐射。
//   * 薇薇安娜的两个「休整期 / 装备销毁」一半都在数据与 `meta/main.mjs`（骑士储蓄罐的销毁概率改写在那边的 item 处理器）。
// ---------------------------------------------------------------------------------------------------------------

const KAZIMIERZ_BOND = 'kazimierzShip';
const PLATNM_ASPD = 'RECON_PLATNM_ASPD';
const MLYNAR_FIELD = 'RECON_MLYNAR_FIELD';

/**
 * 白金：`<战斗中>未攻击时每 0.5 秒攻速 +5（最多 20 层），到顶后在场每 5 秒自身已激活盟约 +1；攻击后 10 秒内逐渐降到 0`。
 * 一个 buff（key 按干员 id 区分）每跳用 `refresh: 'replace'` 重写 `aspd` 加法值；最后一次攻击距今 < `bb.decay` 秒就减一层，
 * 否则加一层。到顶后的盟约 +1 走 `gainLayers`（只加这名干员自己的已激活盟约）。
 */
S.registerGarrisonInstaller(PLATNM_ASPD, (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!u) continue;
    const step = S.num(it.bb.aspd, 5);
    const max = Math.max(1, Math.floor(S.num(it.bb.max, 20)));
    const interval = Math.max(0.01, S.num(it.bb.interval, 0.5));
    const decay = Math.max(0, S.num(it.bb.decay, 10));
    const bondEvery = Math.max(0, S.num(it.bb.layers_interval, 5));
    const bondLayers = S.num(it.bb.layers, 1);
    const key = `recon:platnm:aspd:${u.id}`;
    let stacks = 0;
    let lastAttack = -Infinity;
    let clock = 0;
    const apply = () => {
      if (!u.alive) return;
      if (stacks <= 0) { battle.removeBuff(u, key); return; }
      battle.addBuff(u, { key, mods: { aspd: stacks * step }, duration: Infinity, refresh: 'replace', persist: true, allowDead: true, tags: ['garrison'] });
    };
    battle.on('attack', ({ attacker }) => { if (attacker === u) lastAttack = battle.time; }, { owner: u });
    battle.every(interval, () => {
      if (!u.alive || !u.deployed) return;
      const since = battle.time - lastAttack;
      // 攻击后的 `decay` 秒内只降不涨（「10 秒内逐渐降至 0」）；窗口结束后若仍在场上且没再攻击，才回到
      // 「未攻击时每 `interval` 秒 +1 层」的累积。边界含等号：正好到 10 秒的那一跳仍算窗口内，随后才开始回升。
      const next = since <= decay ? Math.max(0, stacks - 1) : Math.min(max, stacks + 1);
      if (next !== stacks) { stacks = next; apply(); }
      if (stacks >= max && bondEvery > 0) {
        clock += interval;
        if (clock >= bondEvery) {
          clock -= bondEvery;
          if (u.ownerId != null) S.gainLayers(battle, { playerId: u.ownerId, bonds: S.unitBonds(u), n: bondLayers, requireActive: true, source: u, reason: 'garrison' });
        }
      } else {
        clock = 0;
      }
    });
  }
});

/**
 * 玛恩纳：`【卡西米尔】干员每攻击 3 次，都会使全场敌人在 2 秒受到 5 次 N 点的固定伤害`。
 * 每名玛恩纳各记一份自己的攻击计数（同一玩家的【卡西米尔】干员的攻击都算）；每 3 次排 5 发无来源固定伤害
 * （`sourceless`，`type: 'true'`，间隔 `bb.interval` 秒、共 2 秒）。
 */
S.registerGarrisonInstaller(MLYNAR_FIELD, (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!u || u.ownerId == null) continue;
    const need = Math.max(1, Math.floor(S.num(it.bb.attacks, 3)));
    const ticks = Math.max(1, Math.floor(S.num(it.bb.ticks, 5)));
    const interval = Math.max(0.01, S.num(it.bb.interval, 0.4));
    const damage = S.num(it.bb.damage, 0);
    if (!(damage > 0)) continue;
    let n = 0;
    battle.on('attack', ({ attacker }) => {
      if (!attacker || attacker.kind !== 'op' || attacker.ownerId !== u.ownerId) return;
      if (!S.isMember(battle, attacker, KAZIMIERZ_BOND)) return;
      if (++n % need !== 0) return;
      for (let i = 1; i <= ticks; i++) {
        battle.after(interval * i, () => {
          for (const e of battle.enemies || []) {
            if (!e || !e.alive) continue;
            battle.dealDamage(null, e, { amount: damage, type: 'true', canDodge: false, sourceless: true, tags: ['garrison', 'addition'] });
          }
        }, { owner: u });
      }
    }, { owner: u });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 叙拉古（业主 2026-10-31）：斥罪的「替隐匿的叙拉古干员承担攻击」。
//   * 贝洛内的两条特质（部署加层 / 休整期互惠）一半在数据（`act2autochess_gar_event_onstart`）一半在
//     `meta/main.mjs`（`siracusaPrepRewards`）。
// ---------------------------------------------------------------------------------------------------------------

const SIRACUSA_BOND = 'siracusaShip';
const ZEIZ_GUARD = 'RECON_ZEIZ_GUARD';

/**
 * 斥罪：`处于隐匿的【叙拉古】干员受到的攻击由自身承担，每次承担攻击都会使【叙拉古】【不屈】层数 +4 / +8
 * （最多 6 次）`。
 * 在 `hit` 钩子上（priority −20，等其它修正都算完）把这一击取消，再以同一份数值打给斥罪自己 —— 她按自己的
 * 防御 / 法抗结算（「由自身承担」）。每承担一次就 `gainLayers` 一次，`cap` = 4/8 × 6 且 `capKey` 按干员区分，
 * 所以每名斥罪每场各自至多 6 次。另一名斥罪身上的伤害不再转走（`zeizTransfer` 标签 + 目标自带同一条特质即跳过）。
 */
S.registerGarrisonInstaller(ZEIZ_GUARD, (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!u || u.ownerId == null) continue;
    const step = Math.max(1, Math.floor(S.num(it.bb.layers, 4)));
    const maxTimes = Math.max(0, Math.floor(S.num(it.bb.max_times, 6)));
    if (!(step > 0)) continue;
    battle.on('hit', ({ source: src, target: t, dmg: d }) => {
      if (!src || !d || !t) return;
      if (!d.isAttack || src.side !== 'enemy') return;
      if (d.cancel || (Array.isArray(d.tags) && d.tags.includes('zeizTransfer'))) return;
      if (t === u || t.side !== 'ally' || t.kind !== 'op' || !t.alive || t.removed) return;
      if (!t.s || !t.s.flags || !t.s.flags.stealth) return;
      if (!S.isMember(battle, t, SIRACUSA_BOND)) return;
      if (!u.alive || !u.deployed) return;
      // 目标自己就是另一名斥罪 ⇒ 不替她承担（避免两名斥罪互相转移）
      if (S.garrisonIdsOf(t).some((gid) => /^recon_garrison_judge_/.test(gid))) return;
      d.cancel = true;
      battle.dealDamage(src, u, {
        amount: d.amount, type: d.type, mul: d.mul, canDodge: d.canDodge,
        isAttack: true, isSkill: d.isSkill, tags: ['garrison', 'addition', 'zeizTransfer'],
      });
      S.gainLayers(battle, {
        playerId: u.ownerId, bonds: [SIRACUSA_BOND, INDOM_BOND], n: step,
        requireActive: true, source: u, reason: 'garrison',
        cap: step * maxTimes, capKey: `recon:zeiz:${u.id}`,
      });
    }, { owner: u, priority: -20 });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 阿戈尔（业主 2026-10-31）：克莱门莎的元素伤害 / 侵蚀爆发冷却，海沫的「身后继承身前的特质」。
//   * 深海色（售出给 2 阶装备）与安哲拉（休整期装备替换）全在 `meta/main.mjs`。
// ---------------------------------------------------------------------------------------------------------------

const AEGIR_BOND = 'egirShip';
const CLEMNT_AEGIR = 'RECON_CLEMNT_AEGIR';
const HIGHMO_COPY = 'RECON_HIGHMO_COPY';

/**
 * 克莱门莎：`每次攻击额外附带自身 1% / 2% 生命上限 ×【阿戈尔】层数的元素伤害`；
 * `<战斗中>攻击使敌人的侵蚀损伤冷却减少 25% / 50%`。
 * 两个都挂在 `hit`：元素伤害走 `type: 'elemental'`（元素抗性结算、无视 DEF/RES），带 `recon:clemnt` 标签防递归；
 * 侵蚀爆发冷却就是引擎的 `erosionBurst` buff（`burstLock`），这里把剩余时间按比例砍掉（`duration` 留着做展示）。
 */
S.registerGarrisonInstaller(CLEMNT_AEGIR, (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!u || u.ownerId == null) continue;
    const pct = S.num(it.bb.hp_pct, 0);
    const cut = Math.min(1, Math.max(0, S.num(it.bb.cooldown_cut, 0)));
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== u || !dmg || !target || target.side !== 'enemy') return;
      if (!dmg.isAttack) return; // 「每次攻击」：技能 DoT / 元素损伤那类不算
      if (Array.isArray(dmg.tags) && dmg.tags.includes('recon:clemnt')) return;
      // 侵蚀损伤的爆发冷却（erosionBurst）按比例缩短剩余时间
      const lock = typeof target.findBuff === 'function' ? target.findBuff('erosionBurst') : null;
      if (lock && cut > 0 && lock.timeLeft > 0) lock.timeLeft = Math.max(0, lock.timeLeft * (1 - cut));
      if (!(pct > 0)) return;
      const layers = S.bondLayers(battle, u.ownerId, AEGIR_BOND);
      const amount = u.s.maxHp * pct * layers;
      if (!(amount > 0)) return;
      battle.dealDamage(u, target, {
        amount, type: 'elemental', element: 'erosion', canDodge: false,
        tags: ['garrison', 'addition', 'recon:clemnt'],
      });
    }, { owner: u });
  }
});

/** 朝向 → 前进向量（与引擎 `dir.js` 同一张表；缺省 RIGHT）。 */
const HOME_DIR_VEC = Object.freeze({ UP: [1, 0], RIGHT: [0, 1], DOWN: [-1, 0], LEFT: [0, -1] });

/** 同一玩家、同一「家格」（战前部署位置）上的干员。 */
function opAtHome(battle, pid, r, c) {
  for (const a of battle.allyUnits || []) {
    if (!a || a.kind !== 'op' || a.ownerId !== pid || a.removed) continue;
    if (a.homeR === r && a.homeC === c) return a;
  }
  return null;
}

/**
 * 海沫：`<战斗开始时>使身后一格（精锐两格）干员获得身前一格干员的特质`。
 * 引擎的动态授予通道 `battle.rbAddGarrison(unit, g)`（莱伊「复制身前干员的战斗中类效果」用的同一格）——
 * 复制的是身前一格那名干员的 **IN_BATTLE** 特质；授予发生在特质安装阶段，早于第一次部署。
 */
S.registerGarrisonInstaller(HIGHMO_COPY, (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    if (!u || u.ownerId == null || typeof battle.rbAddGarrison !== 'function') continue;
    if (!Number.isInteger(u.homeR) || !Number.isInteger(u.homeC)) continue;
    const tiles = Math.max(1, Math.floor(S.num(it.bb.tiles, 1)));
    const [dr, dc] = HOME_DIR_VEC[u.dir] || HOME_DIR_VEC.RIGHT;
    const front = opAtHome(battle, u.ownerId, u.homeR + dr, u.homeC + dc);
    if (!front || front === u) continue;
    const traits = S.garrisonIdsOf(front).map((gid) => S.garrisonRecord(gid)).filter((g) => g && g.eventType === 'IN_BATTLE');
    if (!traits.length) continue;
    for (let k = 1; k <= tiles; k++) {
      const t = opAtHome(battle, u.ownerId, u.homeR - dr * k, u.homeC - dc * k);
      if (!t || t === u) continue;
      for (const g of traits) battle.rbAddGarrison(t, g);
    }
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 本机没有官方 kit 的八名新增干员的**天赋**（业主 2026-10-31「新增干员的特质和天赋都没有生效」）。
// 特质走 `garrisons.json`（上面各段）；天赋本应写在官方 kit 的 `talents[].install` 里 —— 这八名干员没有 kit
// （`content/index.js kitOf` 落到 generic），而 generic kit 只装「写死成属性行」的天赋（`generic.js genericTalents`，
// 且只对 stand-in / 自选生效），所以这些天赋一直没有落地。下面按 `def.charId` 认人（与 `installCourierSkills`
// 按棋子 id 认人是同一类做法），每条只作用于自己的普通 / 精锐形态（charId 相同）。
//
// 数据里的 bb 就是官方那张表（`chess.json` 记录上的 `talents[].bb`），这里不重抄数值：
//   狮蝎 `{delay, atk}` · 极光 `{hp_recovery_per_sec_by_max_hp_ratio, sp_ratio}` · 讯使 `{cnt, def}`
//   空构 `{prob, stun, def_penetrate}` · 白金 `{attack@min_delta, attack@max_delta, attack@min_atk_scale, attack@max_atk_scale}`
//   海沫 `{value}` · 深海色 `{cnt, tokenKey}` · 安哲拉 `{attack_speed}`
// 海沫的第二条天赋「罹患，浸染」是【水月与深蓝之树】专属（本模式不生效），不实现。
// ---------------------------------------------------------------------------------------------------------------

const ADDED_NO_KIT = Object.freeze({
  MANTIC: 'char_215_mantic',
  AURORA: 'char_422_aurora',
  COURIER: 'char_198_blackd',
  SPURIA: 'char_4015_spuria',
  PLATNM: 'char_204_platnm',
  HIGHMO: 'char_4066_highmo',
  DEEPCL: 'char_110_deepcl',
  CUTTLE: 'char_218_cuttle',
});

/** 场上 / 编成里的干员中 charId 为 `charId` 的那些（普通与精锐同 charId）。 */
function addedOps(battle, charId) {
  const out = [];
  for (const u of battle.allyUnits || []) {
    if (u && u.kind === 'op' && u.def && u.def.charId === charId) out.push(u);
  }
  return out;
}

/** 这名干员天赋里第一个满足 `pick(bb)` 的那一条（`def.talents[].bb` 是 `simdata` 归一后的黑板）。 */
function talentWithBb(u, pick) {
  for (const t of u.def?.talents || []) if (t && t.bb && pick(t.bb)) return t;
  return null;
}

/**
 * 狮蝎「隐匿的杀手·中级」：平时隐匿；攻击时解除隐匿且**当次**攻击力 +29%（精锐 +33%），停止攻击 6 秒后重新隐匿。
 * `attack` 事件在全部命中结算之后触发，所以 `hit` 里读到的 `hidden` 仍是这次攻击开始时的状态；解除只由她自己的攻击触发
 * （敌人的攻击不解除 —— 与上面 `recon_garrison_mantic_*` 那条「受到敌人攻击后解除」的特质各自独立）。
 */
function installManticTalent(battle) {
  for (const u of addedOps(battle, ADDED_NO_KIT.MANTIC)) {
    const t = talentWithBb(u, (bb) => typeof bb.atk === 'number' && typeof bb.delay === 'number');
    const bonus = S.num(t?.bb.atk, 0);
    const delay = Math.max(0, S.num(t?.bb.delay, 6));
    if (!(bonus > 0)) continue;
    const key = `recon:mantic:talent:${u.id}`;
    let hidden = false;
    let lastAttackAt = -Infinity;
    const hide = () => {
      if (!u.alive || !u.deployed) return;
      battle.addBuff(u, { key, duration: Infinity, flags: { stealth: true }, status: 'stealth', refresh: 'replace', tags: ['talent'] });
      hidden = true;
    };
    const unhide = () => {
      if (!hidden) return;
      hidden = false;
      battle.removeBuff(u, key);
    };
    battle.on('deploy', ({ unit }) => { if (unit === u) hide(); }, { owner: u });
    battle.on('battleStart', hide, { owner: u });
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== u || !dmg || !dmg.isAttack || !hidden) return;
      if (!target || target.side !== 'enemy') return;
      dmg.amount = S.num(dmg.amount, 0) * (1 + bonus);
    }, { owner: u });
    battle.on('attack', ({ attacker }) => {
      if (attacker !== u) return;
      lastAttackAt = battle.time;
      unhide();
    }, { owner: u });
    battle.every(0.5, () => {
      if (hidden || !u.alive || !u.deployed) return;
      if (battle.time - lastAttackAt >= delay) hide();
    }, { owner: u });
  }
}

/**
 * 极光「低温休憩」：未开技能且技力 ≤ 最大值一半时停止攻击并每秒回复 3.5% 最大生命（精锐 4%）。
 * 「停止攻击」走引擎的 `disarm` 旗标（普通攻击停、技能照常）；治疗走 `battle.heal`（自身治疗，不受禁疗以外的东西影响）。
 */
function installAuroraTalent(battle) {
  for (const u of addedOps(battle, ADDED_NO_KIT.AURORA)) {
    const t = talentWithBb(u, (bb) => typeof bb.hp_recovery_per_sec_by_max_hp_ratio === 'number');
    const ratio = S.num(t?.bb.hp_recovery_per_sec_by_max_hp_ratio, 0);
    const spRatio = Math.max(0, S.num(t?.bb.sp_ratio, 0.5));
    if (!(ratio > 0)) continue;
    const key = `recon:aurora:talent:${u.id}`;
    const resting = () => {
      const sk = u.skill;
      if (!u.alive || !u.deployed || !sk || sk.active || !(sk.spCost > 0)) return false;
      return sk.sp <= sk.spCost * spRatio + 1e-9;
    };
    battle.every(0.5, () => {
      if (!resting()) {
        if (u.findBuff(key)) battle.removeBuff(u, key);
        return;
      }
      battle.addBuff(u, { key, duration: Infinity, flags: { disarm: true }, refresh: 'replace', tags: ['talent'] });
    }, { owner: u });
    battle.every(1, () => {
      if (!resting()) return;
      battle.heal(u, u, u.s.maxHp * ratio, { self: true });
    }, { owner: u });
  }
}

/** 讯使「雪境巡逻员」：阻挡 ≥2 名敌人时防御力 +11%（精锐 +13%）。按**人数**（`u.blocking.length`）判定。 */
function installCourierTalent(battle) {
  for (const u of addedOps(battle, ADDED_NO_KIT.COURIER)) {
    const t = talentWithBb(u, (bb) => typeof bb.cnt === 'number' && typeof bb.def === 'number');
    const need = Math.max(1, Math.floor(S.num(t?.bb.cnt, 2)));
    const pct = S.num(t?.bb.def, 0);
    if (!(pct > 0)) continue;
    const key = `recon:courier:talent:${u.id}`;
    battle.every(0.5, () => {
      const n = u.alive && u.deployed && Array.isArray(u.blocking) ? u.blocking.length : 0;
      if (n < need) {
        if (u.findBuff(key)) battle.removeBuff(u, key);
        return;
      }
      battle.addBuff(u, { key, mods: S.directMods({ def: pct }), duration: Infinity, refresh: 'replace', tags: ['talent'] });
    }, { owner: u });
  }
}

/**
 * 空构「装弹对比实验」：每次攻击 50% 概率三选一 —— 二连击 / 目标晕眩 1 秒 / 无视目标 60% 防御。
 * 每个 `attackId` 只掷一次（同一攻击的多目标共用结果）。二连击是**第二次命中**（照常走减伤），不是把这一击的数值乘 2。
 */
function installSpuriaTalent(battle) {
  for (const u of addedOps(battle, ADDED_NO_KIT.SPURIA)) {
    const t = talentWithBb(u, (bb) => typeof bb.prob === 'number');
    const prob = Math.max(0, Math.min(1, S.num(t?.bb.prob, 0.5)));
    const stun = Math.max(0, S.num(t?.bb.stun, 1));
    const pierce = Math.max(0, Math.min(1, S.num(t?.bb.def_penetrate, 0.6)));
    let curId = -1;
    let mode = 0; // 0 没有触发 · 1 二连击 · 2 晕眩 · 3 穿甲
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== u || !dmg || !dmg.isAttack) return;
      if (!target || target.side !== 'enemy') return;
      if (Array.isArray(dmg.tags) && dmg.tags.includes('recon:spuria:double')) return; // 追击的那一笔不再掷
      const id = dmg.attackId ?? 0;
      if (id !== curId) {
        curId = id;
        mode = 0;
        if (prob > 0 && battle.rng.chance(prob)) mode = 1 + battle.rng.int(3);
      }
      if (mode === 1) {
        const copy = { amount: dmg.amount, type: dmg.type, mul: dmg.mul, canDodge: dmg.canDodge, isSkill: dmg.isSkill, defIgnorePct: dmg.defIgnorePct, resIgnorePct: dmg.resIgnorePct };
        battle.after(0, () => {
          if (!u.alive || !target.alive || !target.deployed) return;
          battle.dealDamage(u, target, { ...copy, isAttack: true, tags: ['garrison', 'addition', 'recon:spuria:double'] });
        }, { owner: u });
      } else if (mode === 2) {
        if (stun > 0) battle.applyStatus(target, 'stun', { duration: stun, source: u });
      } else if (mode === 3) {
        if (pierce > 0) dmg.defIgnorePct = S.num(dmg.defIgnorePct, 0) + pierce;
      }
    }, { owner: u });
  }
}

/**
 * 白金「蓄力攻击」：距上次攻击越久，这一击的攻击力越高 —— 1 秒时 100%，2.5 秒时 190%（精锐 200%），中间线性。
 * 每个 `attackId` 只算一次倍率；`lastAt` 记的是**上一次攻击第一次命中**的时间（正式攻击间隔，`bat` 的射击也照此）。
 */
function installPlatnmTalent(battle) {
  for (const u of addedOps(battle, ADDED_NO_KIT.PLATNM)) {
    const t = talentWithBb(u, (bb) => typeof bb['attack@max_atk_scale'] === 'number');
    if (!t) continue;
    const minD = Math.max(0, S.num(t.bb['attack@min_delta'], 1));
    const maxD = Math.max(minD, S.num(t.bb['attack@max_delta'], 2.5));
    const minS = Math.max(0, S.num(t.bb['attack@min_atk_scale'], 1));
    const maxS = Math.max(minS, S.num(t.bb['attack@max_atk_scale'], 1.9));
    let lastAt = null;
    let curId = -1;
    let scale = 1;
    // 蓄力从**部署完成**起算（「距离上次攻击的间隔」：还没攻击过就是从部署算）—— 部署时把起点写成当时的时间
    battle.on('deploy', ({ unit }) => { if (unit === u) { lastAt = battle.time; curId = -1; } }, { owner: u });
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== u || !dmg || !dmg.isAttack) return;
      if (!target || target.side !== 'enemy') return;
      const id = dmg.attackId ?? 0;
      if (id !== curId) {
        curId = id;
        const delta = lastAt == null ? minD : Math.max(0, battle.time - lastAt);
        const k = maxD > minD ? Math.max(0, Math.min(1, (delta - minD) / (maxD - minD))) : 0;
        scale = minS + (maxS - minS) * k;
        lastAt = battle.time;
      }
      if (scale > 1) dmg.amount = S.num(dmg.amount, 0) * scale;
    }, { owner: u });
  }
}

/** 海沫「收割，给养」：每攻击到一个敌人回复自身 35 点元素损伤，最大生效数 = 阻挡数。 */
function installHighmoTalent(battle) {
  for (const u of addedOps(battle, ADDED_NO_KIT.HIGHMO)) {
    const t = talentWithBb(u, (bb) => typeof bb.value === 'number' && !bb.tokenKey);
    const value = S.num(t?.bb.value, 0);
    if (!(value > 0)) continue;
    let curId = -1;
    let hit = 0;
    battle.on('hit', ({ source, target, dmg }) => {
      if (source !== u || !dmg || !dmg.isAttack) return;
      if (!target || target.side !== 'enemy') return;
      const id = dmg.attackId ?? 0;
      if (id !== curId) { curId = id; hit = 0; }
      const cap = Math.max(0, Math.floor(S.num(u.s.blockCnt, 0)));
      if (hit >= cap) return;
      hit++;
      battle.reduceElement(u, value);
    }, { owner: u });
  }
}

/**
 * 深海色「召唤触手」：三个触手召唤物（`token_10001_deepcl_tentac`，包内 `tokens.json` 的 `placeable: false`，
 * 所以不是手牌召唤物，只能在战斗里由这条天赋放下）。部署完成后在自身周围（由近到远、行优先）找空位放下，
 * 最多 `bb.cnt` 个；`spawnToken` 自己拒绝已占格。
 */
function installDeepclTalent(battle) {
  const TOKEN = 'token_10001_deepcl_tentac';
  for (const u of addedOps(battle, ADDED_NO_KIT.DEEPCL)) {
    const t = talentWithBb(u, (bb) => typeof bb.cnt === 'number');
    const cnt = Math.max(0, Math.floor(S.num(t?.bb.cnt, 3)));
    if (!(cnt > 0)) continue;
    const tokenId = t && typeof t.tokenKey === 'string' && t.tokenKey ? t.tokenKey : TOKEN;
    const spawn = () => {
      if (!u.alive || !u.deployed) return;
      // 已经有了的不再补（`deploy` 与 `battleStart` 各跑一次；再部署 / 多次触发同样只补到 `cnt` 个）
      let need = cnt;
      for (const t of battle.allyUnits || []) {
        if (t && t.kind === 'token' && t.ownerUnit === u && t.defId === tokenId && t.alive) need--;
      }
      if (need <= 0) return;
      const spots = [];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (!dr && !dc) continue;
          const r = u.tileR + dr, c = u.tileC + dc;
          if (!battle.grid.inRect(r, c) || !battle.grid.canStand(r, c)) continue;
          spots.push([r, c, Math.abs(dr) + Math.abs(dc), dr * 10 + dc]);
        }
      }
      spots.sort((a, b) => a[2] - b[2] || a[3] - b[3]);
      let made = 0;
      for (const [r, c] of spots) {
        if (made >= need) break;
        if (battle.spawnToken(u, tokenId, r, c, { anySource: true })) made++;
      }
    };
    battle.on('battleStart', spawn, { owner: u });
    battle.on('deploy', ({ unit }) => { if (unit === u) spawn(); }, { owner: u });
  }
}

/** 安哲拉「深海直觉」：编入队伍时所有【深海猎人】干员攻击速度 +8（精锐 +10）。本模式按 `egirShip` 盟约判定。 */
function installCuttleTalent(battle) {
  const cuttles = addedOps(battle, ADDED_NO_KIT.CUTTLE);
  if (!cuttles.length) return;
  let aspd = 0;
  for (const c of cuttles) {
    const t = talentWithBb(c, (bb) => typeof bb.attack_speed === 'number');
    aspd = Math.max(aspd, S.num(t?.bb.attack_speed, 0));
  }
  if (!(aspd > 0)) return;
  const apply = (a, c) => {
    if (!a || !S.isOp(a) || a.ownerId !== c.ownerId) return;
    if (!S.isMember(battle, a, AEGIR_BOND)) return;
    S.passiveBuff(battle, a, 'talent:cuttle:aspd', { aspd }, { tags: ['talent'] });
  };
  for (const c of cuttles) for (const a of S.playerOps(battle, c.ownerId)) apply(a, c);
  battle.on('deploy', ({ unit }) => {
    if (!unit || !S.isOp(unit)) return;
    for (const c of cuttles) apply(unit, c);
  });
}

/** 八名「本机没有官方 kit」的新增干员的天赋（`install(battle)` 里调用；引擎的 generic kit 推导不出这些）。 */
function installAddedTalents(battle) {
  installManticTalent(battle);
  installAuroraTalent(battle);
  installCourierTalent(battle);
  installSpuriaTalent(battle);
  installPlatnmTalent(battle);
  installHighmoTalent(battle);
  installDeepclTalent(battle);
  installCuttleTalent(battle);
}

/** 与 `meta/main.mjs` 的 `EFFECT_KEY` 必须是同一个字符串（meta 写、这里读）。 */

const EFFECT_KEY = 'effect:recon_protocol';

/** 【重构】盟约的 id（`bonds.json` 的记录、特训学员的 `bondGrants`、引擎的 RECON_BOND_ID 三处同一个）。 */
const RECON_BOND = 'bond_recon';

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

/**
 * 熔芯负载三条的 id。**业主 2026-10-30 改规则**：预重构屏上交的是「要**排除**的那一条」，
 * 另外两条同时生效（从前是单选一条生效）。所以这里判的不是 `plan.load === X`，而是 `plan.load !== X`。
 */
const LOAD_IDS = Object.freeze([LOAD_BOND, LOAD_EQUIP, LOAD_DATA]);

/**
 * 某一条负载在这一局是否生效：`plan.load` 是三条之一（没交 / 不认识的 id ⇒ 一条都不生效，与从前的「不指定」同一口径），
 * 且不是被排除的那一条。
 * @param {{ load?: string }|null} plan
 * @param {string} id
 */
function loadActive(plan, id) {
  return !!plan && LOAD_IDS.includes(plan.load) && plan.load !== id;
}

/**
 * 战斗音乐（业主 2026-10-28）：场上出现带专属曲目的·重构首领时，`key` = 那只首领的 `defId`（没有 ⇒ null）。
 * 面板 `ui/music.js` 用**与战斗运行器同一条模块 URL** import 本模块读它（与多索雷斯包的 `DOS_LIVE` 同一做法），
 * 曲目文件在 `assets/bgm/`；没有曲目的首领（碎骨 / 庞贝 / 萨卡兹百夫长 …）落回引擎原本的战斗音乐。
 */
export const RECON_MUSIC = { key: null };

/** 有专属曲目的首领 key（与 `ui/music.js` 的 TRACKS 同一份名单；召唤物 / 增益产物不在此列）。 */
const MUSIC_BOSSES = new Set([
  // R4
  'enemy_ws_recon_cqbw', 'enemy_ws_recon_mousek', 'enemy_ws_recon_mdrock',
  // R8（霜星的「绝对零度」在源文件夹 12 里，按首领认，不看目录）
  'enemy_ws_recon_dekght', 'enemy_ws_recon_dekght_2', 'enemy_ws_recon_blkswb', 'enemy_ws_recon_xi',
  'enemy_ws_recon_jakill', 'enemy_ws_recon_mephi', 'enemy_ws_recon_faust', 'enemy_ws_recon_frstar2',
  // R12
  'enemy_ws_recon_reid', 'enemy_ws_recon_patrt', 'enemy_ws_recon_talula', 'enemy_ws_recon_mirbst',
  // R16
  'enemy_ws_recon_dirctr', 'enemy_ws_recon_bldkgt', 'enemy_ws_recon_dywqgs', 'enemy_ws_recon_morphis', 'enemy_ws_recon_mandra',
  // R20
  'enemy_ws_recon_bsnake', 'enemy_ws_recon_syskad', 'enemy_ws_recon_shchmr',
  'enemy_ws_recon_dycyue', 'enemy_ws_recon_skzjkl',
  // R21
  'enemy_ws_recon_csdoll', 'enemy_ws_recon_skzamy', 'enemy_ws_recon_muama', 'enemy_ws_recon_mutwin', 'enemy_ws_recon_musnake',
  'enemy_ws_recon_suisho', 'enemy_ws_recon_suizzh', 'enemy_ws_recon_suiyzh', 'enemy_ws_recon_suiwei',
  'enemy_ws_recon_shophm', 'enemy_ws_recon_shorbb',
]);

/** 场上带曲目的首领：真首领（`tag === 'boss'`）优先，否则第一只（试炼首领是按普通敌人追加的）。 */
function musicKeyOf(battle) {
  let any = null;
  for (const e of (battle && battle.enemies) || []) {
    if (!e || !e.alive || !MUSIC_BOSSES.has(e.defId)) continue;
    if (e.tag === 'boss') return e.defId;
    any = any || e.defId;
  }
  return any;
}

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

/** 敌方那一条 buff（数据负载 + 盟约负载合并成一条 hpPct，省一次挂 buff）。被排除的那一条不算，其余照常。 */
function enemyModsOf(battle, plans) {
  let pct = 0;
  let res = 0;
  let hp = 0;
  for (const [playerId, plan] of plans) {
    if (loadActive(plan, LOAD_DATA)) { pct = Math.max(pct, DATA_PCT); res = Math.max(res, DATA_RES); }
    if (loadActive(plan, LOAD_BOND)) {
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

/** 我方的两条（数据重构 + 装备负载）+ 本局选过的重构决策，一个单位部署时算一次（`passiveBuff` 同键替换，重复部署不会叠加）。 */
function applyAlly(battle, unit, plan, dec = null) {
  if (!S.isOp(unit)) return;
  if (plan && plan.assist === ASSIST_DATA) {
    S.passiveBuff(battle, unit, 'recon:assist_data', S.directMods({ atk: DATA_PCT, def: DATA_PCT, hp: DATA_PCT }, { resFlat: DATA_RES }));
  }
  if (loadActive(plan, LOAD_EQUIP)) {
    if (!S.itemsOf(unit).length) S.passiveBuff(battle, unit, 'recon:load_bare', { dmgDealtMul: BARE_DAMAGE_MUL });
    const tier = S.tierOf(unit);
    for (const itemId of S.itemsOf(unit)) {
      const rec = S.itemRecord(itemId);
      if (!rec || rec.itemType !== 'EQUIP') continue;
      // 阶级高于携带者 ⇒ 这件装备的**全部数值效果**（属性 + 触发类）-50%；条件不成立时恢复原样。
      S.setItemEffectScale(battle, unit, S.itemKeyOf(itemId), Number(rec.tier) > tier ? 0.5 : 1);
    }
  }
  applyDecisionAlly(battle, unit, dec);
}

// ---- 重构决策（业主 2026-10-28）：攻势 / 守备 / 削弱来自 `playerEffects` 里的 `effect:recon_decision` 条目 ----

const DECISION_KEY = 'effect:recon_decision';
const DECISION_ASSAULT = 'recon_decision_assault';
const DECISION_GUARD = 'recon_decision_guard';
const DECISION_WEAKEN = 'recon_decision_weaken';

/** 这名玩家这一局选过的决策参数（效果行 `params = { id, ally?, enemy? }`，数值全在数据里）。 */
function decisionsOf(battle, playerId) {
  const p = S.player(battle, playerId);
  const refs = p && Array.isArray(p.playerEffects) ? p.playerEffects : [];
  const out = [];
  for (const r of refs) if (r && r.key === DECISION_KEY && r.params && typeof r.params.id === 'string') out.push(r.params);
  return out;
}

/**
 * 一条决策的参数 → 引擎 mods。`resPct` / `resMin` 按这个单位的基础法抗折算成 `resFlat`
 * （守备的「法抗 +10%（至少 10 点）」与削弱的「法抗 -25%（最少 10 点）」共用这一条）。
 */
const DECISION_SPECIAL_KEYS = new Set([
  'resPct', 'resMin', 'skillCdMul', 'selfDamageAtkPct', 'randomDebuffEvery', 'randomDebuffDuration', 'fragile', 'palsy', 'weaken',
  'attackTruePct', 'attackWeakness', 'attackDebuffPct', 'attackDebuffStacks', 'attackAspd', 'attackAspdStacks',
  'shieldEvery', 'shieldPct', 'shieldMaxStacks', 'regenPctPerSec', 'flatDamageCut', 'bondLayerDamagePct',
]);

function decisionMods(raw, unit) {
  if (!raw || typeof raw !== 'object') return null;
  const mods = {};
  let resPct = null;
  let resMin = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'resPct') { resPct = Number(v); continue; }
    if (k === 'resMin') { resMin = Number(v) || 0; continue; }
    if (DECISION_SPECIAL_KEYS.has(k)) continue;
    if (Number.isFinite(Number(v))) mods[k] = Number(v);
  }
  if (Number.isFinite(resPct)) {
    const base = Number(unit.base && unit.base.res) || 0;
    const want = base * resPct;
    const floor = Math.abs(resMin);
    mods.resFlat = (mods.resFlat || 0) + (Math.abs(want) < floor ? Math.sign(resPct) * floor : want);
  }
  return Object.keys(mods).length ? mods : null;
}

/** 这名玩家「已激活盟约层数总和」（战场输入里的 bonds；`count > 0` 算激活）。 */
function bondLayerSum(battle, playerId) {
  const p = S.player(battle, playerId);
  const bonds = p && p.bonds ? p.bonds : null;
  if (!bonds || typeof bonds !== 'object') return 0;
  let sum = 0;
  for (const b of Object.values(bonds)) if (b && Number(b.count) > 0) sum += Number(b.layers) || 0;
  return sum;
}

/** 攻势 / 守备（以及后续回合同类）：只落在这名玩家自己的干员身上，一条决策一个独立 buff 键。 */
function applyDecisionAlly(battle, unit, dec, layers = 0) {
  if (!dec || !dec.length) return;
  for (const prm of dec) {
    const mods = decisionMods(prm.ally, unit) || {};
    const pct = Number(prm.ally && prm.ally.bondLayerDamagePct);
    if (pct > 0) mods.dmgDealtMul = (mods.dmgDealtMul || 1) * (1 + layers * pct);
    if (Object.keys(mods).length) S.passiveBuff(battle, unit, `recon:dec:${prm.id}`, mods);
  }
}

/** 削弱（以及后续回合同类）：落在这名玩家的敌人身上。 */
function applyDecisionEnemy(battle, enemy, dec, layers = 0) {
  if (!dec || !dec.length || !enemy || enemy.side === 'ally') return;
  for (const prm of dec) {
    const mods = decisionMods(prm.enemy, enemy) || {};
    const pct = Number(prm.enemy && prm.enemy.bondLayerDamagePct);
    if (pct > 0) mods.dmgTakenMul = (mods.dmgTakenMul || 1) * (1 + layers * pct);
    if (Object.keys(mods).length) S.passiveBuff(battle, enemy, `recon:dec:${prm.id}`, mods);
  }
}

/**
 * 读不懂成 mods 的两类决策（业主 2026-10-28 的 D 档）：
 *   * `ally.attackTruePct` —— 攻击时附带该比例的**真实伤害**（每一击、每个目标，一次）；
 *   * `ally.shieldEvery / shieldPct / shieldMaxStacks` —— 每 N 秒给这名玩家的干员加一层护盾
 *     （每层 = 生命上限 × shieldPct，最多 shieldMaxStacks 层）。
 * 参数仍全在数据里，所以后续回合复用这两个字段即可。
 */
function applyDecisionSpecials(battle, decisions) {
  let attackPctOwner = null;
  let attackWeakness = false;
  let attackDebuff = false;
  let attackSelf = false;
  let attackAspd = false;
  let bondDependent = false;
  const flatCuts = [];
  const randomDebuffs = [];
  for (const [pid, dec] of decisions) {
    for (const prm of dec) {
      const a = prm.ally;
      if (a) {
        if (Number.isFinite(a.attackTruePct) && a.attackTruePct > 0) attackPctOwner = true;
        if (a.attackWeakness === true) attackWeakness = true;
        if (Number.isFinite(a.attackDebuffPct) && a.attackDebuffPct > 0) attackDebuff = true;
        if (Number.isFinite(a.attackAspd) && a.attackAspd > 0) attackAspd = true;
        if (Number.isFinite(a.flatDamageCut) && a.flatDamageCut > 0) flatCuts.push({ pid, cut: a.flatDamageCut });
        const every = Number(a.shieldEvery);
        if (every > 0 && Number.isFinite(a.shieldPct) && a.shieldPct > 0) {
          const key = `recon:dec:${prm.id}`;
          const stacks = Number.isFinite(a.shieldMaxStacks) && a.shieldMaxStacks > 0 ? a.shieldMaxStacks : 1;
          battle.every(every, () => {
            for (const u of battle.allyUnits || []) {
              if (!u || !u.alive || !u.deployed || u.ownerId !== pid) continue;
              const per = u.s.maxHp * a.shieldPct;
              const cap = per * stacks;
              const b = u.findBuff ? u.findBuff(key) : null;
              if (b) { b.shield = Math.min(cap, (b.shield || 0) + per); u.markDirty(); }
              else battle.addBuff(u, { key, shield: Math.min(cap, per), duration: Infinity, visible: true });
            }
          });
        }
        if (Number.isFinite(a.regenPctPerSec) && a.regenPctPerSec > 0) {
          battle.every(1, () => {
            for (const u of battle.allyUnits || []) {
              if (!u || !u.alive || !u.deployed || u.ownerId !== pid) continue;
              battle.heal(u, u, u.s.maxHp * a.regenPctPerSec, { self: true });
            }
          });
        }
      }
      if (prm.enemy && Number.isFinite(prm.enemy.selfDamageAtkPct) && prm.enemy.selfDamageAtkPct > 0) attackSelf = true;
      if (prm.enemy && Number.isFinite(prm.enemy.randomDebuffEvery) && prm.enemy.randomDebuffEvery > 0) randomDebuffs.push({ pid, cfg: prm.enemy });
      if ((prm.ally && Number(prm.ally.bondLayerDamagePct) > 0) || (prm.enemy && Number(prm.enemy.bondLayerDamagePct) > 0)) bondDependent = true;
    }
  }
  if (bondDependent) {
    // R21 的「+已激活盟约层数总和×1%」：层数会随对局变化，每秒按当前总和重刷一次（同名 buff 替换）。
    battle.every(1, () => {
      for (const [pid, dec] of decisions) {
        const sum = bondLayerSum(battle, pid);
        for (const u of battle.allyUnits || []) if (u && u.alive && u.deployed && u.ownerId === pid) applyDecisionAlly(battle, u, dec, sum);
        for (const e of battle.enemies || []) if (e && e.alive && e.side === 'enemy' && e.ownerId === pid) applyDecisionEnemy(battle, e, dec, sum);
      }
    });
  }
  if (flatCuts.length) {
    // 守备A：受到的所有伤害数值 -1000（把「已扣掉的量」里最多 1000 立刻回补；不足 1000 就回到 0 伤害）
    battle.on('damaged', (c) => {
      const t = c && c.target;
      if (!t || t.side !== 'ally' || !Number.isFinite(c.amount) || c.amount <= 0) return;
      const hit = flatCuts.find((x) => x.pid === t.ownerId);
      if (!hit) return;
      battle.heal(t, t, Math.min(c.amount, hit.cut), { self: true });
    });
  }
  for (const rb of randomDebuffs) {
    // 削弱A：每 10 秒给这名玩家的敌人随机挂 50% 脆弱 / 3 层麻痹 / 50% 虚弱（各持续 10 秒）
    const cfg = rb.cfg;
    const every = cfg.randomDebuffEvery;
    const dur = Number.isFinite(cfg.randomDebuffDuration) ? cfg.randomDebuffDuration : 10;
    battle.every(every, () => {
      for (const e of battle.enemies || []) {
        if (!e || !e.alive || e.side !== 'enemy' || e.ownerId !== rb.pid) continue;
        const roll = battle.rng.int(3);
        if (roll === 0) {
          battle.applyStatus(e, 'physFragile', { duration: dur, value: Number(cfg.fragile) || 0.5 });
          battle.applyStatus(e, 'artsFragile', { duration: dur, value: Number(cfg.fragile) || 0.5 });
        } else if (roll === 1) {
          battle.applyStatus(e, 'palsy', { duration: dur, value: Number(cfg.palsy) || 3 });
        } else {
          battle.applyStatus(e, 'weaken', { duration: dur, value: Number(cfg.weaken) || 0.5 });
        }
      }
    });
  }
  if (attackWeakness) {
    // 攻势C：这名玩家的干员的物理 / 法术伤害改为「弱点伤害」（取对该目标更有效的那一类，与 陈 / 双模机械臂同一条实现）
    battle.on('hit', (c) => {
      const src = c && c.source;
      if (!src || !c.target || c.target.side !== 'enemy') return;
      const dec = decisions.get(src.ownerId) || [];
      if (dec.some((prm) => prm.ally && prm.ally.attackWeakness === true)) S.weaknessRetype(c.dmg, src, c.target);
    }, { priority: 5 });
  }
  if (attackSelf) {
    // 削弱B：敌人**实际打出**的伤害 ×5000%（`damaged` 事件的 `amount` 是已扣掉的血量；自伤自身不触发，防递归）
    battle.on('damaged', (c) => {
      const src = c && c.source;
      const t = c && c.target;
      if (!src || src.side === 'ally' || !t || t.side !== 'ally') return;
      if (!Number.isFinite(c.amount) || c.amount <= 0) return;
      if (c.dmg && Array.isArray(c.dmg.tags) && c.dmg.tags.includes('reconDecision')) return;
      const dec = decisions.get(src.ownerId) || [];
      let pct = 0;
      for (const prm of dec) if (prm.enemy && Number.isFinite(prm.enemy.selfDamageAtkPct)) pct += prm.enemy.selfDamageAtkPct;
      if (pct <= 0) return;
      battle.dealDamage(src, src, { amount: c.amount * pct / 100, type: 'true', canDodge: false, ignoreSelect: true, tags: ['reconDecision'] });
    });
  }
  if (!attackPctOwner && !attackDebuff && !attackAspd) return;
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || !a.alive || a.side !== 'ally') return;
    const dec = decisions.get(a.ownerId) || [];
    let pct = 0;
    let debuffPct = 0;
    let debuffStacks = 1;
    let aspdAdd = 0;
    let aspdStacks = 1;
    for (const prm of dec) {
      if (!prm.ally) continue;
      if (Number.isFinite(prm.ally.attackTruePct)) pct += prm.ally.attackTruePct;
      if (Number.isFinite(prm.ally.attackDebuffPct) && prm.ally.attackDebuffPct > 0) {
        debuffPct = Math.max(debuffPct, prm.ally.attackDebuffPct);
        debuffStacks = Math.max(debuffStacks, Number(prm.ally.attackDebuffStacks) || 1);
      }
      if (Number.isFinite(prm.ally.attackAspd) && prm.ally.attackAspd > 0) {
        aspdAdd = Math.max(aspdAdd, prm.ally.attackAspd);
        aspdStacks = Math.max(aspdStacks, Number(prm.ally.attackAspdStacks) || 1);
      }
    }
    if (aspdAdd > 0) {
      // 攻势A：每次攻击自身攻速 +5（最多 100 层；同名 buff 叠层、无到期）
      battle.addBuff(a, { key: `recon:dec:aspd:${a.ownerId}`, refresh: 'stack', stacks: 1, maxStacks: aspdStacks, duration: Infinity, mods: { aspd: aspdAdd }, visible: true });
    }
    if (pct > 0) {
      for (const t of c.targets || []) {
        if (!t || !t.alive) continue;
        battle.dealDamage(a, t, { amount: a.s.atk * pct, type: 'true', canDodge: false, tags: ['reconDecision'] });
      }
    }
    if (debuffPct > 0) {
      // 攻势B：每次攻击使目标防御 / 法抗 -2.5%（独立乘区；层数走同名 buff，最多 20 层）
      for (const t of c.targets || []) {
        if (!t || !t.alive || t.side === 'ally') continue;
        const key = `recon:dec:debuff:${a.ownerId}`;
        const baseRes = Number(t.base && t.base.res) || 0;
        battle.addBuff(t, {
          key, duration: Infinity, refresh: 'stack', stacks: 1, maxStacks: debuffStacks,
          mods: { defPct: -debuffPct, resFlat: -baseRes * debuffPct }, visible: true,
        });
      }
    }
  });
}

/** 削弱C 的第二半：这名玩家的敌人的技能首次释放与冷却 ×`skillCdMul`（生成时按记录里的 cd / icd 与运行时计时器一起缩放）。 */
function scaleEnemySkills(enemy, dec) {
  if (!dec || !dec.length || !enemy || !enemy.mem || !enemy.mem.ab) return;
  let mul = 1;
  for (const prm of dec) if (prm.enemy && Number.isFinite(prm.enemy.skillCdMul) && prm.enemy.skillCdMul > 0) mul *= prm.enemy.skillCdMul;
  if (mul === 1) return;
  const ab = enemy.mem.ab;
  if (ab.sk && typeof ab.sk === 'object') {
    for (const s of Object.values(ab.sk)) {
      if (!s) continue;
      if (Number.isFinite(s.cd)) s.cd *= mul;
      if (Number.isFinite(s.icd)) s.icd *= mul;
    }
  }
  if (Array.isArray(ab.list)) {
    for (const a of ab.list) {
      if (!a) continue;
      if (Number.isFinite(a.cd)) a.cd *= mul;
      if (Number.isFinite(a.left)) a.left *= mul;
    }
  }
}

/** 每个战场建起来时跑一次（`sim/content/index.js installContent` 在官方内容模块之后调用）。 */
export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  installReconBosses(battle);
  // 讯使 S2 的两处补数（特质记录是休整期的，不进战斗特质表）
  installCourierSkills(battle);
  // 八名没有官方 kit 的新增干员的天赋（generic kit 只装无条件属性行，推导不出这些）
  installAddedTalents(battle);
  // 【重构】盟约的 4 人档属性加成：与预重构的两条选择无关，任何重构对局都要挂
  installReconBondStats(battle);
  // 战斗音乐：每 tick 认一次场上有没有带专属曲目的·重构首领（面板读 RECON_MUSIC）
  battle.on('tick', () => {
    const key = musicKeyOf(battle);
    if (RECON_MUSIC.key !== key) RECON_MUSIC.key = key;
  });
  RECON_MUSIC.key = musicKeyOf(battle);
  const plans = new Map();
  const decisions = new Map();
  for (const p of battle.players) {
    const playerId = p && p.playerId;
    if (!playerId) continue;
    const plan = planOf(battle, playerId);
    if (plan && (plan.assist || plan.load)) plans.set(playerId, plan);
    const dec = decisionsOf(battle, playerId);
    if (dec.length) decisions.set(playerId, dec);
  }
  if (!plans.size && !decisions.size) return;
  const enemyMods = enemyModsOf(battle, plans);
  if (enemyMods) {
    const apply = (enemy) => { if (enemy && enemy.side !== 'ally') S.passiveBuff(battle, enemy, 'recon:load', enemyMods); };
    battle.on('enemySpawn', (ctx) => apply(ctx && ctx.enemy));
    for (const e of battle.enemies || []) apply(e);
  }
  if (decisions.size) {
    // 削弱：按敌人归属到选了这条的玩家
    const applyEnemy = (enemy) => {
      if (!enemy) return;
      const dec = decisions.get(enemy.ownerId);
      applyDecisionEnemy(battle, enemy, dec, bondLayerSum(battle, enemy.ownerId));
      scaleEnemySkills(enemy, dec);
    };
    battle.on('enemySpawn', (ctx) => applyEnemy(ctx && ctx.enemy));
    for (const e of battle.enemies || []) applyEnemy(e);
    applyDecisionSpecials(battle, decisions);
  }
  battle.on('deploy', (ctx) => {
    const unit = ctx && ctx.unit;
    if (unit && unit.side === 'ally') applyAlly(battle, unit, plans.get(unit.ownerId), decisions.get(unit.ownerId), bondLayerSum(battle, unit.ownerId));
  });
  // 建场时已经站在场上的（今天的部署是逐波来的，install 时通常一个都没有 —— 这一趟是防御性的）
  for (const u of battle.allyUnits || []) if (u && u.deployed) applyAlly(battle, u, plans.get(u.ownerId), decisions.get(u.ownerId), bondLayerSum(battle, u.ownerId));
}

/**
 * 重构盟约（`bond_recon`）4 人档（业主 2026-10-30，数值在 `bonds.json` 的 `bb.recon_stat_pct`）：在场 ≥4 名【重构】
 * 干员（阈值 [2,4] ⇒ tier 2）时，**他们自己的**生命上限与基础攻击力 +50%。与官方盟约同一个「直接乘算」桶
 * （`S.directMods`），所以和技能/装备的 +X% 是相加关系。干员是逐波部署的，所以认 `deploy` 事件；
 * 召唤物不吃（与 `bonds/dataDriven.js` 的通用盟约加成同口径，只有干员本人）。
 */
function installReconBondStats(battle) {
  const rec = S.bondRecord(RECON_BOND);
  const pct = rec && rec.bb ? Number(rec.bb.recon_stat_pct) : 0;
  if (!(pct > 0)) return;
  const pids = new Set();
  for (const p of battle.players || []) {
    const playerId = p && p.playerId;
    if (playerId && S.bondTier(battle, playerId, RECON_BOND) >= 2) pids.add(playerId);
  }
  if (!pids.size) return;
  const mods = S.directMods({ atk: pct, hp: pct });
  const apply = (unit) => {
    if (!unit || unit.side !== 'ally' || unit.kind !== 'op') return;
    if (!pids.has(unit.ownerId)) return;
    if (!S.isMember(battle, unit, RECON_BOND)) return;
    S.passiveBuff(battle, unit, 'bond:recon:stat', mods);
  };
  battle.on('deploy', (ctx) => apply(ctx && ctx.unit));
  for (const u of battle.allyUnits || []) if (u && u.deployed) apply(u);
}

/** 供测试与诊断：本模块认的四条规则与它们的数值（一条真相）。 */
export const RECON_BATTLE_RULES = Object.freeze({
  EFFECT_KEY, ASSIST_DATA, LOAD_DATA, LOAD_BOND, LOAD_EQUIP, DATA_PCT, DATA_RES, BOND_LOAD_PER_LAYER, BARE_DAMAGE_MUL, KINDS,
  DECISION_KEY, DECISION_ASSAULT, DECISION_GUARD, DECISION_WEAKEN,
});

// ---------------------------------------------------------------------------------------------------------------
// ·重构 首领（现存 4 / 8 / 12 / 16 回合的四批）—— 数据在
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
// （官方 W 的 kit 里只有 C4，所以没有别的东西会丢）；记录里的 `cooldown` 仍是官方 20 s，本包每次开火后按
// **×0.5（10 s）** 重置计时器（业主 2026-10-27：冷却降低 50%）。
//
// 第 16 回合的五只（业主 2026-10-28 重新制作）：蔓德拉 / 血骑士狄开俄波利斯 / 莫菲丝 / “酒神” / “望” —— 引擎同样
// 没有它们的 kit，官方行为与重构增量都在本包实现（旧版依赖的地图装置一律不实现）。
// 第 20 回合的五只（业主 2026-10-28 重新制作）：不死的黑蛇 / 奎隆 / 伊莎玛拉 / 玻利瓦尔 / 朔壳 —— 引擎同样没有它们的
// kit，官方行为与重构增量都在本包实现（地图装置一律不实现）。
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
//     是「近战（被阻挡）再多一发」；这一发的伤害**无视目标 25% 防御力**（2026-10-27）。

const BOSS_SKULSR = 'enemy_ws_recon_skulsr';
const BOSS_LSLIME = 'enemy_ws_recon_lslime';
const BOSS_CQBW = 'enemy_ws_recon_cqbw';
const BOSS_MDROCK = 'enemy_ws_recon_mdrock';
const BOSS_MOUSEK = 'enemy_ws_recon_mousek';
const BOSS_DEMONK = 'enemy_ws_recon_demonk';

// 第 8 回合的新一批（业主 2026-10-27）：腐败 / 凋零 / 自在 / 梅菲斯特 / 浮士德 / 杰斯顿 / 霜星
const BOSS_XI = 'enemy_ws_recon_xi';
const BOSS_MEPHI = 'enemy_ws_recon_mephi';
const BOSS_FAUST = 'enemy_ws_recon_faust';
const BOSS_FRSTAR2 = 'enemy_ws_recon_frstar2';
/** 腐败 / 凋零骑士·重构（官方 kit 的同伴亡语只认官方 key，重构这一对由本包自己接线）。 */
const BOSS_DEKGHT = 'enemy_ws_recon_dekght';
const BOSS_DEKGHT_2 = 'enemy_ws_recon_dekght_2';

// 第 8 回合的锏·重构（数据 + 本包代码；大亚当 / 自在 / 杰斯顿·威廉姆斯 三只纯数据改动，没有本包的代码）
const BOSS_BLKSWB = 'enemy_ws_recon_blkswb';

/** 泥岩巨像（data/enemies.json）：泥岩·重构「首次跌破半血」时召唤的那一只（普通单位，不是 part/boss tag）。 */
const MDGINT_KEY = 'enemy_1092_mdgint';

/** 锏·重构 攻击冻结的概率（业主：10%）。随机数走战场自己的种子流 `battle.rng`（确定性；绝不用 Math.random）。 */
const BLKSWB_FREEZE_PROB = 0.1;
/** 冻结时长沿用引擎既有值：`COLD_FREEZE_DURATION` = 3 s（server/sim/constants.js:177）[ASSUMED: 冻结时长沿用引擎既有值 3 s，业主未指定]。 */
const FREEZE_DURATION = 3;

/** 碎骨榴弹：PRTS 天赋「相当于攻击力26%的物理伤害…」——与引擎 leaders.js:31 同一组数。
 *  重构版只改伤害口径：这枚榴弹**无视目标 25% 防御力**（不再挂防御下降）。 */
const GRENADE_SCALE = 0.26;
const GRENADE_DEF_IGNORE = 0.25;
/** 三条「·重构」共用的半血阈值（碎骨/庞贝/W 的官方 kit 都读 0.5）。 */
const HALF_HP = 0.5;

/** W 的 C4 引信与爆炸半径（引擎 leaders.js:49 的 C4_FUSE / C4_RADIUS，[ASSUMED]）。 */
const C4_FUSE = 1;
const C4_RADIUS = 1;
/** C4 冷却缩减（业主 2026-10-27：冷却时间降低 50%）。 */
const C4_COOLDOWN_SCALE = 0.5;

/** 梅菲斯特·重构：光环每秒额外回复、普攻治疗加成、召唤周期 / 每周期只数、浮士德阵亡后的召唤数。 */
const MEPHI_AURA_FLAT = 25;
const MEPHI_HEAL_BONUS = 500;
const MEPHI_HEAL_TARGETS = 3;
const MEPHI_INTERVAL = 10;
const MEPHI_PER_TICK = 3;
const MEPHI_AVENGE = 10;
const AURA_REFRESH = 1;
const MEPHI_AURA_KEY = 'recon:mephi_aura';
/** 宿主池（data/enemies.json 里名字含「宿主」的三只）。 */
const HOST_KEYS = Object.freeze(['enemy_1043_zomsbr', 'enemy_1061_zomshd', 'enemy_1062_rager_2']);

/** 浮士德·重构：隐匿取代无敌（时长沿用官方 invincible.duration），梅菲斯特阵亡后攻击间隔 −2 s。 */
const FAUST_STEALTH_KEY = 'recon:faust_stealth';
const FAUST_BAT_CUT = 2;
const FAUST_HASTE_KEY = 'recon:faust_haste';

/** 自在·重构：额外选择 1 个目标（第二近）；纬地经天的十字臂长沿用引擎 XI_CROSS_REACH = 2。 */
const XI_CROSS_REACH = 2;

/** 霜星·重构：第二形态额外 DEF +150%（defPct 1.5 ⇒ ×2.5）。 */
const FRSTAR_FORM2_DEF_PCT = 1.5;

/** 第 12 回合：塔露拉 / 爱国者 / 狂躁异质裂兽（引擎没有 kit，官方行为由本包补）。 */
const BOSS_TALULA = 'enemy_ws_recon_talula';
const BOSS_PATRT = 'enemy_ws_recon_patrt';
const BOSS_MIRBST = 'enemy_ws_recon_mirbst';
/** 塔露拉·重构：每次普通攻击附带 25% 攻击力的灼燃。 */
const TALULA_BURN_SCALE = 0.25;
/** 爱国者：光环半径、毁灭姿态射程、行军姿态连击数。 */
const PATRT_AURA_RADIUS = 1.5;
const PATRT_RAGE_RANGE = 2;
const PATRT_HITS = 5;
/** 狂躁异质裂兽：第二形态回复 50% 生命。 */
const MIRBST_PHASE2_HEAL = 0.5;

/** 第 16 回合：蔓德拉 / 血骑士狄开俄波利斯 / 莫菲丝 / “酒神” / “望”（引擎没有 kit，官方行为由本包补）。 */
const BOSS_MANDRA = 'enemy_ws_recon_mandra';
const BOSS_BLDKGT = 'enemy_ws_recon_bldkgt';
const BOSS_MORPHIS = 'enemy_ws_recon_morphis';
const BOSS_DIRCTR = 'enemy_ws_recon_dirctr';
const BOSS_DYWQGS = 'enemy_ws_recon_dywqgs';
// 第 20 回合（最终首领）
const BOSS_BSNAKE = 'enemy_ws_recon_bsnake';
const BOSS_SKZJKL = 'enemy_ws_recon_skzjkl';
const BOSS_SYSKAD = 'enemy_ws_recon_syskad';
const BOSS_SHCHMR = 'enemy_ws_recon_shchmr';
const BOSS_DYCYUE = 'enemy_ws_recon_dycyue';
// 第 21 回合（隐秘核心）
const BOSS_CSDOLL = 'enemy_ws_recon_csdoll';
const BOSS_SKZAMY = 'enemy_ws_recon_skzamy';
const BOSS_MUAMA = 'enemy_ws_recon_muama';
const BOSS_MUTWIN = 'enemy_ws_recon_mutwin';
const BOSS_MUSNAKE = 'enemy_ws_recon_musnake';
/** 岁四部位·重构（业主 2026-10-29）：每块 boss 场地只放一只（引擎 `reconBossWaveFor` 按区域切 key）。 */
const BOSS_SUISHO = 'enemy_ws_recon_suisho';
const BOSS_SUIZZH = 'enemy_ws_recon_suizzh';
const BOSS_SUIYZH = 'enemy_ws_recon_suiyzh';
const BOSS_SUIWEI = 'enemy_ws_recon_suiwei';
/** 抬起（业主 2026-10-29）：抬起 5 s、期间 80% 减伤；技能首次释放与冷却统一 30 s。 */
const SUI_LIFT = 5;
const SUI_LIFT_TAKEN = 0.2;
const SUI_SP_INIT = 30;
const SUI_SP_CD = 30;
/** 【十方怼怒】：向所有干员的位置爆开，持续 10 s（每 0.5 s 一跳）。 */
const SUI_FIRE_DURATION = 10;
const SUI_FIRE_TICK = 0.5;
/** 【天倾地陷】：攻击次数 3 → 4，范围 3×3 → 5×5；【掩月】/【蔽日】仍是 3×3。 */
const SUI_TAIL_HITS = 4;
const SUI_TAIL_AOE = 2;
const SUI_CLAW_AOE = 1;
/** 【柱折维绝】：生命首次 < 50% ⇒ 20 普通 + 10 精英（本场随机特训类型）。 */
const SUI_BREAK_RATIO = 0.5;
const SUI_BREAK_NORMAL = 20;
const SUI_BREAK_ELITE = 10;
/** 洛伦茨，扰动之谬 / 源阶方·重构（业主 2026-10-29）：只出现在 boss 区域2/3/4，每个区域一整对。 */
const BOSS_SHOPHM = 'enemy_ws_recon_shophm';
const BOSS_SHORBB = 'enemy_ws_recon_shorbb';
/** 源阶粒素：本包内联记录（官方记录只在 enemy-ext 包里，不能依赖它）。 */
const SUMMON_SHORSM = 'enemy_ws_recon_shorsm';
const SHP_SHIELD_INIT = 20;    // 冰盾 30/30 → 20/20
const SHP_SHIELD_CD = 20;
const SHP_FAKE_MIN = 1;        // 假死：强制保留 1 点生命值
const SHP_FAKE_REGEN = 0.03;   // 假死：每秒 3% 生命上限
const SHP_DR_INIT = 0.05;      // 源阶方初始 95% 减伤
const SHP_DR_WAKE = 0.3;       // 洛伦茨假死时移除 65% 减伤（95% → 30%）
const SHP_AOE_CD = 8;          // 失链裂变：半血前 8 秒
const SHP_AOE_INIT = 10;       // 首次 15 → 10
const SHP_AOE_ADVANCE = 4;     // 半血后 4 秒
const SHP_AOE_SCALE = 1;
const SHP_BLAST_CD = 20;       // 召唤模块 → 全场死亡爆炸：冷却 20 / 首次 10
const SHP_BLAST_INIT = 10;
const SHP_BLAST_SCALE = 2;
const SHORSM_INTERVAL = 10;    // 每 10 秒
const SHORSM_COUNT = 5;        // 5 个（每块 boss 区域各自召唤）
const SHORSM_BOOM_SCALE = 2;   // 死亡爆炸 = ATK×2（官方 boom.atk_scale）
const SHORSM_AOE = 1;          // [ASSUMED] 3×3
/** 凝血之刃（本包 enemies.json 里的召唤物，官方 enemy_1186_bldbld 的变体）。 */
const SUMMON_BLDBLD = 'enemy_ws_recon_bldbld';

/** 蔓德拉：注目额外 −25 法抗；第二形态石之盾溅射额外 −10 法抗（新机制，记录里没有对应字段）。 */
const MANDRA_RAY_RES_DOWN = 25;
const MANDRA_STONE_RES_DOWN = 10;
const MANDRA_STONE_DEBUFF_DURATION = 3;
/** 血骑士：【血归】的持续伤害时长（记录里没有 duration，官方持续 10 s）[ASSUMED]。 */
const BLDKGT_BLOOD_DURATION = 10;
/** 凝血之刃走向血骑士的移速 [ASSUMED]：它是召唤物，没有自己的路线。业主 2026-10-29：原速 2 太快，降低 75% ⇒ 0.5。 */
const BLDKGT_BLADE_SPEED = 0.5;
/** 莫菲丝：【感官的剥离】连接自身时自身受到伤害 ×0.75；每根有效丝线额外 DEF +25%、RES +25。 */
const MORPHIS_SELF_TAKEN = 0.75;
const MORPHIS_LINE_DEF = 0.25;
const MORPHIS_LINE_RES = 25;
/** 莫菲丝的时间常量（记录里没有 initCooldown / 释放间隔，沿用旧版）[ASSUMED]。 */
const MORPHIS_RED_INIT = 18;
const MORPHIS_RED_INTERVAL = 15;
const MORPHIS_EVOLVE_INTERVAL = 18;
const MORPHIS_RED_RADIUS = 2.45;
/** “酒神”：非阻挡干员的物理/法术伤害 ×0.5；【幕间不息】方形半径 2.8、蓄力 1 s [ASSUMED]。 */
const DIRCTR_CUT = 0.5;
const DIRCTR_SCENE_RADIUS = 2.8;
const DIRCTR_CHARGE = 1;
/** “望”：【落】主目标 ATK×100%、相邻 50%；周期 10 s；第一形态眩晕 50% / 5 s、未被阻挡减伤 50%。 */
const DYWQGS_FALL_SCALE = 1;
const DYWQGS_FALL_SPLASH = 0.5;
const DYWQGS_FALL_RADIUS = 1;
const DYWQGS_FALL_INTERVAL = 10;
const DYWQGS_STUN_CHANCE = 0.5;
const DYWQGS_STUN_DURATION = 5;
const DYWQGS_UNBLOCKED_TAKEN = 0.5;
/** 【征】首次 20 s、之后 40 s，一次至多 3 名；第二形态连续 6 次【落】、之后每 10 s 召唤 2 只精英。 */
const DYWQGS_ZH_INIT = 20;
const DYWQGS_ZH_INTERVAL = 40;
const DYWQGS_ZH_MAX = 3;
const DYWQGS_FORM2_FALLS = 6;
const DYWQGS_ELITE_INTERVAL = 10;
const DYWQGS_ELITE_COUNT = 2;

/** 本包在战场便签里的命名空间（引擎 SDK 的 battleStore，每场一份）。 */
const BOSS_STORE = 'recon:bosses';
/** 战场便签：W 的 C4 计时器（每只 W 一条）、泥岩·重构 的「已召唤」标记、“复仇者”·重构 的攻击间隔叠层（每只一条）。 */
function bossStore(battle) {
  return S.battleStore(battle, BOSS_STORE, () => ({
    c4: new Map(), summoned: new WeakSet(), reid: new Map(), mousekDrift: new WeakMap(),
    mephi: new Map(), mephiHeal: new Map(), faust: new Map(), frstar: new Map(), xiCross: new WeakMap(),
    talula: new Map(), patrt: new Map(), mirbst: new Map(),
    mandra: new Map(), bld: new Map(), morphis: new Map(), dirctr: new Map(), wang: new Map(),
    bsnake: new Map(), skzjkl: new Map(), syskad: new Map(), shchmr: new Map(), shuoke: new Map(),
    csdoll: new Map(), skzamy: new Map(), muama: new Map(), mutwin: new Map(), musnake: new Map(),
    sui: new Map(), shp: new Map(), shorb: new Map(),
  }));
}

/** 敌人能否行动：与引擎 helpers.js canCast 同口径（活着、在场、不晕、不因沉默封技能、不在失衡里）。 */
function canAct(battle, e) {
  return !!(e && e.alive && !e.hidden && !e.s.flags.stun && !e.s.flags.silence && !(battle.time < e.unbalanceUntil - 1e-9));
}

/**
 * 给**带共享血池**的首领回血：池是唯一真相（`_syncBossHp` 会把单位血条按池的比率重写，直接写 `e.hp` 会被下一次同步
 * 覆盖，§5.4）。多块场地共用同一条池 ⇒ `window` 游戏秒内只认第一块场地的这一次，避免翻倍。
 * 没有池（普通回合 / 单战场测试）时退回写单位血条。
 */
function healBoss(battle, e, amount, win = 0.9) {
  if (!(amount > 0)) return 0;
  const p = battle.sharedBoss;
  if (!p || !Number.isFinite(p.hp) || !(p.maxHp > 0)) {
    if (e.hp >= e.s.maxHp - 1e-6) return 0;
    const before = e.hp;
    e.hp = Math.min(e.s.maxHp, e.hp + amount);
    e.markDirty();
    return e.hp - before;
  }
  if (p.hp >= p.maxHp - 1e-6) return 0;
  if (p._reconHealAt != null && battle.time >= p._reconHealAt && battle.time - p._reconHealAt < win) return 0;
  p._reconHealAt = battle.time;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  return p.hp - before;
}

/** 本场的共享血池（普通回合 / 单战场测试里是 null）。 */
function bossPoolOf(battle) {
  const p = battle && battle.sharedBoss;
  return p && typeof p.damage === 'function' && Number.isFinite(p.hp) ? p : null;
}

/**
 * 多阶段首领 × 共享血池的通用驱动（交接 §5.3）。
 *
 * 挂池的单位**不能**被包侧 `kill` 钩子复活（`server/sim/battle/deploy.js:kill` 只保留 `!unit.bossPool` 的复活），
 * 所以阶段交接改挂在**池的状态**上：`Match` 的 `SharedBossPool` 支持「多条命」（`setLives`）——中间阶段扣血时池被夹在
 * 1、`phaseReady` 置位；哪个战场先察觉到就 `takePhase(refill)` 原子推进（多块场地只推进一次）并把池回填，
 * 各战场再各自跑本地的阶段脚本（`onPhase`）。
 *
 * @param {any} battle
 * @param {any} e 首领单位
 * @param {any} s 本地阶段状态（本函数用 `poolPhase` / `poolLives` 两格）
 * @param {{ lives: number | (() => number), refill?: (phase: number) => number, onPhase?: (phase: number) => void }} o
 * @returns {number} 本地已同步到的阶段（0 = 第一阶段）
 */
function syncPoolPhase(battle, e, s, { lives, refill = null, onPhase = null }) {
  const pool = bossPoolOf(battle);
  if (!pool || typeof pool.takePhase !== 'function') return s.poolPhase ?? 0;
  const want = Math.max(1, Math.floor(Number(typeof lives === 'function' ? lives() : lives) || 1));
  if (s.poolLives !== want) {
    s.poolLives = want;
    pool.setLives(want);
  }
  if (s.poolPhase == null) s.poolPhase = Number.isFinite(pool.phase) ? pool.phase : 0;
  if (pool.phaseReady && s.poolPhase === pool.phase) {
    const nxt = pool.phase + 1;
    pool.takePhase(refill ? refill(nxt) : 1);
  }
  if (pool.phase !== s.poolPhase) {
    s.poolPhase = pool.phase;
    if (onPhase) onPhase(pool.phase);
  }
  return s.poolPhase;
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
  // cast 窗口 = 技能时长（bb.duration）；没有时长就交给客户端的 ENEMY_GRACE（0.3 s）处理。
  const d = sk.bb && typeof sk.bb.duration === 'number' && sk.bb.duration > 0 ? Math.round(sk.bb.duration * 100) / 100 : 0;
  battle._ev(d > 0 ? ['cast', e.id, at, d] : ['cast', e.id, at]);
  // 技能**动作**：`['cast']` 只开特效窗口，敌人快照不亮 SKILL ⇒ 还要 `['skill', 1/0]`（与 enemy-ext 同口径）。
  // 重叠窗口用引用计数：第一次 +1 时开，最后一个结束时才关。
  if (!(e._reconSkillWins > 0)) { e._reconSkillWins = 0; battle._ev(['skill', e.id, 1]); }
  e._reconSkillWins += 1;
  const hold = d > 0 ? d : 0.3;
  battle.after(hold, () => {
    e._reconSkillWins = Math.max(0, (e._reconSkillWins || 1) - 1);
    if (e._reconSkillWins === 0) battle._ev(['skill', e.id, 0]);
  }, { owner: e });
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

/** 十字（曼哈顿 ≤ n）内的我方：唱沙「伤害无视迷彩」⇒ 只排除无法选中，不排除隐匿。 */
function alliesInPlus(battle, r, c, n) {
  const out = [];
  const rr = Math.round(r), cc = Math.round(c);
  for (const a of battle.allies()) {
    if (!a || !a.alive || a.s.flags.untargetable) continue;
    if (Math.abs(Math.round(a.tileR) - rr) + Math.abs(Math.round(a.tileC) - cc) <= n) out.push(a);
  }
  return out;
}

/** 十字的**两条臂**（同行或同列，距离 ≤ n；不含四个斜角）—— 与引擎 `areaAlliesInTiles(...,'plus', n)` 同形。 */
function alliesInCrossArms(battle, r, c, n) {
  const out = [];
  const rr = Math.round(r), cc = Math.round(c);
  for (const a of battle.allies()) {
    if (!a || !a.alive || a.s.flags.untargetable) continue;
    const dr = Math.round(a.tileR) - rr, dc = Math.round(a.tileC) - cc;
    if ((dr === 0 && Math.abs(dc) <= n) || (dc === 0 && Math.abs(dr) <= n)) out.push(a);
  }
  return out;
}

/** 「方形」区域内的我方（Chebyshev ≤ n，按真实格坐标）—— 【幕间不息】的 2.8 格方形。 */
function alliesInSquare(battle, r, c, n) {
  const out = [];
  for (const a of battle.allies()) {
    if (!a || !a.alive || a.s.flags.untargetable) continue;
    if (Math.max(Math.abs(a.tileR - r), Math.abs(a.tileC - c)) <= n) out.push(a);
  }
  return out;
}

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

/** 阶段切换的模型动作（客户端 FORMS 的 form2 一套）。 */
const FORM2 = { form: 'form2' };

/** 梅菲斯特·重构 的宿主召唤：`n` 只用战场 rng 从宿主池里抽，放在 `e` 脚下。 */
function summonHosts(battle, e, n) {
  for (let i = 0; i < n; i++) {
    const key = battle.rng.pick(HOST_KEYS);
    battle.spawnEnemy(key, { pos: [e.y, e.x], ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
    battle.fx('summon', { x: e.x, y: e.y, id: e.id, key, n: 1 });
  }
}

/** 给「没有引擎 kit」的敌人补一个空 kit 壳，只为了借 `mem.ab.atkType` 这条伤害类型通道（list 永远是空的）。 */
function ensureKitShell(e) {
  if (e.mem.ab) return e.mem.ab;
  e.mem.ab = { key: e.defId, t: {}, tS: {}, sk: {}, list: [], times: null, hitShield: 0, atkType: null, immune: null, origMaxHp: e.base.maxHp };
  return e.mem.ab;
}

/**
 * 1. 碎骨·重构：**被阻挡**的普通攻击额外发射一枚榴弹（官方 kit 只在「未被阻挡」时发射，那一路已经归引擎）。
 * 落点是「目标 + 其 3×3 格块」内的每一个我方单位；每人都吃 ATK×0.26 物理，且这枚榴弹的伤害**无视目标 25% 防御力**
 * （业主 2026-10-27；旧版挂的「防御力下降 50%」已移除）。
 */
function installSkulsr(battle) {
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_SKULSR || c.isSkill || !a.blockedBy) return;
    const t = c.targets && c.targets[0];
    if (!t || !t.alive) return;
    battle.fx('grenade', { x: t.x, y: t.y, r: 1.5, kind: 'grenade' });
    for (const u of alliesInBox(battle, t.tileR, t.tileC, 1)) {
      battle.dealDamage(a, u, { amount: a.s.atk * GRENADE_SCALE, type: 'phys', defIgnorePct: GRENADE_DEF_IGNORE, canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'splash'] });
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
    // 引擎 `targetAndArea` 的同一条口径：锁定目标**一定**吃到（引信期间走出落点也一样），其余是范围选择。
    const list = [];
    for (const u of battle.alliesInRadius(x, y, C4_RADIUS)) {
      if (u.hidden || u.isFlying || u.s.flags.untargetable) continue;
      list.push(u);
    }
    if (t && t.alive && !list.includes(t)) list.push(t);
    for (const u of list) {
      battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
    }
  });
}

/**
 * 3. W·重构：本包自有的 C4。计时器（每只 W 一条）在 `enemySpawn` 时以记录的 `initCooldown` 起算，`tick` 里递减，
 * 能行动且场上有可选目标时开火、重置为记录的 `cooldown` **×0.5**（业主 2026-10-27：冷却降低 50%）。目标数 = 官方的
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
      s.left = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0 ? sk.cooldown : 20) * C4_COOLDOWN_SCALE;
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
 * 5. 鼠王·重构：官方 kit 由 `effectRef` 继承（屏障 / 半血增伤 / 唱沙 / 沙狱）。
 * 重构增量（业主 2026-10-27）：
 *   * 【唱沙】选择的目标 +1 —— 官方只打「生命上限最高」的一名；本模块在官方那一次命中后，再对**生命上限第二高**的
 *     我方补一次同样的「十字范围、ATK 口径的 800 物理」（同一次唱沙只补一次：用战场便签按时间戳去重）；
 *   * 屏障数值 +50% —— 纯数据（`talents.bb["shield.dynamic"]` 4667 → 7000）。
 * 其余（沙狱 / 半血增伤）完全沿用官方 kit。
 */
function installMousek(battle) {
  battle.on('damaged', (c) => {
    const src = c && c.source, dmg = c && c.dmg;
    if (!src || src.defId !== BOSS_MOUSEK || !dmg || !dmg.isSkill || dmg.isAttack || dmg.type !== 'phys') return;
    const st = bossStore(battle);
    const last = st.mousekDrift.get(src);
    // 同一次唱沙会命中十字内的多名单位：只补一次；也挡住本模块自己补的那次伤害（同一时刻）。
    if (last != null && battle.time - last < 0.05) return;
    st.mousekDrift.set(src, battle.time);
    const sk = skillOf(src, 'DriftSand');
    const amount = sk && sk.bb && Number.isFinite(sk.bb.damage) ? sk.bb.damage : 800;
    const list = battle.allies()
      .filter((u) => u && u.alive && !u.s.flags.untargetable)
      .sort((a, b) => b.s.maxHp - a.s.maxHp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const extra = list[1]; // 官方打的是 list[0]（生命上限最高）；+1 ⇒ 再打第二高
    if (!extra) return;
    battle.fx('telegraph', { x: extra.tileC, y: extra.tileR, r: 1, kind: 'driftSand', tiles: 'plus', id: src.id });
    for (const u of alliesInPlus(battle, extra.tileR, extra.tileC, 1)) {
      battle.dealDamage(src, u, { amount, type: 'phys', canDodge: false, ignoreSelect: true, isSkill: true, tags: ['enemyAbility'] });
    }
  });
}

/**
 * 11. 塔露拉·重构：引擎没有官方 kit ⇒ 本包按官方数据补，再叠加重构增量。
 * 官方：日冕（半径 2.5 法术）、烈焚灼息（30.5s 递增真伤）、被阻挡时普攻真伤、半血 DEF/RES 提升并换 [Half] 技能。
 * 重构（2026-10-28）：日冕首次/冷却 −20s（数据 20/20）、[Half] 日冕冷却 −5s（15→10）；每次普攻附带 **25% 攻击力灼燃**。
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
      s.corona -= dt;
      if (s.corona <= 1e-9) {
        const sk = skillOf(e, s.half ? 'DanceFire[Half]' : 'DanceFire') || skillOf(e, 'DanceFire');
        s.corona = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 20;
        const radius = Math.max(0, skNum(sk, 'range_radius', e.base.rangeRadius));
        battle.fx('explode', { x: e.x, y: e.y, r: radius, kind: 'corona' });
        for (const u of battle.alliesInRadius(e.x, e.y, radius)) {
          battle.dealDamage(e, u, { amount: e.s.atk * skNum(sk, 'atk_scale', 1), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
        }
      }
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
 * 12. 爱国者·重构：引擎没有官方 kit ⇒ 本包按官方数据补，再叠加重构增量。
 * 官方：全场敌方攻防强化；行军姿态（攻防抗提升、4 连击）；重生阶段真伤光环 → 毁灭姿态（远程 / 投枪 / 真伤光环）。
 * 重构（2026-10-28）：光环额外 **+20 法抗**；行军姿态 **5 连击**；重生 10s、真伤间隔 0.6s；重生后无敌 10s；
 * 投枪冷却 15s、**可锁定地面单位**、伤害 ×1.3（`atk_scale` 1.755）。
 */
function installPatrt(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_PATRT) return;
    bossStore(battle).patrt.set(e, { phase: 'shield', spear: icdOf(skillOf(e, 'throwspear[Rage]')), aura: 0, reborn: false });
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
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      for (let i = 1; i < PATRT_HITS && t.alive; i++) {
        battle.dealDamage(a, t, { amount: a.s.atk, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
      }
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.patrt.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    const src = liveEnemies(battle, BOSS_PATRT)[0];
    if (src) {
      const atk = talentOf(src, 'strength.atk', 0.2);
      const def = talentOf(src, 'strength.def', 200);
      const res = talentOf(src, 'strength.magic_resistance', 20);
      for (const o of battle.enemies) {
        if (!o.alive) continue;
        battle.addBuff(o, { key: 'recon:patrt_strength', duration: AURA_REFRESH, refresh: 'extend', source: src, mods: { atkPct: atk, defFlat: def, resFlat: res } });
      }
    }
    for (const [e, s] of st.patrt) {
      if (!e.alive) { st.patrt.delete(e); continue; }
      // 重生阶段是**专用状态**（重生 buff 自带 stun）⇒ 先推进它，再对常规行动套 `canAct`。
      // 从前 `canAct` 在它前面 ⇒ 整个重生窗口的真伤一次都跑不出来（旧 bug）。
      if (s.phase === 'reborn') {
        const sk = skillOf(e, 'immo_trigger[reborning]');
        const iv = Math.max(0.1, skNum(sk, 'interval', 0.6));
        s.aura -= dt;
        if (s.aura <= 1e-9) {
          s.aura = iv;
          for (const u of battle.alliesInRadius(e.x, e.y, PATRT_AURA_RADIUS)) {
            battle.dealDamage(e, u, { amount: e.s.atk * skNum(sk, 'atk', 0.2), type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          }
        }
        continue;
      }
      if (!canAct(battle, e)) continue;
      if (s.phase !== 'rage') continue;
      const iv = Math.max(0.1, talentOf(e, 'immo_trigger[rage].interval', 0.8));
      s.aura -= dt;
      if (s.aura <= 1e-9) {
        s.aura = iv;
        for (const u of battle.alliesInRadius(e.x, e.y, PATRT_AURA_RADIUS)) {
          battle.dealDamage(e, u, { amount: e.s.atk * 0.2, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
        }
      }
      s.spear -= dt;
      if (s.spear <= 1e-9) {
        const sk = skillOf(e, 'throwspear[Rage]');
        s.spear = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 15;
        // 重构：不再只打高台 —— 地面 / 高台都可以锁定，取最远
        const cands = battle.allies().filter((u) => u.alive && !u.s.flags.untargetable);
        let best = null, bestD = -1;
        for (const u of cands) {
          const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
          if (d > bestD) { bestD = d; best = u; }
        }
        if (best) {
          battle.fx('explode', { x: best.x, y: best.y, r: 0.5, kind: 'spear', id: e.id });
          battle.dealDamage(e, best, { amount: e.s.atk * skNum(sk, 'atk_scale', 1.755), type: 'phys', canDodge: false, tags: ['enemyAbility'] });
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
    const dur = Math.max(0.1, talentOf(e, 'reborn.duration', 10));
    const inv = Math.max(0, talentOf(e, 'reborn.patrt_t_state_2[reborn_invincible].duration', 10));
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
        s.spear = icdOf(skillOf(e, 'throwspear[Rage]'));
        e.profile.noAttack = false;
        e.profile.melee = false;
        e.base.rangeRadius = PATRT_RAGE_RANGE;
        // 行军姿态的专属增益（攻/防/抗 + 嘲讽）随形态切换**一起移除**：从前留着，毁灭姿态白拿一整份行军属性。
        b.removeBuff(e, 'recon:patrt_shield');
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        castSkill(b, e, skillOf(e, 'Immo[Rage]'));
        b.addBuff(e, {
          key: 'recon:patrt_rage', persist: true, visible: true,
          mods: {
            atkPct: talentOf(e, 'immo_trigger[rage].atk', 0.2),
            defFlat: talentOf(e, 'immo_trigger[rage].def', 200),
            moveMul: 1 + talentOf(e, 'immo_trigger[rage].move_speed', 0.1),
            batPct: talentOf(e, 'immo_trigger[rage].base_attack_time', -0.4) / (e.base.bat || 4),
          },
        });
        if (inv > 0) b.addBuff(e, { key: 'recon:patrt_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/**
 * 13. 狂躁异质裂兽·重构：引擎没有官方 kit ⇒ 本包按官方数据补。
 * 官方：二连击 + 目标受伤 ×2；狂怒（攻速/移速/减伤，最多 3 目标）；落石；第二形态。
 * 重构（2026-10-28）：**狂怒不会结束**；只在生命 <50% 时切换第二形态（不再按 120s/240s 计时，也不逃跑）。
 */
function installMirbst(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MIRBST) return;
    const st = bossStore(battle);
    st.mirbst.set(e, { phase: 1, stone: icdOf(skillOf(e, 'ThrowStone')), hitBy: new Map(), raged: true });
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
      battle.dealDamage(a, t, { amount: a.s.atk, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
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
      if (s.phase === 1 && e.hpRatio < talentOf(e, 'RunController.hp_ratio', 0.5)) { enterMirbstPhase2(battle, e, s); continue; }
      if (!canAct(battle, e)) continue;
      // 狂怒不结束：第二形态也不再按 60 s 退回常态
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

/** 狂躁异质裂兽·重构：生命 <50% ⇒ 第二形态（不再逃跑/不按时间结束），回 50% 生命并保持狂怒。 */
function enterMirbstPhase2(battle, e, s) {
  s.phase = 2;
  s.raged = true;
  castSkill(battle, e, skillOf(e, 'StartRun'));
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

/**
 * 7. 自在·重构：官方 kit（`kitXi`）由 effectRef 继承；重构增量 = 【纬地经天】释放时额外选择 1 个目标。
 * 官方那一次打**最近**目标；本模块在官方十字命中后，再对**第二近**目标补一次同样的十字（同一次释放只补一次）。
 */
function installXi(battle) {
  battle.on('damaged', (c) => {
    const src = c && c.source, dmg = c && c.dmg;
    if (!src || src.defId !== BOSS_XI || !dmg || !dmg.isSkill || dmg.isAttack || dmg.type !== 'arts') return;
    const sk = skillOf(src, 'CrossAttack');
    const amount = src.s.atk * skNum(sk, 'atk_scale', 1);
    if (Math.abs((dmg.amount ?? 0) - amount) > 1e-6) return; // 破桎而出的爆炸是 atk×6/8，不是纬地经天
    const st = bossStore(battle);
    const last = st.xiCross.get(src);
    if (last != null && battle.time - last < 0.05) return; // 同一次十字的多个命中只补一次
    st.xiCross.set(src, battle.time);
    const list = battle.allies()
      .filter((u) => u && u.alive && !u.s.flags.untargetable)
      .sort((a, b) => ((a.x - src.x) ** 2 + (a.y - src.y) ** 2) - ((b.x - src.x) ** 2 + (b.y - src.y) ** 2)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const extra = list[1]; // 官方打 list[0]（最近）；+1 ⇒ 再打第二近
    if (!extra) return;
    battle.fx('telegraph', { x: extra.tileC, y: extra.tileR, r: XI_CROSS_REACH, kind: 'xiCross', tiles: 'plus', id: src.id });
    for (const u of alliesInCrossArms(battle, extra.tileR, extra.tileC, XI_CROSS_REACH)) {
      battle.dealDamage(src, u, { amount, type: 'arts', canDodge: false, ignoreSelect: true, isSkill: true, tags: ['enemyAbility'] });
    }
  });
}

/**
 * 8. 梅菲斯特·重构：引擎没有官方 kit ⇒ 本包按官方数据补官方行为，再叠加重构增量。
 *   * 官方：治疗光环（全场敌方自然回复速度加倍）+ 每 bat 秒治疗生命比例最低的至多 3 名敌方单位（`atk`）。
 *   * 重构（2026-10-27）：光环**再 +25 HP/s**；治疗量 **+500**；每 10 s 召唤 3 只随机宿主；浮士德阵亡后一次召唤 10 只。
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
    const src = liveEnemies(battle, BOSS_MEPHI)[0];
    if (src) {
      for (const o of battle.enemies) {
        if (!o.alive) continue;
        const rate = (o.base && o.base.hpRecoveryPerSec) || 0;
        // 自然回复 ×2（再加一份自身速率）+ 固定 25/s
        battle.addBuff(o, { key: MEPHI_AURA_KEY, duration: AURA_REFRESH, refresh: 'extend', source: src, mods: { hpRegen: rate + MEPHI_AURA_FLAT } });
      }
    }
    for (const [e, left] of st.mephiHeal) {
      if (!e.alive) { st.mephiHeal.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      const next = left - dt;
      if (next > 1e-9) { st.mephiHeal.set(e, next); continue; }
      st.mephiHeal.set(e, e.s.bat);
      const wounded = battle.enemies.filter((o) => o.alive && o.hp < o.s.maxHp)
        .sort((a, b) => a.hpRatio - b.hpRatio).slice(0, MEPHI_HEAL_TARGETS);
      for (const o of wounded) {
        const healed = battle.heal(e, o, e.s.atk + MEPHI_HEAL_BONUS);
        if (healed > 0) { o.markDirty(); battle.fx('heal', { x: o.x, y: o.y, id: o.id }); }
      }
    }
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
 * 9. 浮士德·重构：引擎没有官方 kit ⇒ 本包按官方数据补官方行为，再叠加重构增量。
 *   * 官方：登场无敌（`invincible.duration`）+ 无法被阻挡 + 【致命弩箭】每 `cooldown` 让下一击额外 `atk×(scale−1)`。
 *   * 重构（2026-10-27）：无敌改为**隐匿**（同时长）；**移除无法被阻挡**；致命弩箭首次 / 冷却 −7 s（数据 10/10）；
 *     梅菲斯特阵亡后攻击间隔 **−2 s**（`batPct = −2 / base.bat`）；召唤弩炮台属地图装置 ⇒ 数据里的技能已移除。
 */
function installFaust(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_FAUST) return;
    const stealth = talentOf(e, 'invincible.duration', 0);
    if (stealth > 0) battle.addBuff(e, { key: FAUST_STEALTH_KEY, duration: stealth, visible: true, flags: { stealth: true } });
    const sk = skillOf(e, 'CriticalHit');
    bossStore(battle).faust.set(e, { left: icdOf(sk), ready: false });
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
    const s = bossStore(battle).faust.get(a);
    if (!s || !s.ready) return;
    const sk = skillOf(a, 'CriticalHit');
    const scale = skNum(sk, 'atk_scale', 1);
    const extra = a.s.atk * Math.max(0, scale - 1);
    if (extra > 0) {
      for (const t of c.targets || []) {
        if (!t || !t.alive) continue;
        battle.dealDamage(a, t, { amount: extra, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
      }
      battle.fx('crit', { x: a.x, y: a.y, id: a.id });
    }
    s.ready = false;
    s.left = icdOf(sk);
  });
  battle.on('death', (c) => {
    const u = c && c.unit;
    if (!u || u.defId !== BOSS_MEPHI) return;
    for (const e of liveEnemies(battle, BOSS_FAUST)) {
      // 梅菲斯特阵亡 = 浮士德的隐匿结束（重构文本「梅菲斯特阵亡后…」）；已在 tick 里自然到期的 buff 再删也无害。
      battle.removeBuff(e, FAUST_STEALTH_KEY);
      battle.addBuff(e, { key: FAUST_HASTE_KEY, persist: true, visible: true, mods: { batPct: -FAUST_BAT_CUT / (e.base.bat || 5) } });
    }
  });
}

/**
 * 10. 霜星，“冬痕”·重构：引擎没有官方 kit ⇒ 本包按官方数据补，再叠加数据侧的重构改动。
 * 官方：普攻附带寒冷；冰环（对被冻结/寒冷目标 ×2，并施加寒冷）；冰盾按层吸收法术伤害；死亡重生（第二形态）。
 * 重构（2026-10-27）：冰盾冷却 20 s；重生 5 s、无敌 10 s（数据）；第二形态 **ATK +50%（官方）+ DEF +150%（本包）**。
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
      s.shield -= dt;
      if (s.shield <= 1e-9) {
        const sk = skillOf(e, s.form2 ? 'IceShield[Reborn]' : 'IceShield') || skillOf(e, 'IceShield');
        s.shield = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 20;
        const max = skNum(sk, 'max_cnt', 2);
        if (s.charges < max) {
          s.charges = max;
          battle.addBuff(e, { key: 'recon:frstar_shield', persist: true, visible: true });
        }
      }
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
        b.addBuff(e, { key: 'recon:frstar_form2', persist: true, visible: true, mods: { atkPct: atkUp, defPct: FRSTAR_FORM2_DEF_PCT } });
        if (inv > 0) b.addBuff(e, { key: 'recon:frstar_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: Math.max(0.1, dur), kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/**
 * 6. 萨卡兹百夫长·重构：
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

/**
 * 9. 腐败 / 凋零骑士·重构：同伴亡语（一方倒下，另一方 +50% 攻击 / +50 攻速 / +150% 移速，**只一次**）。
 * 引擎的 `kitDekght` 用 `/enemy_1513_dekght/` 匹配死亡单位的 `defId`，重构 key 不匹配 ⇒ 官方那一路永远不会触发；
 * 这一条是本包补的接线（不重命名运行单位、不扩大成「任意首领死亡」）。数值读**存活那只**自己的记录
 * （`triggerrage.*`，与官方 kit 同一条口径）。
 */
function installKnights(battle) {
  battle.on('kill', (c) => {
    const v = c && c.victim;
    if (!v || (v.defId !== BOSS_DEKGHT && v.defId !== BOSS_DEKGHT_2)) return;
    for (const e of (battle.enemies || [])) {
      if (!e || !e.alive || e === v) continue;
      if (e.defId !== BOSS_DEKGHT && e.defId !== BOSS_DEKGHT_2) continue;
      if (e._reconKnightRaged) continue;
      e._reconKnightRaged = true;
      battle.addBuff(e, {
        key: 'recon:knight_rage', persist: true, visible: true,
        mods: {
          atkPct: talentOf(e, 'triggerrage.atk', 0.5),
          aspd: talentOf(e, 'triggerrage.attack_speed', 50),
          moveMul: 1 + talentOf(e, 'triggerrage.move_speed', 1.5),
        },
      });
      battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'rage' });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 第 12 回合的·重构首领（“复仇者”）
//
// 塔露拉 / 霜星“冬痕” / 爱国者 / 狂躁异质裂兽 四只的重构版已整体移除，等重新制作；“复仇者”保留。
// “复仇者”在引擎的 KITS 里（server/sim/content/enemies/leaders.js:213），官方 kit 由 effectRef 继承，本包只叠加
// 重构增量（每次攻击后攻击间隔 −5%，可叠加到 −90%）。
const BOSS_REID = 'enemy_ws_recon_reid';

/** “复仇者”·重构：每次攻击 batPct −10%（可叠 9 层 = −90%）；每次攻击回复 325 生命。 */
const REID_BAT_STEP = 0.10;
const REID_BAT_CAP = 0.9;
const REID_HEAL = 325;

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
    const healed = battle.heal(a, a, REID_HEAL, { self: true });
    if (healed > 0) {
      a.markDirty();
      battle.fx('heal', { x: a.x, y: a.y, id: a.id });
    }
  });
}
// ---------------------------------------------------------------------------------------------------------------
// 第 16 回合的五只·重构首领（业主 2026-10-28）
//
// 这五只在引擎的 KITS 里都没有 kit ⇒ 官方行为 + 重构增量全部由本包实现。旧版依赖的地图装置（破碎支柱、摄影机 /
// 摄影区域、瑕 / 失气、部署地块、召唤空地敌人）一律不实现；下面每段都写清「官方行为」与「重构增量」。

/**
 * 21. 蔓德拉·重构。
 * 官方：第一形态【石之盾】减伤（`StoneSkin.damage_resistance`）；【蔓德拉的注目】点攻击最高的我方、法术伤害 + 降攻速；
 * 生命归零 → 重生 → 第二形态（近地悬浮、【石之盾】每秒对周围法术溅射）。
 * 重构：注目额外 **−25 法抗**（移除地块损毁）；石之盾溅射伤害读记录（`atk_scale` 0.36 = +20%），并额外 **−10 法抗**；
 * 不召唤破碎支柱。
 */
function installMandra(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MANDRA) return;
    const dr = talentOf(e, 'StoneSkin.damage_resistance', 0.6);
    battle.addBuff(e, { key: 'recon:mandra_stone', persist: true, visible: true, mods: { physTakenMul: 1 - dr, artsTakenMul: 1 - dr } });
    castSkill(battle, e, skillOf(e, 'SummonStoneSkin'));
    bossStore(battle).mandra.set(e, { ray: icdOf(skillOf(e, 'PetrifiedRay')), form2: false, reborn: false, aura: 0 });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.mandra.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.mandra) {
      if (!e.alive) { st.mandra.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      // 第二形态【石之盾】：每秒对半径内我方造成法术伤害（伤害倍率读记录），并 −10 法抗
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
            battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            if (u.alive) {
              battle.addBuff(u, { key: 'recon:mandra_stone_res', duration: MANDRA_STONE_DEBUFF_DURATION, refresh: 'extend', source: e, visible: true, mods: { resFlat: -MANDRA_STONE_RES_DOWN } });
            }
          }
        }
      }
      // 【蔓德拉的注目】：攻击最高的我方，法术伤害 + 攻速下降 + 25 法抗下降
      s.ray -= dt;
      if (s.ray <= 1e-9) {
        const sk = skillOf(e, 'PetrifiedRay');
        s.ray = s.form2
          ? Math.max(0.1, talentOf(e, 'Reborn.mandra_ray_p2[cd]', 10))
          : ((sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 15);
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable);
        let best = null, bestAtk = -1;
        for (const u of cands) if (u.s.atk > bestAtk) { bestAtk = u.s.atk; best = u; }
        if (best) {
          castSkill(battle, e, sk);
          battle.fx('beam', { from: [e.x, e.y], to: [best.x, best.y], kind: 'mandraRay', id: e.id });
          battle.dealDamage(e, best, { amount: e.s.atk * skNum(sk, 'atk_scale', 1), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          if (best.alive) {
            battle.addBuff(best, {
              key: 'recon:mandra_ray', duration: skNum(sk, 'mandra_ray[cd].duration', 7.1), source: e, visible: true,
              mods: { aspd: skNum(sk, 'attack_speed', -0.7) * 100, resFlat: -MANDRA_RAY_RES_DOWN },
            });
          }
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
    castSkill(battle, e, skillOf(e, 'Reborn'));
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
        castSkill(b, e, skillOf(e, 'SummonStoneSkin_2'));
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/** 血骑士的减伤：第一形态 0.75、第二形态 0.5（`Passive.damage_scale` / `Passive2.damage_scale`，即「受到伤害的倍率」）。 */
function bldkgtScale(e, phase) {
  return phase === 2 ? talentOf(e, 'Passive2.damage_scale', 0.5) : talentOf(e, 'Passive.damage_scale', 0.75);
}

/** 复活姿态每波召唤的凝血之刃数量（PRTS 只写「召唤大量」，数量由业主 2026-10-28 定为 20）。 */
const BLDKGT_BLADE_BATCH = 20;
/** 凝血之刃的落点：距本体**大于** 2.5 格的随机格（业主 2026-10-28）。 */
const BLDKGT_BLADE_MIN_DIST = 2.5;
/** 第二形态每波召唤数量（Wiki 只说「召唤凝血之刃」，没给数量 ⇒ 取 1 枚/波，5/12 冷却）。 */
const BLDKGT_FORM2_BLADES = 1;

/** 一个距本体 > 2.5 格的随机落点（用战场种子流，确定性；取样失败时退回本体西侧 3 格）。 */
function bldkgtBladePos(battle, e) {
  const R = battle.rect || null;
  const rr = Math.round(e.tileR), cc = Math.round(e.tileC);
  const r0 = R ? Math.round(R.r0) : 0, r1 = R ? Math.round(R.r1) : 14;
  const c0 = R ? Math.round(R.c0) : 0, c1 = R ? Math.round(R.c1) : 32;
  const rows = Math.max(1, r1 - r0 + 1), cols = Math.max(1, c1 - c0 + 1);
  for (let i = 0; i < 30; i++) {
    const r = r0 + battle.rng.int(rows);
    const c = c0 + battle.rng.int(cols);
    if (Math.hypot(r - rr, c - cc) > BLDKGT_BLADE_MIN_DIST) return [r, c];
  }
  return [rr, Math.max(c0, cc - 3)];
}

/** 召一波凝血之刃（同一波共用一次 `summon` 表现事件）。 */
function bldkgtSummonBlades(battle, e, n) {
  for (let i = 0; i < n; i++) {
    const [r, c] = bldkgtBladePos(battle, e);
    battle.spawnEnemy(SUMMON_BLDBLD, { pos: [r, c], ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
  }
  battle.fx('summon', { x: e.x, y: e.y, id: e.id, key: SUMMON_BLDBLD, n });
}

/** 阻挡者的减伤只生效一半：0.75 → 0.875、0.5 → 0.75。 */
function bldkgtBlockerScale(scale) {
  return 1 - (1 - scale) * 0.5;
}

/**
 * 22. 血骑士狄开俄波利斯·重构。
 * 官方：受伤害降低（对阻挡者无效）；【血归】晕眩目标并每秒造成法术伤害；生命归零进入复活姿态（无敌、召唤凝血之刃，
 * 回满则回第一形态，否则进入第二形态：攻击力 +50%、远程、减伤 50%）。
 * 重构：减伤对阻挡者仍生效**原本的 50%**；血归伤害读记录（400）；复活姿态读 `CheckTrigger.recovery_time`（20 s）；
 * **复活姿态的回复只来自凝血之刃**（业主 2026-10-28 定稿：不再每秒自动回 15%），每枚抵达回复 `Devour.hp_ratio`（Wiki：10%）；
 * 复活姿态每波召唤 **20 枚**（Wiki「召唤大量」，数量由业主定），落点在**自身 2.5 格外**的随机格；第二形态照常召唤（Wiki 5/12）。
 * 第二形态攻击目标数 = 2。
 */
function installBldkgt(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_BLDKGT) return;
    battle.addBuff(e, { key: 'recon:bldkgt_reduce', persist: true, visible: true, mods: { physTakenMul: bldkgtScale(e, 1), artsTakenMul: bldkgtScale(e, 1) } });
    bossStore(battle).bld.set(e, {
      blood: icdOf(skillOf(e, 'BloodPool')), phase: 1, reborn: false, reviveLeft: 0, summonLeft: 2,
      summon2: icdOf(skillOf(e, 'SummonBldbld2')),
    });
  });
  battle.on('hit', (c) => {
    const t = c && c.target, s = c && c.source, dmg = c && c.dmg;
    if (!t || t.defId !== BOSS_BLDKGT || !s || !dmg || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
    if (s !== t.blockedBy) return;
    const st = bossStore(battle).bld.get(t);
    const phase = st && st.phase === 2 ? 2 : 1;
    const base = bldkgtScale(t, phase);
    if (!(base > 0)) return;
    // 引擎已按 base 乘过一次（physTakenMul / artsTakenMul）；把阻挡者那一份补成 blocker/base。
    dmg.mul = (dmg.mul ?? 1) * (bldkgtBlockerScale(base) / base);
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.bld.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.bld) {
      if (!e.alive) { st.bld.delete(e); continue; }
      if (s.phase === 'revive') {
        s.reviveLeft -= dt;
        // 复活姿态**没有自动回复**：回复只来自凝血之刃抵达（见下面那条 tick），所以「回满回第一形态」是玩家放不放刀的结果
        if (e.hpRatio >= talentOf(e, 'CheckTrigger.hp_ratio', 1)) {
          s.phase = 1;
          // 回满血回第一形态 ⇒ 重新可以进入复活姿态（从前 `s.reborn` 一直是 true，下一次击倒直接真死）。
          s.reborn = false;
          e.profile.noAttack = false;
          battle.removeBuff(e, 'recon:bldkgt_reborn');
          battle.addBuff(e, { key: 'recon:bldkgt_reduce', persist: true, visible: true, mods: { physTakenMul: bldkgtScale(e, 1), artsTakenMul: bldkgtScale(e, 1) } });
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'revived' });
          continue;
        }
        s.summonLeft -= dt;
        if (s.summonLeft <= 1e-9) {
          const sk = skillOf(e, 'SummonBldbld');
          s.summonLeft = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 10;
          castSkill(battle, e, sk);
          // Wiki：复活姿态「按预设路径召唤大量凝血之刃」（2/10）；数量由业主定 20，落点在自身 2.5 格外的随机格
          bldkgtSummonBlades(battle, e, BLDKGT_BLADE_BATCH);
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
          e.profile.maxTargets = 2; // 重构：第二形态攻击目标 +1
          e.hp = e.s.maxHp;
          e.atkCd = 0;
          castSkill(battle, e, skillOf(e, 'RebornToNext'));
          const inv = talentOf(e, 'Passive2.invincible_time', 6);
          if (inv > 0) battle.addBuff(e, { key: 'recon:bldkgt_inv', duration: inv, visible: true, flags: { invulnerable: true } });
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
        }
        continue;
      }
      if (!canAct(battle, e)) continue;
      // 第二形态：Wiki 里也有一支召唤技能（SummonBldbld2，初始 5 / 冷却 12）
      if (s.phase === 2) {
        s.summon2 = (s.summon2 ?? 12) - dt;
        if (s.summon2 <= 1e-9) {
          const sk2 = skillOf(e, 'SummonBldbld2');
          s.summon2 = (sk2 && Number.isFinite(sk2.cooldown) && sk2.cooldown > 0) ? sk2.cooldown : 12;
          castSkill(battle, e, sk2);
          bldkgtSummonBlades(battle, e, BLDKGT_FORM2_BLADES);
        }
      }
      // 【血归】：晕眩 + 每秒法术伤害（伤害读记录）
      s.blood -= dt;
      if (s.blood <= 1e-9) {
        const sk = skillOf(e, s.phase === 2 ? 'BloodPool2' : 'BloodPool') || skillOf(e, 'BloodPool');
        s.blood = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 15;
        const t = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable).sort((a, b) => b.s.atk - a.s.atk)[0];
        if (t) {
          castSkill(battle, e, sk);
          battle.applyStatus(t, 'stun', { duration: skNum(sk, 'stun', 10), source: e });
          battle.addBuff(t, {
            key: 'recon:bldkgt_blood', duration: BLDKGT_BLOOD_DURATION, visible: true, source: e, interval: skNum(sk, 'interval', 1),
            onTick: ({ battle: b, unit }) => {
              b.dealDamage(e.alive ? e : null, unit, { amount: skNum(sk, 'damage', 200), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            },
          });
        }
      }
    }
  });
  // 凝血之刃：走到血骑士身边即消失并回复 `Devour.hp_ratio` 的最大生命
  battle.on('tick', (c) => {
    const blades = (battle.enemies || []).filter((x) => x && x.alive && x.defId === SUMMON_BLDBLD);
    if (!blades.length) return;
    const boss = liveEnemies(battle, BOSS_BLDKGT)[0];
    if (!boss) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const blade of blades) {
      const dx = boss.x - blade.x, dy = boss.y - blade.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.8) {
        const step = Math.min(dist, BLDKGT_BLADE_SPEED * dt);
        blade.x += (dx / Math.max(1e-9, dist)) * step;
        blade.y += (dy / Math.max(1e-9, dist)) * step;
        continue;
      }
      const healed = healBoss(battle, boss, boss.s.maxHp * talentOf(boss, 'Devour.hp_ratio', 0.1));
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
    s.reviveLeft = Math.max(0.1, talentOf(e, 'CheckTrigger.recovery_time', 20));
    s.summonLeft = 2;
    castSkill(battle, e, skillOf(e, 'RebornToPrev'));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.removeBuff(e, 'recon:bldkgt_reduce');
    battle.addBuff(e, {
      key: 'recon:bldkgt_reborn', duration: s.reviveLeft, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: false, noMove: true, stun: true },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: s.reviveLeft, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

/**
 * 23. 莫菲丝·重构（记录 key `enemy_ws_recon_morphis`，名字“莫菲丝·重构”）。
 * 官方：每根有效【线】+25% 攻击；【幻梦的纠缠】连接最远我方、每 `RedLine.interval` 造成法术伤害；【感官的剥离】把伤害
 * 分给被连接的敌方单位；【梦境的演变】骑乘获得屏障；生命归零 → 重生（回血 + 全场法术伤害）。
 * 重构：每根线额外 **DEF +25%、RES +25**；可连接自身（自身受伤 −25%）；屏障 = max(20% 生命, 100000)、持续
 * `Shield.interval`（20 s）；重生 / 伤害间隔 / 复活后攻击读记录。
 */
function installMorphis(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MORPHIS) return;
    bossStore(battle).morphis.set(e, {
      red: MORPHIS_RED_INIT, evolve: MORPHIS_EVOLVE_INTERVAL, phase: 1, reborn: false, revived: false, rebornLeft: 0,
      barrier: 0, barrierLeft: 0, mounted: false, hitAcc: 0,
    });
    // 【感官的剥离】连接自身 ⇒ 自身受到的伤害 −25%
    battle.addBuff(e, { key: 'recon:morphis_share', persist: true, visible: true, mods: { dmgTakenMul: MORPHIS_SELF_TAKEN } });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.morphis.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.morphis) {
      if (!e.alive) { st.morphis.delete(e); continue; }
      // 重生形态：`Reborn.duration` 内线性回满，每 `Reborn.hit_interval` 全场法术伤害
      if (s.reborn) {
        s.rebornLeft -= dt;
        s.hitAcc += dt;
        const perSec = e.s.maxHp / Math.max(0.1, talentOf(e, 'Reborn.duration', 5));
        e.hp = Math.min(e.s.maxHp, e.hp + perSec * dt);
        e.markDirty();
        if (s.hitAcc >= Math.max(0.1, talentOf(e, 'Reborn.hit_interval', 1))) {
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
      // 骑乘形态：屏障被击破（引擎 shield buff 消失）或到点即结束
      if (s.mounted) {
        s.barrierLeft -= dt;
        if (s.barrierLeft <= 1e-9 || !e.findBuff('recon:morphis_barrier')) exitMorphisMount(battle, e, s);
        continue;
      }
      // 【幻梦的纠缠】：连接范围内最远的、尚未被连接的我方
      s.red -= dt;
      if (s.red <= 1e-9) {
        s.red = MORPHIS_RED_INTERVAL;
        const radius = s.phase === 2 ? 99 : MORPHIS_RED_RADIUS;
        const taken = new Set();
        for (const u of battle.allies()) if (u.findBuff && u.findBuff('recon:morphis_red')) taken.add(u);
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable && !taken.has(u)
          && (u.x - e.x) ** 2 + (u.y - e.y) ** 2 <= radius * radius);
        let best = null, bestD = -1;
        for (const u of cands) {
          const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
          if (d > bestD) { bestD = d; best = u; }
        }
        if (best) {
          const scale = s.phase === 2 ? talentOf(e, 'RedLine.atk_scale_2', 0.6) : talentOf(e, 'RedLine.atk_scale', 0.5);
          battle.fx('beam', { from: [e.x, e.y], to: [best.x, best.y], kind: 'morphisRed', id: e.id });
          battle.addBuff(best, {
            key: 'recon:morphis_red', duration: talentOf(e, 'RedLine.duration', 10), visible: true, source: e,
            interval: Math.max(0.05, talentOf(e, 'RedLine.interval', 0.4)),
            onTick: ({ battle: b, unit }) => {
              b.dealDamage(e.alive ? e : null, unit, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            },
          });
        }
      }
      // 【梦境的演变】
      s.evolve -= dt;
      if (s.evolve <= 1e-9) {
        s.evolve = MORPHIS_EVOLVE_INTERVAL;
        enterMorphisMount(battle, e, s);
      }
      // 每根有效线：攻击 +25%（记录）、DEF +25%、RES +25（重构）
      const lineAtk = talentOf(e, 'EnemyLineT.atk', 0.25);
      const lines = battle.allies().filter((u) => u.findBuff && u.findBuff('recon:morphis_red')).length;
      battle.addBuff(e, {
        key: 'recon:morphis_lines', persist: true, visible: true,
        mods: { atkPct: lineAtk * lines, defPct: MORPHIS_LINE_DEF * lines, resFlat: MORPHIS_LINE_RES * lines },
      });
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_MORPHIS) return;
    const s = bossStore(battle).morphis.get(e);
    if (!s || s.revived) return;
    s.revived = true;
    s.reborn = true;
    s.rebornLeft = Math.max(0.1, talentOf(e, 'Reborn.duration', 5));
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

/** 莫菲丝进入骑乘形态：屏障 = max(生命上限 × `Shield.dynamic_ratio`, `Shield.dynamic`)，持续 `Shield.interval`；不再不可阻挡。 */
function enterMorphisMount(battle, e, s) {
  if (s.mounted) return;
  s.mounted = true;
  s.barrier = Math.max(e.s.maxHp * talentOf(e, 'Shield.dynamic_ratio', 0.2), talentOf(e, 'Shield.dynamic', 100000));
  s.barrierLeft = Math.max(0.1, talentOf(e, 'Shield.interval', 20));
  battle.addBuff(e, {
    key: 'recon:morphis_mount', duration: s.barrierLeft, visible: true,
    mods: { moveFlat: talentOf(e, 'Shield.move_speed', 0.7) },
  });
  // 官方「屏障」不限定伤害类型（PRTS 术语释义）⇒ 不写 shieldType
  battle.addBuff(e, { key: 'recon:morphis_barrier', duration: s.barrierLeft, visible: true, shield: s.barrier });
  battle.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'morphisMount' });
}

/** 退出骑乘形态（屏障破碎或到点）。 */
function exitMorphisMount(battle, e, s) {
  if (!s.mounted) return;
  s.mounted = false;
  s.barrier = 0;
  s.barrierLeft = 0;
  battle.removeBuff(e, 'recon:morphis_mount');
  battle.removeBuff(e, 'recon:morphis_barrier');
}

/** 莫菲丝第二形态：生命回满、攻击 +20%、攻击间隔 −0.8 s、攻击范围扩大至全场。 */
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
    mods: { atkPct: talentOf(e, 'Reborn.atk', 0.2), batPct: Math.max(-0.9, talentOf(e, 'Reborn.base_attack_time', -0.8) / Math.max(0.1, e.base.bat || 2.8)) },
  });
  battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
}

/**
 * 24. “酒神”·重构。
 * 官方：【未曾领悟】摄影区域外的伤害降低；【意兴盎然】攻击数次后下一击提升；【戏剧化】神经损伤爆发后炸周围；
 * 【渗散荒诞】摄影机；【幕间不息】蓄力后按摄影区域内我方逐个攻击；生命归零重生。
 * 重构：未曾领悟 = 来自**非阻挡干员**的物理/法术伤害 −50%（常态）；意兴盎然 = 攻击目标 +1；渗散荒诞（摄影机）不实现；
 * 幕间不息 = 蓄力后对自身 2.8 格方形内我方由近到远逐个攻击；重生时间读记录（5 s）。戏剧化需要神经损伤源，
 * 本模式移除了地图装置 ⇒ 不实现。
 */
function installDirctr(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_DIRCTR) return;
    bossStore(battle).dirctr.set(e, { s3: icdOf(skillOf(e, 's3')), reborn: false, form2: false });
    e.profile.maxTargets = Math.max(1, Number(e.profile.maxTargets) || 1) + 1; // 意兴盎然：目标 +1
  });
  battle.on('hit', (c) => {
    const t = c && c.target, s = c && c.source, dmg = c && c.dmg;
    if (!t || t.defId !== BOSS_DIRCTR || !s || s.side !== 'ally' || !dmg) return;
    if (dmg.type !== 'phys' && dmg.type !== 'arts') return;
    if (s === t.blockedBy) return; // 阻挡自己的干员不享受减伤
    dmg.mul = (dmg.mul ?? 1) * DIRCTR_CUT;
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.dirctr.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.dirctr) {
      if (!e.alive) { st.dirctr.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      s.s3 -= dt;
      if (s.s3 > 1e-9) continue;
      const sk = skillOf(e, 's3');
      s.s3 = (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0) ? sk.cooldown : 32;
      castSkill(battle, e, sk);
      battle.fx('telegraph', { x: e.x, y: e.y, r: DIRCTR_SCENE_RADIUS, dur: DIRCTR_CHARGE, kind: 'dirctrScene', id: e.id });
      // 【幕间不息】：蓄力后对 2.8 格方形内的我方由近到远逐个攻击
      battle.after(DIRCTR_CHARGE, () => {
        if (!e.alive) return;
        const list = alliesInSquare(battle, e.tileR, e.tileC, DIRCTR_SCENE_RADIUS)
          .sort((a, b) => ((a.x - e.x) ** 2 + (a.y - e.y) ** 2) - ((b.x - e.x) ** 2 + (b.y - e.y) ** 2));
        battle.fx('explode', { x: e.x, y: e.y, r: DIRCTR_SCENE_RADIUS, kind: 'dirctrScene', id: e.id, box: true });
        for (const u of list) {
          battle.dealDamage(e, u, { amount: e.s.atk, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'scene'] });
        }
      });
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_DIRCTR) return;
    const st = bossStore(battle).dirctr.get(e);
    if (!st || st.reborn) return;
    st.reborn = true;
    const dur = Math.max(0.1, talentOf(e, 'Reborn.duration', 5));
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

/** 【落】：在目标位置造成 ATK×100%，相邻（Chebyshev ≤1）每人吃 50% 溅射。 */
function wangFall(battle, e, u) {
  if (!e || !e.alive || !u || !u.alive) return;
  battle.fx('explode', { x: u.x, y: u.y, r: DYWQGS_FALL_RADIUS, kind: 'fall', id: e.id });
  battle.dealDamage(e, u, { amount: e.s.atk * DYWQGS_FALL_SCALE, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'fall'] });
  for (const v of alliesInBox(battle, u.tileR, u.tileC, DYWQGS_FALL_RADIUS)) {
    if (v === u || !v.alive) continue;
    battle.dealDamage(e, v, { amount: e.s.atk * DYWQGS_FALL_SPLASH, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'fall', 'splash'] });
  }
}

/** 本场数据里「特训敌人」类型（`factions.types[*].involveRandom`）的全部 enemy key —— 望的第二形态精英。 */
function trainingEnemyKeys(battle) {
  const gd = typeof S.gameData === 'function' ? S.gameData() : null;
  const types = gd && gd.factions && gd.factions.types ? gd.factions.types : null;
  const out = [];
  for (const t of Object.values(types || {})) {
    if (!t || t.involveRandom !== true || !Array.isArray(t.pool)) continue;
    for (const k of t.pool) {
      if (typeof k !== 'string') continue;
      if (battle.data && typeof battle.data.rawEnemy === 'function' && !battle.data.rawEnemy(k)) continue;
      out.push(k);
    }
  }
  return out;
}

/** 召唤 `n` 只随机特训精英（种类从本场数据的 involveRandom 类型池里用 `battle.rng` 抽）。 */
function summonWangElites(battle, e, n) {
  const pool = trainingEnemyKeys(battle);
  if (!pool.length) return;
  for (let i = 0; i < n; i++) {
    const key = battle.rng.pick(pool);
    if (!key) return;
    battle.spawnEnemy(key, { pos: [e.y, e.x], ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
    battle.fx('summon', { x: e.x, y: e.y, id: e.id, key, n: 1 });
  }
}

/** 【征】：优先选「周围八格内我方最多」的目标及其相邻，一次至多 3 名。 */
function wangZhVolley(battle, e) {
  castSkill(battle, e, skillOf(e, 'SiegeChess1'));
  const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable);
  if (!cands.length) return;
  const neighbourCount = (u) => alliesInBox(battle, u.tileR, u.tileC, 1).filter((v) => v !== u).length;
  const ranked = cands.slice().sort((a, b) => neighbourCount(b) - neighbourCount(a));
  const picked = [];
  for (const u of ranked) {
    if (picked.length >= DYWQGS_ZH_MAX) break;
    if (!picked.includes(u)) picked.push(u);
    for (const v of alliesInBox(battle, u.tileR, u.tileC, 1)) {
      if (picked.length >= DYWQGS_ZH_MAX) break;
      if (v !== u && !picked.includes(v)) picked.push(v);
    }
  }
  battle.fx('explode', { x: e.x, y: e.y, r: 8, kind: 'zh', id: e.id });
  for (const u of picked) {
    battle.dealDamage(e, u, { amount: e.s.atk, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'zh'] });
  }
}

/** “望”第二形态：连续 6 次【落】；之后每 10 s 召唤 2 只精英（其余旧效果不再实现）。 */
function enterWangForm2(battle, e, s) {
  s.reborn = false;
  s.revived = true;
  s.form2 = true;
  e.profile.noAttack = false;
  e.hp = e.s.maxHp;
  e.atkCd = 0;
  battle.removeBuff(e, 'recon:wang_reborn');
  const inv = talentOf(e, 'Reborn.invincible_duration', 10);
  if (inv > 0) battle.addBuff(e, { key: 'recon:wang_inv', duration: inv, visible: true, flags: { invulnerable: true } });
  for (let i = 0; i < DYWQGS_FORM2_FALLS; i++) {
    const t = battle.rng.pick(battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable));
    if (t) wangFall(battle, e, t);
  }
  s.eliteLeft = DYWQGS_ELITE_INTERVAL;
  castSkill(battle, e, skillOf(e, 'SwitchFinalMode'));
  battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
}

/**
 * 25. “望”·重构。
 * 官方：部署 / 周期在周围部署“瑕”，【征】全图攻击，重生。
 * 重构：【落】= 每次部署我方在该位置造成 ATK×100% + 相邻 50%，之后每 10 s 对随机一名我方再触发一次；第一形态移除
 * 瑕的全部效果，改为攻击 50% 眩晕 5 s、未被阻挡时受伤 −50%；【征】每 40 s（首次 20 s）一次，优先打周围八格我方最多
 * 的目标及其相邻、至多 3 名；重生 / 无敌时间读记录；第二形态连续 6 次【落】，之后每 10 s 召唤 2 只随机特训精英。
 */
function installDywqgs(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_DYWQGS) return;
    bossStore(battle).wang.set(e, {
      fallLeft: DYWQGS_FALL_INTERVAL, zh: DYWQGS_ZH_INIT, reborn: false, revived: false, rebornLeft: 0,
      form2: false, eliteLeft: DYWQGS_ELITE_INTERVAL,
    });
    castSkill(battle, e, skillOf(e, 'StartBattle'));
  });
  // 【落】：每次部署我方单位时在该位置触发（移动部署不算）
  battle.on('deploy', (c) => {
    const u = c && c.unit;
    if (!u || u.side !== 'ally' || c.move || c.initial || !u.alive) return;
    const e = liveEnemies(battle, BOSS_DYWQGS)[0];
    if (e) wangFall(battle, e, u);
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_DYWQGS || c.isSkill) return;
    const s = bossStore(battle).wang.get(a);
    if (!s || s.form2) return;
    if (!battle.rng.chance(DYWQGS_STUN_CHANCE)) return;
    for (const t of c.targets || []) if (t && t.alive) battle.applyStatus(t, 'stun', { duration: DYWQGS_STUN_DURATION, source: a });
  });
  battle.on('hit', (c) => {
    const t = c && c.target, dmg = c && c.dmg;
    if (!t || t.defId !== BOSS_DYWQGS || !dmg || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
    const s = bossStore(battle).wang.get(t);
    if (!s || s.form2 || t.blockedBy) return;
    dmg.mul = (dmg.mul ?? 1) * DYWQGS_UNBLOCKED_TAKEN; // 第一形态：未被阻挡时受伤 −50%
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.wang.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.wang) {
      if (!e.alive) { st.wang.delete(e); continue; }
      if (s.reborn) {
        s.rebornLeft -= dt;
        if (s.rebornLeft <= 1e-9) enterWangForm2(battle, e, s);
        continue;
      }
      if (!canAct(battle, e)) continue;
      if (s.form2) {
        s.eliteLeft -= dt;
        if (s.eliteLeft <= 1e-9) {
          s.eliteLeft = DYWQGS_ELITE_INTERVAL;
          summonWangElites(battle, e, DYWQGS_ELITE_COUNT);
        }
        continue;
      }
      // 【落】的周期触发（第一形态；第二形态改为召唤精英）
      s.fallLeft -= dt;
      if (s.fallLeft <= 1e-9) {
        s.fallLeft = DYWQGS_FALL_INTERVAL;
        const t = battle.rng.pick(battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable));
        if (t) wangFall(battle, e, t);
      }
      // 【征】
      s.zh -= dt;
      if (s.zh <= 1e-9) {
        s.zh = DYWQGS_ZH_INTERVAL;
        wangZhVolley(battle, e);
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_DYWQGS) return;
    const s = bossStore(battle).wang.get(e);
    if (!s || s.revived || s.reborn) return;
    s.reborn = true;
    s.rebornLeft = Math.max(0.1, talentOf(e, 'Reborn.duration', 5));
    castSkill(battle, e, skillOf(e, 'Reborning'));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:wang_reborn', duration: s.rebornLeft, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: s.rebornLeft, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

// ===============================================================================================================
// 第 20 回合的五只·重构首领（业主 2026-10-28）—— 引擎没有它们的 kit，官方行为 + 重构增量全部在本包实现。

const SUMMON_BSENERGY = 'enemy_ws_recon_energy';
const SUMMON_NILU = 'enemy_ws_recon_nilu';
const SUMMON_LIANAO = 'enemy_ws_recon_lianao';
const SUMMON_JIANAO = 'enemy_ws_recon_jianao';
const SUMMON_BODY = 'enemy_ws_recon_body';

/** 召唤物内联记录（不占波次、不进图鉴；数值照官方装置页）。
 *
 * `spine` / `iconId` 是**渲染必需的**：快照按 `simdata.js normalizeEnemy` 取 `e.spine ?? key` 与
 * `e.iconId ?? e.avatar ?? key`（server/sim/simdata.js:304-305），内联 def 不写这两个字段时客户端拿到的是
 * `enemy_ws_recon_*`，本地模型清单里没有它 ⇒ 单位只剩一个空占位（客户端按 spine 找模型，art.enemies 也按它找图标）。
 * 这里一律指向官方素材 id，模型/图标随包携带（`pack.json.art.enemies`），怪物的技能特效也按这个 id 查
 * （render/vfx/wiring.js unitKeyOf：先 `info.spine`、再 `info.defId`）。
 *
 * 能量聚合体在官方客户端里是**地图装置**（没有敌人记录、没有独立模型），这里借尼卢火的装置模型 [ASSUMED：
 * 官方无模型，取同批装置里观感最接近的一只]。 */
export const RECON_SUMMON_DEFS = {
  [SUMMON_BSENERGY]: {
    name: '能量聚合体', rank: 'NORMAL', applyWay: 'NONE',
    spine: 'enemy_2090_skzjbc', iconId: 'enemy_2090_skzjbc',
    stats: { maxHp: 6000, atk: 0, def: 200, res: 20, moveSpeed: 0, bat: 1, aspd: 100, rangeRadius: 0, blockCnt: 1, dmgType: 'none', motion: 'WALK', lpr: 1 },
  },
  [SUMMON_NILU]: {
    name: '尼卢火', rank: 'NORMAL', applyWay: 'NONE',
    spine: 'enemy_2090_skzjbc', iconId: 'enemy_2090_skzjbc',
    stats: { maxHp: 10000, atk: 0, def: 500, res: 70, moveSpeed: 0, bat: 1, aspd: 100, rangeRadius: 1, blockCnt: 1, dmgType: 'none', motion: 'WALK', lpr: 1 },
  },
  [SUMMON_LIANAO]: {
    name: '敛傲', rank: 'NORMAL', applyWay: 'RANGED',
    spine: 'enemy_2130_dyswrd', iconId: 'enemy_2130_dyswrd',
    stats: { maxHp: 20000, atk: 1800, def: 500, res: 20, moveSpeed: 1, bat: 5, aspd: 100, rangeRadius: 1.5, blockCnt: 1, dmgType: 'arts', motion: 'FLY', lpr: 1 },
  },
  [SUMMON_JIANAO]: {
    name: '剑傲', rank: 'NORMAL', applyWay: 'MELEE',
    spine: 'enemy_2129_dylong', iconId: 'enemy_2129_dylong',
    stats: { maxHp: 20000, atk: 1800, def: 500, res: 20, moveSpeed: 1, bat: 5, aspd: 100, rangeRadius: 0, blockCnt: 1, dmgType: 'phys', motion: 'WALK', lpr: 1 },
  },
  [SUMMON_BODY]: {
    name: '身形', rank: 'NORMAL', applyWay: 'NONE',
    spine: 'enemy_2128_dysuib', iconId: 'enemy_2128_dysuib',
    stats: { maxHp: 80000, atk: 200, def: 1000, res: 30, moveSpeed: 0.6, bat: 5, aspd: 100, rangeRadius: 0, blockCnt: 1, dmgType: 'none', motion: 'WALK', lpr: 1 },
  },
  [SUMMON_SHORSM]: {
    name: '源阶粒素', rank: 'NORMAL', applyWay: 'NONE',
    spine: 'enemy_2149_shorsm', iconId: 'enemy_2149_shorsm',
    // 业主 2026-10-29：基础生命值 50000、不可被阻挡、主动向防守点移动；其余数值照官方（攻 300 / 防 50 / 抗 80 / 移速 0.7）。
    stats: { maxHp: 50000, atk: 300, def: 50, res: 80, moveSpeed: 0.7, bat: 1, aspd: 100, rangeRadius: 0, blockCnt: 0, dmgType: 'none', motion: 'WALK', lpr: 1 },
  },
};

const cdOf = (sk, fallback) => (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0 ? sk.cooldown : fallback);

/**
 * 生成一个召唤物（内联 def 走 spawnEnemy 的 `opts.def`）。
 *
 * 召唤物**计入数量与漏怪生命值**（业主 2026-10-29）：def 不再带 `notCountInTotal`，`lpr` 取 1（卢西恩沿用官方 30），
 * 于是它们在战斗结束时按普通敌人统计、按 `lpr` 扣目标生命（从前是 `countInTotal:false` + `lpr:0`，被当成场景装置）。
 */
function spawnSummon(battle, e, key, pos, extra = {}) {
  const def = RECON_SUMMON_DEFS[key];
  if (!def) return null;
  const [r, c] = pos;
  const u = battle.spawnEnemy(key, {
    def, pos: [Math.max(0, Math.round(r)), Math.max(0, Math.round(c))],
    ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null,
    ...extra,
  });
  if (u) battle.fx('summon', { x: u.x, y: u.y, id: e.id, key, n: 1 });
  return u;
}

/** 一个我方周围（优先四格）的空位；没有我方时用 `fallback`。 */
function tileNearAlly(battle, fallback, prefer = 1) {
  const taken = new Set();
  for (const u of battle.units || []) {
    if (!u || !u.alive || !u.deployed) continue;
    taken.add(`${Math.round(u.tileR)},${Math.round(u.tileC)}`);
  }
  const cands = [];
  const seen = new Set();
  const push = (r, c) => {
    const k = `${r},${c}`;
    if (seen.has(k) || taken.has(k) || r < 0 || c < 0) return;
    seen.add(k); cands.push([r, c]);
  };
  for (const a of battle.allies()) {
    if (!a.alive || a.hidden) continue;
    const ar = Math.round(a.tileR), ac = Math.round(a.tileC);
    for (let dr = -prefer; dr <= prefer; dr++) for (let dc = -prefer; dc <= prefer; dc++) push(ar + dr, ac + dc);
  }
  return cands.length ? battle.rng.pick(cands) : [Math.round(fallback[0]), Math.round(fallback[1])];
}

function alliesByAtk(battle) {
  return battle.allies().filter((u) => u.alive && !u.hidden).sort((a, b) => b.s.atk - a.s.atk);
}

function alliesWith(battle, key) {
  return battle.allies().filter((u) => u.alive && typeof u.findBuff === 'function' && u.findBuff(key));
}

/** 本场「特训敌人」的两档池：普通 = rank NORMAL，精英 = 其余（ELITE / BOSS）。 */
function trainingPools(battle) {
  const gd = typeof S.gameData === 'function' ? S.gameData() : null;
  const types = gd && gd.factions && gd.factions.types ? gd.factions.types : null;
  const out = { normal: [], elite: [] };
  for (const t of Object.values(types || {})) {
    if (!t || t.involveRandom !== true || !Array.isArray(t.pool)) continue;
    for (const k of t.pool) {
      if (typeof k !== 'string') continue;
      const rec = battle.data && typeof battle.data.rawEnemy === 'function' ? battle.data.rawEnemy(k) : null;
      if (!rec) continue;
      (String(rec.rank || 'NORMAL') === 'NORMAL' ? out.normal : out.elite).push(k);
    }
  }
  return out;
}

/** 在首领脚下召唤一批随机特训敌人（`normalN` 普通 + `eliteN` 精英）。 */
function summonTraining(battle, e, normalN, eliteN, mark = null) {
  const pool = trainingPools(battle);
  const pick = (arr) => (arr.length ? battle.rng.pick(arr) : null);
  const spawn = (key) => {
    if (!key) return;
    const u = battle.spawnEnemy(key, { pos: [e.y, e.x], ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
    if (u && mark) mark(u);
    battle.fx('summon', { x: e.x, y: e.y, id: e.id, key, n: 1 });
  };
  for (let i = 0; i < normalN; i++) spawn(pick(pool.normal) || pick(pool.elite));
  for (let i = 0; i < eliteN; i++) spawn(pick(pool.elite) || pick(pool.normal));
}

// ---------------------------------------------------------------------------------------------------------------
// “不死的黑蛇”·重构：第一阶段减伤 66%；烈焚灼息 40.5 s；点燃 15 s；引爆 25 s / +230；
// 第一次重生：不息恶火 10 轮 × 1 s、伤害 +230、按半场换方向、无敌 10 s、15 s 后回形态（满血 + 5 s 无敌）；
// 第二次重生：再放一次不息恶火，结束后保留 10% 生命、受伤 -99%、每秒流失 1% 直到倒下。

const BS_GUARD_TAKEN = 0.34;
const BS_FIRE_DURATION = 40.5;
const BS_IGNITE_CD = 15;
const BS_EXPLODE_CD = 25;
const BS_DAMAGE_BONUS = 230;
const BS_FIRESTORM_INTERVAL = 1;
const BS_FIRESTORM_ROUNDS = 10;
/** 不息恶火的**官方全屏特效**（本包 `fx.manifest` 携带的 `battle/prefabs/effects/screen.ab` 那一枚）。 */
const BS_FIRESTORM_SCREEN = 'screen_bsnake';
const BS_RAGE_INVINCIBLE = 10;
const BS_RAGE_LENGTH = 15;
const BS_BACK_INVINCIBLE = 5;
const BS_SUMMON_FIRST = 50;
const BS_ASH_HP_RATIO = 0.1;
const BS_ASH_TAKEN = 0.01;
const BS_ASH_DRAIN = 0.01;

/** 烈焚灼息：每秒真伤，50 + 180 × min(1, 已过秒/30)，持续 40.5 s。
 *
 *  普攻附带的火**不发技能**：官方那条是攻击命中时的被动（攻击造成真实伤害并对目标施加【烈焚灼息】），
 *  技能 `Ignite` 的动画属于「周期性对两名我方点燃」那一次施放。以前这里也 `castSkill(Ignite)`，于是首领**每一下
 *  普攻**都点亮技能槽 1（模型切到 Skill_1_A 的施法动作、SKILL 旗亮 0.3 s），普攻的挥砍动作被它截断 —— 业主
 *  2026-10-28 报的「动作和特效对不上」就是这一条。 */
function bsnameFire(battle, e, target) {
  if (!target || !target.alive || target.findBuff('recon:bsnake_fire')) return;
  const base = talentOf(e, 'fire.attack@dragon_fire.baseDamage', 50);
  const addOn = talentOf(e, 'fire.attack@dragon_fire.addOnDamage', 180);
  const addOnDur = Math.max(1, talentOf(e, 'fire.attack@dragon_fire.addOnDuration', 30));
  let elapsed = 0;
  battle.addBuff(target, {
    key: 'recon:bsnake_fire', duration: BS_FIRE_DURATION, visible: true, source: e, interval: 1,
    onTick: ({ battle: b, unit }) => {
      elapsed += 1;
      b.dealDamage(e.alive ? e : null, unit, { amount: base + addOn * Math.min(1, elapsed / addOnDur), type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    },
  });
}

/**
 * 【不息恶火】（官方 `ScreenAttack` 模式）：**全屏火雨**。持续 = 轮次 × 间隔 = `BS_FIRESTORM_ROUNDS × BS_FIRESTORM_INTERVAL`
 * （官方 28 s / 2 s，重构后 −13 s / −1 s）：每轮整场铺火（火光 + 从首领所在那一半场往另一半扫的火团），伤害仍是
 * 该行最靠近火源的那一名我方、`atk + 230` 法术。
 *
 * 画面：本包 `fx.manifest` 携带的**官方全屏 prefab `screen_bsnake`**（`fx('official')`，客户端在官方特效层里起一枚、
 * 撑满整段），外加每轮的程序化火雨 —— 全屏火光 + 命中者身上的火团 + 空地随机火团（确定性地取格，不掷随机）。
 *
 * 以前每轮 `castSkill(ScreenAttack)`：官方那个模式**没有动作 clip**（`anims.skills` 的槽 3 是空的），客户端会退回
 * 上一次的技能动作（Skill_1_A），同时逐目标发 `atk` 又让首领每轮挥一次普攻 —— 动作和火雨各演各的，而火雨本身
 * 根本没画出来（那条 `beam` 的 `from` 是坐标不是单位 ⇒ 客户端只画成目标身上的一枚火星）。现在一条都不发。
 */
function bsnameFirestorm(battle, e, onDone) {
  if (!e || !e.alive) return;
  const rc = battle.rect || {};
  const r0 = Number.isFinite(rc.r0) ? rc.r0 : 0;
  const r1 = Number.isFinite(rc.r1) ? rc.r1 : 6;
  const c0 = Number.isFinite(rc.c0) ? rc.c0 : 0;
  const c1 = Number.isFinite(rc.c1) ? rc.c1 : 20;
  const cx = (c0 + c1) / 2;
  const cy = (r0 + r1) / 2;
  const fromRight = e.tileC < cx;
  const rows = Math.max(1, r1 - r0 + 1);
  const cols = Math.max(1, c1 - c0 + 1);
  const total = BS_FIRESTORM_INTERVAL * BS_FIRESTORM_ROUNDS;
  // 官方全屏火雨：整段持续（+0.6 s 覆盖最后一轮火团的收尾）。起在**战场中心**：这枚 prefab 的 `static_offset`
  // 自带「抬高约 9.8 格、俯 30° 面向战斗相机」，从中心起才会摊在整个战场上（从世界原点起会飘到右上、上半幅出屏）
  battle.fx('official', { x: cx, y: cy, key: BS_FIRESTORM_SCREEN, holdS: total + 0.6, id: e.id });
  for (let i = 1; i <= BS_FIRESTORM_ROUNDS; i++) {
    battle.after(BS_FIRESTORM_INTERVAL * i, () => {
      if (!e.alive) return;
      // 全屏火光（`telegraph` 的 r ≥ 12 档 ⇒ 客户端只闪屏），再撒满整场的火团：每轮 16 处、按轮次错开
      // （确定的取格，不掷随机），从火源那一侧往另一侧铺 —— 10 轮下来每一格都被火烧过一遍以上
      battle.fx('telegraph', { x: cx, y: cy, r: 30, dur: 0.5, kind: 'bsnakeFire' });
      const tiles = rows * cols;
      const n = Math.min(16, tiles);
      for (let k = 0; k < n; k++) {
        const idx = (Math.floor((k * tiles) / n) + i * 7) % tiles;
        const rr = r0 + Math.floor(idx / cols);
        const off = idx % cols;
        const cc = fromRight ? c1 - off : c0 + off;
        battle.fx('flame', { x: cc, y: rr, r: 0.45, dur: 1.6 });
      }
      const hitRows = [...new Set(battle.allies().filter((a) => a.alive && !a.hidden).map((a) => Math.round(a.tileR)))];
      for (const r of hitRows) {
        const inRow = battle.allies().filter((a) => a.alive && !a.hidden && Math.round(a.tileR) === r);
        if (!inRow.length) continue;
        const t = inRow.sort((a, b) => (fromRight ? b.tileC - a.tileC : a.tileC - b.tileC))[0];
        // 命中只有一团火：不再发 `atk`（那会让首领挥一次普攻、动作与火雨错位）。**不带 `id`** —— 客户端的
        // `_flame` 按 `src` 认「同一股火」，带 id 的话这一轮所有命中会并成一股、只剩最后一个目标在烧
        battle.fx('flame', { x: t.x, y: t.y, r: 0.6, dur: 1.6 });
        battle.dealDamage(e, t, { amount: e.s.atk + BS_DAMAGE_BONUS, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
      }
    }, { owner: e });
  }
  if (onDone) battle.after(BS_FIRESTORM_INTERVAL * BS_FIRESTORM_ROUNDS, () => { if (e.alive) onDone(); }, { owner: e });
}

function installBsname(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_BSNAKE) return;
    battle.addBuff(e, {
      key: 'recon:bsnake_guard', persist: true, visible: true,
      mods: { physTakenMul: BS_GUARD_TAKEN, artsTakenMul: BS_GUARD_TAKEN, trueTakenMul: BS_GUARD_TAKEN },
    });
    bossStore(battle).bsnake.set(e, {
      phase: 'snake', ign: BS_IGNITE_CD, exp: BS_EXPLODE_CD, sum: BS_SUMMON_FIRST, rageLeft: 0, ashAcc: 0, death: 0,
    });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_BSNAKE || c.isSkill) return;
    const s = bossStore(battle).bsnake.get(a);
    if (!s || s.phase !== 'snake') return;
    for (const t of c.targets || []) bsnameFire(battle, a, t);
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.bsnake.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.bsnake) {
      if (!e.alive) { st.bsnake.delete(e); continue; }
      // 挂共享血池时：阶段由池驱动（3 条命：两次阶段死亡 + 最终死亡），第二次阶段回来只留 10% 生命
      syncPoolPhase(battle, e, s, {
        lives: 3,
        refill: (ph) => (ph === 2 ? BS_ASH_HP_RATIO : 1),
        onPhase: (ph) => { if (ph > s.death && ph <= 2) { s.death = ph; bsnameDeath(battle, e, s, ph); } },
      });
      if (s.phase === 'reborn' || s.phase === 'dying') continue;
      if (s.phase === 'berserk') {
        s.sum -= dt;
        if (s.sum <= 1e-9) {
          s.sum = BS_SUMMON_FIRST;
          castSkill(battle, e, skillOf(e, 'SummonFlame'));
          // 召唤落在 Skill_3 的命中帧（0.9 s）：以前技能一抬手就把能量聚合体放出来，动作与召唤对不上
          battle.after(0.9, () => {
            if (!e.alive) return;
            spawnSummon(battle, e, SUMMON_BSENERGY, tileNearAlly(battle, [e.tileR, e.tileC], 2));
          }, { owner: e });
        }
        s.rageLeft -= dt;
        if (s.rageLeft <= 1e-9) {
          s.phase = 'snake';
          battle.removeBuff(e, 'recon:bsnake_rage');
          battle.removeBuff(e, 'recon:bsnake_inv');
          e.profile.noAttack = false;
          e.hp = e.s.maxHp;
          e.atkCd = 0;
          e.markDirty();
          battle.addBuff(e, { key: 'recon:bsnake_back', duration: BS_BACK_INVINCIBLE, visible: true, flags: { invulnerable: true } });
          s.ign = BS_IGNITE_CD;
          s.exp = BS_EXPLODE_CD;
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: null });
        }
        continue;
      }
      if (s.phase === 'ash') {
        s.ashAcc += dt;
        while (s.ashAcc >= 1 - 1e-9) {
          s.ashAcc -= 1;
          const drain = e.s.maxHp * BS_ASH_DRAIN;
          const pool = bossPoolOf(battle);
          if (pool) {
            // 挂池：余烬流失也要扣**池**（写 e.hp 会被下一帧 `_syncBossHp` 冲掉）
            pool.damage(null, drain);
            if (pool.hp <= 1e-9) { battle.kill(e, null); break; }
          } else {
            e.hp -= drain;
            if (e.hp <= 1e-9) { e.hp = 0; e.markDirty(); battle.kill(e, null); break; }
          }
        }
        e.markDirty();
        continue;
      }
      if (!canAct(battle, e)) continue;
      // 点燃（15 s）：两名未带火的我方
      s.ign -= dt;
      if (s.ign <= 1e-9) {
        s.ign = BS_IGNITE_CD;
        const sk = skillOf(e, 'Ignite');
        const free = battle.allies().filter((u) => u.alive && !u.hidden && !u.findBuff('recon:bsnake_fire'));
        const picks = [];
        while (picks.length < 2 && free.length) picks.push(...free.splice(battle.rng.int ? battle.rng.int(free.length) : 0, 1));
        if (picks.length) castSkill(battle, e, sk);
        battle.after(1.167, () => {
          if (!e.alive || !picks.length) return;
          for (const u of picks) if (u.alive) bsnameFire(battle, e, u);
        }, { owner: e });
      }
      // 引爆（25 s）：每个带火的我方 + 四格，伤害 +230
      s.exp -= dt;
      if (s.exp <= 1e-9) {
        s.exp = BS_EXPLODE_CD;
        castSkill(battle, e, skillOf(e, 'DragonFireExplode'));
        battle.after(1.033, () => {
          if (!e.alive) return;
          for (const u of alliesWith(battle, 'recon:bsnake_fire')) {
            battle.dealDamage(e, u, { amount: e.s.atk + BS_DAMAGE_BONUS, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
            battle.removeBuff(u, 'recon:bsnake_fire');
            for (const o of alliesInBox(battle, u.tileR, u.tileC, 1)) {
              if (o === u || !o.alive) continue;
              battle.dealDamage(e, o, { amount: e.s.atk + BS_DAMAGE_BONUS, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
              if (o.alive) bsnameFire(battle, e, o);
            }
          }
        }, { owner: e });
      }
    }
  });
  // 能量聚合体：25 s 自爆，四方向各打最近我方 1000 法术 + 挂火
  battle.on('tick', (c) => {
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const u of liveEnemies(battle, SUMMON_BSENERGY)) {
      u._reconFuse = (u._reconFuse ?? 0) + dt;
      if (u._reconFuse < 25) continue;
      u._reconFuse = 0;
      const snake = liveEnemies(battle, BOSS_BSNAKE)[0] || null;
      battle.fx('explode', { x: u.x, y: u.y, r: 2, kind: 'bsnakeFire', id: u.id });
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const t = battle.allies().filter((a) => a.alive && !a.hidden)
          .filter((a) => (dr === 0 ? Math.round(a.tileR) === Math.round(u.tileR) : Math.round(a.tileC) === Math.round(u.tileC)))
          .sort((a, b) => Math.abs(a.x - u.x) + Math.abs(a.y - u.y) - (Math.abs(b.x - u.x) + Math.abs(b.y - u.y)))[0];
        if (!t) continue;
        battle.fx('beam', { from: [u.x, u.y], to: [t.x, t.y], kind: 'bsnakeFire', id: u.id });
        battle.dealDamage(snake, t, { amount: 1000, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
        if (t.alive && snake) bsnameFire(battle, snake, t);
      }
      battle.kill(u, snake);
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_BSNAKE) return;
    const st = bossStore(battle);
    const s = st.bsnake.get(e);
    if (!s || s.phase === 'reborn' || s.phase === 'dying' || s.phase === 'ash') return;
    // 挂共享血池时 `kill` 只代表**最终**死亡（中间阶段被池夹住了），阶段脚本走 `syncPoolPhase`
    if (e.bossPool) return;
    if (s.death >= 2) return;
    s.death += 1;
    bsnameDeath(battle, e, s, s.death);
  });
}

/** 黑蛇的一次「阶段死亡」：`death = 1` 重生→狂暴，`death = 2` 消失→余烬。 */
function bsnameDeath(battle, e, s, death) {
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    if (death === 1) {
      // 第一次：5 s 重生 → 狂暴（HP/ATK +50%）→ 10 s 无敌 + 不息恶火 → 15 s 后回形态
      s.death = 1;
      s.phase = 'reborn';
      battle.addBuff(e, {
        key: 'recon:bsnake_reborn', duration: 5, visible: true, persist: true,
        flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
        onExpire: ({ battle: b }) => {
          if (!e.alive) return;
          s.phase = 'berserk';
          s.rageLeft = BS_RAGE_LENGTH;
          s.sum = BS_SUMMON_FIRST;
          // 「生命 +50%」= 基础生命的加算百分比（`hpPct`）。`hpMul` 是**乘数**键，0.5 会砍成一半（旧 bug）。
          b.addBuff(e, { key: 'recon:bsnake_rage', persist: true, visible: true, mods: { hpPct: 0.5, atkPct: 0.5 } });
          e.hp = e.s.maxHp;
          e.markDirty();
          b.addBuff(e, { key: 'recon:bsnake_inv', persist: true, visible: true, flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true } });
          b.after(BS_RAGE_INVINCIBLE, () => { if (e.alive && s.phase === 'berserk') b.removeBuff(e, 'recon:bsnake_inv'); }, { owner: e });
          b.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'rage' });
          bsnameFirestorm(b, e, null);
        },
      });
      battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: 5, kind: 'reborn', id: e.id, form: 'reborn' });
    } else {
      // 第二次：5 s 后消失 → 再放一次不息恶火 → 保留 10% 生命、受伤 -99%、每秒流失 1%
      s.death = 2;
      s.phase = 'dying';
      battle.addBuff(e, {
        key: 'recon:bsnake_dying', duration: 5, visible: true, persist: true,
        flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
        onExpire: ({ battle: b }) => {
          if (!e.alive) return;
          b.addBuff(e, { key: 'recon:bsnake_inv', persist: true, visible: true, flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true } });
          bsnameFirestorm(b, e, () => {
            if (!e.alive) return;
            b.removeBuff(e, 'recon:bsnake_inv');
            s.phase = 'ash';
            s.ashAcc = 0;
            e.profile.noAttack = false;
            e.hp = Math.max(1, e.s.maxHp * BS_ASH_HP_RATIO);
            e.markDirty();
            b.addBuff(e, { key: 'recon:bsnake_ash', persist: true, visible: true, mods: { dmgTakenMul: BS_ASH_TAKEN } });
            b.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'ash' });
          });
        },
      });
      battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: 5, kind: 'reborn', id: e.id, form: 'reborn' });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// 奎隆，摩诃萨埵权化·重构：不着相 10 s；入定 15 s 尼卢火 / 30 s 5 精英；清火执 20 s；自在怒目每 3 次命中、
// 伤害 +200；呼吸法 25 s 尼卢火 / 20 s（7 普通 + 3 精英）；惩五戒 15 s、6 段、每段 +200、每 2 段怒目；
// 承三身改为每次 +15% 减伤；尼卢火 30 s、退场全体 -40% 攻击 30 s、伤害 4000；重生 7 s 后清场（首领除外）。

const SKZ_WRATH_BONUS = 200;
const SKZ_CLEAN_INIT = 20;
const SKZ_CLEAN_INTERVAL = 20;
const SKZ_MEDITATE_SWITCH = 10;
const SKZ_MEDITATE_NILU = 15;
const SKZ_MEDITATE_BATCH = 30;
const SKZ_MEDITATE_ELITES = 5;
const SKZ_FREE_NILU = 25;
const SKZ_FREE_BATCH = 20;
const SKZ_FREE_NORMAL = 7;
const SKZ_FREE_ELITE = 3;
const SKZ_CAREFREE_NILU = 10;
const SKZ_FIVE_INTERVAL = 15;
const SKZ_FIVE_SEGMENTS = 6;
const SKZ_FIVE_FRAMES = Object.freeze([0.767, 1.3, 2, 2.367, 3.967]);
const SKZ_REDUCE_STEP = 0.15;
const SKZ_REBORN = 7;
const SKZ_NILU_LIFE = 30;
const SKZ_NILU_ATK_DOWN = 0.4;
const SKZ_NILU_DEBUFF_DURATION = 30;
const SKZ_NILU_DAMAGE = 4000;

/** 【怒目】：以每个尼卢火为中心，十字五格各吃 ATK + 200 法术（无视不可选中）。 */
function skzWrath(battle, e) {
  const nilus = liveEnemies(battle, SUMMON_NILU);
  const amount = e.s.atk + SKZ_WRATH_BONUS;
  for (const n of nilus) {
    battle.fx('explode', { x: n.x, y: n.y, r: 1, kind: 'niluWrath', id: e.id });
    for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const a of battle.allies()) {
        if (!a.alive || a.hidden) continue;
        if (Math.round(a.tileR) !== Math.round(n.tileR) + dr || Math.round(a.tileC) !== Math.round(n.tileC) + dc) continue;
        battle.dealDamage(e, a, { amount, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'wrath'] });
      }
    }
  }
}

/** 尼卢火：30 s（或被我方治疗回满）后退场；退场时全体在场干员攻击 -40%/30 s，并对其周围 4000 法术。 */
function skzNiluTick(battle, dt) {
  for (const n of liveEnemies(battle, SUMMON_NILU)) {
    n._reconLife = (n._reconLife ?? 0) + dt;
    const full = n._reconLife > 5 && n.hp >= n.s.maxHp - 1e-9;
    if (n._reconLife < SKZ_NILU_LIFE && !full) continue;
    const boss = liveEnemies(battle, BOSS_SKZJKL)[0] || null;
    battle.fx('explode', { x: n.x, y: n.y, r: 1, kind: 'niluEnd', id: n.id });
    for (const a of battle.allies()) {
      if (!a.alive) continue;
      battle.addBuff(a, { key: 'recon:skz_nilu_atkdown', duration: SKZ_NILU_DEBUFF_DURATION, refresh: 'extend', visible: true, source: boss, mods: { atkPct: -SKZ_NILU_ATK_DOWN } });
    }
    for (const a of alliesInBox(battle, n.tileR, n.tileC, 1)) {
      if (a.alive) battle.dealDamage(boss, a, { amount: SKZ_NILU_DAMAGE, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    }
    battle.kill(n, boss);
  }
}

function installSkzjkl(battle) {
  /** 首领**自己召唤**的单位（尼卢火 / 特训批次）：阶段重生的清场不带走它们（业主 2026-10-29）。 */
  const markOwn = (u) => { if (u) u._reconSkzOwn = true; return u; };
  battle.on('enemySpawn', (c) => {
    const n = c && c.enemy;
    if (n && n.defId === SUMMON_NILU) {
      battle.addBuff(n, { key: 'recon:nilu_untargetable', persist: true, visible: true, flags: { invulnerable: true, untargetable: true } });
      n.profile.noAttack = true;
      n.hp = 1;
      n._reconLife = 0;
      return;
    }
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SKZJKL) return;
    battle.addBuff(e, { key: 'recon:skz_meditate', persist: true, visible: true, flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true } });
    e.profile.noAttack = true;
    bossStore(battle).skzjkl.set(e, {
      phase: 'meditate', switchLeft: SKZ_MEDITATE_SWITCH,
      t1: SKZ_MEDITATE_NILU, t2: SKZ_MEDITATE_BATCH,
      clean: SKZ_CLEAN_INIT, five: icdOf(skillOf(e, 'M1MultiAttack')),
      hits: 0, thresholds: [], stacks: 0, rebornDone: false,
    });
  });
  // 普攻每 3 次命中触发一次怒目（无忧觉的二连击算两段）
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_SKZJKL || c.isSkill) return;
    const s = bossStore(battle).skzjkl.get(a);
    if (!s || s.phase === 'meditate') return;
    const segs = s.phase === 'carefree' ? 2 : 1;
    s.hits += segs;
    while (s.hits >= 3) { s.hits -= 3; skzWrath(battle, a); }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    // 尼卢火按自己的计时退场（30 s / 被治疗回满），**不依赖首领还在场**：从前这一行在 `skzjkl` 的空表判断之后，
    // 首领一退场剩下的尼卢火就永远不再结算（也不退场）。
    skzNiluTick(battle, dt);
    if (!st.skzjkl || !st.skzjkl.size) return;
    const nilus = liveEnemies(battle, SUMMON_NILU).length;
    for (const [e, s] of st.skzjkl) {
      if (!e.alive) { st.skzjkl.delete(e); continue; }
      // 挂共享血池时：池两条命（一次阶段重生 + 最终死亡）
      syncPoolPhase(battle, e, s, { lives: 2, onPhase: () => skzStartReborn(battle, e, s) });
      // 尼卢火减伤：每个 ×0.8（乘算）
      battle.removeBuff(e, 'recon:skz_nilumit');
      if (nilus > 0) {
        const mul = Math.pow(0.8, nilus);
        battle.addBuff(e, { key: 'recon:skz_nilumit', persist: true, visible: true, mods: { physTakenMul: mul, artsTakenMul: mul } });
      }
      if (s.phase === 'meditate') {
        s.switchLeft -= dt;
        s.t1 -= dt;
        s.t2 -= dt;
        s.clean -= dt;
        if (s.t1 <= 1e-9) { s.t1 = SKZ_MEDITATE_NILU; castSkill(battle, e, skillOf(e, 'M1SummonSkzjbc')); markOwn(spawnSummon(battle, e, SUMMON_NILU, tileNearAlly(battle, [e.tileR, e.tileC], 2))); }
        if (s.t2 <= 1e-9) { s.t2 = SKZ_MEDITATE_BATCH; summonTraining(battle, e, 0, SKZ_MEDITATE_ELITES, markOwn); }
        if (s.clean <= 1e-9) { s.clean = SKZ_CLEAN_INTERVAL; castSkill(battle, e, skillOf(e, 'M0TriggerSkzth')); skzWrath(battle, e); }
        if (s.switchLeft <= 1e-9) {
          castSkill(battle, e, skillOf(e, 'M0SwitchMode'));
          s.phase = 'free';
          battle.removeBuff(e, 'recon:skz_meditate');
          e.profile.noAttack = false;
          s.t1 = SKZ_FREE_NILU;
          s.t2 = SKZ_FREE_BATCH;
          s.five = icdOf(skillOf(e, 'M1MultiAttack'));
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'M1' });
        }
        continue;
      }
      if (!canAct(battle, e)) continue;
      // 承三身（仅自在阶段）：75 / 50 / 25% 各 +15% 减伤（不无敌、不阻挡、不停手）
      if (s.phase === 'free') {
        const ratio = e.hpRatio;
        for (const th of [0.75, 0.5, 0.25]) {
          if (ratio > th || s.thresholds.includes(th)) continue;
          s.thresholds.push(th);
          s.stacks += 1;
          battle.removeBuff(e, 'recon:skz_reduce');
          battle.addBuff(e, {
            key: 'recon:skz_reduce', persist: true, visible: true,
            mods: { physTakenMul: Math.pow(1 - SKZ_REDUCE_STEP, s.stacks), artsTakenMul: Math.pow(1 - SKZ_REDUCE_STEP, s.stacks) },
          });
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'guard' });
          break;
        }
      }
      // 清火执
      s.clean -= dt;
      if (s.clean <= 1e-9) {
        s.clean = SKZ_CLEAN_INTERVAL;
        castSkill(battle, e, skillOf(e, 'M0TriggerSkzth'));
        skzWrath(battle, e);
      }
      // 尼卢火
      s.t1 -= dt;
      if (s.t1 <= 1e-9) {
        s.t1 = s.phase === 'carefree' ? SKZ_CAREFREE_NILU : SKZ_FREE_NILU;
        castSkill(battle, e, skillOf(e, 'M1SummonSkzjbc'));
        markOwn(spawnSummon(battle, e, SUMMON_NILU, tileNearAlly(battle, [e.tileR, e.tileC], 2)));
      }
      // 召唤批次（无忧觉不再召唤）
      if (s.phase === 'free') {
        s.t2 -= dt;
        if (s.t2 <= 1e-9) { s.t2 = SKZ_FREE_BATCH; summonTraining(battle, e, SKZ_FREE_NORMAL, SKZ_FREE_ELITE, markOwn); }
      }
      // 惩五戒：6 段（第 6 段与第 5 段同帧），每段 +200，每 2 段触发一次怒目
      s.five -= dt;
      if (s.five <= 1e-9) {
        const sk = skillOf(e, s.phase === 'carefree' ? 'M3MultiAttack' : 'M1MultiAttack') || skillOf(e, 'M1MultiAttack');
        s.five = SKZ_FIVE_INTERVAL;
        const t = alliesByAtk(battle)[0];
        if (!t) continue;
        castSkill(battle, e, sk);
        const amount = e.s.atk + SKZ_WRATH_BONUS;
        for (let i = 0; i < SKZ_FIVE_SEGMENTS; i++) {
          const at = SKZ_FIVE_FRAMES[Math.min(SKZ_FIVE_FRAMES.length - 1, i)];
          battle.after(at, () => {
            if (!e.alive || !t.alive) return;
            battle.dealDamage(e, t, { amount, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
            if ((i + 1) % 2 === 0) skzWrath(battle, e);
          }, { owner: e });
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SKZJKL) return;
    const s = bossStore(battle).skzjkl.get(e);
    if (!s || s.rebornDone) return;
    // 挂池时 `kill` 只代表最终死亡（阶段脚本走 `syncPoolPhase`）
    if (e.bossPool) return;
    skzStartReborn(battle, e, s);
  });
}

/** 奎隆的唯一一次阶段重生（7 s 后清场、进入无忧觉）。 */
function skzStartReborn(battle, e, s) {
    if (!s || s.rebornDone) return;
    s.rebornDone = true;
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:skz_reborn', duration: SKZ_REBORN, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        // 清除场上其他敌人（**首领除外**，免得把对面阵营的同名首领一起清掉；**首领自己召唤的单位也除外** ——
        // 尼卢火 / 特训批次不随首领的阶段退场一起消失，业主 2026-10-29）
        for (const o of (b.enemies || []).slice()) {
          if (!o || !o.alive || o === e) continue;
          if (o._reconSkzOwn) continue;
          const rank = (o.def && o.def.raw && o.def.raw.rank) || o.rank;
          if (rank === 'BOSS') continue;
          b.kill(o, e);
        }
        s.phase = 'carefree';
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        s.t1 = SKZ_CAREFREE_NILU;
        s.five = SKZ_FIVE_INTERVAL;
        s.hits = 0;
        b.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'M3' });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: SKZ_REBORN, kind: 'reborn', id: e.id, form: 'reborn' });
}

// ---------------------------------------------------------------------------------------------------------------
// 伊莎玛拉，腐化之心·重构：治疗 +48600；在场每秒 +2 技力、每 20 s 留一滴泪（+30 技力）；半血额外留 3 滴泪；
// 变身形态 4 目标 / 真伤 / 生命×75% 攻击×80% 防御×50% 法抗×70% 移速×80% 攻击间隔×50%；变身后被击倒 → 5 s 重生，
// 回到初始形态并恢复记录的生命，充能上限缩减至 80。

const SYS_HEAL_BONUS = 48600;
const SYS_HEAL_TARGETS = 3;
const SYS_SP_MAX = 120;
const SYS_SP_REBIRTH = 80;
const SYS_SP_REGEN = 2;
const SYS_TEAR_INTERVAL = 20;
const SYS_TEAR_SP = 30;
const SYS_REBORN = 5;

/** 留泪：每滴 +30 技力（部署拦截不做，泪只作充能标记）。 */
function syskadTears(battle, e, s, n) {
  for (let i = 0; i < n; i++) {
    s.sp = Math.min(s.spMax, s.sp + SYS_TEAR_SP);
    battle.fx('mark', { x: e.x, y: e.y, id: e.id, kind: 'syskadTear', n: 1 });
  }
}

function installSyskad(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SYSKAD) return;
    e.profile.noAttack = true;
    bossStore(battle).syskad.set(e, {
      transformed: false, reborn: false, sp: 0, spMax: SYS_SP_MAX, tearLeft: SYS_TEAR_INTERVAL,
      healAcc: 0, berserk: false, hpRecord: e.s.maxHp,
    });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.syskad.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.syskad) {
      if (!e.alive) { st.syskad.delete(e); continue; }
      // 挂共享血池时：**变身后**才多一条命（未变身被击倒 = 最终死亡）
      syncPoolPhase(battle, e, s, {
        lives: () => (s.transformed ? 2 : 1),
        refill: () => (s.hpRecord ? Math.max(0.01, Math.min(1, s.hpRecord / e.s.maxHp)) : 1),
        onPhase: () => syskadStartReborn(battle, e, s),
      });
      if (s.reborn || s.transformed) continue;
      // 生命首次低于 50%：攻击 +50%，并额外留 3 滴泪
      if (!s.berserk && e.hpRatio < talentOf(e, 'Berserk.hp_ratio', 0.5)) {
        s.berserk = true;
        castSkill(battle, e, skillOf(e, 'BerserkCorrupt'));
        battle.addBuff(e, { key: 'recon:syskad_berserk', persist: true, visible: true, mods: { atkPct: talentOf(e, 'Berserk.atk', 0.5) } });
        syskadTears(battle, e, s, 3);
        battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'rage' });
      }
      // 在场每秒 +2 技力；每 20 s 留一滴泪（+30）
      s.sp += SYS_SP_REGEN * dt;
      s.tearLeft -= dt;
      if (s.tearLeft <= 1e-9) { s.tearLeft = SYS_TEAR_INTERVAL; syskadTears(battle, e, s, 1); }
      // 初始形态的普攻 = 治疗 3 名最缺血的敌人（ATK + 48600）
      s.healAcc -= dt;
      if (s.healAcc <= 1e-9) {
        s.healAcc = e.s.bat;
        const hurt = (battle.enemies || []).filter((x) => x.alive && x.hpRatio < 1)
          .sort((a, b2) => a.hpRatio - b2.hpRatio).slice(0, SYS_HEAL_TARGETS);
        for (const h of hurt) {
          battle.heal(e, h, e.s.atk + SYS_HEAL_BONUS, {});
          battle.fx('heal', { x: h.x, y: h.y, id: h.id });
        }
      }
      if (s.sp >= s.spMax - 1e-9) {
        s.transformed = true;
        castSkill(battle, e, skillOf(e, 'change'));
        s.hpRecord = e.hp;
        // 变身后才会「被击倒 → 重生」：这时才把共享池的寿命加到 2（未变身被击倒就是最终死亡）
        { const pool = bossPoolOf(battle); if (pool && typeof pool.setLives === 'function') pool.setLives(2); }
        battle.addBuff(e, {
          key: 'recon:syskad_form2', persist: true, visible: true,
          // 变身形态：生命 ×75% / 攻击 ×80% / 防御 ×50% / 法抗 ×70% / 移速 ×80% / 攻击间隔 ×50%（攻速 ×2）。
          // 「×N」一律走**乘数**键（`hpMul` 等）；从前写成 `hpMul: -0.25` 会把上限夹成 1（旧 bug）。
          mods: {
            hpMul: 0.75, atkMul: 0.8, defMul: 0.5, resMul: 0.7, moveMul: 0.8, aspd: e.base.aspd,
          },
        });
        e.profile.noAttack = false;
        e.profile.dmgType = 'true';
        e.profile.maxTargets = 4;
        e.base.rangeRadius = 4;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        e.markDirty();
        battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SYSKAD) return;
    const s = bossStore(battle).syskad.get(e);
    if (!s || !s.transformed || s.reborn) return;
    // 挂池时 `kill` 只代表最终死亡（阶段脚本走 `syncPoolPhase`）
    if (e.bossPool) return;
    syskadStartReborn(battle, e, s);
  });
}

/** 伊莎玛拉变身后被击倒：5 s 重生 → 回到初始形态并恢复记录的生命。 */
function syskadStartReborn(battle, e, s) {
    if (!s || !s.transformed || s.reborn) return;
    s.reborn = true;
    castSkill(battle, e, skillOf(e, 'Corrupt'));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:syskad_reborn', duration: SYS_REBORN, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        s.transformed = false;
        s.reborn = false;
        b.removeBuff(e, 'recon:syskad_form2');
        e.profile.noAttack = true;
        e.profile.dmgType = null;
        e.profile.maxTargets = 1;
        e.base.rangeRadius = 20;
        e.hp = Math.max(1, Math.min(e.s.maxHp, s.hpRecord));
        e.markDirty();
        s.sp = 0;
        s.spMax = SYS_SP_REBIRTH;
        s.tearLeft = SYS_TEAR_INTERVAL;
        s.healAcc = 0;
        b.fx('revive', { x: e.x, y: e.y, id: e.id, form: null });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: SYS_REBORN, kind: 'reborn', id: e.id, form: 'reborn' });
}

// ---------------------------------------------------------------------------------------------------------------
// 玻利瓦尔，症结之核·重构：普攻降防 -120；未熄之地 10 s / 首次 5 s；灾厄之口 10 s、0.25 s 一跳、目标提前离场 +2 s；
// 二形态 +50% 攻 / +50% 生命；三形态 +20% 攻 / +60% 生命、起飞 6 s（20/10）、火球 3 s、RebornLike 60 s。

const SH_DEF_DOWN = -120;
const SH_DEF_DOWN_DURATION = 5;
const SH_FIREBALL_CD = 10;
const SH_FIREBALL_INIT = 5;
const SH_FIREBALL_FLY_CD = 3;
const SH_FIRE_DURATION = 25;
const SH_JAW_DURATION = 10;
const SH_JAW_INTERVAL = 0.25;
const SH_JAW_FIRST_DELAY = 2;
const SH_JAW_EXTEND = 2;
const SH_JAW_PURE = 0.4;
const SH_JAW_MAGIC = 0.15;
const SH_FLY_DURATION = 6;
const SH_FLY_CD = 20;
const SH_FLY_INIT = 10;
const SH_REBORN_LIKE = 60;

/** 【未熄之地】：主目标与四格吃 ATK×1.2 法术，留 25 s 火场（每秒 ATK×0.15）。 */
function shchmrFireball(battle, e, flying) {
  const sk = skillOf(e, flying ? 'Fireball_Fly' : 'Fireball') || skillOf(e, 'Fireball');
  const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable);
  if (!cands.length) return;
  const t = battle.rng.pick(cands);
  castSkill(battle, e, sk);
  const main = skNum(sk, 'atk_scale_main', 1.2);
  const dot = skNum(sk, 'atk_scale_dot', 0.15);
  battle.after(1, () => {
    if (!e.alive || !t.alive) return;
    const ix = t.x, iy = t.y, r = t.tileR, c = t.tileC;
    battle.fx('explode', { x: ix, y: iy, r: 1, kind: 'shchmrFire' });
    battle.dealDamage(e, t, { amount: e.s.atk * main, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
    for (const u of alliesInBox(battle, r, c, 1)) {
      if (u === t || !u.alive) continue;
      battle.dealDamage(e, u, { amount: e.s.atk * main, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    }
    for (let i = 1; i <= SH_FIRE_DURATION; i++) {
      battle.after(i, () => {
        if (!e.alive) return;
        for (const u of alliesInBox(battle, r, c, 1)) {
          if (u.alive) battle.dealDamage(e, u, { amount: e.s.atk * dot, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
        }
      }, { owner: e });
    }
  }, { owner: e });
}

/** 进入【灾厄之口】：暂时离场 10 s，0.25 s 一跳；`pendingUp` 决定结束后是否进下一形态。 */
function shchmrStartJaw(battle, e, s, pendingUp) {
  if (s.jaw) return;
  s.jaw = true;
  s.jawLeft = SH_JAW_DURATION;
  s.jawAcc = SH_JAW_FIRST_DELAY;
  s.jawTarget = null;
  s.jawExtDone = false;
  s.pendingUp = !!pendingUp;
  e.hp = 1;
  e.unbalanceUntil = -Infinity;
  e.profile.noAttack = true;
  // 灾厄之口 = 官方 Fire 技能窗口：动作走 `anims.skills[0]` 的 C_Skill_1（不是换形态；D_* 是飞行那套）。
  // 窗口长度按本实现的 10 s，而不是记录的 20 s，免得技能 clip 在嘴巴关上后还在播。
  const fire = skillOf(e, 'Fire');
  if (fire) castSkill(battle, e, { ...fire, bb: { ...(fire.bb || {}), duration: SH_JAW_DURATION } });
  battle.addBuff(e, {
    key: 'recon:shchmr_jaw', persist: true, visible: true,
    flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true },
  });
  battle.fx('telegraph', { x: e.x, y: e.y, r: 2, dur: SH_JAW_DURATION, kind: 'jaw', id: e.id });
}

function shchmrEndJaw(battle, e, s) {
  s.jaw = false;
  battle.removeBuff(e, 'recon:shchmr_jaw');
  e.profile.noAttack = false;
  e.hp = e.s.maxHp;
  e.atkCd = 0;
  e.markDirty();
  if (s.pendingUp && s.form < 3) {
    s.form += 1;
    const atk = s.form === 2 ? 0.5 : 0.2;
    const hp = s.form === 2 ? 0.5 : 0.6;
    battle.removeBuff(e, 'recon:shchmr_form');
    // 「生命 +50% / +60%」是加算百分比；`hpMul` 是乘数（旧写法会把上限砍成 50%/60%）
    battle.addBuff(e, { key: 'recon:shchmr_form', persist: true, visible: true, mods: { hpPct: hp, atkPct: atk } });
    battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: s.form === 3 ? 'form3' : 'form2' });
  }
  s.pendingUp = false;
  if (s.form >= 3) s.rebornLike = SH_REBORN_LIKE;
}

function installShchmr(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SHCHMR) return;
    bossStore(battle).shchmr.set(e, {
      form: 1, ballis: SH_FIREBALL_INIT, fly: SH_FLY_INIT, flying: 0,
      jaw: false, jawLeft: 0, jawAcc: 0, jawTarget: null, jawExtDone: false, pendingUp: false, rebornLike: SH_REBORN_LIKE,
    });
  });
  // 普攻附带降防 -120（持续 5 s，命中刷新）
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_SHCHMR || c.isSkill) return;
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      battle.addBuff(t, { key: 'recon:shchmr_defdown', duration: SH_DEF_DOWN_DURATION, refresh: 'extend', visible: true, source: a, mods: { defFlat: SH_DEF_DOWN } });
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.shchmr.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.shchmr) {
      if (!e.alive) { st.shchmr.delete(e); continue; }
      // 挂共享血池时：池三条命（两次灾厄之口形态升级 + 最终死亡）
      syncPoolPhase(battle, e, s, {
        lives: 3,
        onPhase: () => { if (s.form < 3) shchmrStartJaw(battle, e, s, true); },
      });
      if (s.jaw) {
        s.jawLeft -= dt;
        // 被选中目标提前离场 ⇒ 延长 2 s（每次灾厄之口只判一次）
        const top = battle.allies().filter((u) => u.alive).sort((a, b2) => b2.s.maxHp - a.s.maxHp)[0] || null;
        if (!s.jawExtDone && s.jawTarget && (!s.jawTarget.alive || s.jawTarget.hidden || s.jawTarget !== top)) {
          if (!s.jawTarget.alive || s.jawTarget.hidden) { s.jawLeft += SH_JAW_EXTEND; s.jawExtDone = true; }
        }
        if (top) s.jawTarget = top;
        s.jawAcc -= dt;
        while (s.jawAcc <= 1e-9) {
          s.jawAcc += SH_JAW_INTERVAL;
          const alive = battle.allies().filter((u) => u.alive);
          if (!alive.length) break;
          const t = [...alive].sort((a, b2) => b2.s.maxHp - a.s.maxHp)[0];
          const near = new Set(alliesInBox(battle, t.tileR, t.tileC, 2));
          battle._ev(['atk', e.id, t.id, 'true']);
          for (const u of alive) {
            const inside = u === t || near.has(u);
            battle.dealDamage(e, u, {
              amount: e.s.atk * (inside ? SH_JAW_PURE : SH_JAW_MAGIC),
              type: inside ? 'true' : 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'],
            });
          }
        }
        if (s.jawLeft <= 1e-9) shchmrEndJaw(battle, e, s);
        continue;
      }
      // 第三形态：起飞 6 s（20 s 冷却 / 首次 10 s），起飞时不普攻、火球 3 s 一发
      if (s.form >= 3) {
        if (s.flying > 0) {
          s.flying -= dt;
          if (s.flying <= 1e-9) {
            s.flying = 0;
            e.profile.noAttack = false;
            battle.removeBuff(e, 'recon:shchmr_fly');
          }
        } else {
          s.fly -= dt;
          if (s.fly <= 1e-9) {
            s.fly = SH_FLY_CD;
            s.flying = SH_FLY_DURATION;
            e.profile.noAttack = true;
            battle.addBuff(e, { key: 'recon:shchmr_fly', duration: SH_FLY_DURATION, visible: true, flags: { unblockable: true, levitate: true } });
            // 起飞 = D_Begin → D_Idle（`form:'fly'`，模型自己的飞行 clip 集），落地由该形态的 `end`（D_End）收尾。
            // 官方 `Fly` 技能没有特效（`skills.fly.effects = []`），这里用一个 `phase` 光效说明「离地」[ASSUMED]。
            battle.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'shchmrFly', dur: SH_FLY_DURATION, form: 'fly' });
          }
        }
        // "经过较长时间后再次灾厄之口"
        if (s.flying <= 1e-9) {
          s.rebornLike -= dt;
          if (s.rebornLike <= 1e-9) { s.rebornLike = SH_REBORN_LIKE; castSkill(battle, e, skillOf(e, 'RebornLike')); shchmrStartJaw(battle, e, s, false); continue; }
        }
      }
      // 火球：起飞时也照常释放（第三形态飞行中 3 s 一发）
      if (s.flying > 0 || canAct(battle, e)) {
        s.ballis -= dt;
        if (s.ballis <= 1e-9) {
          s.ballis = s.flying ? SH_FIREBALL_FLY_CD : SH_FIREBALL_CD;
          shchmrFireball(battle, e, s.flying > 0);
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SHCHMR) return;
    const s = bossStore(battle).shchmr.get(e);
    if (!s || s.jaw) return;
    if (s.form >= 3) return; // 第三形态被击倒 = 真死
    // 挂池时 `kill` 只代表最终死亡（阶段脚本走 `syncPoolPhase`）
    if (e.bossPool) return;
    shchmrStartJaw(battle, e, s, true);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 朔壳·重构：暴武闪避 75%（被阻挡 -25%，身形在场 +10%）；在场每 10 s +10% 攻 / +10% 防；
// 醉生 24 s（召唤剑傲）；溯律 20 s（随机 3 名我方各召 1 枚敛傲）；描躯 30 s（身形在场只加闪避、不再强制撤退）；
// 被击倒后召唤 35 普通 + 15 精英。

const DYC_DODGE = 0.75;
const DYC_BLOCKED_PENALTY = 0.25;
const DYC_BODY_BONUS = 0.1;
const DYC_STACK_INTERVAL = 10;
const DYC_STACK_STEP = 0.1;
const DYC_SEND_CD = 24;
const DYC_PUNCH_CD = 20;
const DYC_PUNCH_TARGETS = 3;
const DYC_BODY_CD = 30;
const DYC_BATCH_NORMAL = 35;
const DYC_BATCH_ELITE = 15;

function installDycyue(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_DYCYUE) return;
    bossStore(battle).shuoke.set(e, {
      send: icdOf(skillOf(e, 'SendPunchCard')), punch: icdOf(skillOf(e, 'Punch')), body: icdOf(skillOf(e, 'SummonBody')),
      bodyRef: null, stacks: 0, stackLeft: DYC_STACK_INTERVAL,
    });
  });
  battle.on('hit', (c) => {
    const t = c && c.target, src = c && c.source, dmg = c && c.dmg;
    if (!t || t.defId !== BOSS_DYCYUE || !src || !dmg || (dmg.type !== 'phys' && dmg.type !== 'arts')) return;
    if (src === t || t.blockedBy === src) return;
    const s = bossStore(battle).shuoke.get(t);
    let prob = DYC_DODGE;
    if (t.blockedBy) prob -= DYC_BLOCKED_PENALTY;
    if (s && s.bodyRef && s.bodyRef.alive) prob += DYC_BODY_BONUS;
    if (prob > 0 && battle.rng.chance(Math.min(1, prob))) {
      dmg.cancel = true;
      battle.fx('dodge', { x: t.x, y: t.y, id: t.id });
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.shuoke.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.shuoke) {
      if (!e.alive) { st.shuoke.delete(e); continue; }
      // 在场每 10 s：攻击 +10% / 防御 +10%（可叠加）
      s.stackLeft -= dt;
      if (s.stackLeft <= 1e-9) {
        s.stackLeft = DYC_STACK_INTERVAL;
        s.stacks += 1;
        battle.removeBuff(e, 'recon:dyc_stack');
        battle.addBuff(e, { key: 'recon:dyc_stack', persist: true, visible: true, mods: { atkPct: DYC_STACK_STEP * s.stacks, defPct: DYC_STACK_STEP * s.stacks } });
      }
      // 醉生：在自身所在格召唤 1 枚剑傲
      s.send -= dt;
      if (s.send <= 1e-9) {
        s.send = DYC_SEND_CD;
        castSkill(battle, e, skillOf(e, 'SendPunchCard'));
        spawnSummon(battle, e, SUMMON_JIANAO, [e.tileR, e.tileC]);
      }
      // 描躯：场上无身形时召唤一节身形（落在干员附近）
      s.body -= dt;
      if (s.body <= 1e-9) {
        s.body = DYC_BODY_CD;
        if (!(s.bodyRef && s.bodyRef.alive)) {
          castSkill(battle, e, skillOf(e, 'SummonBody'));
          s.bodyRef = spawnSummon(battle, e, SUMMON_BODY, tileNearAlly(battle, [e.tileR, e.tileC], 2));
        }
      }
      if (!canAct(battle, e)) continue;
      // 溯律：随机 3 名我方，各在朔壳所在格召唤 1 枚敛傲，沿路径走向该干员所在格
      s.punch -= dt;
      if (s.punch <= 1e-9) {
        s.punch = DYC_PUNCH_CD;
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable);
        castSkill(battle, e, skillOf(e, 'Punch'));
        for (let i = 0; i < DYC_PUNCH_TARGETS && cands.length; i++) {
          const t = cands.splice(battle.rng.int(cands.length), 1)[0];
          if (!t) continue;
          spawnSummon(battle, e, SUMMON_LIANAO, [e.tileR, e.tileC], {
            route: { start: [Math.round(e.tileR), Math.round(e.tileC)], end: [Math.round(t.tileR), Math.round(t.tileC)], motion: 'F' },
          });
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_DYCYUE) return;
    summonTraining(battle, e, DYC_BATCH_NORMAL, DYC_BATCH_ELITE);
  });
}

// ===============================================================================================================
// 第 21 回合的两只（业主 2026-10-28）：伤心的大锁·重构 / “阿米娅”，炉芯终曲·重构

const SUMMON_LUCIEN = 'enemy_ws_recon_lucien';
const SUMMON_SKZAMB = 'enemy_ws_recon_skzamb';
const SUMMON_SKZJS = 'enemy_ws_recon_skzjs';
const SUMMON_SKZDW = 'enemy_ws_recon_skzdw';

Object.assign(RECON_SUMMON_DEFS, {
  [SUMMON_LUCIEN]: {
    name: '卢西恩，“猩红血钻”', rank: 'BOSS', applyWay: 'MELEE',
    spine: 'enemy_2016_csphtm', iconId: 'enemy_2016_csphtm',
    stats: { maxHp: 100000, atk: 1500, def: 600, res: 40, moveSpeed: 0.6, bat: 3, aspd: 100, rangeRadius: 0, blockCnt: 1, massLevel: 6, dmgType: 'phys', motion: 'WALK', lpr: 30 },
  },
  [SUMMON_SKZAMB]: {
    name: '仅剩的创意', rank: 'NORMAL', applyWay: 'NONE',
    spine: 'enemy_2094_skzamb', iconId: 'enemy_2094_skzamb',
    stats: { maxHp: 25000, atk: 300, def: 0, res: 0, moveSpeed: 0.2, bat: 1, aspd: 100, rangeRadius: 0, blockCnt: 1, massLevel: 0, dmgType: 'none', motion: 'WALK', lpr: 1 },
  },
  [SUMMON_SKZJS]: {
    name: '恐卡兹', rank: 'NORMAL', applyWay: 'MELEE',
    spine: 'enemy_2065_skzjs', iconId: 'enemy_2065_skzjs',
    stats: { maxHp: 50000, atk: 800, def: 350, res: 50, moveSpeed: 0.8, bat: 2.2, aspd: 100, rangeRadius: 0, blockCnt: 1, massLevel: 2, dmgType: 'phys', motion: 'WALK', lpr: 1 },
  },
  [SUMMON_SKZDW]: {
    name: '年代印痕', rank: 'NORMAL', applyWay: 'NONE',
    spine: 'enemy_2086_skzdwx', iconId: 'enemy_2086_skzdwx',
    stats: { maxHp: 75000, atk: 0, def: 0, res: 0, moveSpeed: 0, bat: 1, aspd: 100, rangeRadius: 0, blockCnt: 1, massLevel: 0, dmgType: 'none', motion: 'FLY', lpr: 1 },
  },
});

// ---- 伤心的大锁·重构 ----
const CSDOLL_MAX_TARGETS = 3;
const CSDOLL_HEAL_RATIO = 0.0025;
const CSDOLL_HEAL_CAP = 100000;
const CSDOLL_AOE_HITS = 25;
const CSDOLL_AOE_WARN = 10;
const CSDOLL_AOE_SCALE = 1.5;
const CSDOLL_SHIELD_FIRST = 80;
const CSDOLL_SHIELD_CD = 80;
const CSDOLL_SHIELD_DURATION = 30;
const CSDOLL_SHIELD_CAP = 1000000;
const CSDOLL_SHIELD_ELITES = 5;
const CSDOLL_CLASS1_TIMES = Object.freeze([20, 40, 60]);
const CSDOLL_CLASS1_NORMAL = 10;
const CSDOLL_CLASS2_TIMES = Object.freeze([80, 100, 120]);
const CSDOLL_CLASS2_ELITE = 3;
const CSDOLL_CLASS3_AT = 150;
const CSDOLL_CLASS3_INTERVAL = 20;
const CSDOLL_CLASS3_NORMAL = 5;
const CSDOLL_CLASS3_ELITE = 2;

function installCsdoll(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_CSDOLL) return;
    e.profile.maxTargets = CSDOLL_MAX_TARGETS;
    bossStore(battle).csdoll.set(e, {
      t0: battle.time, stack: 0, healAcc: 0,
      shieldAt: battle.time + CSDOLL_SHIELD_FIRST, shielding: false, shieldLeft: 0,
      c1: 0, c2: 0, class3At: Infinity, lucien: false,
    });
  });
  battle.on('damaged', (c) => {
    const t = c && c.target;
    if (!t || t.defId !== BOSS_CSDOLL) return;
    const s = bossStore(battle).csdoll.get(t);
    if (!s) return;
    s.stack += 1;
    if (s.stack === CSDOLL_AOE_WARN) battle.fx('telegraph', { x: t.x, y: t.y, r: 12, dur: 2, kind: 'csdollWarn', id: t.id });
    if (s.stack < CSDOLL_AOE_HITS) return;
    s.stack = 0;
    castSkill(battle, t, skillOf(t, 'Doom'));
    battle.fx('explode', { x: t.x, y: t.y, r: 12, kind: 'csdollAoe', id: t.id });
    for (const a of battle.allies()) {
      if (!a.alive || a.hidden) continue;
      battle.dealDamage(t, a, { amount: t.s.atk * CSDOLL_AOE_SCALE, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.csdoll.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.csdoll) {
      if (!e.alive) { st.csdoll.delete(e); continue; }
      // 自愈：每秒 min(0.25% 最大生命, 100000)（有共享血池时回**池**，否则写血条）
      s.healAcc += dt;
      while (s.healAcc >= 1 - 1e-9) {
        s.healAcc -= 1;
        healBoss(battle, e, Math.min(e.s.maxHp * CSDOLL_HEAL_RATIO, CSDOLL_HEAL_CAP));
      }
      const t = battle.time - s.t0;
      // 召唤序列（绝对时间）
      if (s.c1 < CSDOLL_CLASS1_TIMES.length && t >= CSDOLL_CLASS1_TIMES[s.c1]) {
        s.c1 += 1;
        summonTraining(battle, e, CSDOLL_CLASS1_NORMAL, 0);
      }
      if (s.c2 < CSDOLL_CLASS2_TIMES.length && t >= CSDOLL_CLASS2_TIMES[s.c2]) {
        s.c2 += 1;
        summonTraining(battle, e, 0, CSDOLL_CLASS2_ELITE);
      }
      if (!s.lucien && t >= CSDOLL_CLASS3_AT) {
        s.lucien = true;
        s.class3At = t + CSDOLL_CLASS3_INTERVAL;
        spawnSummon(battle, e, SUMMON_LUCIEN, tileNearAlly(battle, [e.tileR, e.tileC], 3));
      } else if (s.lucien && t >= s.class3At) {
        s.class3At = t + CSDOLL_CLASS3_INTERVAL;
        summonTraining(battle, e, CSDOLL_CLASS3_NORMAL, CSDOLL_CLASS3_ELITE);
      }
      // 屏障
      if (s.shielding) {
        s.shieldLeft -= dt;
        if (s.shieldLeft <= 1e-9 || !e.findBuff('recon:csdoll_shield')) {
          s.shielding = false;
          battle.removeBuff(e, 'recon:csdoll_shield');
          e.profile.noAttack = false;
          s.shieldAt = battle.time + CSDOLL_SHIELD_CD;
          battle.removeBuff(e, 'recon:csdoll_shield_buff');
        }
        continue;
      }
      if (!canAct(battle, e) || battle.time < s.shieldAt - 1e-9) continue;
      s.shielding = true;
      s.shieldLeft = CSDOLL_SHIELD_DURATION;
      e.profile.noAttack = true;
      castSkill(battle, e, skillOf(e, 'shield'));
      const barrier = Math.min(e.s.maxHp * talentOf(e, 'shield_ratio', 0.05), CSDOLL_SHIELD_CAP);
      battle.addBuff(e, { key: 'recon:csdoll_shield', duration: CSDOLL_SHIELD_DURATION, visible: true, shield: barrier });
      battle.addBuff(e, {
        key: 'recon:csdoll_shield_buff', duration: CSDOLL_SHIELD_DURATION, visible: true,
        mods: { moveFlat: talentOf(e, 'movespeedup.move_speed', 2) },
      });
      battle.fx('telegraph', { x: e.x, y: e.y, r: 3, dur: 1, kind: 'csdollShield', id: e.id });
      summonTraining(battle, e, 0, CSDOLL_SHIELD_ELITES);
    }
  });
}

// ---- “阿米娅”，炉芯终曲·重构 ----
const SKZAMY_TAKEN = 0.34;
const SKZAMY_HALF_INVULN = 10;
const SKZAMY_SPLASH = 2;
const SKZAMY_BALL_INTERVAL = 30;
const SKZAMY_BALL_SPEED = 0.2;
const SKZAMY_AURA_RADIUS = 2.8;
const SKZAMY_AURA_DEALT = 0.75;
const SKZAMY_BATCH_INTERVAL = 20;
const SKZAMY_BATCH_NORMAL = 10;
const SKZAMY_BATCH_ELITE = 3;
const SKZAMY_FORM2_TARGETS = 4;
const SKZAMY_FORM2_SCALE = 2;
const SKZAMY_REBORN = 2.5;
const SKZAMY_MARK_ELEMENT = 100;

/** 黑冠余威：对 `r,c` 周围最多 4 名我方各造成 ATK×2 真实伤害。 */
function skzamyCrown(battle, e, r, c) {
  const picked = alliesInBox(battle, r, c, 1).filter((u) => u.alive).slice(0, SKZAMY_FORM2_TARGETS);
  if (!picked.length) return;
  castSkill(battle, e, skillOf(e, 'AOEAttack'));
  battle.fx('explode', { x: e.x, y: e.y, r: 2, kind: 'skzamyCrown', id: e.id });
  for (const u of picked) {
    battle.dealDamage(e, u, { amount: e.s.atk * SKZAMY_FORM2_SCALE, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'crown'] });
  }
}

function skzamyEnterForm2(battle, e, s) {
  s.form = 2;
  s.reborn = false;
  battle.removeBuff(e, 'recon:skzamy_reborn');
  e.profile.noAttack = false;
  e.hp = e.s.maxHp;
  e.atkCd = 0;
  e.markDirty();
  castSkill(battle, e, skillOf(e, 'AOEAttackInit'));
  battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
  skzamyCrown(battle, e, e.tileR, e.tileC);
}

function installSkzamy(battle) {
  battle.on('enemySpawn', (c) => {
    const b = c && c.enemy;
    if (b && b.defId === SUMMON_SKZAMB) {
      b.profile.noAttack = true;
      return;
    }
    if (b && b.defId === SUMMON_SKZDW) {
      b._reconMarkTick = 0;
      return;
    }
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SKZAMY) return;
    battle.addBuff(e, { key: 'recon:skzamy_dr', persist: true, visible: true, mods: { physTakenMul: SKZAMY_TAKEN, artsTakenMul: SKZAMY_TAKEN } });
    bossStore(battle).skzamy.set(e, {
      ball: SKZAMY_BALL_INTERVAL, batch: SKZAMY_BATCH_INTERVAL, half: false, form: 1, reborn: false, rebornLeft: 0,
    });
    { const pool = bossPoolOf(battle); if (pool && typeof pool.setLives === 'function') pool.setLives(2); }
  });
  // 普攻对目标 3×3 追加 ATK×2 法术
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_SKZAMY || c.isSkill) return;
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      battle.fx('explode', { x: t.x, y: t.y, r: 1.5, kind: 'skzamyAoe', id: a.id });
      for (const u of alliesInBox(battle, t.tileR, t.tileC, 1)) {
        battle.dealDamage(a, u, { amount: a.s.atk * SKZAMY_SPLASH, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'splash'] });
      }
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    // 年代印痕：每秒对范围内我方 100 凋亡损伤
    for (const m of liveEnemies(battle, SUMMON_SKZDW)) {
      m._reconMarkTick = (m._reconMarkTick ?? 0) + dt;
      if (m._reconMarkTick < 1) continue;
      m._reconMarkTick -= 1;
      for (const a of alliesInBox(battle, m.tileR, m.tileC, 1)) {
        if (!a.alive) continue;
        battle.dealDamage(m, a, { type: 'element', element: 'apoptosis', amount: SKZAMY_MARK_ELEMENT, canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'skzMark'] });
      }
    }
    // 仅剩的创意：朝阿米娅移动 + 2.8 格内我方伤害 -25%
    const boss = liveEnemies(battle, BOSS_SKZAMY)[0] || null;
    for (const ball of liveEnemies(battle, SUMMON_SKZAMB)) {
      if (boss) {
        const dx = boss.x - ball.x, dy = boss.y - ball.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 1) {
          const step = Math.min(dist, SKZAMY_BALL_SPEED * dt);
          ball.x += (dx / Math.max(1e-9, dist)) * step;
          ball.y += (dy / Math.max(1e-9, dist)) * step;
        }
        // 第二形态：碰触创意 ⇒ 对创意周围最多 4 名我方 200% 攻击真伤
        const s0 = st.skzamy.get(boss);
        if (s0 && s0.form >= 2) {
          if (dist <= 1 && !ball._reconTouch) {
            ball._reconTouch = true;
            skzamyCrown(battle, boss, ball.tileR, ball.tileC);
          } else if (dist > 1.5) ball._reconTouch = false;
        }
      }
      for (const a of battle.allies()) {
        if (!a.alive || a.hidden) continue;
        if (Math.hypot(a.x - ball.x, a.y - ball.y) > SKZAMY_AURA_RADIUS) continue;
        battle.addBuff(a, {
          key: 'recon:skzamy_aura', duration: 1.2, refresh: 'extend', visible: true, source: boss,
          mods: { dmgDealtMul: SKZAMY_AURA_DEALT },
        });
      }
    }
    if (!st.skzamy.size) return;
    for (const [e, s] of st.skzamy) {
      if (!e.alive) { st.skzamy.delete(e); continue; }
      // 挂共享血池时：池两条命（第一次击倒 → 第二形态；第二次 = 最终死亡）
      syncPoolPhase(battle, e, s, { lives: 2, onPhase: () => skzamyReborn(battle, e, s) });
      if (s.reborn) {
        s.rebornLeft -= dt;
        if (s.rebornLeft <= 1e-9) skzamyEnterForm2(battle, e, s);
        continue;
      }
      // 生命首次 <50%：无敌 10s
      if (!s.half && e.hpRatio < 0.5) {
        s.half = true;
        battle.addBuff(e, { key: 'recon:skzamy_half_inv', duration: SKZAMY_HALF_INVULN, visible: true, flags: { invulnerable: true } });
        battle.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'skzamyHalf' });
      }
      if (!canAct(battle, e)) continue;
      // 每 30 秒一个“仅剩的创意”
      s.ball -= dt;
      if (s.ball <= 1e-9) {
        s.ball = SKZAMY_BALL_INTERVAL;
        castSkill(battle, e, skillOf(e, 'SummonBallS4'));
        spawnSummon(battle, e, SUMMON_SKZAMB, tileNearAlly(battle, [e.tileR, e.tileC], 3));
      }
      // 尽头重现：每 20 秒 10 普通 + 3 精英
      s.batch -= dt;
      if (s.batch <= 1e-9) {
        s.batch = SKZAMY_BATCH_INTERVAL;
        summonTraining(battle, e, SKZAMY_BATCH_NORMAL, SKZAMY_BATCH_ELITE);
      }
    }
  });
  // 创意被击倒 ⇒ 原地召恐卡兹 + 年代印痕
  battle.on('kill', (c) => {
    const u = c && c.victim;
    if (u && u.defId === SUMMON_SKZAMB) {
      const boss = liveEnemies(battle, BOSS_SKZAMY)[0] || null;
      spawnSummon(battle, boss || u, SUMMON_SKZJS, [u.tileR, u.tileC]);
      spawnSummon(battle, boss || u, SUMMON_SKZDW, [u.tileR, u.tileC]);
      return;
    }
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SKZAMY) return;
    const s = bossStore(battle).skzamy.get(e);
    if (!s) return;
    if (s.form === 1 && !s.reborn) {
      // 挂池时 `kill` 只代表最终死亡（第一次击倒是池的阶段事件）
      if (e.bossPool) return;
      skzamyReborn(battle, e, s);
      return;
    }
    if (s.form === 2) {
      // 永恒存续：本引擎没有「结束整场作战」的通道 ⇒ 只做一次全场真实伤害 + 退场
      castSkill(battle, e, skillOf(e, 'Doom'));
      battle.fx('explode', { x: e.x, y: e.y, r: 20, kind: 'skzamyEternal', id: e.id });
      for (const a of battle.allies()) {
        if (a.alive) battle.dealDamage(e, a, { amount: e.s.atk * SKZAMY_FORM2_SCALE, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'eternal'] });
      }
    }
  });
}

/** 阿米娅第一次被击倒：2.5 s 后进入第二形态（黑冠余威）。 */
function skzamyReborn(battle, e, s) {
    if (!s || s.form !== 1 || s.reborn) return;
    s.reborn = true;
    s.rebornLeft = SKZAMY_REBORN;
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'recon:skzamy_reborn', duration: SKZAMY_REBORN, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: SKZAMY_REBORN, kind: 'reborn', id: e.id, form: 'reborn' });
}

// ---- AMa-10 / AMa-10异构体 / “终始”·重构（业主 2026-10-28）----
// 只能做到「单块战场内」的部分：分区域上场由 match 侧按 boss 组切波次；跨战场共享血量 / 伤害转移 /
// 终始倒下让另外两只退场 / 击杀奖励给别的区域玩家，引擎没有跨战场通道，这里用就地近似（见下方注释）。

const AMA_FIREWALL_TAKEN = 0.2;
const AMA_STACK_ATK = 100;
const AMA_STACK_CAP = 4;
const AMA_TORRENT_VALUE = 1000;
const AMA_TORRENT_STUN = 6;
const AMA_TORRENT_H_CD = 30;
const AMA_TORRENT_H_INIT = 30;
const AMA_TORRENT_V_CD = 30;
const AMA_TORRENT_V_INIT = 15;
const AMA_BLINK_CD = 40;
const AMA_BLINK_INIT = 20;
const AMA_FAKE_LOCK = 0.04;
const AMA_FAKE_REGEN = 0.01;
const AMA_FAKE_END = 0.5;
const AMA_FAKE_TAKEN = 0.2;

const MUSNAKE_FIREWALL_TAKEN = 0.2;
const MUSNAKE_THRESHOLDS = Object.freeze([0.6, 0.2]);
const MUSNAKE_TORRENT_CD = 20;
const MUSNAKE_TORRENT_INIT = 10;
const MUSNAKE_TORRENT_TARGETS = 3;
const MUSNAKE_TORRENT_VALUE = 1000;
const MUSNAKE_TORRENT_STUN = 10;
const MUSNAKE_SUMMON_INTERVAL = 5;
const MUSNAKE_SUMMON_NORMAL = 5;
const MUSNAKE_SUMMON_ELITE = 2;

/** 信息洪流：同行/同列 3 格内最近的一名我方吃 `value` 真伤 + 眩晕。 */
function amaLineHit(battle, e, sk, horizontal, value, stun) {
  const er = Math.round(e.tileR), ec = Math.round(e.tileC);
  const cands = battle.allies().filter((a) => a.alive && !a.hidden
    && (horizontal ? Math.round(a.tileR) === er : Math.round(a.tileC) === ec)
    && (horizontal ? Math.abs(Math.round(a.tileC) - ec) : Math.abs(Math.round(a.tileR) - er)) <= 3)
    .sort((x, y) => (horizontal ? Math.abs(Math.round(x.tileC) - ec) - Math.abs(Math.round(y.tileC) - ec)
      : Math.abs(Math.round(x.tileR) - er) - Math.abs(Math.round(y.tileR) - er)));
  const t = cands[0];
  if (!t) return;
  // 官方信息洪流的特效是「起手 → 循环 → 收尾」的一段（记录里没有 duration）⇒ 给 1 s 窗口，别只闪 0.3 s。
  castSkill(battle, e, sk ? { ...sk, bb: { ...(sk.bb || {}), duration: 1 } } : sk);
  battle._ev(['atk', e.id, t.id, 'true']);
  battle.dealDamage(e, t, { amount: value, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'amaLine'] });
  if (t.alive && stun > 0) battle.applyStatus(t, 'stun', { duration: stun, source: e });
}

/** match 层的跨战斗通道（只在 server-run 的 boss 战场出现；没有就回落到单战场近似）。 */
function reconChannelOf(battle) {
  const ch = battle && battle.opts ? battle.opts.reconChannel : null;
  return ch && typeof ch.pool === 'function' && typeof ch.drain === 'function' ? ch : null;
}

/** 击杀终始召唤物后的奖励：区域2/3 玩家的干员 伤害 +50% / 攻速 +20 / 受伤 -20%。 */
function amaReward(battle, ch) {
  for (const a of battle.allies()) {
    if (!a || !a.alive || !ch || ch.areaOf(a.ownerId) < 1) continue;
    battle.addBuff(a, {
      key: 'recon:ama_reward', persist: true, visible: true,
      mods: { atkPct: 0.5, aspd: 20, dmgTakenMul: 0.8 },
    });
  }
}

/** AMa-10 / 异构体：防火墙（官方 `enemy_muama_range_01_*` 四向墙，客户端按 passive 能力自动跟随）、同目标叠攻、信息洪流、刷新、假死。 */
function installAmaRecon(battle, defId, storeKey) {
  const ch = reconChannelOf(battle);
  const area = ch ? ch.areaOf(((battle.players || [])[0] || {}).playerId) : 0;
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== defId) return;
    battle.addBuff(e, { key: 'recon:ama_still', persist: true, visible: false, flags: { noMove: true } });
    battle.addBuff(e, { key: 'recon:ama_wall', persist: true, visible: true, mods: { physTakenMul: AMA_FIREWALL_TAKEN, artsTakenMul: AMA_FIREWALL_TAKEN } });
    bossStore(battle)[storeKey].set(e, {
      h: AMA_TORRENT_H_INIT, v: AMA_TORRENT_V_INIT, blink: AMA_BLINK_INIT,
      last: null, stack: 0, fake: false,
    });
  });
  // 跨战场共享血量：这块战场的 AMa-10 / 异构体把伤害记到同一条 `ama` 池；假死时 80% 转到 `core`（终始）
  if (ch) {
    battle.on('damaged', (c) => {
      const t = c && c.target;
      if (!t || t.defId !== defId || !(c.amount > 0)) return;
      const s = bossStore(battle)[storeKey].get(t);
      // 有共享池时，引擎那一次扣血已经落在通道池上（`ChannelBossPool` 适配器）⇒ 这里不再重复扣；
      // 只有「没有池」的单战场近似才自己记这条通道账。
      if (!bossPoolOf(battle)) ch.damage('ama', c.amount);
      if (s && s.fake) ch.damage('core', c.amount * 4);
      const p = ch.pool('ama');
      if (p && p.hp > 0) { t.hp = Math.min(t.s.maxHp, p.hp); t.markDirty(); }
    });
    battle.on('kill', (c) => {
      const e = c && c.victim;
      if (!e || e.defId !== defId) return;
      const s = bossStore(battle)[storeKey].get(e);
      if (s && s.retreat) return;
      const p = ch.pool('ama');
      if (p && p.hp > 0) { e.hp = Math.max(1, p.hp); e.markDirty(); }
    });
  }
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== defId || c.isSkill) return;
    const st = bossStore(battle)[storeKey].get(a);
    const t = c.targets && c.targets[0];
    if (!st || !t) return;
    if (st.last === t) {
      if (st.stack < AMA_STACK_CAP) {
        st.stack += 1;
        battle.addBuff(a, { key: 'recon:ama_focus', persist: true, visible: true, mods: { atkFlat: st.stack * AMA_STACK_ATK } });
      }
    } else {
      st.last = t;
      st.stack = 0;
      battle.removeBuff(a, 'recon:ama_focus');
    }
  });
  // 假死期间：受到的伤害 -80%（本地吃 20%；跨战场的 80% 由下面的 damaged 钩子记进终始池）
  battle.on('hit', (c) => {
    const t = c && c.target, dmg = c && c.dmg;
    if (!t || t.defId !== defId || !dmg) return;
    const s = bossStore(battle)[storeKey].get(t);
    if (!s || !s.fake) return;
    dmg.mul = (dmg.mul ?? 1) * AMA_FAKE_TAKEN;
  });
  // 致命伤害先进假死：`hpDamage` 在减伤/护盾之后、扣血之前（只允许把伤害**改小**）。把这一击压到「池 / 血条
  // 刚好停在 4%」，tick 再接管假死。从前低血检测只在 tick 里跑，一击从阈值上方越到 0 ⇒ 直接死亡，
  // 跨战场路径还会先广播 `<key>Down`（§5.11）。
  battle.on('hpDamage', (c) => {
    const t = c && c.target;
    if (!t || t.defId !== defId || !c.amount) return;
    const s = bossStore(battle)[storeKey].get(t);
    if (!s || s.fake || s.retreat) return;
    const p = ch ? ch.pool('ama') : null;
    const remaining = p ? p.hp : t.hp;
    const allowed = Math.max(0, remaining - t.s.maxHp * AMA_FAKE_LOCK);
    if (c.amount > allowed) c.amount = allowed;
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st[storeKey].size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st[storeKey]) {
      if (!e.alive) { st[storeKey].delete(e); continue; }
      if (ch) {
        const p = ch.pool('ama');
        if (p && p.hp <= 0) { s.retreat = true; battle.kill(e, null); continue; }
        for (const ev of ch.drain(area)) {
          if (ev.kind === 'amaDown' || ev.kind === 'coreDown') { s.retreat = true; battle.kill(e, null); break; }
          if (ev.kind === 'endFake' && s.fake) { s.fake = false; battle.removeBuff(e, 'recon:ama_fake'); }
          if (ev.kind === 'coreReward') amaReward(battle, ch);
        }
        if (s.retreat) continue;
        if (p && p.hp > 0) { e.hp = Math.min(e.s.maxHp, p.hp); e.markDirty(); }
        // 池是唯一真相：假死锁 4%、每秒回 1%、50% 结束；回复**全局只算一次**（两块 AMa 战场同时假死时不翻倍）
        if (s.fake) {
          ch.healOnce('ama', p.maxHp * AMA_FAKE_REGEN * dt, battle.time);
          e.hp = Math.min(e.s.maxHp, ch.pool('ama').hp);
          e.markDirty();
          if (e.hpRatio >= AMA_FAKE_END) {
            s.fake = false;
            battle.removeBuff(e, 'recon:ama_fake');
            battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: null });
          }
          continue;
        }
        if (p.hp <= p.maxHp * AMA_FAKE_LOCK + 1e-9) {
          s.fake = true;
          ch.setHp('ama', p.maxHp * AMA_FAKE_LOCK);
          e.hp = Math.min(e.s.maxHp, ch.pool('ama').hp);
          e.markDirty();
          battle.addBuff(e, { key: 'recon:ama_fake', persist: true, visible: true });
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'fake' });
          continue;
        }
      }
      // 假死（无通道的单战场近似）：锁 4%、每秒回 1%，到 50% 结束
      if (!ch && s.fake) {
        e.hp = Math.max(e.hp, e.s.maxHp * AMA_FAKE_LOCK);
        e.hp = Math.min(e.s.maxHp, e.hp + e.s.maxHp * AMA_FAKE_REGEN * dt);
        e.markDirty();
        if (e.hpRatio >= AMA_FAKE_END) {
          s.fake = false;
          battle.removeBuff(e, 'recon:ama_fake');
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: null });
        }
        continue;
      }
      if (e.hpRatio <= AMA_FAKE_LOCK + 1e-9) {
        s.fake = true;
        e.hp = e.s.maxHp * AMA_FAKE_LOCK;
        e.markDirty();
        battle.addBuff(e, { key: 'recon:ama_fake', persist: true, visible: true });
        battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'fake' });
        continue;
      }
      if (!canAct(battle, e)) continue;
      s.h -= dt;
      if (s.h <= 1e-9) {
        s.h = AMA_TORRENT_H_CD;
        amaLineHit(battle, e, skillOf(e, 'HorizontalLineAttack'), true, AMA_TORRENT_VALUE, AMA_TORRENT_STUN);
      }
      s.v -= dt;
      if (s.v <= 1e-9) {
        s.v = AMA_TORRENT_V_CD;
        amaLineHit(battle, e, skillOf(e, 'VerticalLine'), false, AMA_TORRENT_VALUE, AMA_TORRENT_STUN);
      }
      s.blink -= dt;
      if (s.blink <= 1e-9) {
        s.blink = AMA_BLINK_CD;
        const cands = battle.allies().filter((a) => a.alive && !a.hidden);
        const t = cands.length ? battle.rng.pick(cands) : null;
        if (t) {
          const blink = skillOf(e, 'Blink');
          castSkill(battle, e, blink ? { ...blink, bb: { ...(blink.bb || {}), duration: 0.8 } } : blink);
          e.tileR = Math.round(t.tileR);
          e.tileC = Math.round(t.tileC);
          e.y = t.y;
          e.x = t.x;
          e.markDirty();
          battle.addBuff(e, { key: 'recon:ama_wall', persist: true, visible: true, mods: { physTakenMul: AMA_FIREWALL_TAKEN, artsTakenMul: AMA_FIREWALL_TAKEN } });
          battle.fx('summon', { x: e.x, y: e.y, id: e.id, key: defId, n: 1 });
        }
      }
    }
  });
}

/** 终始：防火墙、60%/20% 挡位、3 目标 1000 真伤、5 秒一批召唤。 */
function installMusnakeRecon(battle) {
  const ch = reconChannelOf(battle);
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MUSNAKE) return;
    battle.addBuff(e, { key: 'recon:musnake_wall', persist: true, visible: true, mods: { physTakenMul: MUSNAKE_FIREWALL_TAKEN, artsTakenMul: MUSNAKE_FIREWALL_TAKEN } });
    bossStore(battle).musnake.set(e, { line: MUSNAKE_TORRENT_INIT, summon: MUSNAKE_SUMMON_INTERVAL, steps: [] });
  });
  if (ch) {
    // 终始的生命 = `core` 池（跨战场唯一真相）；它自己的伤害记到池里
    battle.on('damaged', (c) => {
      const t = c && c.target;
      if (!t || t.defId !== BOSS_MUSNAKE || !(c.amount > 0)) return;
      // 有共享池时引擎已经把这一击记到 `core`（`ChannelBossPool` 适配器）⇒ 不再重复扣
      if (!bossPoolOf(battle)) ch.damage('core', c.amount);
      const p = ch.pool('core');
      if (p && p.hp > 0) { t.hp = Math.min(t.s.maxHp, p.hp); t.markDirty(); }
    });
    battle.on('kill', (c) => {
      const e = c && c.victim;
      if (!e || e.defId !== BOSS_MUSNAKE) return;
      const p = ch.pool('core');
      if (p && p.hp > 0) { e.hp = Math.max(1, p.hp); e.markDirty(); }
    });
    // 击杀终始的召唤物 ⇒ 广播奖励（区域2/3 的战场在自己的 tick 里领）
    battle.on('kill', (c) => {
      const v = c && c.victim;
      if (v && v._reconCoreSummon) ch.emit('coreReward');
    });
  }
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.musnake.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.musnake) {
      if (!e.alive) { st.musnake.delete(e); continue; }
      if (ch) {
        const p = ch.pool('core');
        if (p && p.hp <= 0) { battle.kill(e, null); continue; }
        if (p && p.hp > 0) { e.hp = Math.min(e.s.maxHp, p.hp); e.markDirty(); }
      }
      // 60% / 20% 挡位：结束 AMa-10 / 异构体的假死并让它们回 10% 生命（共享池 `ama` 是唯一真相）
      // 没有通道时只能管同一战场里的那两只（正常情况下它们不在同一块战场）。
      while (s.steps.length < MUSNAKE_THRESHOLDS.length && e.hpRatio <= MUSNAKE_THRESHOLDS[s.steps.length]) {
        s.steps.push(MUSNAKE_THRESHOLDS[s.steps.length]);
        // 【受伤】：官方技能（`Injured`，动作 Injured_Begin→Loop→End）。cast 窗口 + 2 s 受伤姿态后回到基础 clip。
        castSkill(battle, e, skillOf(e, 'Injured'));
        battle.fx('telegraph', { x: e.x, y: e.y, r: 0.8, dur: 2, kind: 'injured', id: e.id, form: 'injured' });
        battle.after(2.2, () => { if (e.alive) battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: null }); }, { owner: e });
        battle.fx('explode', { x: e.x, y: e.y, r: 6, kind: 'musnakeStep', id: e.id });
        if (ch) {
          const ama = ch.pool('ama');
          if (ama) ch.heal('ama', ama.maxHp * 0.1);
          ch.emit('endFake');
        }
        for (const [other, os] of bossStore(battle).muama) if (other !== e && os.fake) {
          os.fake = false;
          other.hp = Math.min(other.s.maxHp, other.hp + other.s.maxHp * 0.1);
          other.markDirty();
          battle.removeBuff(other, 'recon:ama_fake');
        }
        for (const [other, os] of bossStore(battle).mutwin) if (other !== e && os.fake) {
          os.fake = false;
          other.hp = Math.min(other.s.maxHp, other.hp + other.s.maxHp * 0.1);
          other.markDirty();
          battle.removeBuff(other, 'recon:ama_fake');
        }
      }
      // 每 5 秒一批（5 普通 + 2 精英）
      s.summon -= dt;
      if (s.summon <= 1e-9) {
        s.summon = MUSNAKE_SUMMON_INTERVAL;
        summonTraining(battle, e, MUSNAKE_SUMMON_NORMAL, MUSNAKE_SUMMON_ELITE, (u) => { u._reconCoreSummon = true; });
      }
      if (!canAct(battle, e)) continue;
      s.line -= dt;
      if (s.line <= 1e-9) {
        s.line = MUSNAKE_TORRENT_CD;
        const sk = skillOf(e, 'GlobalLineAttack');
        const cands = battle.allies().filter((a) => a.alive && !a.hidden);
        if (!cands.length) continue;
        castSkill(battle, e, sk ? { ...sk, bb: { ...(sk.bb || {}), duration: 1 } } : sk);
        const picked = [];
        while (picked.length < MUSNAKE_TORRENT_TARGETS && cands.length) picked.push(...cands.splice(battle.rng.int(cands.length), 1));
        battle._ev(['atk', e.id, picked[0].id, 'true']);
        for (const t of picked) {
          battle.dealDamage(e, t, { amount: MUSNAKE_TORRENT_VALUE, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'musnakeLine'] });
          if (t.alive) battle.applyStatus(t, 'stun', { duration: MUSNAKE_TORRENT_STUN, source: e });
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 岁四部位·重构（业主 2026-10-29）：岁 / 左爪 / 右爪 / 尾 各守一块 boss 场地（引擎 `reconBossWaveFor` 按区域切 key），
// 四条都是 `tag: 'boss'` ⇒ 共用同一条 `sharedBoss` 池（共享生命 / 同一条胜利条件都是引擎给的）。
//
// 业主给的重构增量（没提的按官方来）：
//   * 抬起：5 s、期间**80% 减伤**（不再无敌 / 不动 / 不可选中）；四部位的技能首次释放与冷却统一 **30 s**；
//   * 【十方怼怒】：向**所有干员的位置**爆开火焰，持续 **10 s**（每 0.5 s 一跳）；
//   * 【掩月】/【蔽日】：优先选**生命值最高**的我方目标，命中其 **3×3**；
//   * 【天倾地陷】：攻击次数 **+1（3→4）**、范围 **5×5**；
//   * 【柱折维绝】：岁生命**首次 < 50%** ⇒ 召唤 **20 普通 + 10 精英**（本场随机特训敌人类型），并让四个部位**同时**放技能
//     （另三块场地靠 `ReconChannel` 收 `suiBreak`；clientCombat 没有通道 ⇒ 只有岁自己立刻放）。
// 官方的「镇岁柱 / 未熄 / 柱折维绝召唤追加敌人」不实现（没有那些记录 / 装置通道）。

const SUI_ALL = new Set([BOSS_SUISHO, BOSS_SUIZZH, BOSS_SUIYZH, BOSS_SUIWEI]);
/** 站定不动的首领（业主 2026-10-29 / 2026-10-30）：源阶方 / 洛伦茨 / 岁四部位 / 伤心的大锁 —— **记录里写了
 *  `stillBoss: true`**，地图 boss 路线的起点就是它们的站位中心。引擎侧 `server/match/waves.js bossStandsStill`
 *  读同一个字段，决定双人场地里这一只出 1 只（两位玩家同时打）还是 2 只（每位玩家一只）。 */
function installStillBosses(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    const raw = e && e.def && e.def.raw;
    if (!raw || raw.stillBoss !== true) return;
    if (e.findBuff('recon:boss_still')) return;
    battle.addBuff(e, { key: 'recon:boss_still', persist: true, visible: false, flags: { noMove: true } });
  });
}

const SUI_IS_SOUTH = (e) => e.defId === BOSS_SUIWEI;

/** 抬起 5 s（80% 减伤）→ 5 s 后落技能。 */
function suiReleaseNow(battle, e) {
  const readyKey = e.defId === BOSS_SUISHO ? 'FireBreathReady' : SUI_IS_SOUTH(e) ? 'TailReady' : 'ClawsReady';
  castSkill(battle, e, skillOf(e, readyKey));
  battle.addBuff(e, { key: 'recon:sui_lift', duration: SUI_LIFT, visible: true, mods: { dmgTakenMul: SUI_LIFT_TAKEN } });
  battle.after(SUI_LIFT, () => { if (e.alive) suiStrike(battle, e); }, { owner: e });
}

/** 抬起结束：按部位落对应技能。 */
function suiStrike(battle, e) {
  if (e.defId === BOSS_SUISHO) { suiFireBreath(battle, e); return; }
  if (SUI_IS_SOUTH(e)) { suiTail(battle, e); return; }
  suiClaws(battle, e);
}

/**
 * 【十方怼怒】：10 s 内每 0.5 s 在**所有存活干员的位置**爆一次火。
 * 首跳是喷吐本体（`main_attack_atk_scale 1.8` 法术 + `main_attack_ele_atk_scale 0.45` 灼燃），
 * 之后是火焰（`dot_attack_atk_scale 0.2` 法术 + `dot_attack_ele_atk_scale 0.1` 灼燃），都是目标所在 3×3。
 */
function suiFireBreath(battle, e) {
  castSkill(battle, e, skillOf(e, 'FireBreath'));
  const atk = e.s.atk;
  let n = 0;
  const tick = () => {
    if (!e.alive || n * SUI_FIRE_TICK > SUI_FIRE_DURATION + 1e-9) return;
    const first = n === 0;
    for (const a of battle.allies()) {
      if (!a || !a.alive || a.hidden) continue;
      for (const u of alliesInBox(battle, a.tileR, a.tileC, SUI_CLAW_AOE)) {
        battle.dealDamage(e, u, { amount: atk * (first ? 1.8 : 0.2), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'suiFire'] });
        battle.dealDamage(e, u, { amount: atk * (first ? 0.45 : 0.1), type: 'element', element: 'burn', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'suiFire'] });
      }
      // 每 1 s 一处画面（10 s × 每名干员一处；避免 0.5 s 一跳刷两百条 fx）
      if (n % 2 === 0) battle.fx('explode', { x: a.x, y: a.y, r: 1.5, kind: 'suiFire', id: e.id });
    }
    n += 1;
    battle.after(SUI_FIRE_TICK, tick, { owner: e });
  };
  tick();
}

/** 【掩月】/【蔽日】：生命值最高的我方，命中其 3×3（`ComeTheClaws.atk_scale 2.2` 物理）。 */
function suiClaws(battle, e) {
  const cands = battle.allies().filter((a) => a && a.alive && !a.hidden && !(a.s && a.s.flags && a.s.flags.untargetable));
  if (!cands.length) return;
  const t = cands.slice().sort((a, b) => (b.hp - a.hp) || (b.s.maxHp - a.s.maxHp))[0];
  const sk = skillOf(e, 'ComeTheClaws');
  castSkill(battle, e, sk);
  const scale = skNum(sk, 'atk_scale', 2.2);
  battle._ev(['atk', e.id, t.id, 'phys']);
  battle.fx('explode', { x: t.x, y: t.y, r: 1.5, kind: 'suiClaws', id: e.id });
  for (const u of alliesInBox(battle, t.tileR, t.tileC, SUI_CLAW_AOE)) {
    battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'phys', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'suiClaws'] });
  }
}

/** 【天倾地陷】：最南的我方，连戳 4 次、每次 5×5（`Stab.atk_scale 1.1`）。 */
function suiTail(battle, e) {
  const cands = battle.allies().filter((a) => a && a.alive && !a.hidden && !(a.s && a.s.flags && a.s.flags.untargetable));
  if (!cands.length) return;
  const t = cands.slice().sort((a, b) => a.tileR - b.tileR)[0];
  const sk = skillOf(e, 'Stab');
  castSkill(battle, e, sk);
  const scale = skNum(sk, 'atk_scale', 1.1);
  for (let i = 0; i < SUI_TAIL_HITS; i++) {
    if (!t.alive) break;
    battle._ev(['atk', e.id, t.id, 'phys']);
    battle.fx('explode', { x: t.x, y: t.y, r: SUI_TAIL_AOE + 0.5, kind: 'suiTail', id: e.id });
    for (const u of alliesInBox(battle, t.tileR, t.tileC, SUI_TAIL_AOE)) {
      battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'phys', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'suiTail'] });
    }
  }
}

function installSuiRecon(battle) {
  const ch = reconChannelOf(battle);
  const area = ch ? ch.areaOf(((battle.players || [])[0] || {}).playerId) : 0;
  const state = () => bossStore(battle).sui;
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || !SUI_ALL.has(e.defId)) return;
    state().set(e, { next: SUI_SP_INIT, breakDone: false, force: false });
  });
  battle.on('tick', (c) => {
    const st = state();
    if (!st.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    // 别的场地触发了柱折维绝：这一块的部位也立刻放技能
    if (ch) {
      for (const ev of ch.drain(area)) {
        if (!ev || ev.kind !== 'suiBreak') continue;
        for (const e of st.keys()) {
          const s = st.get(e);
          if (s && e.alive) s.force = true;
        }
      }
    }
    for (const [e, s] of st) {
      if (!e.alive) { st.delete(e); continue; }
      // 【柱折维绝】（只有岁本体触发一次）：共享池 / 血条任一 < 50%
      if (e.defId === BOSS_SUISHO && !s.breakDone) {
        const p = bossPoolOf(battle);
        const ratio = p && p.maxHp > 0 ? p.hp / p.maxHp : e.hpRatio;
        if (ratio < SUI_BREAK_RATIO) {
          s.breakDone = true;
          summonTraining(battle, e, SUI_BREAK_NORMAL, SUI_BREAK_ELITE);
          s.force = true;
          if (ch) {
            for (const other of new Set(ch.areas.values())) if (other !== area) ch.emit('suiBreak', null, other);
          }
        }
      }
      const forced = s.force;
      s.force = false;
      if (forced) {
        s.next = SUI_SP_CD;
        if (!e.findBuff('recon:sui_lift')) suiReleaseNow(battle, e);
        continue;
      }
      s.next -= dt;
      if (s.next > 1e-9 || !canAct(battle, e) || e.findBuff('recon:sui_lift')) continue;
      s.next = SUI_SP_CD;
      suiReleaseNow(battle, e);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 洛伦茨，扰动之谬 / 源阶方·重构（业主 2026-10-29）：只出现在 boss 区域2/3/4，每个区域一整对；多只洛伦茨
// **共享血量并相互叠加**（每只 3000000，池子由 match 层的 `ReconChannel` 开成 3000000 × 只数）。
//
//   洛伦茨：冰盾 20/20（30−10）；不再朝<源阶方>移动；【象限封锁】不做；
//           被击倒 → 假死（锁 1 点生命、每秒回 3%）；此时源阶方移除大部分减伤并开始行动；
//           源阶方被击倒 → 洛伦茨解除假死、成对同步退场（共享池清零 ⇒ 隐秘核心通关）。
//   源阶方：初始 95% 减伤（左右两侧额外减免那条不做）；【失链裂变】首次 15→10（冷却 8，半血 4）；
//           召唤源阶方模块 → 每 20 秒（首次 10）对全场 1 次「死亡爆炸」；
//           每 10 秒召 5 个源阶粒素（50000 生命、不可阻挡、向防守点移动，到达 / 死亡时爆炸）。

function shpState(battle) { return bossStore(battle).shp; }
function shorbbState(battle) { return bossStore(battle).shorb; }

/** 本战场有没有处于假死的洛伦茨（共享池 ⇒ 各战场同时进入）。 */
function shpAnyFake(battle) {
  for (const [e, s] of shpState(battle)) if (e && e.alive && s && s.fake) return true;
  return false;
}

/** 源阶粒素死亡 / 进入防守点：周围 3×3 ATK×2 法术。 */
function shorsmBoom(battle, u) {
  if (!u || u._reconBoomed) return;
  u._reconBoomed = true;
  battle.fx('explode', { x: u.x, y: u.y, r: 1.5, kind: 'shorsmBoom', id: u.id });
  for (const a of alliesInBox(battle, u.tileR, u.tileC, SHORSM_AOE)) {
    battle.dealDamage(u.alive ? u : null, a, {
      amount: u.s.atk * SHORSM_BOOM_SCALE, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'shorsmBoom'],
    });
  }
}

/** 在源阶方周围找 `n` 个空格并各召一个源阶粒素。 */
function spawnShorsm(battle, e, n) {
  const taken = new Set();
  for (const u of battle.units || []) if (u && u.alive) taken.add(`${Math.round(u.tileR)},${Math.round(u.tileC)}`);
  const cy = Math.round(e.tileR), cx = Math.round(e.tileC);
  const spots = [];
  for (let r = -2; r <= 2 && spots.length < n; r++) {
    for (let c = -2; c <= 2 && spots.length < n; c++) {
      if (!r && !c) continue;
      const rr = cy + r, cc = cx + c;
      if (taken.has(`${rr},${cc}`)) continue;
      taken.add(`${rr},${cc}`);
      spots.push([rr, cc]);
    }
  }
  while (spots.length < n) spots.push([cy, cx]);
  for (const pos of spots) {
    const u = spawnSummon(battle, e, SUMMON_SHORSM, pos);
    if (!u) continue;
    battle.addBuff(u, { key: 'recon:shorsm_ghost', persist: true, visible: false, flags: { unblockable: true } });
  }
}

/** 一对同场退场：洛伦茨解除假死并退场、源阶方一起走，共享池清零（= 本场首领战通关）。 */
function shpDownHere(battle) {
  if (battle._shpEnded) return;
  battle._shpEnded = true;
  const st = shpState(battle);
  for (const [e, s] of st) {
    if (s) { s.fake = false; s.down = true; }
    if (e && e.alive) battle.kill(e, null);
  }
  for (const u of liveEnemies(battle, BOSS_SHORBB)) if (u.alive) battle.kill(u, null);
  // 共享池清零：通道池（洛伦茨的叠加血量）直接写 0；没有通道时退回本场那条池（区域1 是源阶方自己的 2200 万）
  const ch = reconChannelOf(battle);
  if (ch && typeof ch.setHp === 'function') ch.setHp('shp', 0);
  const p = bossPoolOf(battle);
  if (!p) return;
  if (p.channel && typeof p.channel.setHp === 'function' && p.key) p.channel.setHp(p.key, 0);
  else if (typeof p.setHp === 'function') p.setHp(0);
  else if (typeof p.damage === 'function') p.damage(null, p.hp);
}

function installShophmRecon(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SHOPHM) return;
    shpState(battle).set(e, { shield: SHP_SHIELD_INIT, fake: false, down: false });
  });
  // 假死：致命伤害压到「池 / 血条刚好留 1」（池是唯一真相；多块场地各压各的，池同一份）
  battle.on('hpDamage', (c) => {
    const t = c && c.target;
    if (!t || t.defId !== BOSS_SHOPHM || !c.amount) return;
    const s = shpState(battle).get(t);
    if (!s || s.down) return;
    const p = bossPoolOf(battle);
    const remaining = p ? p.hp : t.hp;
    const allowed = Math.max(0, remaining - SHP_FAKE_MIN);
    if (c.amount > allowed) c.amount = allowed;
  });
  battle.on('tick', (c) => {
    const st = shpState(battle);
    if (!st.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    const p = bossPoolOf(battle);
    for (const [e, s] of st) {
      if (!e.alive) { st.delete(e); continue; }
      if (s.down) continue;
      s.shield -= dt;
      if (s.shield <= 1e-9) {
        s.shield = SHP_SHIELD_CD;
        castSkill(battle, e, skillOf(e, 'IceShield'));
      }
      const hpLeft = p ? p.hp : e.hp;
      if (!s.fake && hpLeft <= SHP_FAKE_MIN + 1e-6) {
        s.fake = true;
        battle.addBuff(e, { key: 'recon:shp_fake', persist: true, visible: true });
        battle.fx('telegraph', { x: e.x, y: e.y, r: 2, kind: 'shpFake', id: e.id });
      }
      // 假死：每秒回 3% 生命上限（写池；多块场地靠 healBoss 的去重窗口只算一次）
      if (s.fake) {
        const max = p ? p.maxHp : e.s.maxHp;
        if (healBoss(battle, e, max * SHP_FAKE_REGEN * dt) > 0) e.markDirty();
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SHOPHM) return;
    const s = shpState(battle).get(e);
    if (s) s.down = true;
  });
}

function installShorbbRecon(battle) {
  const ch = reconChannelOf(battle);
  const area = ch ? ch.areaOf(((battle.players || [])[0] || {}).playerId) : 0;
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SHORBB) return;
    battle.addBuff(e, { key: 'recon:shorbb_dr', persist: true, visible: true, mods: { dmgTakenMul: SHP_DR_INIT } });
    battle.addBuff(e, { key: 'recon:shorbb_idle', persist: true, visible: true, flags: { noMove: true } });
    e.profile = { ...(e.profile || {}), noAttack: true };
    shorbbState(battle).set(e, {
      awake: false, aoe: SHP_AOE_INIT, blast: SHP_BLAST_INIT, part: SHORSM_INTERVAL,
    });
  });
  battle.on('tick', (c) => {
    const st = shorbbState(battle);
    if (!st.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    if (ch) {
      for (const ev of ch.drain(area)) {
        if (ev && ev.kind === 'shpDown') shpDownHere(battle);
      }
    }
    // 本战场有没有洛伦茨：区域1 的首领就是源阶方自己（没有洛伦茨可等）⇒ 直接醒来（[ASSUMED] 按「已移除大部分减伤」处理）
    const fake = shpAnyFake(battle) || shpState(battle).size === 0;
    for (const [e, s] of st) {
      if (!e.alive) { st.delete(e); continue; }
      if (!s.awake) {
        if (!fake) continue;
        s.awake = true;
        battle.removeBuff(e, 'recon:shorbb_idle');
        battle.removeBuff(e, 'recon:shorbb_dr');
        battle.addBuff(e, { key: 'recon:shorbb_dr_wake', persist: true, visible: true, mods: { dmgTakenMul: SHP_DR_WAKE } });
        e.profile = { ...(e.profile || {}), noAttack: false };
        battle.fx('telegraph', { x: e.x, y: e.y, r: 12, kind: 'shorbbWake', id: e.id });
      } else if (!fake) {
        // 洛伦茨解除假死（退场）⇒ 减伤回归 95%
        battle.removeBuff(e, 'recon:shorbb_dr_wake');
        battle.addBuff(e, { key: 'recon:shorbb_dr', persist: true, visible: true, mods: { dmgTakenMul: SHP_DR_INIT } });
      }
      if (!canAct(battle, e)) continue;
      // 源阶粒素：每 10 秒 5 个（每块 boss 区域各自召唤）
      s.part -= dt;
      if (s.part <= 1e-9) {
        s.part = SHORSM_INTERVAL;
        spawnShorsm(battle, e, SHORSM_COUNT);
      }
      // 【失链裂变】：全场 ATK×1 法术；首次 10 秒，冷却 8（半血 4）
      s.aoe -= dt;
      if (s.aoe <= 1e-9) {
        const sk = skillOf(e, 'Aoe');
        s.aoe = e.hpRatio < talentOf(e, 'Angry.hp_ratio', 0.5) ? SHP_AOE_ADVANCE : SHP_AOE_CD;
        castSkill(battle, e, sk);
        battle.fx('explode', { x: e.x, y: e.y, r: 12, kind: 'shorbbAoe', id: e.id });
        for (const a of battle.allies()) {
          if (!a.alive || a.hidden) continue;
          battle.dealDamage(e, a, { amount: e.s.atk * SHP_AOE_SCALE, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'shorbbAoe'] });
        }
      }
      // 召唤源阶方模块 → 全场 1 次死亡爆炸：首次 10 秒、之后每 20 秒
      s.blast -= dt;
      if (s.blast <= 1e-9) {
        s.blast = SHP_BLAST_CD;
        castSkill(battle, e, skillOf(e, 'Summon'));
        battle.fx('explode', { x: e.x, y: e.y, r: 12, kind: 'shorbbBlast', id: e.id });
        for (const a of battle.allies()) {
          if (!a.alive || a.hidden) continue;
          battle.dealDamage(e, a, { amount: e.s.atk * SHP_BLAST_SCALE, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'shorbbBlast'] });
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SHORBB) return;
    if (battle._shpEnded) return;
    if (ch) for (const other of new Set(ch.areas.values())) if (other !== area) ch.emit('shpDown', null, other);
    shpDownHere(battle);
  });
  battle.on('kill', (c) => {
    const u = c && c.victim;
    if (u && u.defId === SUMMON_SHORSM) shorsmBoom(battle, u);
  });
  battle.on('enemyLeak', (c) => {
    const u = c && c.enemy;
    if (u && u.defId === SUMMON_SHORSM) shorsmBoom(battle, u);
  });
}

// ---------------------------------------------------------------------------------------------------------------

function installReconBosses(battle) {
  installSkulsr(battle);
  installLslime(battle);
  installCqbw(battle);
  installMdrock(battle);
  installMousek(battle);
  installXi(battle);
  installMephi(battle);
  installFaust(battle);
  installFrstar(battle);
  installTalula(battle);
  installPatrt(battle);
  installMirbst(battle);
  installDemonk(battle);
  installBlkswb(battle);
  installKnights(battle);
  installReid(battle);
  installMandra(battle);
  installBldkgt(battle);
  installMorphis(battle);
  installDirctr(battle);
  installDywqgs(battle);
  installBsname(battle);
  installSkzjkl(battle);
  installSyskad(battle);
  installShchmr(battle);
  installDycyue(battle);
  installCsdoll(battle);
  installSkzamy(battle);
  installAmaRecon(battle, BOSS_MUAMA, 'muama');
  installAmaRecon(battle, BOSS_MUTWIN, 'mutwin');
  installMusnakeRecon(battle);
  installSuiRecon(battle);
  installShophmRecon(battle);
  installShorbbRecon(battle);
  installStillBosses(battle);
}

/** 供测试与诊断：本模块叠加的全部·重构首领 key（一条真相）。 */
export const RECON_BOSS_KEYS = Object.freeze({
  skulsr: BOSS_SKULSR, lslime: BOSS_LSLIME, cqbw: BOSS_CQBW, mdrock: BOSS_MDROCK, mousek: BOSS_MOUSEK,
  xi: BOSS_XI, mephi: BOSS_MEPHI, faust: BOSS_FAUST, frstar2: BOSS_FRSTAR2,
  talula: BOSS_TALULA, patrt: BOSS_PATRT, mirbst: BOSS_MIRBST, demonk: BOSS_DEMONK,
  blkswb: BOSS_BLKSWB, reid: BOSS_REID,
  mandra: BOSS_MANDRA, bldkgt: BOSS_BLDKGT, morphis: BOSS_MORPHIS, dirctr: BOSS_DIRCTR, dywqgs: BOSS_DYWQGS,
  bsnake: BOSS_BSNAKE, skzjkl: BOSS_SKZJKL, syskad: BOSS_SYSKAD, shchmr: BOSS_SHCHMR, dycyue: BOSS_DYCYUE,
  csdoll: BOSS_CSDOLL, skzamy: BOSS_SKZAMY,
  muama: BOSS_MUAMA, mutwin: BOSS_MUTWIN, musnake: BOSS_MUSNAKE,
  suisho: BOSS_SUISHO, suizzh: BOSS_SUIZZH, suiyzh: BOSS_SUIYZH, suiwei: BOSS_SUIWEI,
  shophm: BOSS_SHOPHM, shorbb: BOSS_SHORBB, shorsm: SUMMON_SHORSM,
});

/** 供测试与诊断：保留首领的机制数值（一条真相）。 */
export const RECON_BOSS_RULES = Object.freeze({
  BLKSWB_FREEZE_PROB, FREEZE_DURATION, REID_BAT_STEP, REID_BAT_CAP, REID_HEAL,
  GRENADE_SCALE, GRENADE_DEF_IGNORE, C4_COOLDOWN_SCALE,
  MEPHI_AURA_FLAT, MEPHI_HEAL_BONUS, MEPHI_INTERVAL, MEPHI_PER_TICK, MEPHI_AVENGE,
  FAUST_BAT_CUT, FRSTAR_FORM2_DEF_PCT, TALULA_BURN_SCALE, PATRT_HITS, MIRBST_PHASE2_HEAL,
  MANDRA_RAY_RES_DOWN, MANDRA_STONE_RES_DOWN, MANDRA_STONE_DEBUFF_DURATION,
  BLDKGT_BLOOD_DURATION, BLDKGT_BLADE_SPEED,
  MORPHIS_SELF_TAKEN, MORPHIS_LINE_DEF, MORPHIS_LINE_RES, MORPHIS_RED_INIT, MORPHIS_RED_INTERVAL,
  MORPHIS_EVOLVE_INTERVAL, MORPHIS_RED_RADIUS,
  DIRCTR_CUT, DIRCTR_SCENE_RADIUS, DIRCTR_CHARGE,
  DYWQGS_FALL_SCALE, DYWQGS_FALL_SPLASH, DYWQGS_FALL_RADIUS, DYWQGS_FALL_INTERVAL,
  DYWQGS_STUN_CHANCE, DYWQGS_STUN_DURATION,
  DYWQGS_UNBLOCKED_TAKEN, DYWQGS_ZH_INIT, DYWQGS_ZH_INTERVAL, DYWQGS_ZH_MAX,
  DYWQGS_FORM2_FALLS, DYWQGS_ELITE_INTERVAL, DYWQGS_ELITE_COUNT,
  BS_GUARD_TAKEN, BS_FIRE_DURATION, BS_IGNITE_CD, BS_EXPLODE_CD, BS_DAMAGE_BONUS,
  BS_FIRESTORM_INTERVAL, BS_FIRESTORM_ROUNDS, BS_RAGE_INVINCIBLE, BS_RAGE_LENGTH, BS_BACK_INVINCIBLE,
  BS_SUMMON_FIRST, BS_ASH_HP_RATIO, BS_ASH_TAKEN, BS_ASH_DRAIN,
  SKZ_WRATH_BONUS, SKZ_CLEAN_INIT, SKZ_CLEAN_INTERVAL, SKZ_MEDITATE_SWITCH, SKZ_MEDITATE_NILU,
  SKZ_MEDITATE_BATCH, SKZ_MEDITATE_ELITES, SKZ_FREE_NILU, SKZ_FREE_BATCH, SKZ_FREE_NORMAL, SKZ_FREE_ELITE,
  SKZ_CAREFREE_NILU, SKZ_FIVE_INTERVAL, SKZ_FIVE_SEGMENTS, SKZ_REDUCE_STEP, SKZ_REBORN,
  SKZ_NILU_LIFE, SKZ_NILU_ATK_DOWN, SKZ_NILU_DEBUFF_DURATION, SKZ_NILU_DAMAGE,
  SYS_HEAL_BONUS, SYS_HEAL_TARGETS, SYS_SP_MAX, SYS_SP_REBIRTH, SYS_SP_REGEN, SYS_TEAR_INTERVAL, SYS_TEAR_SP, SYS_REBORN,
  SH_DEF_DOWN, SH_DEF_DOWN_DURATION, SH_FIREBALL_CD, SH_FIREBALL_INIT, SH_FIREBALL_FLY_CD, SH_FIRE_DURATION,
  SH_JAW_DURATION, SH_JAW_INTERVAL, SH_JAW_FIRST_DELAY, SH_JAW_EXTEND, SH_FLY_DURATION, SH_FLY_CD, SH_FLY_INIT, SH_REBORN_LIKE,
  SUI_LIFT, SUI_LIFT_TAKEN, SUI_SP_INIT, SUI_SP_CD, SUI_FIRE_DURATION, SUI_FIRE_TICK,
  SUI_TAIL_HITS, SUI_TAIL_AOE, SUI_CLAW_AOE, SUI_BREAK_RATIO, SUI_BREAK_NORMAL, SUI_BREAK_ELITE,
  SHP_SHIELD_INIT, SHP_SHIELD_CD, SHP_FAKE_MIN, SHP_FAKE_REGEN, SHP_DR_INIT, SHP_DR_WAKE,
  SHP_AOE_CD, SHP_AOE_INIT, SHP_AOE_ADVANCE, SHP_AOE_SCALE, SHP_BLAST_CD, SHP_BLAST_INIT, SHP_BLAST_SCALE,
  SHORSM_INTERVAL, SHORSM_COUNT, SHORSM_BOOM_SCALE, SHORSM_AOE,
  DYC_DODGE, DYC_BLOCKED_PENALTY, DYC_BODY_BONUS, DYC_STACK_INTERVAL, DYC_STACK_STEP,
  DYC_SEND_CD, DYC_PUNCH_CD, DYC_PUNCH_TARGETS, DYC_BODY_CD, DYC_BATCH_NORMAL, DYC_BATCH_ELITE,
  CSDOLL_MAX_TARGETS, CSDOLL_HEAL_RATIO, CSDOLL_HEAL_CAP, CSDOLL_AOE_HITS, CSDOLL_AOE_SCALE,
  CSDOLL_SHIELD_FIRST, CSDOLL_SHIELD_CD, CSDOLL_SHIELD_DURATION, CSDOLL_SHIELD_CAP, CSDOLL_SHIELD_ELITES,
  CSDOLL_CLASS1_TIMES, CSDOLL_CLASS1_NORMAL, CSDOLL_CLASS2_TIMES, CSDOLL_CLASS2_ELITE,
  CSDOLL_CLASS3_AT, CSDOLL_CLASS3_INTERVAL, CSDOLL_CLASS3_NORMAL, CSDOLL_CLASS3_ELITE,
  SKZAMY_TAKEN, SKZAMY_HALF_INVULN, SKZAMY_SPLASH, SKZAMY_BALL_INTERVAL, SKZAMY_BALL_SPEED,
  SKZAMY_AURA_RADIUS, SKZAMY_AURA_DEALT, SKZAMY_BATCH_INTERVAL, SKZAMY_BATCH_NORMAL, SKZAMY_BATCH_ELITE,
  SKZAMY_FORM2_TARGETS, SKZAMY_FORM2_SCALE, SKZAMY_REBORN, SKZAMY_MARK_ELEMENT,
  AMA_FIREWALL_TAKEN, AMA_STACK_ATK, AMA_STACK_CAP, AMA_TORRENT_VALUE, AMA_TORRENT_STUN,
  AMA_TORRENT_H_CD, AMA_TORRENT_H_INIT, AMA_TORRENT_V_CD, AMA_TORRENT_V_INIT, AMA_BLINK_CD, AMA_BLINK_INIT,
  AMA_FAKE_LOCK, AMA_FAKE_REGEN, AMA_FAKE_END, AMA_FAKE_TAKEN,
  MUSNAKE_FIREWALL_TAKEN, MUSNAKE_THRESHOLDS, MUSNAKE_TORRENT_CD, MUSNAKE_TORRENT_INIT,
  MUSNAKE_TORRENT_TARGETS, MUSNAKE_TORRENT_VALUE, MUSNAKE_TORRENT_STUN,
  MUSNAKE_SUMMON_INTERVAL, MUSNAKE_SUMMON_NORMAL, MUSNAKE_SUMMON_ELITE,
});

