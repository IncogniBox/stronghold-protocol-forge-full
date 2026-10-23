// workshop/enemy-ext/battle/main.mjs — 新增敌人扩展 的**普通版本**首领行为层。
//
// 覆盖 19 个 engine KITS 没有的官方首领（`enemies.json` 里的 65 条记录；碎骨/庞贝/W/泥岩/百夫长/自在/杰斯顿/锏/复仇者
// 与大亚当基座由引擎官方 kit 或数据自带，本模块不管）。口径一律**官方原版**：数值只从记录（skills[].bb / talents.bb）
// 读，没有数据的地方按图鉴文本给 [ASSUMED] 并点名；重构增量（额外目标 / 额外榴弹 / 冷却减半 …）一概不在这里。
//
// 技能的**官方特效**：cast 时发 `['cast', id, slot]` + `['skill', id, 1/0]`（动作半边；敌人的快照不亮 SKILL 旗标，
// snapshot.js 的 u.skill 是干员专属），slot = 该 prefabKey 在记录 skills[] 里的下标 —— 与引擎 helpers.js castSlot
// 同一条口径。特效文件在 pack fx（assets/fx/，fx.manifest 通道）。
//
// 召唤物实体（浮士德弩炮 / 霜星星冰晶 / 蔓德拉石柱 / 黑蛇能量聚合体 / 奎隆尼卢火 / 朔壳敛傲·宿傲）暂缺官方数值与
// 模型 —— 留待下一轮，README 已点名。

import * as S from '@battle/mod.js';

// ---- 常量 -----------------------------------------------------------------------------------------------

const BOSS_MEPHI = 'enemy_1507_mephi';
const BOSS_FAUST = 'enemy_1508_faust';
const BOSS_TALULA = 'enemy_1503_talula';
const BOSS_FRSTAR2 = 'enemy_1510_frstar2';
const BOSS_PATRT = 'enemy_1506_patrt';
const BOSS_MIRBST = 'enemy_1571_mirbst';
const BOSS_MANDRA = 'enemy_1523_mandra';
const BOSS_BLDKGT = 'enemy_1524_bldkgt';
const BOSS_DIRCTR = 'enemy_1568_dirctr';
const BOSS_DYWQGS = 'enemy_2120_dywqgs';
const BOSS_LDEVIL = 'enemy_1569_ldevil';
const BOSS_BLDBLD = 'enemy_1186_bldbld';
const BOSS_XIA = 'enemy_2101_dyspll';
const BOSS_BSNAKE = 'enemy_1515_bsnake';
const BOSS_SKZJKL = 'enemy_2089_skzjkl';
const BOSS_SYSKAD = 'enemy_2039_syskad';
const BOSS_SHCHMR = 'enemy_2150_shchmr';
const BOSS_DYCYUE = 'enemy_2126_dycyue';
const SUMMON_XIA = 'enemy_2101_dyspll';
const SUMMON_BLDBLD = 'enemy_1186_bldbld';
const SUMMON_BALLIS = 'enemy_ext_ballista';
const SUMMON_FROST = 'enemy_ext_icecrystal';
const SUMMON_ENERGY = 'enemy_ext_energycrystal';
const SUMMON_NILU = 'enemy_ext_nilufire';
const SUMMON_LOTUS = 'enemy_2090_skzjbc';
const SUMMON_LIANAO = 'enemy_2130_dyswrd';
const SUMMON_BODY = 'enemy_2128_dysuib';
const SUMMON_PILLAR = 'enemy_ext_stone_pillar';

// ---- 第 2 批：官方首领（数据已在 enemies.json，模型/图标/art 由本包自带）------------------------------
const BOSS_CSDOLL = 'enemy_2018_csdoll';   // 伤心的大锁
const BOSS_SKZAMY = 'enemy_2092_skzamy';   // “阿米娅”，炉芯终曲
const BOSS_MUAMA = 'enemy_1590_muama';     // AMa-10
const BOSS_MUTWIN = 'enemy_1591_mutwin';   // AMa-10异构体
const BOSS_MUSNAKE = 'enemy_1593_musnake'; // “终始”
const BOSS_SUISHO = 'enemy_1582_suisho';   // 岁
const BOSS_SUIZZH = 'enemy_1583_suizzh';   // 岁·左爪
const BOSS_SUIYZH = 'enemy_1584_suiyzh';   // 岁·右爪
const BOSS_SUIWEI = 'enemy_1585_suiwei';   // 岁·尾
const BOSS_SHOPHM = 'enemy_2147_shophm';   // 洛伦茨，扰动之谬
const BOSS_SHORBB = 'enemy_2148_shorbb';   // 源阶方

// 第 2 批首领的召唤物（均为本包 `enemies.json` 的真实记录，带模型与图标）
const SUMMON_SKZAMB = 'enemy_2094_skzamb';  // 仅剩的创意（阿米娅）
const SUMMON_SHEART = 'enemy_10172_sheart'; // “未熄”（岁）
const SUMMON_SHORSM = 'enemy_2149_shorsm';  // 源阶粒素（源阶方）

// 伤心的大锁的召唤池（PRTS ISW-DF 别无所求「敌人召唤序列」）：三类敌人 + 专属召唤物“报幕助手”
const SUMMON_NBKGHT = 'enemy_1099_nbkght_2'; // 无名精锐骑士
const SUMMON_EMOUSE = 'enemy_1060_emouse_2'; // 灰尾香主
const SUMMON_CSPPT = 'enemy_2011_csppt';     // 剧场组装体
const SUMMON_DUGAGO = 'enemy_1172_dugago_2'; // 愤怒的守墓石像（data/enemies.json 已有）
const SUMMON_AIDE = 'enemy_ext_csdoll_aide'; // “报幕助手”（PRTS TN-3 敌方召唤物页）

const HALF_HP = 0.5;
const BOSS_STORE = 'ext:bosses';
const AURA_REFRESH = 1; // 光环类 buff 的续期周期（s）
const FORM2 = { form: 'form2' };

/** 每场一份的战场便签（引擎 SDK battleStore）。 */
function bossStore(battle) {
  return S.battleStore(battle, BOSS_STORE, () => ({
    mephi: new Map(), mephiHeal: new Map(), faust: new Map(), talula: new Map(), frstar: new Map(),
    patrt: new Map(), mirbst: new Map(), mandra: new Map(), bld: new Map(), dirctr: new Map(),
    wang: new Map(), morphis: new Map(), bsnake: new Map(), syskad: new Map(), shchmr: new Map(), skzjkl: new Map(),
    csdoll: new Map(), skzamy: new Map(), muama: new Map(), mutwin: new Map(), musnake: new Map(),
    suisho: new Map(), shophm: new Map(), shorbb: new Map(),
  }));
}

/** 敌人能否行动：与引擎 helpers.js canCast 同口径。 */
function canAct(battle, e) {
  return !!(e && e.alive && !e.hidden && !e.s.flags.stun && !e.s.flags.silence && !(battle.time < e.unbalanceUntil - 1e-9));
}

/** 场上活着的、defId 匹配的敌人。 */
function liveEnemies(battle, defId) {
  return (battle.enemies || []).filter((x) => x && x.alive && x.defId === defId);
}

/** `e.def.raw.talents.bb[key]` 的一个数（缺省给 fallback）。 */
function talentOf(e, key, fallback) {
  const bb = e && e.def && e.def.raw && e.def.raw.talents ? e.def.raw.talents.bb : null;
  const v = bb ? bb[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** `e.def.raw.skills` 里 prefabKey 匹配的那一条。 */
function skillOf(e, prefabKey) {
  const list = e && e.def && e.def.raw ? e.def.raw.skills : null;
  return Array.isArray(list) ? (list.find((s) => s && s.prefabKey === prefabKey) ?? null) : null;
}

const icdOf = (sk) => (sk && Number.isFinite(sk.initCooldown) && sk.initCooldown > 0 ? sk.initCooldown : (sk && sk.cooldown) || 0);
const cdOf = (sk, fallback) => (sk && Number.isFinite(sk.cooldown) && sk.cooldown > 0 ? sk.cooldown : fallback);
const skNum = (sk, key, fallback) => {
  const v = sk && sk.bb ? sk.bb[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/**
 * 召唤物/装置的内联记录（data/enemies.json 同形；不进 `enemies.json` ⇒ 不参与图鉴、不占波次）。
 * 数值一律照 PRTS 装置页；没有逐关等级数据的按「通常数据」取，代码里点名 [ASSUMED]。
 */
const SUMMON_DEFS = {
  // 弩炮：Lv1 100/100 → Lv30 100/3000；无敌、阻挡3、向前射箭 cd5。本模式取 Lv5（500 攻，PRTS VI-5 Lv5）[ASSUMED]
  [SUMMON_BALLIS]: {
    name: '弩炮', rank: 'NORMAL', applyWay: 'RANGED', notCountInTotal: true,
    stats: { maxHp: 100, atk: 500, def: 0, res: 0, moveSpeed: 0, bat: 1, aspd: 100, rangeRadius: 20, blockCnt: 1, dmgType: 'phys', motion: 'WALK', lpr: 0 },
    attackAnim: { dur: 1, hit: 0.3 },
  },
  // 源石冰晶：HP100，无攻击；寒潮（上方冰晶施放）使周围我方寒冷 10s。
  [SUMMON_FROST]: {
    name: '源石冰晶', rank: 'NORMAL', applyWay: 'NONE', notCountInTotal: true,
    stats: { maxHp: 100, atk: 0, def: 0, res: 0, moveSpeed: 0, bat: 1, aspd: 100, rangeRadius: 0, blockCnt: 1, dmgType: 'none', motion: 'WALK', lpr: 0 },
  },
  // 能量聚合体：HP6000 DEF200 RES20，无攻击；25s 自爆（四方向火球 1000 法术 + 烈焚灼息）。
  [SUMMON_ENERGY]: {
    name: '能量聚合体', rank: 'NORMAL', applyWay: 'NONE', notCountInTotal: true,
    stats: { maxHp: 6000, atk: 0, def: 200, res: 20, moveSpeed: 0, bat: 1, aspd: 100, rangeRadius: 0, blockCnt: 1, dmgType: 'none', motion: 'WALK', lpr: 0 },
  },
  // 尼卢火（我方装置，敌阵里只作「计数/法阵原点」）：HP10000 DEF500 RES70，不可选中、不死，50s。
  [SUMMON_NILU]: {
    name: '尼卢火', rank: 'NORMAL', applyWay: 'NONE', notCountInTotal: true,
    stats: { maxHp: 10000, atk: 0, def: 500, res: 70, moveSpeed: 0, bat: 1, aspd: 100, rangeRadius: 1, blockCnt: 1, dmgType: 'none', motion: 'WALK', lpr: 0 },
  },
  // 托生莲座：HP50000 ATK500 DEF2000 RES50，飞行、不攻击；任一莲座退场即结束承三身。
  [SUMMON_LOTUS]: {
    name: '托生莲座', rank: 'NORMAL', applyWay: 'NONE', notCountInTotal: true,
    stats: { maxHp: 50000, atk: 500, def: 2000, res: 50, moveSpeed: 0.8, bat: 3, aspd: 100, rangeRadius: 0, blockCnt: 1, dmgType: 'none', motion: 'FLY', lpr: 0 },
  },
  // 敛傲：HP20000 ATK1800 DEF500 RES20，飞行远程，bat5；本模式沿「目标所在格」的直线路径前进。
  [SUMMON_LIANAO]: {
    name: '敛傲', rank: 'NORMAL', applyWay: 'RANGED', notCountInTotal: true,
    stats: { maxHp: 20000, atk: 1800, def: 500, res: 20, moveSpeed: 1, bat: 5, aspd: 100, rangeRadius: 1.5, blockCnt: 1, dmgType: 'arts', motion: 'FLY', lpr: 0 },
  },
  // 石柱（蔓德拉 SummonDupilr 的陷阱实体）：站在格上阻挡，5s 后自动坍塌（对四格 100% 攻击法术 + 1s 眩晕 [ASSUMED]）。
  [SUMMON_PILLAR]: {
    name: '石柱', rank: 'NORMAL', applyWay: 'NONE', notCountInTotal: true,
    stats: { maxHp: 8000, atk: 0, def: 600, res: 30, moveSpeed: 0, bat: 2, aspd: 100, rangeRadius: 0, blockCnt: 1, dmgType: 'none', motion: 'WALK', lpr: 0 },
  },
  // 身形（朔壳的替身）：在场时朔壳不可被攻击；官方数据 HP80000 DEF1000 RES30（不攻击）。
  [SUMMON_BODY]: {
    name: '身形', rank: 'NORMAL', applyWay: 'NONE', notCountInTotal: true,
    stats: { maxHp: 80000, atk: 200, def: 1000, res: 30, moveSpeed: 0.6, bat: 5, aspd: 100, rangeRadius: 0, blockCnt: 1, dmgType: 'none', motion: 'WALK', lpr: 0 },
  },
};

/** 生成一个召唤物：内联 def 走 spawnEnemy 的 `opts.def`（键不在 data/*.json 也可）。 */
function spawnSummon(battle, e, key, pos, extra = {}) {
  const def = SUMMON_DEFS[key];
  if (!def) return null;
  const [r, c] = pos;
  const u = battle.spawnEnemy(key, {
    def, pos: [Math.max(0, Math.round(r)), Math.max(0, Math.round(c))],
    ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null,
    countInTotal: false, ...extra,
  });
  if (u) battle.fx('summon', { x: u.x, y: u.y, id: e.id, key, n: 1 });
  return u;
}

/** 离 `r,c` 最近的、没有单位的格（找不到就给原格）。 */
function freeTileNear(battle, alliesOnly = false) {
  const taken = new Set();
  for (const u of battle.units || []) {
    if (!u || !u.alive || !u.deployed) continue;
    if (alliesOnly && u.side !== 'ally') continue;
    taken.add(`${Math.round(u.tileR)},${Math.round(u.tileC)}`);
  }
  return taken;
}

/** 在一个我方周围（优先四格）挑一个空位；没有我方时用 `fallback`。 */
function tileNearAlly(battle, fallback, prefer = 1) {
  const taken = freeTileNear(battle);
  const cands = [];
  const seen = new Set();
  const push = (r, c) => {
    const k = `${r},${c}`;
    if (seen.has(k) || taken.has(k)) return;
    seen.add(k);
    if (r < 0 || c < 0) return;
    cands.push([r, c]);
  };
  for (const a of battle.allies()) {
    if (!a.alive || a.hidden) continue;
    const ar = Math.round(a.tileR), ac = Math.round(a.tileC);
    for (let dr = -prefer; dr <= prefer; dr++) for (let dc = -prefer; dc <= prefer; dc++) push(ar + dr, ac + dc);
  }
  return cands.length ? battle.rng.pick(cands) : [Math.round(fallback[0]), Math.round(fallback[1])];
}

/** 我方按攻击力降序。 */
function alliesByAtk(battle) {
  return battle.allies().filter((u) => u.alive && !u.hidden).sort((a, b) => b.s.atk - a.s.atk);
}

/** 场上所有带某 buff 的我方。 */
function alliesWith(battle, key) {
  return battle.allies().filter((u) => u.alive && u.findBuff && u.findBuff(key));
}

/** 「周围 n 格」的格块取我方（Chebyshev ≤ n）—— 与引擎 helpers.js alliesInTiles 同一条口径。 */
function alliesInBox(battle, r, c, n) {
  const out = [];
  const rr = Math.round(r), cc = Math.round(c);
  for (const a of battle.allies()) {
    if (a.hidden) continue;
    if (Math.max(Math.abs(Math.round(a.tileR) - rr), Math.abs(Math.round(a.tileC) - cc)) <= n) out.push(a);
  }
  return out;
}
const alliesAroundBox = (battle, r, c, n) => alliesInBox(battle, r, c, n);

/**
 * 各 slot 的技能 clip 时长（pack.json art.enemies 骨架 `animations` 派生的瞬发口径；键 = 官方 defId）。
 * 敌人的快照永远不会亮 SKILL 旗标（snapshot.js:96 的 `u.skill` 是干员专属）—— cast 只换 clip 集，
 * 动作由紧跟着的 `['skill', id, 1/0]` 事件驱动（app.js:1815）。
 */
const SKILL_CLIP_DUR = {
  enemy_1508_faust: { 0: 3, 1: 1.667 },                             // 致命一击 → Skill_1；召唤弩炮 → Skill_2
  enemy_1503_talula: { 0: 2, 1: 3.667, 2: 2, 3: 3.667 },           // Skill_1 / Skill_2（[Half] 同号）
  enemy_1510_frstar2: { 0: 3.5, 1: 3.5, 2: 1.5, 3: 3.5, 4: 3.667 },// 冰盾/冰环 → Skill_2，Reborn 冰环 → Skill_3
  enemy_1506_patrt: { 1: 3.433 },                                   // 投枪 → 主 Skill clip
  enemy_1571_mirbst: { 1: 2.3 },                                    // 落石 → Skill
  enemy_1523_mandra: { 0: 1.833, 2: 1.5, 4: 1.5 },                  // 注目 → C1_Skill_1 Begin+Loop；石柱 → C1_Skill_2
  enemy_1524_bldkgt: { 0: 2.8, 2: 2.033, 3: 2.8 },                  // 血归 → A_Skill / B_Skill；召唤凝血之刃2 → B_Skill_2
  enemy_1515_bsnake: { 0: 2.333, 1: 1.967, 2: 1.967, 3: 2.333 },    // 召唤火焰 → Skill_3，点燃 → Skill_1_A，引爆 → Skill_2_A
  enemy_2089_skzjkl: { 0: 2, 2: 5.133, 3: 2, 4: 5.133 },            // 清火执/惩五戒 → A_Skill / B_Skill_2；承三身 → 施法
  enemy_2150_shchmr: { 0: 3.567, 1: 2.4, 2: 3.567, 3: 2.4, 4: 3.567, 5: 1.667, 6: 2.4, 7: 1.667 },
  enemy_2126_dycyue: { 0: 3.167, 1: 4.8, 2: 2 },                    // 溯律 / 醉生 / 描躯
  enemy_1568_dirctr: { 0: 3.167, 2: 3.167, 3: 5 },                  // 意兴盎然 / 渗散荒诞 / 幕间不息
  enemy_2039_syskad: { 0: 3, 2: 2.667 },                            // 变身 / 腐化
  enemy_2120_dywqgs: { 0: 2.333 },                                  // 落
};

/**
 * `['cast', id, slot]` + `['skill', id, 1/0]`（引擎 helpers.js castSlot 的包侧版本，display only）：
 * slot = 该 prefabKey 在记录 skills[] 里的下标；`battle._ev` 是 sim 的事件总线（damage.js:434 同一条）。
 */
function castSkill(battle, e, sk) {
  if (!battle || !e || !sk || sk.prefabKey == null) return;
  const list = e.def && e.def.raw && Array.isArray(e.def.raw.skills) ? e.def.raw.skills : [];
  const at = list.findIndex((x) => x && x.prefabKey === sk.prefabKey);
  if (at < 0) return;
  const clipDur = SKILL_CLIP_DUR[e.def && e.def.spine]?.[at] || 0;
  const d = sk.bb && typeof sk.bb.duration === 'number' && sk.bb.duration > 0 ? Math.round(sk.bb.duration * 100) / 100 : clipDur;
  // cast 窗口 = 技能时长：bb 没有 duration 的瞬发技能用动作 clip 时长（官方由 ON_CAST_START..END 驱动，等价动作同宽）——
  // 否则客户端 hold 只有 0.3 s（skillfx ENEMY_GRACE），loop 型特效刚起就停，看上去像没特效。
  battle._ev(d > 0 ? ['cast', e.id, at, d] : ['cast', e.id, at]);
  if (clipDur > 0) {
    // 技能窗口**引用计数**：塔露拉的烈焚灼息（Skill_1, 2s）与日冕（Skill_2, 3.667s）会重叠施放，
    // 旧写法各自到点就发 `['skill',0]`，先结束的那个会把还开着的另一个关掉 —— 客户端随即回到
    // 普通攻击（被阻挡 ⇒ Attack_2），把正在播的技能动作/特效打断。只有最后一个窗口结束才关。
    const win = e.__extSkillWin || (e.__extSkillWin = { n: 0 });
    win.n += 1;
    battle._ev(['skill', e.id, 1]);
    // **tick 顺序**：引擎的 updateEnemy（ai.js）在本包的 tick 处理器之前跑，只压 atkCd / 清 swing 挡不住
    // 「同一个 tick 里已经起手」的那一下。写通用的 `skillBusyUntil`（ai.js enemyAttack 开头读）—— 窗口内
    // 根本不进入挥击流程，也不会发 `['atk']`（客户端不会因此播 Attack_2）。
    e.skillBusyUntil = Math.max(Number.isFinite(e.skillBusyUntil) ? e.skillBusyUntil : 0, battle.time + clipDur);
    // 施法期间站定走位（ai.js:682 的行走闸读 atkStandUntil；普攻的 attackStand 同一条通道）——
    // 站动作时长，不站 bb.duration 的长 DoT 窗口
    e.atkStandUntil = Math.max(e.atkStandUntil, battle.time + clipDur);
    // 官方：技能占用攻击间隔 —— 施法期间不进行普通攻击（否则被阻挡的塔露拉会在技能中间打出
    // Attack_2，把 Skill_2 的动作/特效顶掉）。攻击冷却至少压到技能动作结束，并打断已经起手的挥击。
    e.atkCd = Math.max(Number.isFinite(e.atkCd) ? e.atkCd : 0, clipDur);
    e.swing = false;
    e.swingTargets = null;
    battle.after(clipDur, () => {
      win.n = Math.max(0, win.n - 1);
      if (win.n === 0 && e.alive) battle._ev(['skill', e.id, 0]);
    }, { owner: e });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 梅菲斯特：图鉴「全场的敌方单位的自然生命回复速度加倍」+ 每 bat(6 s) 治疗最缺血的敌方单位（atk 点，图鉴口径）。

const MEPHI_AURA_KEY = 'ext:mephi_aura';

function installMephi(battle) {
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    const bosses = liveEnemies(battle, BOSS_MEPHI);
    if (!st.mephi.size && !bosses.length) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    // (a) 治疗光环：每个活着的梅菲斯特给全体敌方单位续一条 hpRegen 加倍 buff（短 buff 每 tick 续）
    for (const o of battle.enemies || []) {
      if (!o.alive) continue;
      const near = bosses.some((m) => m.alive);
      if (near) {
        const rate = (o.base.hpRecoveryPerSec || 0);
        if (rate > 0) battle.addBuff(o, { key: MEPHI_AURA_KEY, duration: AURA_REFRESH, refresh: 'extend', source: bosses[0], mods: { hpRegen: rate } });
      } else battle.removeBuff(o, MEPHI_AURA_KEY);
    }
    // (b) 每 bat(6 s) 治疗最缺血的敌方单位，每人 atk 点
    for (const m of bosses) {
      let s = st.mephiHeal.get(m);
      if (!s) { s = { left: m.s.bat }; st.mephiHeal.set(m, s); }
      if (!m.alive) continue;
      s.left -= dt;
      if (s.left > 1e-9) continue;
      s.left = m.s.bat;
      const hurt = (battle.enemies || []).filter((x) => x.alive && x.hpRatio < 1).sort((a, b2) => a.hpRatio - b2.hpRatio)[0];
      if (hurt) {
        battle.heal(m, hurt, m.s.atk, {});
        battle.fx('heal', { x: hurt.x, y: hurt.y, id: hurt.id });
      }
    }
    for (const [m, s] of [...st.mephiHeal]) if (!m.alive) st.mephiHeal.delete(m);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 浮士德：登场无敌（天赋 invincible.duration 150 s）+ 无法被阻挡；致命一击（CriticalHit：initCooldown 起算，
// 到点后下一次普通攻击补 atk × (atk_scale − 1)）。

const FAUST_INV_KEY = 'ext:faust_inv';
const FAUST_BLOCKFREE_KEY = 'ext:faust_blockfree';

function installFaust(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_FAUST) return;
    const inv = talentOf(e, 'invincible.duration', 0);
    if (inv > 0) battle.addBuff(e, { key: FAUST_INV_KEY, duration: inv, visible: true, flags: { invulnerable: true } });
    battle.addBuff(e, { key: FAUST_BLOCKFREE_KEY, persist: true, visible: true, flags: { unblockable: true } });
    const sk = skillOf(e, 'CriticalHit');
    bossStore(battle).faust.set(e, { left: icdOf(sk), ready: false, ballis: icdOf(skillOf(e, 'SummonBallis')) });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.faust.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.faust) {
      if (!e.alive) { st.faust.delete(e); continue; }
      // 召唤弩炮（SummonBallis 15/30）：预设位置最多 2 台（本模式没有小队动作指令 ⇒ 有就召 [ASSUMED]）
      if (canAct(battle, e)) {
        s.ballis -= dt;
        if (s.ballis <= 1e-9) {
          const sk2 = skillOf(e, 'SummonBallis');
          s.ballis = cdOf(sk2, 30);
          if (liveEnemies(battle, SUMMON_BALLIS).length < 2) {
            castSkill(battle, e, sk2);
            const pos = tileNearAlly(battle, [e.tileR, e.tileC], 2);
            const u = spawnSummon(battle, e, SUMMON_BALLIS, pos);
            // 弩炮：无敌（不可选中）、不移动、每 5s 向前射一支弩箭（装置技能 发射弩箭 0/5）
            if (u) {
              battle.addBuff(u, { key: 'ext:ballis_inv', persist: true, visible: true, flags: { invulnerable: true, untargetable: true } });
              u.profile.noAttack = true;
              u._extShot = 0;
            }
          }
        }
      }
      if (s.ready || !canAct(battle, e)) continue;
      s.left -= dt;
      if (s.left <= 1e-9) { s.left = 0; s.ready = true; }
    }
    // 弩炮射击：每 5s 选最近的、在其前方（同一行/列优先）的我方，物理 500（Lv5）[ASSUMED 等级]
    for (const u of liveEnemies(battle, SUMMON_BALLIS)) {
      u._extShot = (u._extShot ?? 0) + dt;
      if (u._extShot < 5) continue;
      u._extShot = 0;
      const cands = battle.allies().filter((a) => a.alive && !a.hidden);
      if (!cands.length) continue;
      cands.sort((a, b) => (Math.abs(a.x - u.x) + Math.abs(a.y - u.y)) - (Math.abs(b.x - u.x) + Math.abs(b.y - u.y)));
      const t = cands[0];
      battle.fx('beam', { from: [u.x, u.y], to: [t.x, t.y], kind: 'ballista', id: u.id });
      battle._ev(['atk', u.id, t.id, 'phys']);
      battle.dealDamage(u, t, { amount: u.s.atk, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
    }
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_FAUST || c.isSkill) return;
    const s = bossStore(battle).faust.get(a);
    if (s && s.ready) {
      const sk = skillOf(a, 'CriticalHit');
      const scale = skNum(sk, 'atk_scale', 2);
      const extra = a.s.atk * Math.max(0, scale - 1);
      if (extra > 0) {
        castSkill(battle, a, sk);
        for (const t of c.targets || []) {
          if (!t || !t.alive) continue;
          battle._ev(["atk", a.id, t.id, "phys"]);
          battle.dealDamage(a, t, { amount: extra, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
        }
        battle.fx('crit', { x: a.x, y: a.y, id: a.id });
      }
      s.ready = false;
      s.left = cdOf(sk, 17);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 塔露拉：日冕（DanceFire：对半径内所有我方 ATK×1 法术）+ 烈焚灼息（DragonFire：随机一名我方挂递增真伤 DoT）；
// 半血加防加抗（talents.bb halfhp.*，官方数据）。

function installTalula(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_TALULA) return;
    bossStore(battle).talula.set(e, { corona: icdOf(skillOf(e, 'DanceFire')), dragon: icdOf(skillOf(e, 'DragonFire')), half: false });
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
        battle.addBuff(e, { key: 'ext:talula_half', persist: true, visible: true, mods: { defPct: def, resFlat: e.base.res * res } });
      }
      if (!canAct(battle, e)) continue;
      // (a) 日冕
      s.corona -= dt;
      if (s.corona <= 1e-9) {
        const sk = skillOf(e, s.half ? 'DanceFire[Half]' : 'DanceFire') || skillOf(e, 'DanceFire');
        castSkill(battle, e, sk);
        s.corona = cdOf(sk, 40);
        const radius = Math.max(0, skNum(sk, 'range_radius', e.base.rangeRadius));
        const scale = skNum(sk, 'atk_scale', 1);
        // 日冕的官方命中帧 = Skill_2 的 OnAttack（2.567 s）：特效行（skill_02_hit）由这一次 atk 触发，
        // 伤害也落在这帧；以前在 cast 当帧就结算，观感上就是「动作和特效对不上」
        battle.after(2.567, () => {
          if (!e.alive) return;
          const targets = battle.alliesInRadius(e.x, e.y, radius);
          if (!targets.length) return;
          battle._ev(['atk', e.id, targets[0].id, 'arts']);
          for (const u of targets) {
            battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          }
        }, { owner: e });
      }
      // (b) 烈焚灼息
      s.dragon -= dt;
      if (s.dragon <= 1e-9) {
        const sk = skillOf(e, s.half ? 'DragonFire[Half]' : 'DragonFire') || skillOf(e, 'DragonFire');
        s.dragon = cdOf(sk, 19);
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable);
        const t = cands.length ? battle.rng.pick(cands) : null;
        if (t) {
          castSkill(battle, e, sk);
          const dur = skNum(sk, 'dragon_fire.duration', 30.5);
          const base = skNum(sk, 'dragon_fire.baseDamage', 50);
          const addOn = skNum(sk, 'dragon_fire.addOnDamage', 180);
          const addOnDur = Math.max(1, skNum(sk, 'dragon_fire.addOnDuration', 30));
          // Skill_1 的官方命中帧 1.0 s：那一次 atk 触发 skill_01_hit，火焰 DoT 也从这帧开始
          battle.after(1, () => {
            if (!e.alive || !t.alive) return;
            battle._ev(['atk', e.id, t.id, 'arts']);
            let elapsed = 0;
            battle.addBuff(t, {
              key: 'ext:talula_dragon', duration: dur, source: e, visible: true, interval: 1,
              onTick: ({ battle: b, unit }) => {
                elapsed += 1;
                const amount = base + addOn * Math.min(1, elapsed / addOnDur);
                b.dealDamage(e.alive ? e : null, unit, { amount, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
              },
            });
          }, { owner: e });
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 霜星，“冬痕”：普攻寒冷（attackfreeze.freeze）；冰环（IceBurst：法术 + 寒冷，冻伤目标加倍）；冰盾（IceShield：
// max_cnt 层挡下一次法术伤害）；生命归零 ⇒ 重生（reborn.duration）后第二形态（无敌 + 攻击 +50%、改用 [Reborn] 技能）。

function installFrstar(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_FRSTAR2) return;
    bossStore(battle).frstar.set(e, { burst: icdOf(skillOf(e, 'IceBurst')), freeze: icdOf(skillOf(e, 'IceShield')), form2: false, reborn: false });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_FRSTAR2 || c.isSkill) return;
    const dur = talentOf(a, 'attackfreeze.freeze', 5);
    if (dur > 0) for (const t of c.targets || []) if (t && t.alive) battle.applyStatus(t, 'cold', { duration: dur, source: a });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.frstar.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.frstar) {
      if (!e.alive) { st.frstar.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      // 冻结（记录里的 IceShield 就是 PRTS 的【冻结】）：半径2内随机冻结 2 格（重生 3 格），
      // 强制击倒其上的我方单位；「封印的地面」本模式没有地块系统 ⇒ 只做击倒 + 冰封特效 [ASSUMED]
      s.freeze -= dt;
      if (s.freeze <= 1e-9) {
        const sk = skillOf(e, s.form2 ? 'IceShield[Reborn]' : 'IceShield') || skillOf(e, 'IceShield');
        s.freeze = cdOf(sk, 35);
        const max = Math.round(skNum(sk, 'max_cnt', s.form2 ? 3 : 2));
        const inside = battle.allies().filter((u) => u.alive && !u.hidden
          && Math.abs(u.x - e.x) <= 2 && Math.abs(u.y - e.y) <= 2);
        if (inside.length && max > 0) {
          castSkill(battle, e, sk);
          const picks = [];
          for (let i = 0; i < max && inside.length; i++) picks.push(...inside.splice(battle.rng.int(inside.length), 1));
          for (const u of picks) {
            battle.fx('explode', { x: u.x, y: u.y, r: 0.5, kind: 'iceFreeze', id: e.id });
            battle.applyStatus(u, 'cold', { duration: 10, source: e });
            battle.retreat(u, { reason: 'frozen', dying: true }); // 强制击倒（可再部署）
          }
        }
      }
      // 冰环：半径 2（重生 3.3）
      s.burst -= dt;
      if (s.burst <= 1e-9) {
        const sk = skillOf(e, s.form2 ? 'IceBurst[Reborn]' : 'IceBurst') || skillOf(e, 'IceBurst');
        castSkill(battle, e, sk);
        s.burst = cdOf(sk, 10.5);
        const radius = s.form2 ? skNum(sk, 'range_radius', 3.3) : 2;
        const cold = skNum(sk, 'freeze', 10);
        const double = skNum(sk, 'frstar2_s.atk_scale', 2);
        battle.fx('explode', { x: e.x, y: e.y, r: radius, kind: 'iceBurst' });
        for (const u of battle.alliesInRadius(e.x, e.y, radius)) {
          const frozen = !!(u.findBuff && (u.findBuff('freeze') || u.findBuff('cold')));
          battle._ev(["atk", e.id, u.id, "arts"]);
          battle.dealDamage(e, u, { amount: e.s.atk * skNum(sk, 'atk_scale', 1) * (frozen ? double : 1), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          if (u.alive && cold > 0) battle.applyStatus(u, 'cold', { duration: cold, source: e });
        }
      }
    }
    // 源石冰晶：寒潮 0/15 —— 周围 2 格我方寒冷 10s
    for (const u of liveEnemies(battle, SUMMON_FROST)) {
      u._extPulse = (u._extPulse ?? 0) + dt;
      if (u._extPulse < 15) continue;
      u._extPulse = 0;
      battle.fx('explode', { x: u.x, y: u.y, r: 2, kind: 'iceBurst' });
      for (const a of battle.alliesInRadius(u.x, u.y, 2)) {
        if (a.alive) battle.applyStatus(a, 'cold', { duration: 10, source: u });
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
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'ext:frstar_reborn', duration: Math.max(0.1, dur), visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        s.form2 = true;
        s.burst = icdOf(skillOf(e, 'IceBurst[Reborn]'));
        s.freeze = icdOf(skillOf(e, 'IceShield[Reborn]'));
        if (atkUp > 0) b.addBuff(e, { key: 'ext:frstar_form2', persist: true, visible: true, mods: { atkPct: atkUp } });
        if (inv > 0) b.addBuff(e, { key: 'ext:frstar_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
        // 召唤寒潮[重生]：预设位置召唤源石冰晶（本模式取「我方周围两格」为预设位 [ASSUMED]）
        const sm = skillOf(e, 'SummonFrosts');
        if (sm) {
          castSkill(b, e, sm);
          for (let i = 0; i < 2; i++) spawnSummon(b, e, SUMMON_FROST, tileNearAlly(b, [e.tileR, e.tileC], 2));
        }
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: Math.max(0.1, dur), kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 爱国者：行军姿态 4 连击（普通攻击补 3 次）；全场敌方攻防强化（strength.* aura）；击倒 ⇒ 生命献祭
// （reborn.duration 60 s：每 immo_trigger[reborning].interval 秒对周围 ATK×0.2 真伤）⇒ 毁灭姿态
// （远程 / 加防加抗 defPct 1 + resFlat 50%，每 immo_trigger[rage].interval 秒对周围真伤，投枪 throwspear[Rage]）。

function installPatrt(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_PATRT) return;
    bossStore(battle).patrt.set(e, { phase: 'shield', spear: icdOf(skillOf(e, 'throwspear[Rage]')), aura: 0, reborn: false });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_PATRT || c.isSkill) return;
    for (let i = 0; i < 3; i++) {
      for (const t of (c.targets || []).filter((x) => x && x.alive)) {
        battle.dealDamage(a, t, { amount: a.s.atk, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
      }
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.patrt.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.patrt) {
      if (!e.alive) { st.patrt.delete(e); continue; }
      // (a) 全场攻防强化 aura
      s.aura -= dt;
      if (s.aura <= 1e-9) {
        s.aura = AURA_REFRESH;
        const atk = talentOf(e, 'strength.atk', 0);
        const def = talentOf(e, 'strength.def', 0);
        if (atk || def) {
          for (const o of battle.enemies || []) {
            if (!o.alive) continue;
            battle.addBuff(o, { key: 'ext:patrt_strength', duration: AURA_REFRESH, refresh: 'extend', source: e, mods: { atkPct: atk, defFlat: def } });
          }
        }
      }
      if (s.phase === 'reborn') {
        const sk = skillOf(e, 'immo_trigger[reborning]');
        const iv = Math.max(0.1, skNum(sk, 'interval', 0.8));
        s.rebornAcc = (s.rebornAcc ?? iv) - dt;
        if (s.rebornAcc <= 1e-9) {
          s.rebornAcc = iv;
          for (const u of alliesInBox(battle, e.tileR, e.tileC, 1)) {
            battle.dealDamage(e, u, { amount: e.s.atk * skNum(sk, 'atk', 0.2), type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          }
        }
        continue;
      }
      if (!canAct(battle, e)) continue;
      // (b) 毁灭姿态的周期真伤
      if (s.phase === 'rage') {
        const iv = Math.max(0.1, talentOf(e, 'immo_trigger[rage].interval', 0.8));
        s.rageAcc = (s.rageAcc ?? iv) - dt;
        if (s.rageAcc <= 1e-9) {
          s.rageAcc = iv;
          for (const u of alliesInBox(battle, e.tileR, e.tileC, 1)) {
            battle.dealDamage(e, u, { amount: e.s.atk * 0.2, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          }
        }
      }
      // (c) 投枪
      s.spear -= dt;
      if (s.spear <= 1e-9) {
        const sk = skillOf(e, 'throwspear[Rage]');
        s.spear = cdOf(sk, 20);
        const high = battle.allies().filter((u) => u.alive && u.kind === 'op' && u.def && u.def.position === 'RANGED');
        let best = null, bestD = -1;
        for (const u of high) {
          const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
          if (d > bestD) { bestD = d; best = u; }
        }
        if (best) {
          castSkill(battle, e, sk);
          // 投枪的官方命中帧 = Skill 的 1.7 s：atk 触发 patrt_skill_01_hit，伤害同帧结算
          battle.after(1.7, () => {
            if (!e.alive || !best.alive) return;
            battle._ev(['atk', e.id, best.id, 'phys']);
            battle.dealDamage(e, best, { amount: e.s.atk * skNum(sk, 'atk_scale', 1.35), type: 'phys', canDodge: false, tags: ['enemyAbility', 'spear'] });
          }, { owner: e });
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
      key: 'ext:patrt_reborn', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        s.phase = 'rage';
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        const range = talentOf(e, 'immo[Rage].range', 2);
        e.base.rangeRadius = range;
        e.profile.melee = false;
        const def = talentOf(e, 'rage.def', 1);
        const res = talentOf(e, 'rage.magic_resistance', 0.5);
        b.addBuff(e, { key: 'ext:patrt_rage', persist: true, visible: true, mods: { defPct: def, resFlat: e.base.res * res } });
        // 形态切换：pack.json forms 的 rage clip 集（Idle_2/Attack_2/Move_2）—— sim fx 带 form 即切（fxForm）
        b.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'rage' });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 狂躁异质裂兽：登场狂怒（M2LimitCrazyBonus.duration）；【落石】对自身受伤最多者 atk×1.5×易伤 2 并眩晕；
// 生命 ≤20% 或狂怒结束 ⇒ 第二阶段（回 50% 生命、攻击 +100%、同时攻击 3 名）。

function installMirbst(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MIRBST) return;
    bossStore(battle).mirbst.set(e, { phase: 1, crazy: talentOf(e, 'M2LimitCrazyBonus.duration', 60), stone: icdOf(skillOf(e, 'ThrowStone')), hitBy: new Map(), raged: true });
    battle.addBuff(e, { key: 'ext:mirbst_crazy', duration: talentOf(e, 'M2LimitCrazyBonus.duration', 60), visible: true, persist: true });
    // 狂怒：受到的物理与法术伤害大幅降低（M0 ..damage_resistance 0.5）
    battle.addBuff(e, { key: 'ext:mirbst_res', persist: true, visible: true, mods: { physTakenMul: 1 - talentOf(e, 'M0CrazyBonus.damage_resistance', 0.5), artsTakenMul: 1 - talentOf(e, 'M0CrazyBonus.damage_resistance', 0.5) } });
  });
  // 第一形态攻击为二连击
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_MIRBST || c.isSkill) return;
    const s = bossStore(battle).mirbst.get(a);
    if (!s || s.phase !== 1) return;
    for (const t of (c.targets || []).filter((x) => x && x.alive)) {
      battle.dealDamage(a, t, { amount: a.s.atk, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
    }
  });
  battle.on('damaged', (c) => {
    const t = c && c.target, src = c && c.source;
    if (!t || t.defId !== BOSS_MIRBST || !src || src.side !== 'ally') return;
    const s = bossStore(battle).mirbst.get(t);
    if (s) s.hitBy.set(src, (s.hitBy.get(src) || 0) + (c.amount || 0));
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.mirbst.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.mirbst) {
      if (!e.alive) { st.mirbst.delete(e); continue; }
      if (s.phase === 1) {
        s.crazy -= dt;
        if (e.hpRatio <= 0.2 || s.crazy <= 1e-9) {
          s.phase = 2;
          s.raged = true;
          s.crazy = talentOf(e, 'M2LimitCrazyBonus.duration', 60);
          battle.removeBuff(e, 'ext:mirbst_crazy');
          e.hp = Math.min(e.s.maxHp, e.hp + e.s.maxHp * 0.5);
          e.markDirty();
          battle.fx('heal', { x: e.x, y: e.y, id: e.id });
          e.profile.maxTargets = Number(talentOf(e, 'AttackParam.attack@max_target', 3));
          battle.addBuff(e, { key: 'ext:mirbst_phase2', persist: true, visible: true, mods: { atkPct: 1 } });
          // 第二形态狂怒减伤 60%
          battle.removeBuff(e, 'ext:mirbst_res');
          battle.addBuff(e, { key: 'ext:mirbst_res', persist: true, visible: true, mods: { physTakenMul: 1 - talentOf(e, 'M2LimitCrazyBonus.damage_resistance', 0.6), artsTakenMul: 1 - talentOf(e, 'M2LimitCrazyBonus.damage_resistance', 0.6) } });
        }
        if (!s.raged) continue;
      }
      if (!canAct(battle, e)) continue;
      s.stone -= dt;
      if (s.stone <= 1e-9) {
        const sk = skillOf(e, 'ThrowStone');
        s.stone = cdOf(sk, 20);
        let best = null, bestDmg = 0;
        for (const [u, dmg] of s.hitBy) if (u.alive && dmg > bestDmg) { bestDmg = dmg; best = u; }
        if (best) {
          castSkill(battle, e, sk);
          s.hitBy.clear();
          // 落石的官方命中帧 = Skill 的 2.2 s
          battle.after(2.2, () => {
            if (!e.alive || !best.alive) return;
            battle._ev(['atk', e.id, best.id, 'phys']);
            battle.dealDamage(e, best, { amount: e.s.atk * skNum(sk, 'atk_scale', 1.5) * 2, type: 'phys', canDodge: false, tags: ['enemyAbility', 'stone'] });
            if (best.alive && skNum(sk, 'stun', 10) > 0) battle.applyStatus(best, 'stun', { duration: skNum(sk, 'stun', 10), source: e });
          }, { owner: e });
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 蔓德拉：石之盾（所受伤害 ×0.4）；【蔓德拉的注目】点攻击最高者 atk×1 法术并降攻速；击倒 ⇒ Reborn 5 s ⇒
// 第二形态（近地悬浮 + 无敌 3 s + 周期性石之盾脉冲）。石柱（SummonDupilr）暂缺本体数据，留待下一轮。

function installMandra(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MANDRA) return;
    const res = talentOf(e, 'StoneSkin.damage_resistance', 0.6);
    battle.addBuff(e, { key: 'ext:mandra_stone', persist: true, visible: true, mods: { physTakenMul: 1 - res, artsTakenMul: 1 - res } });
    bossStore(battle).mandra.set(e, {
      ray: icdOf(skillOf(e, 'PetrifiedRay')), form2: false, reborn: false, aura: 0,
      pillar: icdOf(skillOf(e, 'SummonDupilr')),
    });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.mandra.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.mandra) {
      if (!e.alive) { st.mandra.delete(e); continue; }
      if (!canAct(battle, e)) continue;
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
          }
        }
      }
      // 石柱（SummonDupilr 15/15）：在我方附近召一根石柱，5s 自动坍塌
      s.pillar -= dt;
      if (s.pillar <= 1e-9) {
        const sk = skillOf(e, 'SummonDupilr');
        s.pillar = cdOf(sk, 15);
        castSkill(battle, e, sk);
        const p = spawnSummon(battle, e, SUMMON_PILLAR, tileNearAlly(battle, [e.tileR, e.tileC], 2));
        if (p) {
          p.profile.noAttack = true;
          const collapse = Math.max(0.1, skNum(sk, 'dupilr_t[auto_collapse].interval', 5));
          battle.after(collapse, () => {
            if (!p.alive) return;
            battle.fx('explode', { x: p.x, y: p.y, r: 1, kind: 'stoneCollapse' });
            for (const u of alliesInBox(battle, p.tileR, p.tileC, 1)) {
              battle.dealDamage(e.alive ? e : null, u, { amount: e.s.atk, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
              if (u.alive) battle.applyStatus(u, 'stun', { duration: 1, source: e });
            }
            battle.kill(p, e);
          }, { owner: e });
        }
      }
      // 蔓德拉的注目（5/15）：引导 6s，每秒 100% 攻击法术，攻速最终 -70%
      s.ray -= dt;
      if (s.ray <= 1e-9) {
        const sk = skillOf(e, 'PetrifiedRay');
        castSkill(battle, e, sk);
        s.ray = cdOf(sk, 15);
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable);
        let best = null, bestAtk = -1;
        for (const u of cands) if (u.s.atk > bestAtk) { bestAtk = u.s.atk; best = u; }
        if (best) {
          const scale = skNum(sk, 'atk_scale', 1);
          const aspd = skNum(sk, 'attack_speed', -0.7) * 100;
          battle.addBuff(best, { key: 'ext:mandra_ray', duration: skNum(sk, 'mandra_ray[cd].duration', 7.1), source: e, visible: true, mods: { aspd } });
          const channel = Math.max(1, skNum(sk, 'hit_interval', 6));
          for (let i = 0; i < channel; i++) {
            battle.after(i * 1, () => {
              if (!e.alive || !best.alive) return;
              battle.fx('beam', { from: [e.x, e.y], to: [best.x, best.y], kind: 'mandraRay', id: e.id });
              battle.dealDamage(e, best, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            }, { owner: e });
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
    const inv = talentOf(e, 'Reborn.mandra_p2_invinsible.duration', 3);
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'ext:mandra_reborn', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        s.form2 = true;
        // 第二形态重置注目冷却为 10s（Reborn.mandra_ray_p2[cd]），并恢复石之盾
        s.ray = talentOf(e, 'Reborn.mandra_ray_p2[cd]', 10);
        battle.addBuff(e, { key: 'ext:mandra_stone', persist: true, visible: true, mods: { physTakenMul: 1 - talentOf(e, 'StoneSkin.damage_resistance', 0.6), artsTakenMul: 1 - talentOf(e, 'StoneSkin.damage_resistance', 0.6) } });
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        b.addBuff(e, { key: 'ext:mandra_float', persist: true, visible: true, flags: { unblockable: true, float: true } });
        if (inv > 0) b.addBuff(e, { key: 'ext:mandra_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 血骑士：血归（BloodPool：眩晕 + DoT，官方 1 名）；击倒 ⇒ 复活姿态 15 s（每秒回 10% 生命、召唤凝血之刃）；
// 回到 50% 生命 ⇒ 回第一形态；到点 ⇒ 第二形态（远程、攻击 +50%、无敌 6 s）。凝血之刃接触后消失并回 10%。

const BLDKGT_REVIVE_DURATION = 15;

function installBldkgt(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_BLDKGT) return;
    // 减伤：Passive.damage_scale 0.75（对阻挡者无效的细节本模式不建模 [ASSUMED]）
    battle.addBuff(e, { key: 'ext:bldkgt_reduce', persist: true, visible: true, mods: { physTakenMul: 0.75, artsTakenMul: 0.75 } });
    bossStore(battle).bld.set(e, { blood: icdOf(skillOf(e, 'BloodPool')), phase: 1, reborn: false, reviveLeft: 0, summonLeft: 2, healAcc: 0, summon2: icdOf(skillOf(e, 'SummonBldbld2')) });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.bld.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.bld) {
      if (!e.alive) { st.bld.delete(e); continue; }
      if (s.phase === 'revive') {
        s.reviveLeft -= dt;
        s.healAcc += e.s.maxHp * 0.1 * dt;
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
          battle.removeBuff(e, 'ext:bldkgt_reborn');
          battle.addBuff(e, { key: 'ext:bldkgt_reduce', persist: true, visible: true, mods: { physTakenMul: 0.75, artsTakenMul: 0.75 } });
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: null }); // 回第一形态（form null = 基础 clip 集）
          continue;
        }
        s.summonLeft -= dt;
        if (s.summonLeft <= 1e-9) {
          const sk = skillOf(e, 'SummonBldbld');
          castSkill(battle, e, sk);
          s.summonLeft = cdOf(sk, 10);
          battle.spawnEnemy(SUMMON_BLDBLD, { pos: [e.y, e.x - 1], ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
          battle.fx('summon', { x: e.x, y: e.y, id: e.id, key: SUMMON_BLDBLD, n: 1 });
        }
        if (s.reviveLeft <= 1e-9) {
          s.phase = 2;
          e.profile.noAttack = false;
          battle.removeBuff(e, 'ext:bldkgt_reborn');
          battle.addBuff(e, { key: 'ext:bldkgt_form2', persist: true, visible: true, mods: { atkPct: talentOf(e, 'Passive2.atk', 0.5) } });
          battle.removeBuff(e, 'ext:bldkgt_reduce');
          battle.addBuff(e, { key: 'ext:bldkgt_reduce', persist: true, visible: true, mods: { physTakenMul: 0.5, artsTakenMul: 0.5 } });
          e.profile.melee = false;
          e.base.rangeRadius = 2;
          e.hp = e.s.maxHp;
          e.atkCd = 0;
          s.summon2 = icdOf(skillOf(e, 'SummonBldbld2'));
          const inv = talentOf(e, 'Passive2.invincible_time', 6);
          if (inv > 0) battle.addBuff(e, { key: 'ext:bldkgt_inv', duration: inv, visible: true, flags: { invulnerable: true } });
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
        }
        continue;
      }
      if (!canAct(battle, e)) continue;
      s.blood -= dt;
      if (s.blood <= 1e-9) {
        const sk = skillOf(e, s.phase === 2 ? 'BloodPool2' : 'BloodPool') || skillOf(e, 'BloodPool');
        castSkill(battle, e, sk);
        s.blood = cdOf(sk, 15);
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable)
          .sort((a, b2) => b2.s.atk - a.s.atk).slice(0, 1);
        for (const u of cands) {
          battle.applyStatus(u, 'stun', { duration: skNum(sk, 'stun', 10), source: e });
          let elapsed = 0;
          battle.addBuff(u, {
            key: 'ext:bldkgt_blood', duration: 10, visible: true, source: e, interval: skNum(sk, 'interval', 1),
            onTick: ({ battle: b, unit }) => {
              elapsed += 1;
              if (elapsed > 10) return;
              b.dealDamage(e.alive ? e : null, unit, { amount: skNum(sk, 'damage', 200), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            },
          });
        }
      }
      // 第二形态：持续召唤凝血之刃（SummonBldbld2 5/12）
      if (s.phase === 2) {
        s.summon2 -= dt;
        if (s.summon2 <= 1e-9) {
          const sk = skillOf(e, 'SummonBldbld2');
          s.summon2 = cdOf(sk, 12);
          castSkill(battle, e, sk);
          const pos = tileNearAlly(battle, [e.tileR, e.tileC], 2);
          battle.spawnEnemy(SUMMON_BLDBLD, { pos, ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
          battle.fx('summon', { x: pos[1], y: pos[0], id: e.id, key: SUMMON_BLDBLD, n: 1 });
        }
      }
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
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'ext:bldkgt_reborn', duration: BLDKGT_REVIVE_DURATION, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: BLDKGT_REVIVE_DURATION, kind: 'reborn', id: e.id, form: 'reborn' });
  });
  // 凝血之刃：接触血骑士后消失并回复 10% 生命上限
  battle.on('tick', (c) => {
    const list = (battle.enemies || []).filter((x) => x.alive && x.defId === SUMMON_BLDBLD);
    if (!list.length) return;
    const boss = (battle.enemies || []).find((x) => x.alive && x.defId === BOSS_BLDKGT);
    if (!boss) return;
    for (const blade of list) {
      const d2 = (blade.x - boss.x) ** 2 + (blade.y - boss.y) ** 2;
      if (d2 <= 1.1 ** 2) {
        const heal = boss.s.maxHp * talentOf(boss, 'Devour.hp_ratio', 0.1);
        battle.heal(boss, boss, heal, { self: true });
        battle.fx('heal', { x: boss.x, y: boss.y, id: boss.id });
        battle.kill(blade, boss); // 凝血之刃消失（target, source）
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// “酒神”：常态隐匿；【戏剧化】（官方口径）——每当我方单位神经损伤爆发，短暂延迟后对其周围 4 格的我方单位
// 造成伤害并施加神经损伤；生命归零 ⇒ 重生（Reborn.duration 20 s）。

const DIRCTR_BURST_DELAY = 2;

function installDirctr(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_DIRCTR) return;
    battle.addBuff(e, { key: 'ext:dirctr_stealth', persist: true, visible: true, flags: { stealth: true } });
    // 【未曾领悟】：来源不在摄影区域内 ⇒ 物理/法术伤害降低至 30%。本模式没有摄影机 ⇒ 恒成立
    battle.addBuff(e, { key: 'ext:dirctr_unknowing', persist: true, visible: true, mods: { physTakenMul: 0.3, artsTakenMul: 0.3 } });
    bossStore(battle).dirctr.set(e, { reborn: false, form2: false });
  });
  // 第一/第二形态普攻附带 30%/40% 攻击的神经损伤
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_DIRCTR || c.isSkill) return;
    const s = bossStore(battle).dirctr.get(a);
    const ratio = s && s.form2 ? 0.4 : 0.3;
    for (const t of c.targets || []) {
      if (t && t.alive) battle.dealDamage(a, t, { amount: a.s.atk * ratio, type: 'element', element: 'neural', canDodge: false, tags: ['enemyAbility'] });
    }
  });
  battle.on('elementBurst', (c) => {
    const target = c && c.target;
    if (!target || target.side !== 'ally') return;
    const bosses = liveEnemies(battle, BOSS_DIRCTR);
    if (!bosses.length) return;
    battle.after(DIRCTR_BURST_DELAY, () => {
      const b = bosses.find((x) => x.alive);
      if (!b) return;
      const st = bossStore(battle).dirctr.get(b);
      const p2 = !!(st && st.form2);
      const radius = p2 ? 2 : 1;          // 4 格 / 8 格
      const scale = p2 ? 0.7 : 0.3;       // 70% / 30% 攻击
      for (const u of alliesAroundBox(battle, target.tileR, target.tileC, radius)) {
        battle.fx('explode', { x: u.x, y: u.y, r: 0.5, kind: 'dirctrDrama', id: b.id });
        battle.dealDamage(b, u, { amount: b.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
        // 神经损伤：元素损伤的唯一对外入口是 dealDamage 的 element 通道（bonds/dataDriven 同一条）
        if (u.alive) battle.dealDamage(b, u, { amount: b.s.atk * 0.4, type: 'element', element: 'neural', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
      }
    });
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_DIRCTR) return;
    const s = bossStore(battle).dirctr.get(e);
    if (!s || s.reborn) return;
    s.reborn = true;
    const dur = Math.max(0.1, talentOf(e, 'Reborn.duration', 20));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    battle.addBuff(e, {
      key: 'ext:dirctr_reborn', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        s.form2 = true;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        // 第二形态：攻击半径 +3.0，普攻神经损伤 40%，重生后 10s 无敌
        e.base.rangeRadius = (e.base.rangeRadius || 0) + 3;
        const inv = talentOf(e, 'Reborn.invincible', 10);
        if (inv > 0) b.addBuff(e, { key: 'ext:dirctr_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        b.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// “望”：击倒 ⇒ 重生（Reborn.duration 30 s）：期间每 RebornSpawn.interval 30 s 部署一枚“瑕”，【落】每次
// 我方部署单位时在其周围落一枚“瑕”；重生后第二形态（无敌 Reborn.invincible_duration 60 s + FinalAttributeUp）。

const WANG_XIA_INTERVAL = 30;

function spawnXia(battle, e) {
  // 【落】：随机选一个未部署地块，优先我方单位周围四格（本模式取「我方周围两格」[ASSUMED]）
  const pos = tileNearAlly(battle, [e.tileR, e.tileC], 2);
  const u = battle.spawnEnemy(SUMMON_XIA, { pos, ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null });
  if (u) battle.fx('summon', { x: u.x, y: u.y, id: e.id, key: SUMMON_XIA, n: 1 });
  return u;
}

function installDywqgs(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_DYWQGS) return;
    // 初始形态：无敌 + 自缚 + 仅阻挡攻击，出场 40s 后进入第一形态
    battle.addBuff(e, { key: 'ext:wang_initial', persist: true, visible: true, flags: { invulnerable: true, untargetable: true, noMove: true } });
    e.profile.dmgType = 'arts';
    castSkill(battle, e, skillOf(e, 'StartBattle')); // 官方开场技能：自缚 / 初始形态的动作与特效
    bossStore(battle).wang.set(e, { reborn: false, rebornLeft: 0, xiaLeft: WANG_XIA_INTERVAL, form2: false, initialLeft: 40, fall: icdOf(skillOf(e, 'SiegeChess1')) });
  });
  // 【落】：每次我方部署单位时，在该单位周围落一枚“瑕”（官方 25/25 技能之外的被动触发）
  battle.on('deploy', (ctx) => {
    const u = ctx && ctx.unit;
    if (!u || u.side !== 'ally') return;
    const wang = liveEnemies(battle, BOSS_DYWQGS)[0];
    if (!wang) return;
    spawnXia(battle, wang);
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.wang.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.wang) {
      if (!e.alive) { st.wang.delete(e); continue; }
      if (s.initialLeft > 0) {
        s.initialLeft -= dt;
        if (s.initialLeft <= 1e-9) {
          s.initialLeft = 0;
          battle.removeBuff(e, 'ext:wang_initial');
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'M1' });
        }
      }
      if (!s.reborn) {
        // 落（SiegeChess1 25/25）：每 25s 随机落一枚瑕
        s.fall -= dt;
        if (s.fall <= 1e-9) {
          const sk = skillOf(e, 'SiegeChess1');
          s.fall = cdOf(sk, 25);
          castSkill(battle, e, sk);
          spawnXia(battle, e);
        }
        continue;
      }
      // 第二形态：被“瑕”围住的可部署地块不断生成敌人（[ASSUMED] 场上瑕 ≥4 时每 5 s 在瑕旁生成一只）
      if (s.form2) {
        s.nest = (s.nest ?? 5) - dt;
        if (s.nest <= 1e-9) {
          s.nest = 5;
          const xias = liveEnemies(battle, SUMMON_XIA);
          if (xias.length >= 4) {
            const x = battle.rng.pick(xias);
            const pos = tileNear(battle, x.tileR, x.tileC, 1);
            const u = battle.spawnEnemy(SUMMON_NBKGHT, { pos, ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null, countInTotal: false });
            if (u) battle.fx('summon', { x: u.x, y: u.y, id: e.id, key: SUMMON_NBKGHT, n: 1 });
          }
        }
      }
      s.rebornLeft -= dt;
      s.xiaLeft -= dt;
      if (s.xiaLeft <= 1e-9) {
        s.xiaLeft = Math.max(1, talentOf(e, 'RebornSpawn.interval', WANG_XIA_INTERVAL));
        spawnXia(battle, e);
      }
      if (s.rebornLeft <= 1e-9) {
        s.reborn = false;
        s.form2 = true;
        castSkill(battle, e, skillOf(e, 'SwitchFinalMode')); // 最终形态：官方动作 / 特效
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        const inv = talentOf(e, 'Reborn.invincible_duration', 60);
        if (inv > 0) battle.addBuff(e, { key: 'ext:wang_inv', duration: inv, visible: true, flags: { invulnerable: true } });
        battle.addBuff(e, {
          key: 'ext:wang_form2', persist: true, visible: true,
          mods: { aspd: talentOf(e, 'FinalAttributeUp.attack_speed', 100), atkPct: talentOf(e, 'FinalAttributeUp.attack@atk_scale', 1) - 1 },
        });
        e.profile.maxTargets = Math.max(1, Math.floor(talentOf(e, 'FinalAttributeUp.attack@max_target', 3)));
        e.base.rangeRadius = 99; // 【征】：第二形态全图攻击
        // 官方：进入第二形态时连续部署多枚“瑕”（[ASSUMED] 取 3 枚）
        for (let i = 0; i < 3; i++) spawnXia(battle, e);
        spawnXia(battle, e);
        battle.removeBuff(e, 'ext:wang_reborn');
        battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_DYWQGS) return;
    const s = bossStore(battle).wang.get(e);
    if (!s || s.reborn || s.form2) return; // 最终形态被击倒 ⇒ 直接结束（不再重生）
    s.reborn = true;
    s.rebornLeft = Math.max(0.1, talentOf(e, 'Reborn.duration', 30));
    s.xiaLeft = Math.max(1, talentOf(e, 'RebornSpawn.interval', WANG_XIA_INTERVAL));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'ext:wang_reborn', duration: s.rebornLeft, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: s.rebornLeft, kind: 'reborn', id: e.id, form: 'reborn' });
  });
  // 官方：当场上最后一枚“瑕”被击退时，望自身同时退场（仅第二形态）
  battle.on('kill', (c) => {
    const u = c && c.victim;
    if (!u || u.defId !== SUMMON_XIA) return;
    battle.after(0.05, () => {
      const wang = (battle.enemies || []).find((x) => x && x.alive && x.defId === BOSS_DYWQGS);
      if (!wang) return;
      const s2 = bossStore(battle).wang.get(wang);
      if (!s2 || !s2.form2) return;
      if ((battle.enemies || []).some((x) => x && x.alive && x.defId === SUMMON_XIA)) return;
      battle.fx('telegraph', { x: wang.x, y: wang.y, r: 1, dur: 1, kind: 'wangExit', id: wang.id });
      battle.kill(wang, null);
    }, { owner: u });
  });
  // 瑕：只有**激活状态**（处在“望”1.6 半径内）才能普攻——对四格一个目标 100% 攻击法术 + 1s 晕眩；
  // 每枚激活的瑕让“望”每秒回 2% 最大生命，并获得 1 层 -20% 受伤（一形态最多 4 层，最终形态最多 10 层）。
  battle.on('tick', (c) => {
    const xias = (battle.enemies || []).filter((x) => x.alive && x.defId === SUMMON_XIA);
    if (!xias.length) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    const wangs = (battle.enemies || []).filter((x) => x.alive && x.defId === BOSS_DYWQGS);
    for (const x of xias) {
      x._extAcc = (x._extAcc ?? 0) + dt;
      if (x._extAcc < 1) continue;
      x._extAcc -= 1;
      const near = wangs.find((w) => (w.x - x.x) ** 2 + (w.y - x.y) ** 2 <= talentOf(x, 'ActiveChessDamage.range_radius', 1.6) ** 2);
      if (near) {
        const cands = alliesAroundBox(battle, x.tileR, x.tileC, 1);
        if (cands.length) {
          const t = battle.rng.pick(cands);
          battle.fx('beam', { from: [x.x, x.y], to: [t.x, t.y], kind: 'xia' });
          battle.dealDamage(x, t, { amount: x.s.atk, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
          if (t.alive) battle.applyStatus(t, 'stun', { duration: 1, source: x });
        }
      }
    }
    for (const w of wangs) {
      const s = bossStore(battle).wang.get(w);
      if (!s) continue;
      const active = xias.filter((x) => (w.x - x.x) ** 2 + (w.y - x.y) ** 2 <= talentOf(x, 'ActiveChessDamage.range_radius', 1.6) ** 2).length;
      if (!active) { battle.removeBuff(w, 'ext:wang_shield'); continue; }
      const cap = s.form2 ? 10 : 4;
      const n = Math.min(cap, active);
      battle.removeBuff(w, 'ext:wang_shield');
      battle.addBuff(w, { key: 'ext:wang_shield', persist: true, visible: true, mods: { physTakenMul: Math.max(0, 1 - 0.2 * n), artsTakenMul: Math.max(0, 1 - 0.2 * n) } });
      // 每秒 2% 最大生命（按激活数）
      w.hp = Math.min(w.s.maxHp, w.hp + w.s.maxHp * 0.02 * active * dt);
      w.markDirty();
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 莫菲丝：红线（EnemyLineT：连线最远我方，每 0.4 s atk×0.5 法术；每根有效线 +25% 攻击）；屏障（Shield.dynamic_ratio
// 10% 生命上限，每 8 s 续）；击倒 ⇒ 重生（Reborn.duration 10 s）⇒ 第二形态（攻击 +10%、攻击间隔 −0.2、范围全场）。

function installLdevil(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_LDEVIL) return;
    bossStore(battle).morphis.set(e, { red: 18, evolve: 20, phase: 1, reborn: false, rebornLeft: 0 });
  });
  battle.on('damaged', (c) => {
    const t = c && c.target;
    const amount = c && c.amount;
    if (!t || t.defId !== BOSS_LDEVIL || !(amount > 0)) return;
    const st = bossStore(battle).morphis.get(t);
    // 【感官的剥离】：丝线连向敌方单位，使其分担莫菲丝受到的伤害（damage_share 0.65 / 第二形态 0.7）
    const share = st && st.phase === 2
      ? talentOf(t, 'EnemyLineAdvanceT.damage_share', 0.7)
      : talentOf(t, 'EnemyLineT.damage_share', 0.65);
    const others = (battle.enemies || []).filter((x) => x && x.alive && x !== t && x.defId !== BOSS_LDEVIL);
    if (!others.length || !(share > 0)) return;
    const part = Math.min(amount, amount * share);
    t.hp = Math.min(t.s.maxHp, t.hp + part); // 先把被分担的那一份补回自己
    t.markDirty();
    const per = part / others.length;
    for (const o of others) battle.loseHp(o, per, { sourceless: true, noHitLimit: true, from: c.dmg });
    battle.fx('beam', { x: t.x, y: t.y, from: t.id, to: others[0].id, kind: 'morphisShare' });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.morphis.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.morphis) {
      if (!e.alive) { st.morphis.delete(e); continue; }
      if (s.reborn) {
        s.rebornLeft -= dt;
        // 重生形态：线性回满，每 hit_interval 4 s 对最高生命者 atk×0.5 法术
        e.hp = Math.min(e.s.maxHp, e.hp + e.s.maxHp * (dt / Math.max(0.1, talentOf(e, 'Reborn.duration', 10))));
        s.hitAcc = (s.hitAcc ?? talentOf(e, 'Reborn.hit_interval', 4)) - dt;
        if (s.hitAcc <= 1e-9) {
          s.hitAcc = talentOf(e, 'Reborn.hit_interval', 4);
          const best = battle.allies().filter((u) => u.alive).sort((a, b2) => b2.s.maxHp - a.s.maxHp)[0];
          if (best) battle.dealDamage(e, best, { amount: e.s.atk * 0.5, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
        }
        if (s.rebornLeft <= 1e-9) {
          s.reborn = false;
          s.phase = 2;
          e.profile.noAttack = false;
          e.hp = e.s.maxHp;
          e.atkCd = 0;
          battle.removeBuff(e, 'ext:morphis_reborn');
          // 图鉴「攻击间隔 −0.2 s」以攻速加算键近似（bat 2.8 s ⇒ +7.1%）
          battle.addBuff(e, { key: 'ext:morphis_form2', persist: true, visible: true, mods: { atkPct: 0.1, aspd: 7.14 } });
          e.base.rangeRadius = 99;
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
        }
        continue;
      }
      if (!canAct(battle, e)) continue;
      // 红线：连线最远的我方（持续伤害 + 每线 +25% 攻击）
      s.red -= dt;
      if (s.red <= 1e-9) {
        s.red = 18;
        const cands = battle.allies().filter((u) => u.alive && !u.hidden);
        let best = null, bestD = -1;
        for (const u of cands) {
          const d = (u.x - e.x) ** 2 + (u.y - e.y) ** 2;
          if (d > bestD) { bestD = d; best = u; }
        }
        if (best) {
          battle.addBuff(best, {
            key: 'ext:morphis_red', duration: talentOf(e, 'RedLine.duration', 10), visible: true, source: e, interval: talentOf(e, 'RedLine.interval', 0.4),
            onTick: ({ battle: b, unit }) => {
              b.dealDamage(e.alive ? e : null, unit, { amount: e.s.atk * talentOf(e, 'RedLine.atk_scale', 0.5), type: 'arts', canDodge: false, tags: ['enemyAbility'] });
            },
          });
          const lines = e.findBuff('ext:morphis_lines');
          if (lines) battle.removeBuff(e, 'ext:morphis_lines');
          battle.addBuff(e, { key: 'ext:morphis_lines', duration: talentOf(e, 'EnemyLineT.duration', 40), refresh: 'extend', visible: true, mods: { atkPct: talentOf(e, 'EnemyLineT.atk', 0.25) } });
        }
      }
      // 屏障：每 8 s 按 dynamic_ratio 续一层
      s.shieldAcc = (s.shieldAcc ?? talentOf(e, 'Shield.interval', 8)) - dt;
      if (s.shieldAcc <= 1e-9) {
        s.shieldAcc = talentOf(e, 'Shield.interval', 8);
        const ratio = talentOf(e, 'Shield.dynamic_ratio', 0.1);
        if (ratio > 0 && !e.findBuff('ext:morphis_shield')) {
          battle.addBuff(e, { key: 'ext:morphis_shield', duration: 8, visible: true, mods: { shield: e.s.maxHp * ratio } });
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_LDEVIL) return;
    const s = bossStore(battle).morphis.get(e);
    if (!s || s.reborn) return;
    s.reborn = true;
    s.rebornLeft = Math.max(0.1, talentOf(e, 'Reborn.duration', 10));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    for (const u of battle.allies()) if (u.findBuff && u.findBuff('ext:morphis_red')) battle.removeBuff(u, 'ext:morphis_red');
    battle.addBuff(e, { key: 'ext:morphis_reborn', duration: s.rebornLeft, visible: true, persist: true, flags: { invulnerable: true, untargetable: true, noMove: true, stun: true } });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: s.rebornLeft, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// “不死的黑蛇”：攻击真实伤害并施加【烈焚灼息】（每秒递增真伤）；周期点燃两名我方；引爆把火传给四格；
// 击倒 ⇒【不息恶火】全场法术伤害 + 狂暴（生命/攻击大幅提升 + 无敌窗口）。

function applyBsnameFire(battle, e, target) {
  if (!target || !target.alive || target.findBuff('ext:bsnake_fire')) return;
  const base = talentOf(e, 'fire.attack@dragon_fire.baseDamage', 50);
  const addOn = talentOf(e, 'fire.attack@dragon_fire.addOnDamage', 180);
  const addOnDur = Math.max(1, talentOf(e, 'fire.attack@dragon_fire.addOnDuration', 30));
  let elapsed = 0;
  battle.addBuff(target, {
    key: 'ext:bsnake_fire', duration: talentOf(e, 'fire.attack@dragon_fire.duration', 30.5),
    visible: true, source: e, interval: 1,
    onTick: ({ battle: b, unit }) => {
      elapsed += 1;
      b.dealDamage(e.alive ? e : null, unit, { amount: base + addOn * Math.min(1, elapsed / addOnDur), type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    },
  });
}

/** 【不息恶火】：每 interval 秒从场地左侧放一列向右的火球（每行一个，命中该行最左的我方），共 cnt 次。 */
function bsnameFirestorm(battle, e) {
  const sk = skillOf(e, 'ScreenAttack');
  const cnt = Math.max(1, Math.round(skNum(sk, 'trig_cnt', 10)));
  const interval = Math.max(0.1, skNum(sk, 'interval', 2));
  const scale = skNum(sk, 'atk_scale', 1);
  for (let i = 1; i <= cnt; i++) {
    battle.after(interval * i, () => {
      if (!e.alive) return;
      castSkill(battle, e, sk);
      const rows = [...new Set(battle.allies().filter((a) => a.alive && !a.hidden).map((a) => Math.round(a.tileR)))];
      for (const r of rows) {
        const t = battle.allies().filter((a) => a.alive && !a.hidden && Math.round(a.tileR) === r)
          .sort((a, b) => a.tileC - b.tileC)[0];
        if (!t) continue;
        battle.fx('beam', { from: [battle.rect.c0 - 0.5, t.y], to: [t.x, t.y], kind: 'bsnakeFire', id: e.id });
        battle._ev(['atk', e.id, t.id, 'arts']);
        battle.dealDamage(e, t, { amount: e.s.atk * scale, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
      }
    }, { owner: e });
  }
}

function installBsname(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_BSNAKE) return;
    bossStore(battle).bsnake.set(e, {
      ignite: icdOf(skillOf(e, 'Ignite')), explode: icdOf(skillOf(e, 'DragonFireExplode')),
      summon: icdOf(skillOf(e, 'SummonFlame')), phase: 'snake', death: 0, rageStart: 0,
    });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_BSNAKE || c.isSkill) return;
    const s = bossStore(battle).bsnake.get(a);
    if (!s || s.phase !== 'snake') return;
    for (const t of c.targets || []) applyBsnameFire(battle, a, t);
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.bsnake.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.bsnake) {
      if (!e.alive) { st.bsnake.delete(e); continue; }
      if (s.phase === 'reborn' || s.phase === 'dying') continue;
      if (s.phase === 'berserk') {
        // 召唤能量聚合体[狂暴状态] 75/50
        s.summon -= dt;
        if (s.summon <= 1e-9) {
          const sk = skillOf(e, 'SummonFlame');
          s.summon = cdOf(sk, 50);
          castSkill(battle, e, sk);
          spawnSummon(battle, e, SUMMON_ENERGY, tileNearAlly(battle, [e.tileR, e.tileC], 2));
        }
        continue;
      }
      if (!canAct(battle, e)) continue;
      s.ignite -= dt;
      if (s.ignite <= 1e-9) {
        const sk = skillOf(e, 'Ignite');
        s.ignite = cdOf(sk, 19);
        const free = battle.allies().filter((u) => u.alive && !u.hidden && !u.findBuff('ext:bsnake_fire'));
        const picks = [];
        while (picks.length < 2 && free.length) picks.push(...free.splice(battle.rng.int ? battle.rng.int(free.length) : 0, 1));
        if (picks.length) castSkill(battle, e, sk);
        // 点燃的官方命中帧 = Skill_1_A 的 1.167 s
        battle.after(1.167, () => {
          if (!e.alive || !picks.length) return;
          battle._ev(['atk', e.id, picks[0].id, 'arts']);
          for (const u of picks) if (u.alive) applyBsnameFire(battle, e, u);
        }, { owner: e });
      }
      // 引爆 35/35：目标 100% 法术 → 结束其火 → 目标格+四格（不含目标）100% 法术并重新挂火
      s.explode -= dt;
      if (s.explode <= 1e-9) {
        const sk = skillOf(e, 'DragonFireExplode');
        castSkill(battle, e, sk);
        s.explode = cdOf(sk, 35);
        const scale = skNum(sk, 'atk_scale', 1);
        // 引爆的官方命中帧 = Skill_2_A 的 1.033 s
        battle.after(1.033, () => {
          if (!e.alive) return;
          const targets = alliesWith(battle, 'ext:bsnake_fire');
          if (!targets.length) return;
          battle._ev(['atk', e.id, targets[0].id, 'arts']);
          for (const u of targets) {
            battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
            battle.removeBuff(u, 'ext:bsnake_fire');
            for (const o of alliesInBox(battle, u.tileR, u.tileC, 1)) {
              if (o === u) continue;
              battle.dealDamage(e, o, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
              if (o.alive) applyBsnameFire(battle, e, o);
            }
          }
        }, { owner: e });
      }
      // 召唤能量聚合体[狂暴状态] 75/50：本模式把「狂暴状态」理解为第二次死亡后的不息恶火窗口
      // （能量聚合体的 25s 自爆在阶段循环里作为狂暴期的场面压力 [ASSUMED]）
    }
  });
  // 能量聚合体：25s 自爆，向四方向发火球（首个命中的我方 1000 法术 + 烈焚灼息）
  battle.on('tick', (c) => {
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const u of liveEnemies(battle, SUMMON_ENERGY)) {
      u._extFuse = (u._extFuse ?? 0) + dt;
      if (u._extFuse < 25) continue;
      u._extFuse = 0;
      const snake = liveEnemies(battle, BOSS_BSNAKE)[0] || null;
      battle.fx('explode', { x: u.x, y: u.y, r: 2, kind: 'bsnakeFire', id: u.id });
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        // 四方向：同行/同列里最近的一个
        const t = battle.allies().filter((a) => a.alive && !a.hidden)
          .filter((a) => (dr === 0 ? Math.round(a.tileR) === Math.round(u.tileR) : Math.round(a.tileC) === Math.round(u.tileC)))
          .sort((a, b) => Math.abs(a.x - u.x) + Math.abs(a.y - u.y) - (Math.abs(b.x - u.x) + Math.abs(b.y - u.y)))[0];
        if (!t) continue;
        battle.fx('beam', { from: [u.x, u.y], to: [t.x, t.y], kind: 'bsnakeFire', id: u.id });
        battle.dealDamage(snake, t, { amount: 1000, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
        if (t.alive && snake) applyBsnameFire(battle, snake, t);
      }
      battle.kill(u, snake);
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_BSNAKE) return;
    const s = bossStore(battle).bsnake.get(e);
    if (!s || s.death >= 2) return;
    s.death += 1;
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    if (s.death === 1) {
      // 首次被击败：5s 重生回满 → 狂暴（HP+50% ATK+50%）→ 不息恶火 → 28s 后回黑蛇形态 + 15s 无敌
      s.phase = 'reborn';
      battle.addBuff(e, {
        key: 'ext:bsnake_reborn', duration: 5, visible: true, persist: true,
        flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
        onExpire: ({ battle: b }) => {
          if (!e.alive) return;
          s.phase = 'berserk';
          s.rageStart = b.time;
          b.addBuff(e, { key: 'ext:bsnake_rage', persist: true, visible: true, mods: { hpMul: 0.5, atkPct: 0.5 } });
          e.hp = e.s.maxHp;
          e.markDirty();
          b.addBuff(e, { key: 'ext:bsnake_inv', persist: true, visible: true, flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true } });
          b.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'rage' });
          bsnameFirestorm(b, e);
          b.after(28, () => {
            if (!e.alive) return;
            s.phase = 'snake';
            b.removeBuff(e, 'ext:bsnake_inv');
            b.addBuff(e, { key: 'ext:bsnake_inv2', duration: 15, visible: true, flags: { invulnerable: true } });
            e.profile.noAttack = false;
            e.hp = e.s.maxHp;
            e.atkCd = 0;
            s.ignite = icdOf(skillOf(e, 'Ignite'));
            s.explode = icdOf(skillOf(e, 'DragonFireExplode'));
            b.fx('revive', { x: e.x, y: e.y, id: e.id, form: null });
          }, { owner: e });
        },
      });
      battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: 5, kind: 'reborn', id: e.id, form: 'reborn' });
    } else {
      // 第二次被击败：不退场，5s 后消失并再次释放【不息恶火】，28s 后退场
      s.phase = 'dying';
      battle.addBuff(e, {
        key: 'ext:bsnake_dying', duration: 5, visible: true, persist: true,
        flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
        onExpire: ({ battle: b }) => {
          if (!e.alive) return;
          b.addBuff(e, { key: 'ext:bsnake_inv', persist: true, visible: true, flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true } });
          bsnameFirestorm(b, e);
          b.after(28, () => { if (e.alive) b.kill(e, null); }, { owner: e });
        },
      });
      battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur: 5, kind: 'reborn', id: e.id, form: 'reborn' });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 奎隆，摩诃萨埵权化（三阶段官方口径）：
//   入定：无敌+自缚+不可阻挡、不普攻；每 M0_T1(25s) 召尼卢火、M0_T2(55s) 召波次；不着相 95s ⇒ 自在。
//   自在：普攻每命中一次触发【怒目】；每 M1_T1(35s) 尼卢火、M1_T2(38s) 波次；HP ≤75/50/25% 强制【承三身】。
//   承三身：施法期间无敌+自缚，召托生莲座；任一莲座退场即结束。
//   首次击倒：7.33s 重生回满 → 杀场上其他敌人 → 无忧觉（普攻2连击，每段触发怒目；M3_T1 10s 尼卢火）。
//   尼卢火：我方装置（不可选中/不死），50s；每存在1个奎隆受物理/法术伤害降低至80%（乘算）。
//   怒目：以每个尼卢火为中心，十字范围 100% 攻击法术（无视不可选中）。

/** 【怒目】：以场上每个尼卢火为中心，十字四格的我方各吃一次 100% 攻击法术。 */
function skzjklWrath(battle, e) {
  const nilus = liveEnemies(battle, SUMMON_NILU);
  if (!nilus.length) return;
  for (const n of nilus) {
    battle.fx('explode', { x: n.x, y: n.y, r: 1, kind: 'niluWrath', id: e.id });
    const tiles = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dr, dc] of tiles) {
      for (const a of battle.allies()) {
        if (!a.alive || a.hidden) continue;
        if (Math.round(a.tileR) !== Math.round(n.tileR) + dr || Math.round(a.tileC) !== Math.round(n.tileC) + dc) continue;
        battle.dealDamage(e, a, { amount: e.s.atk, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'wrath'] });
      }
    }
  }
}

/** 尼卢火：50s 或回满生命后退场；退场时攻击最高干员 ATK-50%/50s，并对其周围 3500 法术。 */
function niluTick(battle, dt) {
  for (const n of liveEnemies(battle, SUMMON_NILU)) {
    n._extLife = (n._extLife ?? 0) + dt;
    // 出场流失 100% 生命（本站记为 hp=1），5s 保护期内不会被【怒目】响应；回满即退场
    const full = n._extLife > 5 && n.hp >= n.s.maxHp - 1e-9;
    if (n._extLife < 50 && !full) continue;
    const boss = liveEnemies(battle, BOSS_SKZJKL)[0] || null;
    const top = alliesByAtk(battle)[0];
    if (top) {
      battle.addBuff(top, { key: 'ext:nilu_atkdown', duration: 50, visible: true, mods: { atkPct: -0.5 } });
      battle.fx('explode', { x: n.x, y: n.y, r: 1, kind: 'niluEnd', id: n.id });
      for (const a of battle.alliesInRadius(n.x, n.y, 1)) {
        if (a.alive) battle.dealDamage(boss, a, { amount: 3500, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
      }
    }
    battle.kill(n, boss);
  }
}

function installSkzjkl(battle) {
  battle.on('enemySpawn', (c) => {
    const n = c && c.enemy;
    if (n && n.defId === SUMMON_NILU) {
      // 尼卢火属于我方单位：不可选中、不死（我方治疗回满即退场）
      battle.addBuff(n, { key: 'ext:nilu_untargetable', persist: true, visible: true, flags: { invulnerable: true, untargetable: true } });
      n.profile.noAttack = true;
      n.hp = 1;          // 出场流失 100% 生命值
      n._extLife = 0;
      return;
    }
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SKZJKL) return;
    const s = bossStore(battle);
    // 入定阶段：无敌 + 自缚 + 不可阻挡 + 不普攻
    battle.addBuff(e, { key: 'ext:skz_meditate', persist: true, visible: true, flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true } });
    e.profile.noAttack = true;
    s.skzjkl.set(e, {
      phase: 'meditate', t1: talentOf(e, 'M0_T1.interval', 25), t2: talentOf(e, 'M0_T2.interval', 55),
      switchAt: icdOf(skillOf(e, 'M0SwitchMode')), five: icdOf(skillOf(e, 'M1MultiAttack')),
      clean: icdOf(skillOf(e, 'M0TriggerSkzth')), threshold: [], reborn: false, lotus: false, death: 0,
    });
  });
  // 怒目：自在/无忧觉阶段每次普攻命中都会触发一次
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_SKZJKL || c.isSkill) return;
    const s = bossStore(battle).skzjkl.get(a);
    if (!s || s.phase === 'meditate' || s.phase === 'lotus') return;
    const segs = s.phase === 'carefree' ? 2 : 1;
    for (let i = 0; i < segs; i++) skzjklWrath(battle, a);
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.skzjkl || !st.skzjkl.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    niluTick(battle, dt);
    // 尼卢火减伤：每存在 1 个，奎隆受到的物理/法术伤害降低至 80%（乘算）
    const nilus = liveEnemies(battle, SUMMON_NILU).length;
    for (const [e, s] of st.skzjkl) {
      if (!e.alive) { st.skzjkl.delete(e); continue; }
      const mul = Math.pow(0.8, nilus);
      battle.removeBuff(e, 'ext:skz_nilumit');
      if (nilus > 0) battle.addBuff(e, { key: 'ext:skz_nilumit', persist: true, visible: true, mods: { physTakenMul: mul, artsTakenMul: mul } });
      if (s.phase === 'meditate') {
        s.switchAt -= dt;
        s.t1 -= dt;
        s.t2 -= dt;
        if (s.t1 <= 1e-9) { s.t1 = talentOf(e, 'M0_T1.interval', 25); spawnSummon(battle, e, SUMMON_NILU, tileNearAlly(battle, [e.tileR, e.tileC], 2)); }
        if (s.switchAt <= 1e-9) {
          // 不着相（M0SwitchMode 95/95）⇒ 自在阶段
          const sk = skillOf(e, 'M0SwitchMode');
          castSkill(battle, e, sk);
          s.phase = 'free';
          battle.removeBuff(e, 'ext:skz_meditate');
          e.profile.noAttack = false;
          s.t1 = talentOf(e, 'M1_T1.interval', 35);
          s.t2 = talentOf(e, 'M1_T2.interval', 38);
          s.five = icdOf(skillOf(e, 'M1MultiAttack'));
          s.clean = icdOf(skillOf(e, 'M0TriggerSkzth'));
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'M1' });
        }
        continue;
      }
      if (s.phase === 'lotus') {
        // 承三身：任一托生莲座退场即结束
        if (!liveEnemies(battle, SUMMON_LOTUS).length) {
          s.lotus = false;
          s.phase = 'free';
          battle.removeBuff(e, 'ext:skz_lotus');
          e.profile.noAttack = false;
          s.t1 = talentOf(e, 'M1_T1.interval', 35);
        }
        continue;
      }
      if (!canAct(battle, e)) continue;
      // 承三身：HP 首次 ≤75%/50%/25%
      const ratio = e.hpRatio;
      if (s.phase === 'free' && !s.lotus) {
        for (const th of [0.75, 0.5, 0.25]) {
          if (ratio > th || s.threshold.includes(th)) continue;
          s.threshold.push(th);
          const sk = skillOf(e, 'M1SummonSkzjbc');
          castSkill(battle, e, sk);
          spawnSummon(battle, e, SUMMON_LOTUS, tileNearAlly(battle, [e.tileR, e.tileC], 2));
          s.lotus = true;
          s.phase = 'lotus';
          e.profile.noAttack = true;
          battle.addBuff(e, { key: 'ext:skz_lotus', persist: true, visible: true, flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true } });
          break;
        }
        if (s.lotus) continue;
      }
      // 清火执（M0TriggerSkzth）：触发一次怒目
      s.clean -= dt;
      if (s.clean <= 1e-9) {
        const sk = skillOf(e, 'M0TriggerSkzth');
        s.clean = cdOf(sk, 30);
        castSkill(battle, e, sk);
        skzjklWrath(battle, e);
      }
      // 尼卢火
      s.t1 -= dt;
      if (s.t1 <= 1e-9) {
        s.t1 = s.phase === 'carefree' ? talentOf(e, 'M3_T1.interval', 10) : talentOf(e, 'M1_T1.interval', 35);
        spawnSummon(battle, e, SUMMON_NILU, tileNearAlly(battle, [e.tileR, e.tileC], 2));
      }
      // 惩五戒（M1/M3MultiAttack）：连续5击，每击触发一次怒目，100% 物理
      s.five -= dt;
      if (s.five <= 1e-9) {
        const sk = skillOf(e, s.phase === 'carefree' ? 'M3MultiAttack' : 'M1MultiAttack') || skillOf(e, 'M1MultiAttack');
        s.five = cdOf(sk, 20);
        const t = alliesByAtk(battle)[0];
        if (!t) continue;
        castSkill(battle, e, sk);
        const scale = skNum(sk, 'atk_scale', 1);
        // 惩五戒的官方五段命中帧（B_Skill_2 的 OnAttack）：0.767 / 1.3 / 2 / 2.367 / 3.967 s
        for (const at of [0.767, 1.3, 2, 2.367, 3.967]) {
          battle.after(at, () => {
            if (!e.alive || !t.alive) return;
            battle._ev(['atk', e.id, t.id, 'phys']);
            battle.dealDamage(e, t, { amount: e.s.atk * scale, type: 'phys', canDodge: false, tags: ['enemyAbility'] });
            skzjklWrath(battle, e);
          }, { owner: e });
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SKZJKL) return;
    const s = bossStore(battle).skzjkl.get(e);
    if (!s || s.reborn || s.death >= 1) return;
    s.death = 1;
    s.reborn = true;
    const dur = Math.max(0.1, talentOf(e, 'M1Reborn.duration', 7.33));
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    battle.addBuff(e, {
      key: 'ext:skz_reborn', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        // 重生结束：强制击杀场上其他敌人（含尼卢火）。干员侧保持存活 [ASSUMED：杀光干员会让本模式直接团灭]
        for (const o of (b.enemies || []).slice()) if (o.alive && o !== e) b.kill(o, e);
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        s.phase = 'carefree';
        s.threshold = [];
        s.t1 = talentOf(e, 'M3_T1.interval', 10);
        s.t2 = talentOf(e, 'M3_T2.interval', 20);
        s.five = icdOf(skillOf(e, 'M3MultiAttack'));
        b.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'M3' });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 伊莎玛拉：登场 30 s 后【change】变身（FetchAttributes 系数改属性）并每 bat 治疗 3 名最缺血敌方单位。

// 【变身】技力消耗 120（SP 自动回复 1/s ⇒ 120s）[ASSUMED：本模式不给首领建技力槽，按时间等价]
const SYSKAD_TRANSFORM_AT = 120;
const SYSKAD_HEAL_TARGETS = 3;

function installSyskad(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SYSKAD) return;
    // 初始形态：普攻是治疗（3 个目标、半径 20），不造成伤害
    e.profile.noAttack = true;
    bossStore(battle).syskad.set(e, { transformed: false, left: SYSKAD_TRANSFORM_AT, healAcc: 0, berserk: false, hpRecord: e.s.maxHp, reborn: false });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.syskad.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.syskad) {
      if (!e.alive) { st.syskad.delete(e); continue; }
      if (s.reborn) continue;
      if (!s.transformed) {
        // 生命值首次低于 50%：狂暴（攻击力 +50%，变身/重生均保留）
        if (!s.berserk && e.hpRatio < talentOf(e, 'Berserk.hp_ratio', 0.5)) {
          s.berserk = true;
          battle.addBuff(e, { key: 'ext:syskad_berserk', persist: true, visible: true, mods: { atkPct: talentOf(e, 'Berserk.atk', 0.5) } });
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'rage' });
        }
        // 普攻治疗：每 bat 治疗最缺血的 3 名敌方单位（半径 20）
        s.healAcc -= dt;
        if (s.healAcc <= 1e-9) {
          s.healAcc = e.s.bat;
          const hurt = (battle.enemies || []).filter((x) => x.alive && x.hpRatio < 1)
            .sort((a, b2) => a.hpRatio - b2.hpRatio).slice(0, SYSKAD_HEAL_TARGETS);
          for (const h of hurt) {
            battle.heal(e, h, e.s.atk, {});
            battle.fx('heal', { x: h.x, y: h.y, id: h.id });
          }
        }
        s.left -= dt;
        if (s.left <= 1e-9) {
          // 变身形态：恢复 100% 生命；HP×50% ATK×62.5% DEF×30% RES×50% 移速×80% 攻击间隔×50%
          s.transformed = true;
          s.hpRecord = e.hp;
          battle.addBuff(e, {
            key: 'ext:syskad_form2', persist: true, visible: true,
            mods: {
              hpMul: -0.5, atkPct: -0.375, defFlat: e.base.def * (0.3 - 1), resFlat: e.base.res * (0.5 - 1),
              moveMul: 0.8, aspd: 100, // 攻击间隔 ×50% ⇒ 攻速加算 +100
            },
          });
          e.profile.noAttack = false;
          e.profile.dmgType = 'true';
          e.profile.maxTargets = 3;
          e.base.rangeRadius = 4;
          e.hp = e.s.maxHp;
          e.atkCd = 0;
          e.markDirty();
          battle.fx('revive', { x: e.x, y: e.y, id: e.id, ...FORM2 });
        }
      }
    }
  });
  // 变身形态被击败：5s 重生回 2% → 切换回初始形态（生命值重设为记录的当前生命）
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SYSKAD) return;
    const s = bossStore(battle).syskad.get(e);
    if (!s || !s.transformed || s.reborn) return;
    s.reborn = true;
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    const dur = Math.max(0.1, talentOf(e, 'Reborn.duration', 5));
    battle.addBuff(e, {
      key: 'ext:syskad_reborn', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, noMove: true, stun: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        s.transformed = false;
        s.reborn = false;
        b.removeBuff(e, 'ext:syskad_form2');
        e.profile.noAttack = true;
        e.profile.dmgType = null;
        e.profile.maxTargets = 1;
        e.base.rangeRadius = 20;
        e.hp = Math.max(1, Math.min(e.s.maxHp, s.hpRecord));
        s.left = SYSKAD_TRANSFORM_AT;
        s.healAcc = 0;
        b.fx('revive', { x: e.x, y: e.y, id: e.id, form: null });
      },
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 1, dur, kind: 'reborn', id: e.id, form: 'reborn' });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 玻利瓦尔，症结之核（官方三形态）：
//   * 普攻附带降防（talents.bb DefReduce.def −100 固定防御）
//   * 一形态火球（Fireball cd 12：目标 atk×1.2 法术）
//   * 生命归零 ⇒【灾厄之口】（Fire：duration 20 s，无敌+不可选中；每 0.5 s 对场上生命最高者 atk×0.4 真伤、
//     对其余全体 atk×0.15 法术）⇒ 结束进入下一形态（reborn_N.atk / max_hp 成长，生命回满）
//   * 第三形态：每 Fly.duration 15 s 周期起飞（不可阻挡、不普攻、未熄之地更频繁 cd 4 s）
// 打断条件官方为摧毁“危朽/崩解”实体 —— 本模式没有那套实体 ⇒ 灾厄之口按时长跑完 [ASSUMED]。

function installShchmr(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SHCHMR) return;
    bossStore(battle).shchmr.set(e, { form: 1, ballis: icdOf(skillOf(e, 'Fireball')), fly: icdOf(skillOf(e, 'Fly')), flying: 0, jaw: false });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_SHCHMR || c.isSkill) return;
    const def = talentOf(a, 'DefReduce.def', -100);
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      battle.addBuff(t, { key: 'ext:shchmr_defdown', duration: 5, refresh: 'extend', visible: true, source: a, mods: { defFlat: def } });
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.shchmr.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.shchmr) {
      if (!e.alive) { st.shchmr.delete(e); continue; }
      if (s.jaw) continue; // 灾厄之口期间由其自身循环接管
      // (a) 火球（一/二形态 cd 12；三形态飞行中 cd 4）
      if (!s.flying || !canAct(battle, e)) {
        s.ballis -= dt;
        if (s.ballis <= 1e-9) {
          const sk = skillOf(e, s.flying ? 'Fireball_Fly' : 'Fireball') || skillOf(e, 'Fireball');
          s.ballis = cdOf(sk, 12);
          const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable);
          const t = cands.length ? battle.rng.pick(cands) : null;
          if (t) {
            castSkill(battle, e, sk);
            const scale = skNum(sk, 'atk_scale_main', 1.2);
            const dot = skNum(sk, 'atk_scale_dot', 0.15);
            battle.after(1, () => { // projectile_delay_time 官方 25（帧口径）⇒ 1 s 飞行 [ASSUMED]
              if (!e.alive || !t.alive) return;
              const ix = t.x, iy = t.y;
              battle.fx('explode', { x: ix, y: iy, r: 1, kind: 'shchmrFire' });
              battle._ev(["atk", e.id, t.id, "arts"]);
              battle.dealDamage(e, t, { amount: e.s.atk * scale, type: 'arts', canDodge: false, tags: ['enemyAbility'] });
              // 【未熄之地】：生成时四格 120% 法术；之后 25s 每秒对区域内我方 15% 法术
              for (const u of alliesInBox(battle, iy, ix, 1)) {
                if (u !== t && u.alive) battle.dealDamage(e, u, { amount: e.s.atk * 1.2, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
              }
              for (let i = 1; i <= 25; i++) {
                battle.after(i, () => {
                  if (!e.alive) return;
                  for (const u of alliesInBox(battle, iy, ix, 1)) {
                    if (u.alive) battle.dealDamage(e, u, { amount: e.s.atk * dot, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
                  }
                }, { owner: e });
              }
            }, { owner: e });
          }
        }
      }
      // (b) 第三形态的周期起飞
      if (s.form >= 3) {
        if (s.flying > 0) {
          s.flying -= dt;
          if (s.flying <= 1e-9) {
            s.flying = 0;
            e.profile.noAttack = false;
            battle.removeBuff(e, 'ext:shchmr_fly');
          }
        } else {
          s.fly -= dt;
          if (s.fly <= 1e-9) {
            const sk = skillOf(e, 'Fly');
            s.fly = cdOf(sk, 15);
            s.flying = skNum(sk, 'duration', 15);
            e.profile.noAttack = true;
            battle.addBuff(e, { key: 'ext:shchmr_fly', duration: s.flying, visible: true, flags: { unblockable: true, levitate: true } });
          }
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SHCHMR) return;
    const s = bossStore(battle).shchmr.get(e);
    if (s.jaw) return;
    s.jaw = true;
    const fire = skillOf(e, 'Fire') || {};
    const dur = skNum(fire, 'duration', 20);
    const iv = skNum(fire, 'interval', 0.5);
    const pure = skNum(fire, 'atk_scale_pure', 0.4);
    const magic = skNum(fire, 'atk_scale_magic', 0.15);
    e.hp = 1;
    e.unbalanceUntil = -Infinity;
    e.profile.noAttack = true;
    castSkill(battle, e, fire);
    battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'jaw' }); // 灾厄之口形态（D 集）
    battle.addBuff(e, {
      key: 'ext:shchmr_jaw', duration: dur, visible: true, persist: true,
      flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true },
      onExpire: ({ battle: b }) => {
        if (!e.alive) return;
        s.jaw = false;
        s.form = Math.min(3, s.form + 1);
        // reborn_N：该形态相对初始的成长（总量口径）
        const atkCo = talentOf(e, `reborn_${s.form === 2 ? 1 : 2}.atk`, s.form === 2 ? 0.2 : 0.3);
        const hpCo = talentOf(e, `reborn_${s.form === 2 ? 1 : 2}.max_hp`, s.form === 2 ? 0.5 : 1);
        battle.removeBuff(e, 'ext:shchmr_form');
        battle.addBuff(e, { key: 'ext:shchmr_form', persist: true, visible: true, mods: { hpMul: hpCo, atkPct: atkCo } });
        e.profile.noAttack = false;
        e.hp = e.s.maxHp;
        e.atkCd = 0;
        b.fx('revive', { x: e.x, y: e.y, id: e.id, form: s.form === 3 ? 'form3' : 'form2' });
      },
    });
    // 【灾厄之口】循环：每 0.5 s——最高生命者真伤、其余全体法术
    let acc = skNum(fire, 'first_trigger_interval', 2);
    battle.on('tick', function jawLoop(cc) {
      if (!e.alive || !s.jaw) return;
      const dt2 = cc && Number.isFinite(cc.dt) ? cc.dt : 0;
      acc -= dt2;
      if (acc > 1e-9) return;
      acc = iv;
      const alive = battle.allies().filter((u) => u.alive);
      if (!alive.length) return;
      const top = [...alive].sort((a, b2) => b2.s.maxHp - a.s.maxHp)[0];
      const near = new Set(alliesInBox(battle, top.tileR, top.tileC, 2)); // 8 格
      battle._ev(['atk', e.id, top.id, 'true']); // 灾厄之口每跳由这次 atk 触发官方 hit 行
      for (const u of alive) {
        const inside = u === top || near.has(u);
        battle.dealDamage(e, u, {
          amount: e.s.atk * (inside ? pure : magic),
          type: inside ? 'true' : 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'],
        });
      }
    });
    battle.fx('telegraph', { x: e.x, y: e.y, r: 2, dur, kind: 'reborn', id: e.id, form: 'jaw' });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 朔壳：暴武（非阻挡者物理/法术 50% 闪避；待部署区每张宿傲 +30% 攻击）；醉生（+1 张宿傲，上限8）；
// 溯律（半径13内选宿傲数+1 名我方，在自身位置召敛傲并以目标格为路径终点）；描躯（场上无身形时召一节身形）；
// 身形在场时朔壳不可被攻击。

function installDycyue(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_DYCYUE) return;
    bossStore(battle).shuoke = bossStore(battle).shuoke || new Map();
    bossStore(battle).shuoke.set(e, {
      cards: 0, punch: icdOf(skillOf(e, 'Punch')), send: icdOf(skillOf(e, 'SendPunchCard')),
      body: icdOf(skillOf(e, 'SummonBody')), bodyRef: null,
    });
  });
  battle.on('damaged', (c) => {
    const t = c && c.target, src = c && c.source;
    if (!t || t.defId !== BOSS_DYCYUE || !src || !c.dmg || (c.dmg.type !== 'phys' && c.dmg.type !== 'arts')) return;
    if (src === t || t.blockedBy === src) return; // 阻挡者的伤害不闪避
    const prob = talentOf(t, 'MasterBlcok.prob', 0.5);
    if (prob > 0 && battle.rng.chance(prob)) {
      c.dmg.cancel = true;
      battle.fx('dodge', { x: t.x, y: t.y, id: t.id });
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.shuoke || !st.shuoke.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.shuoke) {
      if (!e.alive) { st.shuoke.delete(e); continue; }
      // 身形挂在身上 ⇒ 朔壳不可被攻击（官方：身形在场时自身无法被攻击）
      const bodyAlive = s.bodyRef && s.bodyRef.alive;
      if (bodyAlive) battle.addBuff(e, { key: 'ext:dyc_body', persist: true, visible: true, flags: { invulnerable: true, untargetable: true } });
      else battle.removeBuff(e, 'ext:dyc_body');
      if (!canAct(battle, e) && !s.bodyRef) { /* 被控也继续走技能计时以外的东西 */ }
      // 醉生（SendPunchCard 5/36）：待部署区 +1 张宿傲（上限 8），每张 +30% 攻击
      s.send -= dt;
      if (s.send <= 1e-9) {
        const sk = skillOf(e, 'SendPunchCard');
        s.send = cdOf(sk, 36);
        if (s.cards < 8) {
          castSkill(battle, e, sk);
          s.cards += 1;
          battle.removeBuff(e, 'ext:dyc_cards');
          battle.addBuff(e, { key: 'ext:dyc_cards', persist: true, visible: true, mods: { atkPct: 0.3 * s.cards } });
          battle.fx('mark', { x: e.x, y: e.y, id: e.id, kind: 'shuokeCard', n: s.cards });
        }
      }
      // 描躯（SummonBody 20/54）：场上无身形时召一节身形
      s.body -= dt;
      if (s.body <= 1e-9) {
        const sk = skillOf(e, 'SummonBody');
        s.body = cdOf(sk, 54);
        if (!(s.bodyRef && s.bodyRef.alive)) {
          castSkill(battle, e, sk);
          s.bodyRef = spawnSummon(battle, e, SUMMON_BODY, tileNearAlly(battle, [e.tileR, e.tileC], 2));
        }
      }
      if (!canAct(battle, e)) continue;
      // 溯律（Punch 10/30）：半径13内选 (宿傲数+1) 名我方，各召 1 枚敛傲，路径终点 = 目标所在格
      s.punch -= dt;
      if (s.punch <= 1e-9) {
        const sk = skillOf(e, 'Punch');
        s.punch = cdOf(sk, 30);
        const radius = skNum(sk, 'range_radius', 13);
        const cands = battle.allies().filter((u) => u.alive && !u.hidden && !u.s.flags.untargetable
          && Math.abs(u.x - e.x) <= radius && Math.abs(u.y - e.y) <= radius);
        if (cands.length) {
          castSkill(battle, e, sk);
          const n = Math.min(cands.length, s.cards + 1);
          for (let i = 0; i < n; i++) {
            const t = cands.splice(battle.rng.int(cands.length), 1)[0];
            const u = spawnSummon(battle, e, SUMMON_LIANAO, [e.tileR, e.tileC], {
              route: { start: [Math.round(e.tileR), Math.round(e.tileC)], end: [Math.round(t.tileR), Math.round(t.tileC)], motion: 'F' },
            });
            if (u) u.counted = false;
          }
        }
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_DYCYUE) return;
    // 被击倒后按预设路径召唤一批敌人：本模式取「2 枚敛傲走向我方」[ASSUMED 波次表不在包内]
    for (let i = 0; i < 2; i++) {
      const t = battle.allies().filter((u) => u.alive && !u.hidden)[0];
      if (!t) break;
      spawnSummon(battle, e, SUMMON_LIANAO, [e.tileR, e.tileC], {
        route: { start: [Math.round(e.tileR), Math.round(e.tileC)], end: [Math.round(t.tileR), Math.round(t.tileC)], motion: 'F' },
      });
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------
// 第 2 批：官方首领（2026-10-23 落地）。数值一律读记录（skills[].bb / talents.bb），图鉴文本补充处标 [ASSUMED]。
// 未实现的子系统在 README「第 2 批首领」一节逐条点名（召唤物记录不在包内 / 地形与传送 / 多形态切换）。

/** 伤心的大锁的三类召唤池（PRTS ISW-DF 别无所求「敌人召唤序列」；[ASSUMED] 取每类的首批组合）。 */
const CSDOLL_POOLS = Object.freeze({
  1: Object.freeze([[SUMMON_NBKGHT, 4]]),
  2: Object.freeze([[SUMMON_NBKGHT, 2], [SUMMON_EMOUSE, 1], [SUMMON_CSPPT, 1]]),
  3: Object.freeze([[SUMMON_NBKGHT, 2], [SUMMON_EMOUSE, 1], [SUMMON_DUGAGO, 1]]),
});

/** 以 `r,c` 为中心找一个空位（找不到就用原格）。 */
function tileNear(battle, r, c, n = 2) {
  const taken = freeTileNear(battle);
  for (let d = 0; d <= n; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
        const rr = Math.round(r) + dr, cc = Math.round(c) + dc;
        if (rr < 0 || cc < 0 || taken.has(`${rr},${cc}`)) continue;
        return [rr, cc];
      }
    }
  }
  return [Math.round(r), Math.round(c)];
}

/** 按池召一类敌人：每个 key 各 `count` 只（每只落在不同的附近空位）；返回生成的单位。 */
function summonPool(battle, e, kind) {
  const pool = CSDOLL_POOLS[kind];
  const out = [];
  if (!pool) return out;
  for (const [key, count] of pool) {
    for (let i = 0; i < count; i++) {
      const pos = tileNear(battle, e.tileR, e.tileC, 3);
      const u = battle.spawnEnemy(key, { pos, ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null, countInTotal: false });
      if (u) { out.push(u); battle.fx('summon', { x: u.x, y: u.y, id: e.id, key, n: 1 }); }
    }
  }
  return out;
}

/** 召唤池的存在时长（`summon.csdoll_summon[n].duration`，90 / 180 s；第三类数据没有时长 ⇒ 不设限）。 */
function limitPoolLife(battle, e, kind, units) {
  if (!units.length) return;
  const dur = talentOf(e, `summon.csdoll_summon[${kind}].duration`, 0);
  if (!(dur > 0)) return;
  for (const u of units) battle.after(dur, () => { if (u.alive) battle.kill(u, null); }, { owner: u });
}

/**
 * 伤心的大锁（`enemy_2018_csdoll`）
 *   图鉴：同时攻击 2 个目标；耐久极高且自愈；周期释放屏障（屏障期间停止攻击，全场敌人移速提升）；
 *   每受到一定次数伤害对全场我方造成法术伤害；长时间后扣除 30 点目标生命。
 *   数据：`aoetrigger.stack_cnt` 20 / `aoe.atk_scale` 1.5 / `movespeedup.move_speed` 2 /
 *   `hprecovery.hp_recovery_per_sec_by_max_hp_ratio` 0.0025；`shield`（init 60 / cd 45 / `hp_ratio` 0.05 /
 *   `interval` 20 s 护盾时长）；`Doom`（480 s / `value` −30）。
 *   召唤（PRTS ISW-DF 别无所求）：入场 24 / 48 / 72 s 各召一次第一类；110 / 130 / 150 / 170 s 第二类；
 *   180 s 起每 16 s 第三类；屏障期间（每 20 s，含开启时）另召一只“报幕助手”。
 *   [ASSUMED] 屏障的 `interval` 读作护盾持续时长；Doom 扣目标生命在本引擎没有战斗内通道（漏怪表由 playout
 *   汇总），本模块只发一条 fx、不改目标生命。
 */
function installCsdoll(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_CSDOLL) return;
    e.profile.maxTargets = 2;
    const ratio = talentOf(e, 'hprecovery.hp_recovery_per_sec_by_max_hp_ratio', 0.0025);
    e.base.hpRecoveryPerSec = Math.max(e.base.hpRecoveryPerSec || 0, e.s.maxHp * ratio);
    const sk = skillOf(e, 'shield');
    bossStore(battle).csdoll.set(e, {
      shield: icdOf(sk), shieldDur: skNum(sk, 'interval', 20), shielding: false, stacks: 0, doom: icdOf(skillOf(e, 'Doom')),
      t0: battle.time, class1: 24, class1N: 0, class2: 110, class2N: 0, class3: 180, aide: 0,
    });
  });
  battle.on('damaged', (c) => {
    const t = c && c.target;
    if (!t || t.defId !== BOSS_CSDOLL) return;
    const st = bossStore(battle).csdoll.get(t);
    if (!st) return;
    st.stacks += 1;
    // 预警阈值（aoetrigger.warning_stack_cnt，10）：到点发一次预警，满 20 层才真正爆发
    if (st.stacks === talentOf(t, 'aoetrigger.warning_stack_cnt', 10)) {
      battle.fx('telegraph', { x: t.x, y: t.y, r: 12, dur: 2, kind: 'csdollWarn', id: t.id });
    }
    if (st.stacks < talentOf(t, 'aoetrigger.stack_cnt', 20)) return;
    st.stacks = 0;
    const scale = talentOf(t, 'aoe.atk_scale', 1.5);
    battle.fx('explode', { x: t.x, y: t.y, r: 12, kind: 'csdollAoe', id: t.id });
    for (const a of battle.allies()) {
      if (!a.alive || a.hidden) continue;
      battle.dealDamage(t, a, { amount: t.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.csdoll.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.csdoll) {
      if (!e.alive) { st.csdoll.delete(e); continue; }
      s.doom -= dt;
      if (s.doom <= 1e-9) {
        s.doom = Infinity; // 一次性：官方 Doom 只发生一次
        const sk = skillOf(e, 'Doom');
        castSkill(battle, e, sk);
        battle.fx('telegraph', { x: e.x, y: e.y, r: 12, dur: 2, kind: 'csdollDoom', id: e.id });
      }
      // 召唤节奏（PRTS ISW-DF 别无所求）：24/48/72 第一类，110/130/150/170 第二类，180 起每 16 s 第三类
      const elapsed = battle.time - s.t0;
      if (s.class1N < 3 && elapsed >= s.class1) { s.class1N += 1; s.class1 += 24; limitPoolLife(battle, e, 1, summonPool(battle, e, 1)); }
      if (s.class2N < 4 && elapsed >= s.class2) { s.class2N += 1; s.class2 += 20; limitPoolLife(battle, e, 2, summonPool(battle, e, 2)); }
      if (s.class3N == null) s.class3N = 0;
      if (elapsed >= s.class3) { s.class3 += 16; s.class3N += 1; limitPoolLife(battle, e, 3, summonPool(battle, e, 3)); }
      if (s.shielding || !canAct(battle, e)) continue;
      s.shield -= dt;
      if (s.shield > 1e-9) continue;
      // 开盾：停止攻击 + 全场敌人移速提升（数据 movespeedup.move_speed）+ 召唤“报幕助手”
      s.shielding = true;
      e.profile.noAttack = true;
      castSkill(battle, e, skillOf(e, 'shield'));
      for (const o of battle.enemies) {
        if (o.alive) battle.addBuff(o, { key: 'ext:csdoll_rush', duration: s.shieldDur, visible: true, mods: { moveFlat: talentOf(e, 'movespeedup.move_speed', 2) } });
      }
      const aidePos = tileNear(battle, e.tileR, e.tileC, 2);
      const aide = battle.spawnEnemy(SUMMON_AIDE, { pos: aidePos, ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null, countInTotal: false });
      if (aide) battle.fx('summon', { x: aide.x, y: aide.y, id: e.id, key: SUMMON_AIDE, n: 1 });
      battle.after(s.shieldDur, () => {
        if (!e.alive) return;
        e.profile.noAttack = false;
        s.shielding = false;
        s.shield = cdOf(skillOf(e, 'shield'), 45);
      }, { owner: e });
    }
  });
}

/**
 * “报幕助手”（`enemy_ext_csdoll_aide`，PRTS TN-3 敌方召唤物页）：
 *   HP10000 / ATK100 / DEF700 / RES60 / 阻挡 0；不容易受到我方单位的攻击（`tauntLevel` −1）；
 *   光环：周围我方攻击力 −30%（最终乘算）并每 0.5 s 受到攻击力 50% 的无类型真实伤害。
 */
function installCsdollAide(battle) {
  battle.on('tick', (c) => {
    const aids = liveEnemies(battle, SUMMON_AIDE);
    if (!aids.length) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const a of aids) {
      const r = talentOf(a, 'aura.range_radius', 1.5);
      const hit = battle.allies().filter((u) => u.alive && !u.hidden && Math.hypot(u.x - a.x, u.y - a.y) <= r);
      for (const u of hit) {
        battle.addBuff(u, { key: 'ext:aide_weaken', duration: AURA_REFRESH, refresh: 'extend', source: a, visible: true, mods: { atkPct: talentOf(a, 'aura.atk_ratio', -0.3) } });
      }
      a.__aideTick = (a.__aideTick || 0) + dt;
      const iv = talentOf(a, 'aura.interval', 0.5);
      if (a.__aideTick >= iv) {
        a.__aideTick -= iv;
        for (const u of hit) {
          battle.dealDamage(a, u, { amount: a.s.atk * talentOf(a, 'aura.true_damage_ratio', 0.5), type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'aideAura'] });
        }
      }
    }
  });
}

/**
 * “阿米娅”，炉芯终曲（`enemy_2092_skzamy`）
 *   图鉴：第一形态物理/法术伤害降低 50%，生命首次低于 50% 获得无敌；普攻为范围攻击；定期召唤“仅剩的创意”。
 *   数据：`ReduceDamageS1.damage_resistance` 0.5 / `InvincibleS1.hp_ratio` 0.5 / `RebornS3.duration` 10 /
 *   `AOEAttack.bb.atk_scale` 2.5 / `SummonBallS4` 15 s。
 *   [ASSUMED] 无敌时长取 `RebornS3.duration`（图鉴没给数）；“仅剩的创意”没有敌人记录 ⇒ 只播召唤 fx；
 *   第二形态 /【存续先兆】/【永恒存续】是整场脚本，不在包内实现。
 */
function installSkzamy(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SKZAMY) return;
    const dr = talentOf(e, 'ReduceDamageS1.damage_resistance', 0.5);
    battle.addBuff(e, { key: 'ext:skzamy_dr', persist: true, visible: true, mods: { physTakenMul: 1 - dr, artsTakenMul: 1 - dr } });
    bossStore(battle).skzamy.set(e, { half: false, ball: icdOf(skillOf(e, 'SummonBallS4')) });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== BOSS_SKZAMY || c.isSkill) return;
    const sk = skillOf(a, 'AOEAttack') || skillOf(a, 'AOEAttackInit');
    const scale = skNum(sk, 'atk_scale', 2.5);
    for (const t of c.targets || []) {
      if (!t || !t.alive) continue;
      battle.fx('explode', { x: t.x, y: t.y, r: 1.5, kind: 'skzamyAoe', id: a.id });
      for (const u of alliesInBox(battle, t.tileR, t.tileC, 1)) {
        battle.dealDamage(a, u, { amount: a.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'splash'] });
      }
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle);
    if (!st.skzamy.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st.skzamy) {
      if (!e.alive) { st.skzamy.delete(e); continue; }
      if (!s.half && e.hpRatio < HALF_HP) {
        s.half = true;
        battle.addBuff(e, { key: 'ext:skzamy_inv', duration: talentOf(e, 'RebornS3.duration', 10), visible: true, flags: { invulnerable: true } });
        battle.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'skzamyHalf' });
      }
      if (!canAct(battle, e)) continue;
      s.ball -= dt;
      if (s.ball > 1e-9) continue;
      const sk = skillOf(e, 'SummonBallS4');
      s.ball = cdOf(sk, 15);
      castSkill(battle, e, sk);
      // “仅剩的创意”：本包记录 enemy_2094_skzamb（无攻击，碰触昔日道标后改变方向）
      const pos = tileNearAlly(battle, [e.y, e.x], 3);
      const u = battle.spawnEnemy(SUMMON_SKZAMB, { pos, ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null, countInTotal: false });
      if (u) battle.fx('summon', { x: u.x, y: u.y, id: e.id, key: SUMMON_SKZAMB, n: 1 });
    }
  });
}

/**
 * AMa-10 / AMa-10异构体（`enemy_1590_muama` / `enemy_1591_mutwin`）共用的一半：
 *   图鉴：无法移动；攻击同一目标时攻击力逐渐提升；攻击/法术伤害大幅降低（防火墙）；直线信息洪流（首个命中单位
 *   眩晕 + 持续真实伤害）；定期【刷新】自身位置。
 *   数据：`SameTargetAtkUp.atk` 100 / `max_stack_cnt` 4 / `DamageResistance.damage_resistance` 0.9 /
 *   `HorizontalLineAttack`（cd 40 / `value` / `stun`）/ `VerticalLine`（cd 40）/ `Blink`（cd 60）。
 *   [ASSUMED] 防火墙读作**固定减伤 90%**（“来自防火墙外”的逐格判定需要受击点，本引擎在 `hit` 钩子里改数值不
 *   可靠）；【刷新】= 每 cd 秒随机换一个空位（官方是「指定地块」，包内没有关卡脚本可读）。
 */
function installAma(battle, defId, storeKey) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== defId) return;
    const dr = talentOf(e, 'DamageResistance.damage_resistance', 0.9);
    battle.addBuff(e, { key: 'ext:ama_still', persist: true, visible: false, flags: { noMove: true } });
    battle.addBuff(e, { key: 'ext:ama_wall', persist: true, visible: true, mods: { physTakenMul: 1 - dr, artsTakenMul: 1 - dr } });
    bossStore(battle)[storeKey].set(e, {
      last: null, stack: 0, h: icdOf(skillOf(e, 'HorizontalLineAttack')), v: icdOf(skillOf(e, 'VerticalLine')),
      blink: icdOf(skillOf(e, 'Blink')), fake: false,
    });
  });
  battle.on('attack', (c) => {
    const a = c && c.attacker;
    if (!a || a.defId !== defId || c.isSkill) return;
    const st = bossStore(battle)[storeKey].get(a);
    const t = c.targets && c.targets[0];
    if (!st || !t) return;
    if (st.last === t) {
      const cap = talentOf(a, 'SameTargetAtkUp.max_stack_cnt', 4);
      if (st.stack < cap) {
        st.stack += 1;
        battle.addBuff(a, { key: 'ext:ama_focus', persist: true, visible: true, mods: { atkFlat: st.stack * talentOf(a, 'SameTargetAtkUp.atk', 100) } });
      }
    } else {
      st.last = t;
      st.stack = 0;
      battle.removeBuff(a, 'ext:ama_focus');
    }
  });
  const lineHit = (battle, e, sk, horizontal) => {
    const value = skNum(sk, 'value', 120);
    const stun = skNum(sk, 'stun', 5);
    const er = Math.round(e.tileR), ec = Math.round(e.tileC);
    const cands = battle.allies().filter((a) => a.alive && !a.hidden && (horizontal ? Math.round(a.tileR) === er : Math.round(a.tileC) === ec))
      .filter((a) => (horizontal ? Math.abs(Math.round(a.tileC) - ec) : Math.abs(Math.round(a.tileR) - er)) <= 3)
      .sort((x, y) => (Math.abs(horizontal ? Math.round(x.tileC) - ec : Math.round(x.tileR) - er) - Math.abs(horizontal ? Math.round(y.tileC) - ec : Math.round(y.tileR) - er)));
    const t = cands[0];
    if (!t) return;
    castSkill(battle, e, sk);
    battle._ev(['atk', e.id, t.id, 'true']);
    battle.dealDamage(e, t, { amount: value, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'amaLine'] });
    if (t.alive && stun > 0) battle.applyStatus(t, 'stun', { duration: stun, source: e });
  };
  battle.on('tick', (c) => {
    const st = bossStore(battle)[storeKey];
    if (!st.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st) {
      if (!e.alive) { st.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      s.h -= dt;
      if (s.h <= 1e-9) { s.h = cdOf(skillOf(e, 'HorizontalLineAttack'), 40); lineHit(battle, e, skillOf(e, 'HorizontalLineAttack'), true); }
      s.v -= dt;
      if (s.v <= 1e-9) { s.v = cdOf(skillOf(e, 'VerticalLine'), 40); lineHit(battle, e, skillOf(e, 'VerticalLine'), false); }
      s.blink -= dt;
      if (s.blink <= 1e-9) {
        s.blink = cdOf(skillOf(e, 'Blink'), 60);
        // 【刷新】：换一个空位（官方指定地块，包内没有关卡脚本 ⇒ 随机空位 [ASSUMED]）
        const pos = tileNearAlly(battle, [e.y, e.x], 6);
        const sk = skillOf(e, 'Blink');
        castSkill(battle, e, sk);
        e.y = pos[0]; e.x = pos[1];
        e.tileR = pos[0]; e.tileC = pos[1];
        e.markDirty();
        battle.fx('summon', { x: e.x, y: e.y, id: e.id, key: defId, n: 1 });
      }
    }
  });
}

/** 阿米娅的召唤链：仅剩的创意（已实现）→ 昔日道标 → 恐卡兹 → 年代印痕。 */
const SUMMON_SKZAMF = 'enemy_2095_skzamf'; // 昔日道标（普通）
const SUMMON_SKZAMJ = 'enemy_2096_skzamj'; // 昔日道标（精英）
const SUMMON_SKZJS = 'enemy_2065_skzjs';   // 恐卡兹（道标释放的内容）
const SUMMON_SKZDW = 'enemy_2086_skzdwx';  // 年代印痕（x-1 范围；2087=x-2 / 2088=x-4 同款）
const SKZ_STANDS = new Set([SUMMON_SKZAMF, SUMMON_SKZAMJ]);
const SKZ_MARKS = new Set([SUMMON_SKZDW, 'enemy_2087_skzdwy', 'enemy_2088_skzdwz']);
const SKZ_MARK_RANGE = Object.freeze({ 'x-1': 1, 'x-2': 2, 'x-4': 4 });

/** `talents.bbStr[key]`（字符串黑板）。 */
const bbStrOf = (e, key, fallback) => {
  const b = e && e.def && e.def.raw && e.def.raw.talents ? e.def.raw.talents.bbStr : null;
  const v = b ? b[key] : undefined;
  return v == null ? fallback : v;
};

/**
 * 昔日道标（`enemy_2095_skzamf` / `enemy_2096_skzamj`，数据自带 `summon.enemy_key = enemy_2065_skzjs`）：
 *   「仅剩的创意」触碰道标 ⇒ 道标消失、原地释放恐卡兹（图鉴：若触碰昔日道标则释放其中的敌人或友方干员）。
 *   [ASSUMED] 触碰判定 = 创意与道标在同一格（Chebyshev ≤ 0.8）。
 */
function installSkzRelease(battle) {
  battle.on('tick', () => {
    const balls = liveEnemies(battle, SUMMON_SKZAMB);
    if (!balls.length) return;
    const stands = (battle.enemies || []).filter((x) => x && x.alive && SKZ_STANDS.has(x.defId));
    if (!stands.length) return;
    for (const b of balls) {
      for (const s of stands) {
        if (Math.max(Math.abs(b.tileR - s.tileR), Math.abs(b.tileC - s.tileC)) > 0.8) continue;
        battle.fx('explode', { x: s.x, y: s.y, r: 1.5, kind: 'skzRelease', id: s.id });
        const pos = [Math.round(s.tileR), Math.round(s.tileC)];
        const key = bbStrOf(s, 'summon.enemy_key', SUMMON_SKZJS);
        battle.kill(s, null);
        const u = battle.spawnEnemy(key, { pos, ownerPlayerId: s.ownerId ?? null, sourcePlayerId: s.sourcePlayerId ?? null, countInTotal: false });
        if (u) battle.fx('summon', { x: u.x, y: u.y, id: b.id, key, n: 1 });
        break;
      }
    }
  });
}

/**
 * 阿米娅 ↔ 「仅剩的创意」的**共享生命**（[ASSUMED]：PRTS 的「阿米娅，炉芯终曲」与「终曲合声」页面都没有这一条，
 *   业主明确要求补；按「创意是她的延伸」读作同一条生命池）。
 *   写法与岁四部位同一套：创意受伤先补回自己的血条，再 `battle.loseHp(阿米娅, 等量, { sourceless: true, noHitLimit: true })`
 *   转入共享池；阿米娅受伤 / 每 tick 把池值按最大生命比例同步给所有创意；阿米娅倒下 ⇒ 创意一起退场。
 */
function installSkzamyLink(battle) {
  const link = (b) => {
    const st = bossStore(b);
    return (st.skzamyLink || (st.skzamyLink = { leader: null, parts: new Set() }));
  };
  const sync = (l) => {
    if (!l.leader || !l.leader.alive) return;
    for (const p of l.parts) {
      if (!p.alive) continue;
      const want = Math.max(1, Math.min(p.s.maxHp, l.leader.hp * (p.s.maxHp / l.leader.s.maxHp)));
      if (Math.abs(p.hp - want) > 0.5) { p.hp = want; p.markDirty(); }
    }
  };
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e) return;
    const l = link(battle);
    if (e.defId === BOSS_SKZAMY) { l.leader = e; sync(l); }
    else if (e.defId === SUMMON_SKZAMB) { l.parts.add(e); sync(l); }
  });
  battle.on('damaged', (c) => {
    const t = c && c.target;
    const amount = c && c.amount;
    if (!t || !(amount > 0)) return;
    const l = link(battle);
    if (!l.leader || !l.leader.alive) return;
    if (t === l.leader) { sync(l); return; }
    if (t.defId !== SUMMON_SKZAMB) return;
    t.hp = Math.min(t.s.maxHp, t.hp + amount);
    battle.loseHp(l.leader, amount, { sourceless: true, noHitLimit: true, from: c.dmg });
    t.markDirty();
    sync(l);
  });
  battle.on('kill', (c) => {
    const u = c && c.victim;
    const l = link(battle);
    if (!u || !l.leader) return;
    if (u === l.leader) {
      for (const p of [...l.parts]) if (p.alive) battle.kill(p, null);
    } else if (u.defId === SUMMON_SKZAMB) {
      // 创意退场：伤害已在 damaged 里等量转入共享池，这里只摘掉这一条（不重复扣血）
      l.parts.delete(u);
    }
  });
  battle.on('tick', () => {
    const l = link(battle);
    // 【吸收】（天赋 AbsorbSkzamb.range_radius 0.5）：贴近阿米娅的「仅剩的创意」被她吸收
    //   [ASSUMED] 官方没说吸收的收益 ⇒ 回 2% 生命上限并发一次 heal fx
    if (l.leader && l.leader.alive) {
      const r = talentOf(l.leader, 'AbsorbSkzamb.range_radius', 0.5);
      for (const p of [...l.parts]) {
        if (!p.alive) continue;
        if (Math.max(Math.abs(p.tileR - l.leader.tileR), Math.abs(p.tileC - l.leader.tileC)) > r) continue;
        l.parts.delete(p);
        battle.kill(p, null);
        l.leader.hp = Math.min(l.leader.s.maxHp, l.leader.hp + l.leader.s.maxHp * 0.02);
        l.leader.markDirty();
        battle.fx('heal', { x: l.leader.x, y: l.leader.y, id: l.leader.id });
      }
    }
    sync(l);
  });
}

/**
 * 恐卡兹（`enemy_2065_skzjs`）：出生时对所在格周围所有友方造成法术伤害（`1.damage_scale` 0.5）并生成年代印痕；
 *   存在 30 s 后消失（`1.exist_duration`）。
 */
function installSkzjs(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== SUMMON_SKZJS) return;
    const scale = talentOf(e, '1.damage_scale', 0.5);
    battle.fx('explode', { x: e.x, y: e.y, r: 1.5, kind: 'skzjsBirth', id: e.id });
    for (const a of alliesInBox(battle, e.tileR, e.tileC, 1)) {
      battle.dealDamage(e, a, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'skzjsBirth'] });
    }
    const mark = battle.spawnEnemy(SUMMON_SKZDW, { pos: [Math.round(e.tileR), Math.round(e.tileC)], ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null, countInTotal: false });
    if (mark) battle.fx('summon', { x: mark.x, y: mark.y, id: e.id, key: SUMMON_SKZDW, n: 1 });
    const dur = talentOf(e, '1.exist_duration', 30);
    if (dur > 0) battle.after(dur, () => { if (e.alive) battle.kill(e, null); }, { owner: e });
  });
}

/**
 * 年代印痕（`enemy_2086_skzdwx` / `2087_skzdwy` / `2088_skzdwz`）：范围内的我方每秒受到 100 点凋亡损伤
 *   （天赋 `Apoptosis.element_damage` 100；范围由 `Apoptosis.range_id` x-1 / x-2 / x-4 给出，[ASSUMED] 读作半径 1 / 2 / 4）。
 */
function installSkzdw(battle) {
  battle.on('tick', (c) => {
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const m of battle.enemies || []) {
      if (!m || !m.alive || !SKZ_MARKS.has(m.defId)) continue;
      m.__markTick = (m.__markTick || 0) + dt;
      if (m.__markTick < 1) continue;
      m.__markTick -= 1;
      const radius = SKZ_MARK_RANGE[bbStrOf(m, 'Apoptosis.range_id', 'x-1')] || 1;
      for (const a of battle.allies()) {
        if (!a.alive || a.hidden) continue;
        if (Math.max(Math.abs(Math.round(a.tileR) - Math.round(m.tileR)), Math.abs(Math.round(a.tileC) - Math.round(m.tileC))) > radius) continue;
        battle.dealDamage(m, a, { type: 'element', element: 'apoptosis', amount: talentOf(m, 'Apoptosis.element_damage', 100), canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'skzMark'] });
      }
    }
  });
}

function installMuama(battle) { installAma(battle, BOSS_MUAMA, 'muama'); }

/** AMa-10异构体：共用 AMa-10 的一半 + 假死（另一只异构体在场且未假死时，生命归零进入假死并回血复活）。 */
function installMutwin(battle) {
  installAma(battle, BOSS_MUTWIN, 'mutwin');
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_MUTWIN) return;
    const st = bossStore(battle).mutwin.get(e);
    if (!st || st.fake || liveEnemies(battle, BOSS_MUTWIN).filter((o) => o !== e).length === 0) return;
    st.fake = true;
    const ratio = talentOf(e, 'FakeDeath.hp_ratio', 0.04);
    e.hp = Math.max(1, Math.round(e.s.maxHp * ratio));
    e.markDirty();
    battle.addBuff(e, {
      key: 'ext:mutwin_fake', persist: true, visible: true, flags: { invulnerable: true, untargetable: true, noMove: true },
      onExpire: () => { /* 假死到满血由下面的回复处理 */ },
    });
    battle.fx('revive', { x: e.x, y: e.y, id: e.id, form: 'fake' });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle).mutwin;
    if (!st.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st) {
      if (!s.fake || !e.alive) continue;
      // 假死期间持续回复（官方“生命持续恢复，生命值为满时复活”）
      e.hp = Math.min(e.s.maxHp, e.hp + e.s.maxHp * 0.04 * dt);
      e.markDirty();
      if (e.hp >= e.s.maxHp - 1e-6) {
        s.fake = false;
        battle.removeBuff(e, 'ext:mutwin_fake');
        battle.fx('revive', { x: e.x, y: e.y, id: e.id });
      }
    }
    void c;
  });
}

/**
 * “终始”（`enemy_1593_musnake`）
 *   图鉴：每失去一定生命值获得无敌（完成交互则受伤眩晕，否则回血）；防火墙（物理/法术大幅降低）；
 *   【信息洪流】固定方向，首个命中单位眩晕并持续受真实伤害；【中断】长时间后消失并扣除 50 点目标生命。
 *   数据：`StepKill.hp_ratio` 0.2 / `StepKill.enemy_musnake_heal_buff.hp_ratio` 0.2 /
 *   `DamageResistance.damage_resistance` 0.9 / `GlobalLineAttack`（cd 25 / `value` 300 / `stun` 10）/
 *   `TimeOut.interval` 998 s / `value` −50。
 *   [ASSUMED] 「指定交互」在本模式没有对象 ⇒ 每次阈值只走「回血 20% + 2 s 无敌」这一支；【中断】同样只发 fx。
 */
function installMusnake(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_MUSNAKE) return;
    const dr = talentOf(e, 'DamageResistance.damage_resistance', 0.9);
    battle.addBuff(e, { key: 'ext:musnake_dr', persist: true, visible: true, mods: { physTakenMul: 1 - dr, artsTakenMul: 1 - dr } });
    bossStore(battle).musnake.set(e, { step: talentOf(e, 'StepKill.hp_ratio', 0.2), line: icdOf(skillOf(e, 'GlobalLineAttack')), timeout: talentOf(e, 'TimeOut.interval', 998) });
  });
  battle.on('damaged', (c) => {
    const t = c && c.target;
    if (!t || t.defId !== BOSS_MUSNAKE) return;
    const st = bossStore(battle).musnake.get(t);
    if (!st) return;
    while (t.hpRatio <= st.step && st.step > 0) {
      st.step = Math.round((st.step - 0.2) * 100) / 100;
      const heal = talentOf(t, 'StepKill.enemy_musnake_heal_buff.hp_ratio', 0.2);
      battle.addBuff(t, { key: 'ext:musnake_inv', duration: 2, visible: true, flags: { invulnerable: true } });
      t.hp = Math.min(t.s.maxHp, t.hp + t.s.maxHp * heal);
      t.markDirty();
      battle.fx('heal', { x: t.x, y: t.y, id: t.id });
    }
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle).musnake;
    if (!st.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st) {
      if (!e.alive) { st.delete(e); continue; }
      s.timeout -= dt;
      if (s.timeout <= 1e-9) {
        s.timeout = Infinity;
        castSkill(battle, e, skillOf(e, 'Injured'));
        battle.fx('telegraph', { x: e.x, y: e.y, r: 12, dur: 2, kind: 'musnakeTimeout', id: e.id });
      }
      if (!canAct(battle, e)) continue;
      s.line -= dt;
      if (s.line > 1e-9) continue;
      const sk = skillOf(e, 'GlobalLineAttack');
      s.line = cdOf(sk, 25);
      const value = skNum(sk, 'value', 300);
      const stun = skNum(sk, 'stun', 10);
      const cands = battle.allies().filter((a) => a.alive && !a.hidden);
      if (!cands.length) continue;
      const t = battle.rng.pick(cands);
      castSkill(battle, e, sk);
      battle._ev(['atk', e.id, t.id, 'true']);
      battle.dealDamage(e, t, { amount: value, type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'musnakeLine'] });
      if (t.alive && stun > 0) battle.applyStatus(t, 'stun', { duration: stun, source: e });
    }
  });
}

/** 岁 系列的方向选取：x 为列、y 为行（行 0 = 最南 ⇒ 最北是 tileR 最大）。 */
const SUI_PICK = {
  north: (list) => list.slice().sort((a, b) => b.tileR - a.tileR)[0],
  south: (list) => list.slice().sort((a, b) => a.tileR - b.tileR)[0],
  east: (list) => list.slice().sort((a, b) => b.tileC - a.tileC)[0],
  west: (list) => list.slice().sort((a, b) => a.tileC - b.tileC)[0],
};

/**
 * 岁（`enemy_1582_suisho`）：【十方怼怒】抬起一段时间后对最北边我方喷火（法术 + 灼燃），火焰向南爆开持续灼烧。
 *   数据：`FireBreathReady.duration` 10（抬起时长）/ `FireBreath.bb.sp` 50 / `config.main_attack_atk_scale` 1.8 /
 *   `config.main_attack_ele_atk_scale` 0.45 / `config.dot_attack_atk_scale` 0.2 /
 *   `config.dot_attack_ele_atk_scale` 0.1 / `config.dot_attack_duration` 25 / `config.doom` 600。
 *   [ASSUMED] 抬起 = 10 s 无敌 + 不动；喷火目标 = 最北；火焰爆开 = 目标格向南北各 3 列的范围；
 *   四部位共享生命 / 镇岁柱削弱 / 柱折维绝（召唤追加敌人）不在包内实现。
 */
function installSuisho(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SUISHO) return;
    bossStore(battle).suisho.set(e, { ready: true, breath: 0, doom: talentOf(e, 'config.doom', 600) });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle).suisho;
    if (!st.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st) {
      if (!e.alive) { st.delete(e); continue; }
      s.doom -= dt;
      if (s.doom <= 1e-9) { s.doom = Infinity; battle.fx('telegraph', { x: e.x, y: e.y, r: 12, dur: 2, kind: 'suiDoom', id: e.id }); }
      if (s.ready) {
        if (!canAct(battle, e)) continue;
        s.ready = false;
        const dur = skNum(skillOf(e, 'FireBreathReady'), 'duration', 10);
        castSkill(battle, e, skillOf(e, 'FireBreathReady'));
        battle.addBuff(e, { key: 'ext:sui_lift', duration: dur, visible: true, flags: { invulnerable: true, noMove: true, untargetable: true } });
        battle.after(dur, () => {
          if (!e.alive) return;
          const t = SUI_PICK.north(battle.allies().filter((a) => a.alive && !a.hidden));
          if (!t) { s.ready = true; return; }
          castSkill(battle, e, skillOf(e, 'FireBreath'));
          battle._ev(['atk', e.id, t.id, 'arts']);
          battle.dealDamage(e, t, { amount: e.s.atk * talentOf(e, 'config.main_attack_atk_scale', 1.8), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'fire'] });
          battle.dealDamage(e, t, { amount: e.s.atk * talentOf(e, 'config.main_attack_ele_atk_scale', 0.45), type: 'element', element: 'burn', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
          const dot = talentOf(e, 'config.dot_attack_duration', 25);
          const scale = talentOf(e, 'config.dot_attack_atk_scale', 0.2);
          const ele = talentOf(e, 'config.dot_attack_ele_atk_scale', 0.1);
          let elapsed = 0;
          battle.addBuff(t, {
            key: 'ext:sui_burn', duration: dot, source: e, visible: true, interval: 0.5,
            onTick: ({ battle: b, unit }) => {
              elapsed += 0.5;
              if (elapsed > dot) return;
              b.dealDamage(e.alive ? e : null, unit, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'fire'] });
              b.dealDamage(e.alive ? e : null, unit, { amount: e.s.atk * ele, type: 'element', element: 'burn', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] });
            },
          });
          // 官方：“未熄”会被岁首的【十方怼怒】点燃引爆，对周围造成高额法术伤害
          for (const u of battle.enemies) {
            if (!u || !u.alive || u.defId !== SUMMON_SHEART) continue;
            if (Math.max(Math.abs(Math.round(u.tileR) - Math.round(t.tileR)), Math.abs(Math.round(u.tileC) - Math.round(t.tileC))) > 2) continue;
            battle.fx('explode', { x: u.x, y: u.y, r: 1, kind: 'sheartBoom', id: u.id });
            for (const a of alliesInBox(battle, u.tileR, u.tileC, 1)) {
              battle.dealDamage(e, a, { amount: e.s.atk * 1.8, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'fire'] });
            }
            battle.loseHp(u, u.hp, { noHitLimit: true, sourceless: true, tags: ['fire'] }); // 引爆自身（无来源流失）
          }
          s.ready = true;
        }, { owner: e });
      }
    }
  });
}

/**
 * 岁·左爪 / 右爪 / 尾（`enemy_1583_suizzh` / `1584_suiyzh` / `1585_suiwei`）：各自抬起 10 s 后对**最东 / 最西 /
 * 最南**的我方落一次范围物理伤害（尾是 3 连戳）。
 *   数据：`ClawsReady` / `TailReady` 的 `duration` 10；`ComeTheClaws.bb.atk_scale` 2.2；`Stab.bb.atk_scale` 1.1（3 次）。
 *   [ASSUMED] 三只各自独立计时（官方由“岁”统一编排），范围 = 目标 3×3 格块。
 */
function installSuiPart(battle, defId, dir, skillKey, qty, aoe) {
  const parts = (b) => {
    const st = bossStore(b);
    return (st.suiParts || (st.suiParts = new Map()));
  };
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== defId) return;
    const readyKey = dir === 'south' ? 'TailReady' : 'ClawsReady';
    parts(battle).set(e, { ready: true, dur: skNum(skillOf(e, readyKey), 'duration', 10) });
  });
  battle.on('tick', () => {
    const st = parts(battle);
    if (!st.size) return;
    for (const [e, s] of st) {
      if (!e.alive) { st.delete(e); continue; }
      if (!s.ready) continue;
      if (!canAct(battle, e)) continue;
      s.ready = false;
      castSkill(battle, e, skillOf(e, dir === 'south' ? 'TailReady' : 'ClawsReady'));
      battle.addBuff(e, { key: 'ext:sui_lift', duration: s.dur, visible: true, flags: { invulnerable: true, noMove: true, untargetable: true } });
      battle.after(s.dur, () => {
        if (!e.alive) return;
        const t = SUI_PICK[dir](battle.allies().filter((a) => a.alive && !a.hidden));
        if (!t) { s.ready = true; return; }
        const sk = skillOf(e, skillKey);
        castSkill(battle, e, sk);
        const scale = skNum(sk, 'atk_scale', qty > 1 ? 1.1 : 2.2);
        for (let i = 0; i < qty; i++) {
          battle._ev(['atk', e.id, t.id, 'phys']);
          for (const u of alliesInBox(battle, t.tileR, t.tileC, aoe)) {
            battle.dealDamage(e, u, { amount: e.s.atk * scale, type: 'phys', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'suiPart'] });
          }
          if (!t.alive) break;
        }
        // 官方：尾的【天倾地陷】击败友方单位后，按数量生成“未熄”
        if (dir === 'south' && !t.alive) {
          const u = battle.spawnEnemy(SUMMON_SHEART, {
            pos: [Math.round(t.tileR), Math.round(t.tileC)],
            ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null, countInTotal: false,
          });
          if (u) battle.fx('summon', { x: u.x, y: u.y, id: e.id, key: SUMMON_SHEART, n: 1 });
        }
        s.ready = true;
      }, { owner: e });
    }
  });
}

/**
 * 洛伦茨，扰动之谬（`enemy_2147_shophm`）
 *   图鉴：试图向<源阶方>移动，到达终点时摧毁它、扣除 30 点目标生命并使全场持续受到真实伤害；【象限封锁】；
 *   被击倒时使<源阶方>解除无敌并开始行动。
 *   数据：`IceShield.max_cnt` 3（cd 30）/ `reborn.duration` 1 / `exit.value` −30 / `exit.value_damage` 200 /
 *   `exit.interval` 0.5 / `exit.projectile_range` 99。
 *   [ASSUMED] 本包没有「向单位移动」的寻路通道 ⇒ 每 cd 秒朝<源阶方>的方向走一格（直接改坐标）；
 *   抵达（相邻）⇒ 全场 200 真伤 / 0.5 s 一拍、持续 3 s，并发 fx；<源阶方>解除无敌（removeBuff）。
 */
function installShophm(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SHOPHM) return;
    const shield = skillOf(e, 'IceShield');
    bossStore(battle).shophm.set(e, { shield: icdOf(shield), charges: 0, reached: false });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle).shophm;
    if (!st.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st) {
      if (!e.alive) { st.delete(e); continue; }
      if (!canAct(battle, e)) continue;
      s.shield -= dt;
      if (s.shield <= 1e-9) {
        const sk = skillOf(e, 'IceShield');
        s.shield = cdOf(sk, 30);
        s.charges = skNum(sk, 'max_cnt', 3);
        castSkill(battle, e, sk);
      }
      const target = liveEnemies(battle, BOSS_SHORBB)[0];
      if (!target || s.reached) continue;
      const dr = Math.round(target.tileR) - Math.round(e.tileR);
      const dc = Math.round(target.tileC) - Math.round(e.tileC);
      if (Math.abs(dr) + Math.abs(dc) <= 1) {
        s.reached = true;
        battle.fx('explode', { x: e.x, y: e.y, r: 12, kind: 'shophmExit', id: e.id });
        for (const o of battle.enemies) if (o.alive && o.defId === BOSS_SHORBB) battle.removeBuff(o, 'ext:shorbb_inv');
        let ticks = 0;
        const tick = () => {
          if (!e.alive || ticks >= 6) return;
          ticks += 1;
          for (const a of battle.allies()) {
            if (!a.alive || a.hidden) continue;
            battle.dealDamage(e, a, { amount: talentOf(e, 'exit.value_damage', 200), type: 'true', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'exit'] });
          }
          battle.after(talentOf(e, 'exit.interval', 0.5), tick, { owner: e });
        };
        tick();
      } else {
        e.y += Math.sign(dr); e.x += Math.sign(dc);
        e.tileR = e.y; e.tileC = e.x;
        e.markDirty();
      }
    }
  });
  battle.on('kill', (c) => {
    const e = c && c.victim;
    if (!e || e.defId !== BOSS_SHOPHM) return;
    for (const o of liveEnemies(battle, BOSS_SHORBB)) battle.removeBuff(o, 'ext:shorbb_inv');
  });
}

/**
 * 源阶方（`enemy_2148_shorbb`）
 *   图鉴：初始无敌（<洛伦茨，扰动之谬>被击杀后解除并开始行动，召唤<源阶方模块>）；物理/法术伤害减免
 *   （来自左右两侧进一步减少）；【失链裂变】对全场我方造成法术伤害，半血后冷却降低；召唤源阶粒素；
 *   模块全部消失后重新无敌、洛伦茨返回。
 *   数据：`Summon`（cd 30 / init 10）/ `Aoe`（cd 8 / `cooldown_advance` 4 / `atk_scale` 1）/
 *   `DamageScale.damage_scale` 0.3 / `damage_scale_in_range` 0.7 / `Angry.hp_ratio` 0.5。
 *   [ASSUMED] <源阶方模块>/源阶粒素没有敌人记录 ⇒ 只播召唤 fx；左右两侧减伤按固定 30% 处理；
 *   复活（`Revive`）不在包内实现（引擎没有“整场单位复活”通道）。
 */
function installShorbb(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || e.defId !== BOSS_SHORBB) return;
    const scale = talentOf(e, 'DamageScale.damage_scale', 0.3);
    battle.addBuff(e, { key: 'ext:shorbb_inv', persist: true, visible: true, flags: { invulnerable: true } });
    battle.addBuff(e, { key: 'ext:shorbb_dr', persist: true, visible: true, mods: { physTakenMul: 1 - scale, artsTakenMul: 1 - scale } });
    bossStore(battle).shorbb.set(e, { aoe: icdOf(skillOf(e, 'Aoe')), summon: icdOf(skillOf(e, 'Summon')), awake: false });
  });
  battle.on('tick', (c) => {
    const st = bossStore(battle).shorbb;
    if (!st.size) return;
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    for (const [e, s] of st) {
      if (!e.alive) { st.delete(e); continue; }
      if (!s.awake) {
        if (e.findBuff('ext:shorbb_inv')) continue;
        s.awake = true;
      }
      if (!canAct(battle, e)) continue;
      s.summon -= dt;
      if (s.summon <= 1e-9) {
        s.summon = cdOf(skillOf(e, 'Summon'), 30);
        castSkill(battle, e, skillOf(e, 'Summon'));
        // 源阶粒素：本包记录 enemy_2149_shorsm（死亡后爆炸，bb boom.atk_scale 2）。
        // 官方「召唤数个」，半血（Angry）后更多 —— [ASSUMED] 常态 1 个 / 半血 3 个。
        const n = e.hpRatio < talentOf(e, 'Angry.hp_ratio', 0.5) ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const pos = tileNearAlly(battle, [e.y, e.x], 2);
          const u = battle.spawnEnemy(SUMMON_SHORSM, { pos, ownerPlayerId: e.ownerId ?? null, sourcePlayerId: e.sourcePlayerId ?? null, countInTotal: false });
          if (u) battle.fx('summon', { x: u.x, y: u.y, id: e.id, key: SUMMON_SHORSM, n: 1 });
        }
      }
      s.aoe -= dt;
      if (s.aoe > 1e-9) continue;
      const sk = skillOf(e, 'Aoe');
      const cd = e.hpRatio < talentOf(e, 'Angry.hp_ratio', 0.5) ? skNum(sk, 'cooldown_advance', 4) : cdOf(sk, 8);
      s.aoe = Math.max(1, cd);
      const scale = skNum(sk, 'atk_scale', 1);
      castSkill(battle, e, sk);
      battle.fx('explode', { x: e.x, y: e.y, r: 12, kind: 'shorbbAoe', id: e.id });
      for (const a of battle.allies()) {
        if (!a.alive || a.hidden) continue;
        battle.dealDamage(e, a, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'shorbbAoe'] });
      }
    }
  });
}

/**
 * 源阶粒素（`enemy_2149_shorsm`）：死亡后爆炸，对周围造成法术伤害（天赋 `boom.atk_scale` 2）。
 *   [ASSUMED] 官方没给爆炸半径 ⇒ 3×3 格块。
 */
function installShorsm(battle) {
  battle.on('kill', (c) => {
    const u = c && c.victim;
    if (!u || u.defId !== SUMMON_SHORSM) return;
    const scale = talentOf(u, 'boom.atk_scale', 2);
    battle.fx('explode', { x: u.x, y: u.y, r: 1.5, kind: 'shorsmBoom', id: u.id });
    for (const a of alliesInBox(battle, u.tileR, u.tileC, 1)) {
      battle.dealDamage(u, a, { amount: u.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'shorsmBoom'] });
    }
  });
}

/**
 * 岁 四部位**共享生命**（图鉴：「四个部位共享生命值」）。
 *   做法与引擎 `content/bosses.js` 的部件传递同一条：部位受到的伤害先补回它自己的血条，再用
 *   `battle.loseHp(leader, 等量, { sourceless: true, noHitLimit: true })` 转入共享池；主体的 `damaged` 把池值同步给
 *   所有部位（血条显示同一条血）。主体倒下 ⇒ 部位一起退场；部位被一击打空 ⇒ 共享池扣到 0。
 */
const SUI_PARTS = new Set([BOSS_SUIZZH, BOSS_SUIYZH, BOSS_SUIWEI]);

function installSuiLink(battle) {
  const link = (b) => {
    const st = bossStore(b);
    return (st.suiLink || (st.suiLink = { leader: null, parts: new Set() }));
  };
  const sync = (l) => {
    if (!l.leader || !l.leader.alive) return;
    for (const p of l.parts) {
      if (!p.alive) continue;
      const want = Math.max(1, Math.min(p.s.maxHp, l.leader.hp * (p.s.maxHp / l.leader.s.maxHp)));
      if (Math.abs(p.hp - want) > 0.5) { p.hp = want; p.markDirty(); }
    }
  };
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e) return;
    const l = link(battle);
    if (e.defId === BOSS_SUISHO) { l.leader = e; sync(l); }
    else if (SUI_PARTS.has(e.defId)) { l.parts.add(e); sync(l); }
  });
  battle.on('damaged', (c) => {
    const t = c && c.target;
    const amount = c && c.amount;
    if (!t || !(amount > 0)) return;
    const l = link(battle);
    if (!l.leader || !l.leader.alive) return;
    if (t === l.leader) { sync(l); return; }
    if (!SUI_PARTS.has(t.defId)) return;
    // 部位受伤 ⇒ 先把它自己的血条补回来，再把等量伤害转入共享池（主体 damaged 会把池值同步回去）
    t.hp = Math.min(t.s.maxHp, t.hp + amount);
    battle.loseHp(l.leader, amount, { sourceless: true, noHitLimit: true, from: c.dmg });
    t.markDirty();
    sync(l);
  });
  battle.on('kill', (c) => {
    const u = c && c.victim;
    const l = link(battle);
    if (!u || !l.leader) return;
    if (u === l.leader) {
      for (const p of [...l.parts]) if (p.alive) battle.kill(p, null);
    } else if (SUI_PARTS.has(u.defId)) {
      if (!l.leader.alive) return;
      battle.loseHp(l.leader, Math.max(1, Math.round(l.leader.hp)), { sourceless: true, noHitLimit: true });
      if (l.leader.alive) sync(l);
    }
  });
  battle.on('tick', () => sync(link(battle)));
}

// ---------------------------------------------------------------------------------------------------------------

/** 本模块覆盖的全部首领 id（一条真相，供测试与诊断）。 */
export const EXT_BOSS_KEYS = Object.freeze({
  mephi: BOSS_MEPHI, faust: BOSS_FAUST, talula: BOSS_TALULA, frstar2: BOSS_FRSTAR2, patrt: BOSS_PATRT,
  mirbst: BOSS_MIRBST, mandra: BOSS_MANDRA, bldkgt: BOSS_BLDKGT, dirctr: BOSS_DIRCTR, dywqgs: BOSS_DYWQGS,
  ldevil: BOSS_LDEVIL, bldbld: SUMMON_BLDBLD, xia: SUMMON_XIA, bsnake: BOSS_BSNAKE, skzjkl: BOSS_SKZJKL,
  syskad: BOSS_SYSKAD, shchmr: BOSS_SHCHMR, dycyue: BOSS_DYCYUE,
  csdoll: BOSS_CSDOLL, skzamy: BOSS_SKZAMY, muama: BOSS_MUAMA, mutwin: BOSS_MUTWIN, musnake: BOSS_MUSNAKE,
  suisho: BOSS_SUISHO, suizzh: BOSS_SUIZZH, suiyzh: BOSS_SUIYZH, suiwei: BOSS_SUIWEI,
  shophm: BOSS_SHOPHM, shorbb: BOSS_SHORBB,
});

/** 战场建起时装载（server.battle 通道，与引擎 MODULES 同一条 install(battle) 协议）。 */
export function install(battle) {
  installMephi(battle);
  installFaust(battle);
  installTalula(battle);
  installFrstar(battle);
  installPatrt(battle);
  installMirbst(battle);
  installMandra(battle);
  installBldkgt(battle);
  installDirctr(battle);
  installDywqgs(battle);
  installLdevil(battle);
  installBsname(battle);
  installSkzjkl(battle);
  installSyskad(battle);
  installShchmr(battle);
  installDycyue(battle);
  installCsdoll(battle);
  installCsdollAide(battle);
  installSkzamy(battle);
  installSkzamyLink(battle);
  installSkzRelease(battle);
  installSkzjs(battle);
  installSkzdw(battle);
  installMuama(battle);
  installMutwin(battle);
  installMusnake(battle);
  installSuisho(battle);
  installSuiPart(battle, BOSS_SUIZZH, 'east', 'ComeTheClaws', 1, 2);
  installSuiPart(battle, BOSS_SUIYZH, 'west', 'ComeTheClaws', 1, 2);
  installSuiPart(battle, BOSS_SUIWEI, 'south', 'Stab', 3, 1);
  installSuiLink(battle);
  installShophm(battle);
  installShorbb(battle);
  installShorsm(battle);
}
