// workshop/ave-mujica/battle/main.mjs — 颂乐人偶/Ave Mujica 的**战斗侧**逻辑（`pack.json.server.battle`，DESIGN §28.17）。
//
// 原来这份代码住在引擎的 `server/sim/mod/ave-mujica/ave-mujica.js`（靠引擎专属的 mod 挂载点加载）。现在它就在包里，
// 通过 `@battle/mod.js`（包侧 SDK）把盟约 / 特质注册进官方表 —— 包由此**自足**，引擎不再含任何 mod 专属代码。
//
// 注册面（一次性挂在模块顶层；本模块在服务端启动时与本浏览器页面各加载一次，所以两端都会注册）：
//   registerBondInstaller  颂乐人偶盟约安装器（5 名成员特质 + Fever 系统）
//   registerGarrisonInstaller  AVEMUJICA_FEVER_KILL / AVEMUJICA_EXTRA_TRIGGER /
//                              act_gar_event_onhurt_add_bond_layer（若叶睦「受伤加层」，自雷姆必拓包原样复制）
// 休整期那一半见 `meta/main.mjs`。
//
// 简化假设（见 bonds.json spec.assumed）：
//   * Fever 为每场战斗共享团队值（上限 450）：成员每次普通攻击造成伤害 +FEVER_PER_HIT；
//     三角初华在场 ×fever_ratio，5 人翻倍再 ×2；满 450 触发 20 s Fever 状态：期间成员持续获得大量 SP
//     回复（近似官方「无视技力限制持续释放技能」），且 Fever 不再积累。
//   * 除基础填充外，5 位成员「毋畏X」特质各自的 Fever 增量也已**逐条接线**（数值取各自 chess 记录里的 bb）：
//     祥子 毋畏遗忘 +3/造成伤害、初华 毋畏悲伤 +5/治疗成员、若麦 毋畏爱意 +3/秒在场、
//     海铃 毋畏恐惧 +2/造成停顿、若叶睦 毋畏死亡 +3/自身受伤。这些也走同一套乘数。
//   * 五位成员「毋畏X」特质的**另一半**（2026-10-14 补齐，语义同上、数值同样取自各角色 chess 记录）：
//     初华 攻击范围内成员攻击时附带 bonus_scale ×初华攻击力 的**法术**伤害；海铃 在场时成员对**停顿/恐惧**敌人
//     造成的伤害 ×(1 + dmg_up)；若叶睦 在场时**全体成员**生命上限 +max_hp；祥子「颂乐音符」（2026-10-17）：
//     持续攻击（无目标也按攻击间隔演奏）+ 每枚音符按 wiki 的三态积分（扩张正弦 / 追踪 + 转向速度 / 出范围 1s 消失），
//     场上每存在 1 个音符 ⇒ 成员无视敌人 def_pen 防御 / res_pen 法抗（≤ max_stack 层）。音符是包侧自建实体，
//     位置经 `NOTES_LIVE` 交客户端面板绘制（引擎不渲染自建弹道）。
//   * 祥子「毋畏遗忘」后半（2026-10-17）：其他成员攻击范围与祥子**常规范围**（baseRangeKeys）有重合 ⇒ 并进
//     祥子的 `extraRangeKeys`（复合范围，同时把延伸后的实际范围写回 `liveRangeGrid` 让详情卡看得见）；范围内干员
//     攻速 +12（E2）。
//   * Fever 期间的技能（2026-10-17）：触发那一刻在场成员**立刻**用 `skill.activate('fever', { free: true })` 重开
//     当前技能（切换类除外）；期间持续开、并把已激活的持续类技能延到 Fever 结束；Fever 结束强制结束它们。
//   * 「使已激活的盟约层数+1」= 所有已激活盟约（同蜜莓官方写法），含颂乐人偶自身。
//   * 丰川祥子 10%：非成员干员获得 Amoris/Timoris/Mortis 三项战斗效果的 10%（随 5 人翻倍）。
//   * 「可部署干员数量上限+1」在休整期那一半（meta/main.mjs，onBondChange 当帧生效）。

import * as S from '@battle/mod.js';
import {
  registerBondInstaller, registerGarrisonInstaller, reached, onLayers, onUnitDamaged, isEnemyTarget, ownTag, byUnit,
  fireGain, num,
} from '@battle/mod.js';

/** 每场战斗的额外安装（本 mod 的注册都在模块顶层完成，这里无需每场逻辑）。 */
export function install() {}

// =====================================================================================================================
// 颂乐人偶 核心盟约

/** 基础 chess id → 成员角色（丰川祥子 Oblivionis / 三角初华 Doloris / 祐天寺若麦 Amoris / 八幡海铃 Timoris / 若叶睦 Mortis）。 */
const ROLE_BY_CHESS = Object.freeze({
  chess_char_6_30: 'oblivionis',
  chess_char_5_30: 'doloris',
  chess_char_5_31: 'amoris',
  chess_char_5_32: 'timoris',
  chess_char_5_25: 'mortis',
});
const roleOf = (u) => {
  const b = String(u && (u.defId || u.def?.id) || '').replace(/_[ab]$/, '');
  return ROLE_BY_CHESS[b] || null;
};

const FEVER_CAP = 450;
const FEVER_TIME = 20;
const FEVER_PER_HIT = 2;
const FEVER_BUF = 'bond:avemujica:fever';
// Fever 期间**不再**强制回满技力：成员自身的技力照常恢复（业主 2026-10-17 裁决「fever 过程中会正常恢复角色自身原本的技力」），
// 「无视技力限制地持续开技能」由下面的 `skill.activate('fever', { free: true })` 承担（不消耗技力）。

/**
 * 客户端面板（`ui/fever.js`）读的**实时** Fever 读数：`pid -> { fever, cap, on, until }`。
 * 面板拿不到战场对象，只能靠模块级读数 —— 它按 `battleRunner.currentBattle().spec.workshopBattle` 里那条
 * `/workshop-battle/ave-mujica/battle/main.mjs?v=<hash>` 的**同一 URL** `import()` 本模块（ES module 按 URL
 * 去重 ⇒ 与运行器加载的是同一个实例），于是读得到这张表。只给本机自己那台客户端用；服务端跑战斗时本模块的
 * installer 不在浏览器里执行，这张表就是空的（面板会因此不画）。
 */
export const FEVER_LIVE = { byPid: Object.create(null) };

/**
 * 「颂乐音符」的**实时位置表**，与 `FEVER_LIVE` 同一套读法：`pid -> [[x, y, tracking], …]`（世界坐标：x = 列、
 * y = 行，都是格）。音符是**自建实体**（本模块自己积分），不进引擎的 `battle.projectiles` —— 引擎的弹道只在 sim
 * 侧飞，客户端的弹道视觉是**按 `atk` 事件**画的（`render/fx/projectiles.js`），自建弹道因此进不了那条渲染管线。
 * 所以位置由本模块每 tick 写进这张表，本包客户端面板（`ui/fever.js`）按它把音符画到屏幕上。
 */
export const NOTES_LIVE = { byPid: Object.create(null) };

/**
 * 颂乐人偶: 只要有成员在场即激活（thresholds [1..5]）。成员特质（每层叠加，5 人全部 ×2）：
 *   Amoris   全体颂乐人偶成员 ATK +(amoris_atk + amoris_atk_per·L)
 *   Timoris  成员攻击命中敌人：prob = (timoris_prob + timoris_prob_per·L) 停顿 timoris_dur 秒
 *   Mortis   成员攻击附带凋亡损伤 = (mortis_pct + mortis_pct_per·L) × 攻击力
 *   Doloris  Fever 获得量 ×fever_ratio
 *   Oblivionis 非成员干员获得上述三项效果的 obliv_share（5 人时再 ×2）
 *   Fever 系统见头注释。
 * 成员各自「毋畏X」特质的**另一半**（2026-10-14 补齐）：初华 攻击范围内成员攻击附带 bonus_scale×攻击力 法术伤害；
 *   海铃 在场时成员对停顿/恐惧敌人增伤 dmg_up；若叶睦 在场时全体成员生命上限 +max_hp；
 *   祥子「颂乐音符」成员按场上音符数无视 def_pen 防御 / res_pen 法抗。
 */
function installAveMujica(battle, pid, bb, members) {
  const memberSet = new Set(members);
  const st = S.battleStore(battle, 'avemujica:st', () => ({ fever: 0, until: -Infinity }));
  // 只读自省句柄（同 `battle._avemujicaNotes`）：把 Fever 读数挂出来，测试 / 调试可直接读。
  battle._avemujicaFever = st;
  const L = () => S.bondLayers(battle, pid, 'aveMujica');
  const dbl = () => (reached(battle, pid, 'aveMujica', 5) ? 2 : 1);
  const roles = () => {
    const r = { amoris: false, timoris: false, mortis: false, doloris: false, oblivionis: false };
    for (const u of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
      const k = roleOf(u);
      if (k) r[k] = true;
    }
    return r;
  };
  const feverOn = () => battle.time < st.until;
  const allOps = () => S.playerOps(battle, pid, { fieldOnly: true });

  // ---- 「毋畏X」各成员特质各自的 Fever 增量（2026-10-13 逐条接线）----------------------------------------------
  // 数值**逐条取自该干员 chess 记录里那条特质的 bb**（不写死在代码里）：
  //   丰川祥子   毋畏遗忘 bb.fever            3  对敌人造成伤害时（任意伤害来源，含技能）
  //   三角初华   毋畏悲伤 bb.fever            5  治疗【颂乐人偶】成员时
  //   祐天寺若麦 毋畏爱意 bb.fever_per_sec    3  在场时每秒
  //   八幡海铃   毋畏恐惧 bb.fever            2  使敌人停顿（Timoris 减速命中）时
  //   若叶睦     毋畏死亡 bb.cnt              3  自身受到一次伤害或损伤时
  // 这些增量一律走 gainFever() ⇒ 与「成员攻击填充 +2/次」共用同一套乘数（初华 ×fever_ratio、5 人 ×2）。
  const TALENT_NAME = Object.freeze({
    oblivionis: '毋畏遗忘', doloris: '毋畏悲伤', amoris: '毋畏爱意', timoris: '毋畏恐惧', mortis: '毋畏死亡',
  });
  /** 按名字取某个角色那条特质的 `bb`（`u.def.raw.talents`；找不到 ⇒ null）。 */
  const roleTalentBb = (u, role) => {
    const list = u && u.def && u.def.raw && Array.isArray(u.def.raw.talents) ? u.def.raw.talents : null;
    if (!list) return null;
    const t = list.find((x) => x && x.name === TALENT_NAME[role]);
    return t && t.bb && typeof t.bb === 'object' ? t.bb : null;
  };
  /** 该角色**当前在场**成员那条特质里 key 的数值（无该角色 / 不在场 / 无该键 ⇒ 0）。 */
  const traitFever = (role, key) => {
    for (const u of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
      if (roleOf(u) === role) return num((roleTalentBb(u, role) || {})[key], 0);
    }
    return 0;
  };
  /** 本场属于某角色的干员（含未上场）—— 用它们各自的任命挂 Fever 钩子。 */
  const roleUnits = (role) => S.playerOps(battle, pid, { fieldOnly: false }).filter((u) => roleOf(u) === role);
  /** 该角色**当前在场**的第一个成员（无 ⇒ null）。 */
  const fieldRole = (role) => S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true }).find((u) => roleOf(u) === role) || null;
  /** 按特质**名字**取 bb（「颂乐音符」等不在 TALENT_NAME 里的用它；`u.def.raw.talents`）。 */
  const talentBbByName = (u, name) => {
    const list = u && u.def && u.def.raw && Array.isArray(u.def.raw.talents) ? u.def.raw.talents : null;
    if (!list) return null;
    const t = list.find((x) => x && x.name === name);
    return t && t.bb && typeof t.bb === 'object' ? t.bb : null;
  };

  // ---- Amoris: 成员 ATK buff（refresh: deploy / layerGain / battleStart）
  const applyAtk = () => {
    const r = roles();
    const d = dbl();
    const pct = (num(bb.amoris_atk, 0.25) + num(bb.amoris_atk_per, 0.0005) * L()) * d;
    const share = num(bb.obliv_share, 0.25) * d;
    for (const u of allOps()) {
      const isM = memberSet.has(u);
      const eff = isM ? pct : (r.oblivionis ? pct * share : 0);
      if (r.amoris && eff > 0) S.passiveBuff(battle, u, 'bond:avemujica:atk', S.directMods({ atk: eff }));
      else battle.removeBuff(u, 'bond:avemujica:atk');
    }
  };
  // ---- Mortis「毋畏死亡」后半：在场时**全体成员**生命上限 +max_hp（原先是单挂自身）
  const applyHp = () => {
    const m = fieldRole('mortis');
    const hp = m ? num((roleTalentBb(m, 'mortis') || {}).max_hp, 0) : 0;
    for (const u of allOps()) {
      if (memberSet.has(u) && hp > 0) S.passiveBuff(battle, u, 'bond:avemujica:hp', S.directMods({ hp }));
      else battle.removeBuff(u, 'bond:avemujica:hp');
    }
  };
  // ---- 丰川祥子「毋畏遗忘」T2（2026-10-17 补齐）：复合攻击范围 + 攻击范围内干员攻速 +12
  // Wiki（E2）：其他 Ave Mujica 成员的攻击范围若与祥子**常规攻击范围**（不含延伸）有任何重合，则视作攻击范围的
  // **延伸**（复合范围 = 自己攻击范围 + 该成员视野范围；成员本身也用复合范围时只累加其**基础范围**）；
  // **攻击范围内干员攻击速度 +12**（潜能5 为 +16，代码读不到潜能 ⇒ 取 E2 的 12）。
  // 判定用引擎维护的 `u.baseRangeKeys`（本体网格 + 永久 rangeExtend，**不含** extraRangeKeys）—— 正是「常规范围」；
  // 延伸写在 `u.extraRangeKeys`（经 battle.setExtraRange），它只并入 `rangeKeys`/`rangeKeySet`、**不进** baseRangeKeys，
  // 所以基准不会被自己的延伸污染。
  const ASPD_BUF = 'bond:avemujica:aspd';
  const ASPD_AURA = 12; // E2；潜能5 = 16
  /** 绝对增量 → 面朝 RIGHT 的相对偏移（`server/sim/dir.js toLocal` 的等价实现；不新增 import 面）。 */
  const toLocal = (ar, ac, d) => {
    const D = typeof d === 'string' ? d.toUpperCase() : 'RIGHT';
    if (D === 'UP') return [0 - ac, ar];
    if (D === 'LEFT') return [0 - ar, 0 - ac];
    if (D === 'DOWN') return [ac, 0 - ar];
    return [ar, ac];
  };
  const applyRange = () => {
    const ob = fieldRole('oblivionis');
    if (ob && S.onField(ob)) {
      const base = new Set(Array.isArray(ob.baseRangeKeys) ? ob.baseRangeKeys : []);
      const extra = new Set();
      for (const m of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
        if (m === ob) continue;
        const keys = Array.isArray(m.baseRangeKeys) ? m.baseRangeKeys : null;
        if (!keys || !keys.length) continue;
        let overlap = false;
        for (const k of keys) if (base.has(k)) { overlap = true; break; }
        if (overlap) for (const k of keys) extra.add(k);
      }
      battle.setExtraRange(ob, [...extra]);
      // 详情卡画的攻击范围来自引擎的 `liveRangeGrid`（`shared/protocol.js unitStatsEntry` 的 `range`），而
      // `_refreshRange` **故意不含** extraRangeKeys（queries.js 注释：卡片保留基础网格）—— 所以再把「延伸后的
      // 实际范围」按当前朝向反算回相对网格写回去，卡片上才看得见延伸（纯展示，不影响战斗结算）。
      if (Array.isArray(ob.rangeKeys)) {
        const seen = new Set();
        const grid = [];
        for (const k of ob.rangeKeys) {
          const r = Math.floor(k / S.COLS), c = k % S.COLS;
          const [dr, dc] = toLocal(r - ob.tileR, c - ob.tileC, ob.dir);
          const key = `${dr},${dc}`;
          if (seen.has(key)) continue;
          seen.add(key);
          grid.push([dr, dc]);
        }
        if (grid.length) ob.liveRangeGrid = grid;
      }
    } else if (ob) {
      battle.setExtraRange(ob, []); // 未上场的祥子：清掉上一次留下的延伸
    }
    // 攻速光环：祥子（已含延伸）攻击范围内的干员（含祥子自身）
    const on = !!(ob && S.onField(ob));
    for (const u of allOps()) {
      if (on && S.inRange(ob, u)) S.passiveBuff(battle, u, ASPD_BUF, { aspd: ASPD_AURA });
      else battle.removeBuff(u, ASPD_BUF);
    }
  };
  // 团队 buff 一起刷新（成员进出场即时生效）：deploy / death / battleStart / layerGain / 每 0.5 s
  const refreshTeam = () => { applyAtk(); applyHp(); applyRange(); };
  refreshTeam();
  onLayers(battle, pid, 'aveMujica', refreshTeam);
  battle.on('deploy', ({ unit }) => { if (unit.ownerId === pid) refreshTeam(); });
  battle.on('death', ({ unit }) => { if (unit && unit.ownerId === pid) refreshTeam(); });
  battle.on('battleStart', refreshTeam);
  battle.every(0.5, refreshTeam);

  // ---- Timoris / Mortis / Fever 的伤害钩子（对每个己方干员注册；丰川祥子在场时非成员吃 25%）
  /** 本场的身份，随读数一起发出去（客户端面板只认「本场」的记录）。
   *  ⚠️ 不能用 `battle.battleId`：`installContent` 在 Battle 的**构造函数里**跑，而 `battleId` 是构造完之后
   *  （`sim/spec.js` `createBattleFromSpec`）才赋给这个对象的 ⇒ 这里读到的永远是 undefined。改用 spec 上
   *  两边都拿得到的那几项拼一条（面板从 `battleRunner.currentBattle().spec` 算同一条）。 */
  const liveKey = `${battle.fieldId ?? ''}|${battle.round ?? 0}|${battle.seed ?? 1}|${battle.kind ?? ''}`;
  /** 把本玩家当前的 Fever 读数写进模块级表（客户端面板读它画积攒进度条）。 */
  const pub = () => {
    // `full`（五名不同成员是否全在场上 ⇒ 面板据此选 Fever 音乐）与 `len`（一段 Fever 的总时长，面板据此把
    // 成员自己的技力条整条换成**共用**的玫红 Fever 条、按剩余时间填充 ⇒ 全员同时结束）随读数一起发出去。
    const r = roles();
    FEVER_LIVE.byPid[pid] = {
      fever: st.fever, cap: FEVER_CAP, on: feverOn(), until: st.until, len: FEVER_TIME,
      full: !!(r.amoris && r.timoris && r.mortis && r.doloris && r.oblivionis),
      // 面板只认**这一场**的记录（`ui/fever.js` 的 paint）：模块级表跨战斗不清，没有它时上一场的
      // `on: true` 会被下一场直接当成「Fever 正在开」（业主 2026-10-20 报的音乐异常）。
      key: liveKey,
    };
  };
  const gainFever = (n) => {
    if (feverOn()) return;
    const r = roles();
    const mult = (r.doloris ? num(bb.fever_ratio, 2) : 1) * dbl();
    st.fever = Math.min(FEVER_CAP, st.fever + n * mult);
    if (st.fever >= FEVER_CAP) {
      st.fever = 0;
      st.until = battle.time + FEVER_TIME;
      interruptFeverSkills(); // 触发那一刻：先强制打断在场成员当前正在释放的技能
      openFeverSkills();      // 紧接着立刻重开一次（Fever 技能机制）
      // 锚点必须是**一个在场成员**：`fxOn` 的第 3 个参数是锚定单位，传 null 会被 `if (!u) return` 直接吞掉
      // （旧代码就是这么写的 ⇒ 这条特效从来没发射过）。锚一个成员，品红团队光环才会真的画出来。
      const anchor = S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true }).find((m) => !!m) || null;
      if (anchor) S.fxOn(battle, 'fever', anchor, 'bond:avemujica', 'fever', { duration: FEVER_TIME });
    }
    pub();
  };
  const onDmg = (ctx) => {
    const u = ctx.source, t = ctx.target, dmg = ctx.dmg;
    if (!u || !dmg || !dmg.isAttack || !isEnemyTarget(t) || ownTag(dmg, 'bond:avemujica')) return;
    const r = roles();
    const d = dbl();
    const share = memberSet.has(u) ? 1 : (r.oblivionis ? num(bb.obliv_share, 0.25) * d : 0);
    if (!(share > 0)) return;
    if (r.timoris) {
      const p = (num(bb.timoris_prob, 0.25) + num(bb.timoris_prob_per, 0.0005) * L()) * d * share;
      if (p > 0 && battle.rng() < Math.min(1, p)) {
        battle.applyStatus(t, 'sluggish', { duration: num(bb.timoris_dur, 1), source: u });
        // 八幡海铃「毋畏恐惧」：造成停顿时 Fever +bb.fever
        const nf = traitFever('timoris', 'fever');
        if (nf > 0) gainFever(nf);
      }
    }
    if (r.mortis) {
      const pct = (num(bb.mortis_pct, 0.25) + num(bb.mortis_pct_per, 0.0005) * L()) * d * share;
      if (pct > 0) {
        battle.dealDamage(u, t, { amount: pct * u.s.atk, type: 'element', element: 'apoptosis', canDodge: false, tags: ['bond:avemujica'] });
      }
    }
    // 三角初华「毋畏悲伤」后半：攻击范围内的成员攻击时，附带「初华攻击力 × bonus_scale」的法术伤害
    if (memberSet.has(u) && r.doloris) {
      const dl = fieldRole('doloris');
      const bs = dl ? num((roleTalentBb(dl, 'doloris') || {}).bonus_scale, 0) : 0;
      if (bs > 0 && S.inRange(dl, u)) {
        battle.dealDamage(u, t, { amount: dl.s.atk * bs, type: 'arts', canDodge: false, tags: ['bond:avemujica'] });
      }
    }
    gainFever(FEVER_PER_HIT);
  };
  for (const u of S.playerOps(battle, pid, { fieldOnly: false })) onUnitDamaged(battle, u, onDmg);

  // ---- 八幡海铃「毋畏恐惧」后半：在场时，成员对处于停顿/恐惧的敌人造成的伤害 ×(1 + dmg_up)
  const debuffed = (t) => Array.isArray(t && t.buffs) && t.buffs.some((b) => b && (b.status === 'sluggish' || b.status === 'fear'));
  battle.on('hit', (c) => {
    const dmg = c.dmg, t = c.target;
    if (!dmg || !isEnemyTarget(t) || !memberSet.has(c.source) || !debuffed(t)) return;
    const tm = fieldRole('timoris');
    const v = tm ? num((roleTalentBb(tm, 'timoris') || {}).dmg_up, 0) : 0;
    if (v > 0) dmg.mul *= 1 + v;
  });

  // ---- 祥子**攻击那一下**的即时伤害置 0：普攻与**技能攻击**的伤害都改由「音符到达目标」时结算 —— wiki 把音符
  // 写成伤害本体（S1「依次演奏 8 个音符造成…」、S2「音符造成法术伤害」、S3「各自演奏 2 个造成相当于攻击力 140%…的音符」），
  // 而 kit（`kits/chess_char_6_30_a.js`）已经把这三条技能的 `hits` / `atkScale` 教给了引擎 ⇒ 引擎每一下攻击自己也
  // 会打出同样的伤害 ⇒ 两套并存就是**双倍**（S3 期间实测是「引擎 4 下 ×1.4 + 自建音符 4 枚 ×1.4」）。
  // 这里把「**由攻击产生**」的那份置 0（`isAttack` 为真时，普攻与技能攻击都算），音符照旧承担伤害。
  // ⚠️ 只压 `isAttack` 的那种：kit 的 S1 是 `onStart` 里直接 `dealDamage`（不带 `isAttack`）的 8 下 —— 那是 S1 唯一
  // 的伤害来源（本包没为它建音符实体），**必须留着**。命中判定 / 动画 / 命中特效仍照常发生。
  battle.on('hit', (c) => {
    const d = c.dmg;
    if (!d || !d.isAttack || !c.source || roleOf(c.source) !== 'oblivionis') return;
    if (c.source.ownerId !== pid) return;
    if (ownTag(d, 'am:note')) return; // 音符**自己**那一下正是伤害的承担者，不能再被压成 0
    d.mul = 0;
  });

  // ---- 丰川祥子「颂乐音符」T1（2026-10-17 重写；2026-10-18 按 PRTS Wiki 逐条校正）
  // Wiki（E2）逐条：
  //   · 祥子**无论攻击范围内是否有目标都会持续攻击**；攻击会演奏**追踪敌人的音符**，音符飘出攻击范围一段时间后消失；
  //     每存在 1 个音符 ⇒ Ave Mujica 成员**无视敌人 def_pen 防御 / res_pen 法抗**（≤ max_stack 层）。
  //   · **祥子没有「主动普攻」**：她的攻击**全部**由「持续攻击」循环奏出（`battle.every(NOTE_DT)` 那一支）——
  //     引擎自己有目标时照常发它自己的 `attack`（那一下伤害已被置 0），但**不再由它产生音符**。早期版本由那条
  //     钩子把引擎选中的 `targets[0]` 当音符的出生目标，音符才会「一直锁定在敌人身上」（业主 2026-10-18 纠正）。
  //   · 音符**出生一律不带追踪目标**，自己飘出去按天赋的流程索敌（自由移动 → 自身半径内最近的敌人 → 追踪移动）；
  //     唯一例外是 **S3**：它的规则本身要求「分别追踪法术抗性/防御力最高的敌人」，所以那 4 枚出生即带规则选出的目标。
  //   · 两态【自由移动】/【追踪移动】（非技能与 S3 的音符都**不存在**【已命中】态 ⇒ 命中即出列）；
  //     状态**每 0.4 s 更新**一次；自由移动有**最短自由移动时间**（未到时即使已有目标也先飘）；
  //     自由移动时**仅在「不存在有效追踪目标」时**才选「自身一定范围内**距离音符最近**」的敌人；
  //     追踪目标失效 ⇒ **以当前运动方向**重新进入自由移动。
  //   · 初始方向：祥子朝向左 20°~右 20° 内随机一个角度（wiki 天赋备注限定「未开启技能时」，但 S3 备注又写明
  //     「技能期间同样随机」⇒ 这里一贯随机）。
  //   · 运动参数按「**这一拍她攻击范围内有无敌人** / 是否技能期间」分**三套**（见 NOTE_PROFILES）。
  //   · 音符位于**自身攻击范围外**且**连续 1 s 以上无追踪目标** ⇒ 消失；祥子退场 ⇒ 清除所有**不处于追踪中**的音符。
  //   · **所有音符强制使用缓存攻击力与攻击倍率**：**发射时若祥子未阻挡敌人** ⇒ 该音符算**远程** ⇒ 永远吃特性 80% 倍率；
  //     **发射时正在阻挡敌人** ⇒ 算**近战** ⇒ **不吃** 80%（即使阻挡目标之后死亡、该音符转去攻击别人也照样不吃）
  //     ⇒ 这一位在**出生那一刻定死**（`n.melee`），命中时不再现算。
  //   · 穿透：每个 Ave Mujica 成员造成伤害时按**当前音符数**加物理/法术穿透（直接加算），**祥子命中目标的那一枚也计入**
  //     ⇒ 命中结算**放在出列之前**；本包按 0.25 s 周期刷新 buff 近似（结算时那一枚通常已在列表里）。
  //
  // 音符是**自建实体、自己积分**（引擎 `addProjectile` 只在 sim 侧飞，客户端弹道视觉按 `atk` 事件画 ⇒ 自建弹道进不了
  // 那条渲染管线；位置改由 `NOTES_LIVE` 交给本包客户端面板绘制）。
  // 「普攻把音符直接打到敌人身上」那一下不是这里 —— 那是**引擎自己画的官方普攻弹道**，已在本包 fx 索引里清掉
  // （见 README §7.8），看得见的音符只有这一套自建弹道。
  // 已知近似：不做【已命中】的固定停留时长；S1/S2 的音符参数（各有自己的一套）仍按「技能期间」通用档近似。
  const NOTE_BUF = 'bond:avemujica:note';
  const NOTE = Object.freeze({
    UPDATE: 0.4,          // 状态更新间隔（s）
    ACQUIRE_R: 1.0,       // 自由移动时的追踪范围半径（格）
    HIT_R: 0.35,          // 命中半径（本包自定：到达即出列）
    OUT_LIMIT: 1.0,       // 出范围且无目标持续多久消失（s）
    LIFE: 12,             // 安全上限（s）
    SWEEP: (20 * Math.PI) / 180, // 初始方向的 ±20°
    RANGED_MUL: 0.8,      // 未阻挡（领主远程）时特性的 80% 攻击倍率（wiki：音符强制用缓存攻击力与攻击倍率）
  });
  /** 三套音符运动参数（wiki 逐条）。`freeKind`：自由移动方式 —— 'sine' =【扩张正弦】、'straight' = 固定速度直行。
   *  分档只看「**这一拍她攻击范围内有没有可选敌人**」与「是不是技能期间」，**与音符有没有追踪目标无关**。 */
  const NOTE_PROFILES = Object.freeze({
    // 技能外 · **攻击范围内无敌人**：扩张正弦（基础振幅 0.3、x 速度 1.3）；最短自由 0.1 s；追踪 2.0、转向 7/30
    loose: Object.freeze({ freeKind: 'sine',     amp: 0.3, xSpeed: 1.3, minFree: 0.1, trackSpeed: 2.0, turn: 7 / 30 }),
    // 技能外 · **攻击范围内有敌人**：固定 2.0 沿当前方向直行；最短自由 0.1 s；追踪 2.0、转向 1/6
    aim:   Object.freeze({ freeKind: 'straight', amp: 0,   xSpeed: 2.0, minFree: 0.1, trackSpeed: 2.0, turn: 1 / 6 }),
    // **技能期间**（无论范围内有无敌人）：扩张正弦（基础振幅 0.5、x 速度 0.8）；最短自由 0.8 s；追踪 1.3、转向 1/4
    skill: Object.freeze({ freeKind: 'sine',     amp: 0.5, xSpeed: 0.8, minFree: 0.8, trackSpeed: 1.3, turn: 1 / 4 }),
  });
  /** 她此刻是否**正在释放技能**（wiki：音符参数按此分档；面板也靠它决定播不播技能攻击段）。 */
  const inSkill = (u) => !!(u && u.skill && u.skill.active);
  /** 该音符该用哪一套运动参数（wiki：**技能期间** / 技能外·**攻击范围内有敌** / 技能外·**无目标** 三档）。
   *  入参 `foeInRange` = 这一拍她攻击范围内有没有可选敌人 —— **不是**「音符有没有追踪目标」（音符出生一律**不带**目标）。 */
  const profileFor = (u, foeInRange) => (inSkill(u) ? NOTE_PROFILES.skill : (foeInRange ? NOTE_PROFILES.aim : NOTE_PROFILES.loose));
  const NOTE_DT = 1 / 30; // 引擎帧
  //   `engineAtk`：本帧引擎自己开过火的成员 id（`attack` 钩子写的）—— 供「持续攻击」循环判断技力别重复给。
  const noteState = S.battleStore(battle, 'avemujica:notes', () => ({ list: [], at: new Map(), engineAtk: new Set() }));
  // 只读自省句柄（与引擎 `globalThis.__SP_VIEW__` 同一种用法）：把音符表挂到 battle 上，测试 / 调试可直接读。
  battle._avemujicaNotes = noteState;
  const norm2 = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  /** 祥子的朝向单位向量（用引擎的 `frontTile` 反推，四方向都正确）。 */
  const facingVec = (u) => { const [fr, fc] = S.frontTile(u, 1); return norm2(fc - u.tileC, fr - u.tileR); };
  /** 被任意【颂乐人偶】成员（**超集**：含祥子自己，见 README §7.20）阻挡的敌人 —— 阻挡关系取引擎自己的那一份
   *  （`server/sim/battle/blocking.js`：敌人 `e.blockedBy` 指向阻挡它的我方单位），成员判定复用 `roleOf`（五名成员的
   *  chess id），不自己重实现阻挡。 */
  const blockedByMember = (e) => !!(e && e.blockedBy && roleOf(e.blockedBy));
  /** 音符的索敌候选：**自身半径 `r` 内**的敌人 **或** **被任意【颂乐人偶】成员阻挡**的敌人（业主 2026-10-18：
   *  「被其他 ave mujica 成员阻挡的目标也会成为丰川祥子射出音符的索敌目标」）。两类敌人合成**同一个候选池**，仍按
   *  原来的规则取「离音符最近的一个」；被成员阻挡的敌人**不必在半径内**（阻挡它的成员可能在别处，音符照样锁它）。
   *  `e.hidden` 不可选。S3 那两对的 `prefer`（最高法抗 / 最高防御）走 `bestInRange`，规则不变。 */
  const nearestEnemy = (x, y, r) => {
    let best = null, bd = Infinity;
    const r2 = r * r;
    for (const e of battle.enemies) {
      if (!e || !e.alive || e.hidden) continue;
      const dx = e.x - x, dy = e.y - y, d2 = dx * dx + dy * dy;
      if (d2 > r2 && !blockedByMember(e)) continue;
      if (d2 <= bd) { bd = d2; best = e; }
    }
    return best;
  };
  /** 她攻击范围内**按规则**选目标：`pick='res'` ⇒ 法术抗性最高，`pick='def'` ⇒ 防御力最高（S3 两对的索敌）。 */
  const bestInRange = (u, pick) => {
    if (!u) return null;
    let best = null, bv = -Infinity;
    for (const e of battle.enemies) {
      if (!e || !e.alive || e.hidden || !S.inRange(u, e)) continue;
      const v = pick === 'res' ? num(e.s && e.s.res, -Infinity) : num(e.s && e.s.def, -Infinity);
      if (v > bv) { bv = v; best = e; }
    }
    return best;
  };
  /** 她攻击范围内是否有可选敌人（wiki：判定「前方一格通行类型」的前提）。 */
  const enemyInRange = (u) => {
    for (const e of battle.enemies) if (e && e.alive && !e.hidden && S.inRange(u, e)) return true;
    return false;
  };
  /** 朝向的**前方一格**地块是否可通行（wiki：攻击范围内不存在敌人时，前方一格「通行类型 = 无」⇒ 无法发射音符）。 */
  const frontPassable = (u) => {
    const [fr, fc] = S.frontTile(u, 1);
    const t = battle.grid && battle.grid.tile ? battle.grid.tile(fr, fc) : null;
    return !!(t && t.pass !== 'NONE');
  };
  /** 她**现行装备**那条技能的 index —— 从**运行时**的技能 def 读（`u.skill.def.index`，退回 `u.def.skill.index`）。
   *  ⚠️ 别用 `u.skill.index`：`SkillRuntime` 上**没有**这个字段（恒为 `undefined`）；更别用 `raw.backup.skillIndex`
   *  —— 那是 chess 记录里「默认/备份」的技能选择，**与当前装备无关**。实测（`test/` 的 harness 起一场真实战斗）：
   *  祥子装备 S3 时 `raw.backup.skillIndex` 仍是 **1** ⇒ 读到的是 S2 的档（2 枚法术音符），S3 的混档根本取不到。 */
  const skillIndexOf = (u) => {
    const a = u && u.skill && u.skill.def && u.skill.def.index;
    if (Number.isInteger(a)) return a;
    const b = u && u.def && u.def.skill && u.def.skill.index;
    return Number.isInteger(b) ? b : null;
  };
  /** 当前**生效**技能的「攻击档」（数据来源 = 她**正在生效**那条技能记录的 bb：`u.def.raw.skills[idx].bb`）：
   *  ⚠️ **技能没生效就一律 null**（⇒ 持续攻击只奏 1 枚）：装备了 S3 但没开技能时**不该**有那些额外音符
   *  —— 业主 2026-10-18：「开启 3 技能时才会额外演奏 4 个音符（2 钢琴、2 风琴），正常持续攻击时只有 1 个音符」。
   *   · S3「残月的余响」⇒ `{ mixed: true, half, scale }`（钢琴 物理 + 风琴 法术，各 `half` 枚、同倍率）；
   *   · 其他多连击技能（S1/S2）⇒ `{ mixed: false, hits, scale, arts }`（她的多连击在 kit 里都写死为法术伤害）；
   *   · 普通普攻 / 单枚无倍率 ⇒ null（按普通普攻那套走，1 枚音符）。 */
  const activeSkillAttack = (u) => {
    if (!inSkill(u)) return null;
    const raw = u && u.def && u.def.raw;
    const list = raw && Array.isArray(raw.skills) ? raw.skills : null;
    if (!list) return null;
    const idx = skillIndexOf(u);
    if (idx == null || !list[idx]) return null;
    const sk = list[idx];
    const bb = sk.bb || null;
    if (!bb) return null;
    const hits = Math.max(1, Math.floor(num(bb.hits, 1)));
    const scale = num(bb.atk_scale, 1);
    // 混档 = 一次攻击同时奏两种音色（S3）：数据上以「没有 dmgType」为标志，再兜一条 skillId 白名单（防数据被改）。
    if (sk.skillId === 'skchr_oblvns_3' || (bb.dmgType == null && hits >= 2)) {
      return { mixed: true, half: Math.max(1, Math.floor(hits / 2)), scale };
    }
    if (hits <= 1 && Math.abs(scale - 1) < 1e-6) return null;
    return { mixed: false, hits, scale, arts: true };
  };

  /** 演奏一枚音符。`u` = 祥子；`t` = 出生时的追踪目标 —— **现在一律传 `null`**（祥子没有「主动普攻」，
   *  音符出生**不带**目标，自己飘出去按天赋的流程索敌）；`opt` 可带 `{ profile, scale, arts, prefer }`。 */
  let noteSeq = 0;
  const playNote = (u, t, opt = null) => {
    if (!u || !S.onField(u)) return;
    const [bx, by] = facingVec(u);
    const a = (battle.rng() * 2 - 1) * NOTE.SWEEP;         // ±20° 随机初始角
    const ca = Math.cos(a), sa = Math.sin(a);
    const dir = norm2(bx * ca - by * sa, bx * sa + by * ca);
    const target = t || null;
    const n = {
      id: (noteSeq += 1),             // 面板按它把官方音符特效**逐个**跟住（跨帧 1:1，见 NOTES_LIVE）
      x: u.x, y: u.y, dir,
      src: u,                         // 演奏者（命中时结算伤害用；wiki：音符用「缓存攻击力」）
      atk: u.s.atk,                   // 出生那一刻的攻击力快照
      scale: opt ? num(opt.scale, 1) : 1,   // 技能期间 = 该技能的 atk_scale；平时 1
      arts: !!(opt && opt.arts),      // 技能期间的多连击音符 = 法术伤害
      prefer: (opt && opt.prefer) || null,  // S3 那两对的索敌规则（'res' / 'def'）；其余 null
      melee: !!(u.blocking && u.blocking.length),  // 出生时**正在阻挡敌人** ⇒ 近战（wiki：不吃 80%，且之后也不吃）
      kind: target ? 'attack' : 'loose',   // 出生时有没有带着追踪目标（只作标注）
      skillOn: inSkill(u),            // 出生时她**是否在技能中**（面板据此决定要不要让她播攻击段）
      profile: (opt && opt.profile) || profileFor(u, !!target || enemyInRange(u)),
      mode: 'free',
      target,
      born: battle.time,
      nextUpdate: battle.time + NOTE.UPDATE,
      freeSince: battle.time,
      sine: { ox: u.x, oy: u.y, ax: dir[0], ay: dir[1], sign: battle.rng() < 0.5 ? -1 : 1, t0: battle.time },
      outSince: null,
    };
    noteState.list.push(n);
    noteState.at.set(u.id, battle.time);
  };
  /** S3「残月的余响」的攻击档：钢琴（**物理**）`half` 枚 + 风琴（**法术**）`half` 枚，**各自按 S3 自己的规则索敌**
   *  —— 钢琴（物理）追「**法术抗性**最高」、风琴（法术）追「**防御力**最高」（wiki 原文「……物理和法术伤害的音符，
   *  且**分别追踪法术抗性和防御力最高的敌人**」—— 两串名单**顺序对位**：物理↔法术抗性、法术↔防御力）。
   *  这是 S3 自己的「选择的目标」——**不是**祥子这一击打了谁（S3 的规则本来就要求「分别追踪…最高的」，
   *  没有这个出生目标就无从「分别」）。它们同样先走【自由移动】（技能档：扩张正弦、最短 0.8 s）再【追踪移动】，
   *  就是天赋那句「攻击会演奏**追踪敌人的**音符」；规则记在音符的 `prefer` 上：**追踪目标失效**后仍按该规则重选。
   *  它是「持续攻击」循环在 **S3 生效**时走的那一支（祥子没有主动普攻，这是唯一的发射路径）。 */
  const playMixed = (u, prof) => {
    const pRes = bestInRange(u, 'res');   // 物理（钢琴）那对的目标
    const pDef = bestInRange(u, 'def');   // 法术（风琴）那对的目标
    for (let i = 0; i < prof.half; i += 1) playNote(u, pRes, { profile: NOTE_PROFILES.skill, scale: prof.scale, arts: false, prefer: 'res' });
    for (let i = 0; i < prof.half; i += 1) playNote(u, pDef, { profile: NOTE_PROFILES.skill, scale: prof.scale, arts: true, prefer: 'def' });
  };
  /** 当前音符数（= 列表长度；寿命/命中的出列都在下面的 tick 里做）。 */
  const noteCount = () => noteState.list.length;
  const applyNotes = () => {
    const ob = fieldRole('oblivionis');
    const tb = ob ? talentBbByName(ob, '颂乐音符') : null;
    const cap = tb ? Math.max(0, Math.floor(num(tb.max_stack, 0))) : 0;
    const n = cap > 0 ? Math.min(cap, noteCount()) : 0;
    const defPen = tb ? num(tb.def_pen, 0) : 0;
    const resPen = tb ? num(tb.res_pen, 0) : 0;
    const mods = {};
    if (n > 0 && defPen > 0) mods.defIgnorePct = n * defPen;
    if (n > 0 && resPen > 0) mods.resIgnorePct = n * resPen;
    const has = Object.keys(mods).length > 0;
    for (const u of allOps()) {
      if (memberSet.has(u) && has) S.passiveBuff(battle, u, NOTE_BUF, mods);
      else battle.removeBuff(u, NOTE_BUF);
    }
  };
  applyNotes();
  battle.every(0.25, applyNotes);
  // ⚠️ **祥子没有「主动普攻」这条攻击**（业主 2026-10-18）：她的攻击**全部**是下面那支「持续攻击」循环
  // （天赋：**无论攻击范围内是否有目标都会持续攻击**）；引擎自己有目标时照常发它自己的 `attack`（那一下的伤害
  // 已被上面的 `hit` 钩子置 0），但**这条钩子不再发音符** —— 早期版本正是由它把引擎选中的 `c.targets[0]` 当成
  // 音符的出生目标，音符才会「一直锁定在敌人身上」。这里只留一个「这一拍引擎已经开过火」的标记，给下面的循环
  // 判断技力别重复给（引擎给自己会给 `spType === 'attack'` 的技力，见 `server/sim/skills.js`）。
  battle.on('attack', (c) => {
    const u = c && c.attacker;
    if (!u || u.ownerId !== pid || roleOf(u) !== 'oblivionis' || c.isSkill) return;
    noteState.engineAtk.add(u.id);
  });
  // 「持续攻击」（**唯一**的演奏路径）：按自身攻击间隔（`s.interval`，随攻速变化）持续奏出音符 ——
  // 引擎有没有目标都照奏。音符**出生时不带追踪目标**，自己飘出去再按天赋的流程索敌（自由移动 → 半径内最近的
  // 敌人 → 追踪）；运动参数仍照 wiki 按「技能期间 / 技能外·攻击范围内有敌 / 技能外·无目标」三档取（`foe` 只决定
  // 用哪一档，**不是**给音符预设一个目标）。wiki 另有一条：**攻击范围内不存在敌人**时，若朝向的**前方一格地块
  // 通行类型 = 无**，则无法发射音符 ⇒ 这里直接跳过。
  // ⚠️ **不看 `u.atkCd`**：引擎自己有目标时一直在开火、`atkCd` 长期为正 —— 那会把这支唯一的演奏路挡死。
  // **技力**：引擎这一拍自己开过火 ⇒ 它已经给过技力，这里不重复给；它没开火（范围内无目标那一路）⇒ 按同一条
  // 判据（技能持续期间不给）在**射出去的那一刻**补上（业主 2026-10-17：不必命中）。
  battle.every(NOTE_DT, () => {
    for (const u of roleUnits('oblivionis')) {
      if (!S.onField(u)) continue;
      const iv = (u.s && u.s.interval > 0) ? u.s.interval : 1.3;
      if (battle.time - (noteState.at.get(u.id) ?? -Infinity) < iv) continue;
      const foe = enemyInRange(u);
      if (!foe && !frontPassable(u)) continue;   // wiki：前方一格通行类型 = 无 ⇒ 不发射
      // S3 ⇒ 钢琴 + 风琴各 2 枚、各按 S3 自己的规则索敌；其余多连击技能 ⇒ 同倍率（**S2 的二连击只在 Fever 期间**，
      // wiki：「Fever 期间变为当前音色的二连击」⇒ 平时只奏 1 枚）；否则一枚普通音符。
      const prof = activeSkillAttack(u);
      if (prof && prof.mixed) playMixed(u, prof);
      else if (prof) {
        const times = prof.hits > 1 && !feverOn() ? 1 : prof.hits;   // S2：非 Fever 只 1 枚
        for (let i = 0; i < times; i += 1) playNote(u, null, { profile: NOTE_PROFILES.skill, scale: prof.scale, arts: prof.arts });
      } else playNote(u, null, { profile: NOTE_PROFILES[inSkill(u) ? 'skill' : (foe ? 'aim' : 'loose')] });
      if (!noteState.engineAtk.delete(u.id)
        && u.skill && u.skill.spType === 'attack' && !(u.skill.active && u.skill.isTimed)) u.skill.gainSp(1, 'attack');
    }
  });
  // 音符积分：每帧按 NOTE 的参数推进位置、每 0.4s 更新行动状态、判定命中与消失，并把位置发到 `NOTES_LIVE`
  // 交给本包客户端面板（`ui/fever.js`）绘制。
  battle.every(NOTE_DT, () => {
    const ob = fieldRole('oblivionis');
    const inField = !!(ob && S.onField(ob));
    const l = noteState.list;
    for (let i = l.length - 1; i >= 0; i--) {
      const n = l[i];
      if (!inField && n.mode !== 'track') { l.splice(i, 1); continue; } // 祥子退场 ⇒ 清除非追踪中的音符
      // 【索敌】非 S3 的音符（`prefer` 为空）**出生不带目标** ⇒ **每一帧都试一次**「自身半径内最近 / **被任意成员
      // 阻挡**（超集，见 §7.20）的敌人」，一旦有敌人进来就立刻锁定。为什么不能只在 0.4 s 的「状态更新」那一刻采样
      // 一次：音符以 2.0 格/s 飞行时两次采样之间会走 0.8 格 —— 它**可能整段从敌人身侧掠过**（两次采样都不在
      // 1.0 半径内）⇒ 永远锁不上、飞出攻击范围后 1 s 消失（业主 2026-10-18：「有些时候音符在场上却没办法及时索敌」）。
      // ⚠️ 状态机的节拍（0.4 s 更新 / 最短自由移动时间 / 追踪↔自由 的切换）**仍按 wiki 走**，这里只是把
      // 「选目标」这一步从「每 0.4 s 一次」提前到「每帧一次」；规则本身没变（还是「半径内最近」＋ §7.20 的阻挡项）。
      // `prefer`（S3 那两对）不走这里 —— 它们按自己的规则（最高法抗 / 最高防御）在状态更新时重选。
      if (n.mode === 'free' && !n.prefer && (!n.target || !n.target.alive || n.target.hidden)) {
        n.target = nearestEnemy(n.x, n.y, NOTE.ACQUIRE_R);
      }
      // 每 0.4s 更新一次行动状态（wiki：自由移动**只在「不存在有效追踪目标」时**才去选最近的敌人）
      while (battle.time + 1e-9 >= n.nextUpdate) {
        n.nextUpdate += NOTE.UPDATE;
        if (n.mode === 'free') {
          if (n.target && (!n.target.alive || n.target.hidden)) n.target = null;
          if (!n.target) {
            // S3 那两对按自己的规则重选（法术抗性最高 / 防御力最高）；其余音符取**自身半径内最近 / 被任意成员阻挡的**敌人
            n.target = n.prefer ? bestInRange(ob, n.prefer) : nearestEnemy(n.x, n.y, NOTE.ACQUIRE_R);
          }
          if (n.target && battle.time - n.freeSince >= n.profile.minFree) n.mode = 'track';
        } else if (!n.target || !n.target.alive || n.target.hidden) {
          // 追踪目标失效 ⇒ 以当前运动方向重新进入【自由移动】（重开一段自由移动）
          n.mode = 'free';
          n.freeSince = battle.time;
          n.target = null;
          n.sine = { ox: n.x, oy: n.y, ax: n.dir[0], ay: n.dir[1], sign: battle.rng() < 0.5 ? -1 : 1, t0: battle.time };
        }
      }
      if (n.mode === 'track') {
        // 追踪：【追踪移动】固定速度（本档）向目标移动；方向每帧按转向速度权重转向目标
        const w = norm2(n.target.x - n.x, n.target.y - n.y);
        const k = n.profile.turn;
        n.dir = norm2(n.dir[0] * (1 - k) + w[0] * k, n.dir[1] * (1 - k) + w[1] * k);
        n.x += n.dir[0] * n.profile.trackSpeed * NOTE_DT;
        n.y += n.dir[1] * n.profile.trackSpeed * NOTE_DT;
        const dx = n.target.x - n.x, dy = n.target.y - n.y;
        if (dx * dx + dy * dy <= NOTE.HIT_R * NOTE.HIT_R) {
          // 命中 ⇒ **结算伤害**：wiki「所有音符强制使用缓存攻击力与攻击倍率」；倍数 = 该档 atk_scale × 特性倍率
          // （`n.melee` = 出生时祥子正在阻挡敌人 ⇒ 近战 ⇒ 不吃 80%）。结算**放在出列之前**（wiki：命中那一枚也计入穿透）。
          // 引擎无【已命中】态 ⇒ 结算完立刻出列。祥子**普攻**的即时伤害已在上面 `hit` 钩子里置 0 ⇒ 不会双倍。
          const target = n.target;
          if (n.src && n.src.alive) {
            const mul = (n.melee ? 1 : NOTE.RANGED_MUL) * (n.scale || 1);
            battle.dealDamage(n.src, target, { amount: n.atk * mul, type: n.arts ? 'arts' : 'phys', isAttack: true, tags: ['am:note'] });
          }
          l.splice(i, 1);
          continue;
        }
      } else if (n.profile.freeKind === 'sine') {
        // 【自由移动】=【扩张正弦】解析解：s = x 方向速度 × 已过时间；横向 = A·sin(s)，A = 基础振幅 × min(3, 周期序号)
        const s = n.profile.xSpeed * (battle.time - n.sine.t0);
        const per = Math.min(3, Math.floor(s / (2 * Math.PI)) + 1);
        const ly = n.profile.amp * per * Math.sin(s) * n.sine.sign;
        const px = n.sine.ox + n.sine.ax * s - n.sine.ay * ly;
        const py = n.sine.oy + n.sine.ay * s + n.sine.ax * ly;
        n.dir = norm2(px - n.x, py - n.y);
        n.x = px; n.y = py;
      } else {
        // 【自由移动】= 固定速度沿**当前方向直行**（wiki：技能外·有目标那一档）
        n.x += n.dir[0] * n.profile.xSpeed * NOTE_DT;
        n.y += n.dir[1] * n.profile.xSpeed * NOTE_DT;
      }
      // 在祥子攻击范围外 且 连续 1s 无追踪目标 ⇒ 消失
      const inRange = inField && !!ob.rangeKeySet
        && ob.rangeKeySet.has(Math.round(n.y) * S.COLS + Math.round(n.x));
      if (!n.target && !inRange) {
        if (n.outSince == null) n.outSince = battle.time;
        else if (battle.time - n.outSince >= NOTE.OUT_LIMIT) { l.splice(i, 1); continue; }
      } else n.outSince = null;
      if (battle.time - n.born >= NOTE.LIFE) l.splice(i, 1); // 安全上限
    }
    NOTES_LIVE.byPid[pid] = l.map((n) => [
      Math.round(n.x * 1000) / 1000, Math.round(n.y * 1000) / 1000, n.mode === 'track' ? 1 : 0,
      n.id, Math.round(n.dir[0] * 1000) / 1000, Math.round(n.dir[1] * 1000) / 1000,
      n.kind === 'loose' ? 1 : 0,   // 7th: 这枚是「无目标」那一支（引擎不发 atk）
      n.skillOn ? 1 : 0,            // 8th: 演奏它时**祥子在技能中** —— 只有这时面板才该让她播技能的攻击段
    ]);
  });

  // ---- 祐天寺若麦「持续攻击」（业主 2026-10-18，与祥子同款）：攻击范围内**没有**目标时也按自身攻击间隔出手。
  // 引擎只在它自己选中了目标时才发它自己的攻击（`updateAlly`），无目标那一路引擎**根本不发 atk** ⇒ 这里按
  // `s.interval` 补一次「出手」：记一笔（`actions`）并按引擎同一条判据补 `spType === 'attack'` 的技力
  // （技能持续期间不给，与 `skills.js onAttackPerformed` 一致）。她的伤害本体仍由引擎那一下 + kit 的
  // `attack.onHit` 承担（见 `kits/chess_char_5_31_a.js`），这里不重复结算。
  // ⚠️ 与祥子同理，**不看 `u.atkCd`**：引擎有目标时一直在开火、`atkCd` 长期为正，那会把这条路挡死。
  const amState = S.battleStore(battle, 'avemujica:amoris', () => ({ at: new Map(), engineAtk: new Set(), actions: 0 }));
  battle._avemujicaAmoris = amState; // 只读自省句柄（测试 / 调试可直接读）
  battle.on('attack', (c) => {
    const u = c && c.attacker;
    if (!u || u.ownerId !== pid || roleOf(u) !== 'amoris' || c.isSkill) return;
    amState.engineAtk.add(u.id);
  });
  battle.every(NOTE_DT, () => {
    for (const u of roleUnits('amoris')) {
      if (!S.onField(u) || !u.canAct || u.s.flags.disarm) continue;
      const iv = (u.s && u.s.interval > 0) ? u.s.interval : 1.3;
      if (battle.time - (amState.at.get(u.id) ?? -Infinity) < iv) continue;
      amState.at.set(u.id, battle.time);
      amState.actions += 1;
      // 引擎这一拍自己开过火 ⇒ 它已经给过技力，这里不重复给；它没开火（范围内无目标那一路）⇒ 这一拍补上
      if (!amState.engineAtk.delete(u.id)
        && u.skill && u.skill.spType === 'attack' && !(u.skill.active && u.skill.isTimed)) u.skill.gainSp(1, 'attack');
    }
  });

  // ---- 各成员「毋畏X」特质各自的 Fever 增量（逐条接线；数值取各自 chess 记录里的 bb）---------------------------
  // 丰川祥子「毋畏遗忘」：对敌人造成**任何**伤害（普攻与技能）时 Fever +bb.fever（与「成员攻击填充 +2」相加）
  for (const u of roleUnits('oblivionis')) {
    const n = num((roleTalentBb(u, 'oblivionis') || {}).fever, 0);
    if (!(n > 0)) continue;
    onUnitDamaged(battle, u, (dctx) => {
      if (!S.onField(u) || !dctx.dmg || !isEnemyTarget(dctx.target) || ownTag(dctx.dmg, 'bond:avemujica')) return;
      gainFever(n);
    });
  }
  // 三角初华「毋畏悲伤」：治疗【颂乐人偶】成员时 Fever +bb.fever
  for (const u of roleUnits('doloris')) {
    const n = num((roleTalentBb(u, 'doloris') || {}).fever, 0);
    if (!(n > 0)) continue;
    battle.on('heal', (hctx) => {
      if (hctx.source !== u || !S.onField(u) || !memberSet.has(hctx.target)) return;
      gainFever(n);
    });
  }
  // 祐天寺若麦「毋畏爱意」：在场时每秒 Fever +bb.fever_per_sec
  for (const u of roleUnits('amoris')) {
    const n = num((roleTalentBb(u, 'amoris') || {}).fever_per_sec, 0);
    if (!(n > 0)) continue;
    battle.every(1, () => { if (S.onField(u)) gainFever(n); }, { owner: u });
  }
  // 若叶睦「毋畏死亡」：自身受到一次伤害或损伤时 Fever +bb.cnt
  for (const u of roleUnits('mortis')) {
    const n = num((roleTalentBb(u, 'mortis') || {}).cnt, 0);
    if (!(n > 0)) continue;
    battle.on('damaged', (dctx) => {
      if (dctx.target !== u || !S.onField(u) || (dctx.dmg && ownTag(dctx.dmg, 'bond:avemujica'))) return;
      gainFever(n);
    });
  }

  // ---- Fever 期间的技能：触发那一刻**强制打断**当前技能并立刻重开一次；期间持续开、并把已激活的持续类技能
  // 延长到 Fever 结束；Fever 结束时**强制结束**这些技能（wiki：「Fever 状态期间……无视技力限制地持续尝试开启技能
  // （切换类技能除外），且通过此方法开启技能时不消耗技力；通过 Fever 状态开启的持续类技能将在 Fever 状态结束时
  // 强制结束」）。开技能用引擎公开的 `skill.activate(reason, { free: true })`（`free` = 无视技力限制且不消耗技力）。
  const feverSkills = S.battleStore(battle, 'avemujica:feverSkills', () => ({ list: [] }));
  /** 该成员这一格能不能被 Fever 驱动开技能（切换类技能除外）。 */
  const feverCastable = (m) => {
    const sk = m.skill;
    return !!(sk && !sk.noSkill && sk.kind !== 'passive' && sk.kind !== 'toggle');
  };
  /** Fever **开启的那一刻**：强制打断在场成员当前正在释放的技能（业主 2026-10-17 裁决）。 */
  const interruptFeverSkills = () => {
    for (const m of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
      const sk = m.skill;
      if (!feverCastable(m)) continue;
      try { if (sk.active) sk.end('fever-interrupt'); } catch { /* ignore */ }
    }
    feverSkills.list.length = 0;
  };
  /** 开启 / 延长在场成员当前的技能（`feverOn()` 为假时不动；**不打断**已经开着的技能）。 */
  const openFeverSkills = () => {
    if (!feverOn()) return;
    for (const m of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
      if (!feverCastable(m)) continue;
      const sk = m.skill;
      if (sk.active && sk.isTimed) {
        // 已在释放的持续类技能：剩余时间延到 Fever 结束 ⇒ 它只会在 Fever 结束时结束
        if (Number.isFinite(sk.timeLeft)) {
          const left = Math.max(0, st.until - battle.time);
          if (sk.timeLeft < left) sk.extend(left - sk.timeLeft);
        }
      } else {
        sk.activate('fever', { free: true }); // 不消耗技力、不受技力限制
      }
      if (!feverSkills.list.includes(sk)) feverSkills.list.push(sk);
    }
  };
  /** Fever 结束：强制结束通过 Fever 开启的持续类技能（幂等）。 */
  const closeFeverSkills = () => {
    const l = feverSkills.list;
    while (l.length) {
      const sk = l.pop();
      try { if (sk && sk.active) sk.end('fever'); } catch { /* ignore */ }
    }
  };

  // ---- S3「残月的余响」·Fever 免死（wiki S3 说明：**Fever 期间 Ave Mujica 成员受到致命伤害时不撤退，Fever 结束后退场**；
  // S3 备注：「免死效果需要处于技能期间生效，优先级 -3000，期间触发过此免死效果的单位将在 Fever 结束时 / 自身退场时退场」）
  // 挂法：一条**不带 owner** 的 `fatal` 钩子（owner 钩子会在该干员离场时被 `offOwner` 撤掉 ⇒ 重新部署后就没了；
  // 不带 owner 则整场有效），钩子内自行筛「己方 / 5 名成员 / 在场」。
  // 命中条件 = **祥子的 S3 正在生效** 且 当前处于 **Fever**（Fever 期间成员被强制开着技能 ⇒ 也满足「处于技能期间」）。
  // 优先级 -3000 ⇒ 排在其它免死之后；本效果**不消耗任何资源**，排在后面只是照 wiki 的写法（不影响结果）。
  const feverSaved = S.battleStore(battle, 'avemujica:feverSaved', () => ({ set: new Set() }));
  /** 祥子的 S3 是否正在生效（`mixed` 档只可能来自 S3）。 */
  const s3Active = () => {
    const ob = fieldRole('oblivionis');
    if (!ob || !S.onField(ob) || !inSkill(ob)) return false;
    const p = activeSkillAttack(ob);
    return !!(p && p.mixed);
  };
  battle.on('fatal', (c) => {
    const u = c && c.unit;
    if (!u || c.prevented || u.ownerId !== pid || !S.onField(u) || !roleOf(u)) return;
    if (!feverOn() || !s3Active()) return;
    c.prevented = true;                 // 引擎会把血顶到 1，本帧不撤退
    feverSaved.set.add(u);
  }, { priority: -3000 });
  // 「自身退场时退场」：成员一旦离场（撤退 / 被击倒 / 换场）就销掉它的免死记录 —— 它已经退过场，无需二次退场。
  battle.on('death', ({ unit }) => { if (unit && feverSaved.set.has(unit)) feverSaved.set.delete(unit); });

  // ---- Fever 状态: 每 0.5 s 驱动技能（触发时已打断 + 重开；期间持续开 / 延长；结束强制结束）
  // 成员**自身技力照常恢复**（不再给 spRecoveryFlat），「无视技力限制」由 activate({free:true}) 承担。
  battle.every(0.5, () => {
    if (!feverOn()) {
      for (const m of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) battle.removeBuff(m, FEVER_BUF);
      closeFeverSkills();
      // S3 免死：**触发过免死的成员在 Fever 结束时退场**（wiki）
      if (feverSaved.set.size) {
        for (const u of [...feverSaved.set]) {
          try { if (u.alive && S.onField(u)) battle.retreat(u, { reason: 'fever' }); } catch { /* ignore */ }
        }
        feverSaved.set.clear();
      }
      pub();
      return;
    }
    openFeverSkills();
    pub();
  }, { immediate: true });

  pub(); // 开场先发一份（面板在第一次 tick 之前也读得到 0/450）
  // 战斗结束：把本场的记录收尾成 `on: false` —— 面板只认同 `battleId` 的记录，所以这一条让「本场停在 Fever 中」
  // 不会以 `on: true` 留给下一场（`FEVER_LIVE` 是模块级表、跨战斗不清；业主 2026-10-20 报的 Fever 音乐异常）。
  battle.on('battleEnd', () => { st.until = -Infinity; pub(); });
}

registerBondInstaller('aveMujica', installAveMujica);

// =====================================================================================================================
// 干员个人特质（garrisons.json）
//   祥子  AVEMUJICA_FEVER_KILL    <战斗开始时>Fever += 层数×fever_ratio；击倒敌人 → 所有活跃盟约层数 +kill_layers
//                                （max_count 限制本场战斗的触发次数，下一场重新计数）
//   初华  AVEMUJICA_EXTRA_TRIGGER 放大器（extra_trigger 次）+ 源为祥子时所有活跃盟约 +partner_layers（每场 1 次）
//   （海铃 AVEMUJICA_REFRESH_LAYERS / 若麦 AVEMUJICA_PREP_REWARD 是休整期那一半，见 meta/main.mjs）

/** 所有活跃盟约层数 +n（「使所有已激活的盟约层数+…」——同蜜莓官方写法，含颂乐人偶自身）。 */
function addLayersToActive(battle, pid, n, source) {
  const ps = S.player(battle, pid);
  if (!ps || !ps.bonds || !(n > 0)) return;
  for (const [bid, bs] of Object.entries(ps.bonds)) {
    if (!bs || !bs.active) continue;
    S.gainLayers(battle, { playerId: pid, bonds: [bid], n, requireActive: false, source, reason: 'garrison' });
  }
}

registerGarrisonInstaller('AVEMUJICA_FEVER_KILL', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    battle.on('battleStart', () => {
      if (!u || !S.onField(u)) return;
      const st = S.battleStore(battle, 'avemujica:st', () => ({ fever: 0, until: -Infinity }));
      const L = S.bondLayers(battle, u.ownerId, 'aveMujica');
      const add = Math.floor(L * S.num(it.bb.fever_ratio, 0.5));
      if (add > 0) st.fever = Math.min(FEVER_CAP, st.fever + add);
    });
    battle.on('kill', ({ killer }) => {
      if (!killer || killer !== u || !S.onField(u)) return;
      // 「（最多N次）」: max_count caps this battle's triggers (the store lives in the battle, so the next fight starts at 0).
      const cap = Math.max(0, Math.floor(S.num(it.bb.max_count, 0)));
      if (cap > 0) {
        const ks = S.battleStore(battle, `avemujica:kill:${u.id}`, () => ({ n: 0 }));
        if (ks.n >= cap) return;
        ks.n++;
      }
      addLayersToActive(battle, u.ownerId, Math.max(1, Math.floor(S.num(it.bb.kill_layers, 1))), u);
      // 初华连携: 触发干员为丰川祥子（祥子的击倒特质触发）时, 场上有初华 → 所有活跃盟约 +partner_layers（每场 1 次）
      const st = S.battleStore(battle, 'avemujica:partner', () => ({ used: false }));
      if (st.used) return;
      let partner = null;
      for (const m of S.bondMembers(battle, u.ownerId, 'aveMujica', { fieldOnly: true })) {
        if (roleOf(m) === 'doloris') { partner = m; break; }
      }
      if (!partner) return;
      const g = S.garrisonRecord(partner.def?.raw?.garrisonIds?.[0] || partner.def?.garrisonIds?.[0]);
      if (!g || g.effectKey !== 'AVEMUJICA_EXTRA_TRIGGER') return;
      st.used = true;
      addLayersToActive(battle, u.ownerId, Math.max(1, Math.floor(S.num(g.bb.partner_layers, 1))), partner);
    });
  }
});

registerGarrisonInstaller('AVEMUJICA_EXTRA_TRIGGER', (battle, list) => {
  if (!battle._rbAmplifiers) battle._rbAmplifiers = [];
  for (const it of list) {
    const amp = { unit: it.unit, bb: it.bb, usedOnce: false };
    amp.onAmp = (b2, srcIt, src) => {
      if (amp.usedOnce || roleOf(src) !== 'oblivionis') return;
      amp.usedOnce = true; // 每回合（= 每场战斗）1 次
      addLayersToActive(b2, src.ownerId, Math.max(1, Math.floor(S.num(it.bb.partner_layers, 1))), amp.unit);
    };
    battle._rbAmplifiers.push(amp);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 若叶睦「受伤加层」（`garrison_164_a/_b`，effectKey = `act_gar_event_onhurt_add_bond_layer`）
//   「每次受到伤害 → 使自身已激活盟约层数 +bb.bond_add_count，至多 bb.max_count 次」
//
// 这条 effectKey **原先只有雷姆必拓包注册**（若叶睦是**双盟约成员**，`rimBilliton` 与本盟约共用这一条 traits），
// 于是本包对 rimbilliton 有一份**硬依赖** —— 只装本包时这条特质一次都不触发（2026-10-18 核实）。所以现在把它
// **原样复制一份到本包**（业主 2026-10-18：「把若叶睦的这个特质的实现复制一份到颂乐人偶mod中」）。
//
// ⚠️ 引擎的 `registerGarrisonInstaller` 是「**同名键先到先得**、重复的静默忽略」（`server/sim/content/garrisons/
// battle.js` 的 `EXTRA_INSTALLERS`），所以两包同时装着时**只有先加载的那一份生效** —— 这两份实现必须**逐字一致**，
// 否则行为会随包的加载次序漂。改这一份就要**同步**改 `workshop/rimbilliton/battle/main.mjs` 里的那一份（反之亦然）。
registerGarrisonInstaller('act_gar_event_onhurt_add_bond_layer', (battle, list) => {
  const m = byUnit(list);
  battle.on('damaged', ({ target, amount }) => {
    const arr = m.get(target);
    if (!arr || !(amount > 0)) return;
    for (const it of arr) {
      if (num(it.bb.max_count, 0) > 0 && (it.fired || 0) >= num(it.bb.max_count)) continue;
      it.fired = (it.fired || 0) + 1;
      fireGain(battle, it);
    }
  });
});
