// 数据显示 —— 工坊包 data-board 的客户端面板模块（`pack.json.client.panels[]`）。
//
// 它挂在**引擎自己渲染的官方槽** `screen.game.overlay`（对局屏根部的一块 `.mod-host`）里，然后自己用 JS 在对局左侧
// 那张「同盟成员表」里找**每一个玩家行**（`.team__row`），把一块「数据统计」用 `position: fixed` 贴到该玩家头像右边、
// 与头像垂直居中。于是每个玩家头像右边都有自己那一块 —— 每一台客户端都渲染所有人的，谁都能看别人的。
//
// 数据来自三处，**没有一处需要 store**（§28.8 的边界）：
//   * **这一帧的对局数据**（`m.public` / `m.private`）：本包另外声明了一条 `game.hud.topBar` 的**组件改写**，那一环
//     只把顶栏 props 里的 `pub` / `priv` / `myId` 抄进本模块的表（`feed`）并通知面板重画。顶栏每一帧都有最新的
//     一份，所以不必等下一次 `m.public` 推送 —— 那是**变化时才发**的（最长可能要等一整个休整期）。
//   * **本机自己那一场的逐单位伤害**：来自引擎的战斗运行器（`/js/battle/runner.js`）的 `result` 事件
//     （`screens/game.js` 的 `battleRunner.on('result', …)` 读的就是它）—— `perPlayer[<我>].unitStats` 是 0.2.4
//     的官方逐单位统计，与服务端校验用的是同一份数字，**不需要任何引擎扩展点**。别人的那一行仍走本包的 `roster` 通道广播。
//   * **只读数据表** `chess`（名字 / 阶级 / 基础数值 / charId）、`assets`（头像 URL），以及**只在「全量测试统计」
//     页**用到的 `bonds`（盟约描述）与 `config`（回合战斗时长）。
//
// 「全量测试统计」页（**只在 `m.public.dev === true` 的「全量模拟」对局出现**，别模式一个字都不画出）：
//   * 盟约加成 · 总和与来源：公开帧的 `players[].bonds` + `chess`/`bonds` 表；下面再接一块**逐盟约的数值总结**
//     （`【颂乐人偶】+50%攻击力、攻击速度+12`）——数字**优先**取引擎真的落在那些成员身上的 `bond:*` 增益（只读
//     读数 `unitBuffs()` 的 `mods`）；本场一条都读不到时（休整期 / 观战 / 队友行 / 成员还没上场 / 效果不是属性
//     增益）**退回盟约自己的数据口径** —— `bonds` 表那条记录的 `bb`（机器可读数字）翻成同一套口径，并明确标注
//     「数据口径（未实测）」；`bb` 里认不出的数字键原样列出，绝不编造一个数据里没有的数；
//   * 本回合预计伤害与每秒伤害：每个干员的**综合 DPS**（技能期与常时按覆盖率加权，见下）之和 × 回合战斗时长；
//   * 不同增益分别对总伤害的提升与占比：**按比例分摊**（`proratedSplitFor`）—— 拿 `unitStats()` 的**实测**属性差
//     （`cur` 与 `base`）按每条增益的**声明幅度**（`mods` 折成攻击力 / 攻击间隔两条通道，与 `server/sim/units.js`
//     的折算式同一条）分摊给各增益，再对每条算留一法提升与占比 —— 类目合计 + 逐条数字 + 一张**扇形图**。
//     它**不要求**与引擎的重算逐位吻合（那正是旧版「对不上就不画」的病根），所以**永远给得出数字**。
//   `unitBuffs()` 是这一页唯一的引擎侧新增物，**只读、不在线路、不在热路径**（见 runner.js 的注释）。
//
// 干员页的口径：
//   * 按 chess 记录的 `baseId` 归并 —— **重复个体**与**精锐化形态**都算同一个干员；累计数据留在表里，
//     **再次上场**带着原数据重新出现。
//   * **上场次数只在「一场战斗开始」时 +1**：阶段从非战斗进入 COMBAT / FINAL_ASSAULT / HIDDEN_CORE 的那一帧，
//     当前在场上的每个干员 +1（联防 UNITE 是同一场战斗的后半段，不再计一次）。
//   * **上回合造成的伤害** = 最近一场战斗里这一位造成的伤害；**累计造成的伤害**是一局之和。两者都按 board 的
//     `baseId` 口径归并（重复个体与精锐形态同一个干员）。
//   * **保留一回合**（业主 2026-10-15）：「上回合的伤害记录什么的要保留一回合」——某个干员**下场**之后，它那一行
//     （含上回合伤害 / 累计伤害 / 实测 DPS / 实测 HPS / 上场次数）**再多留一个回合**再消失。规则写在
//     `lastSeen` / `lastRates` 两处（`noteSeen` / `noteRates` 记、`retainedRowsFor` / `pastRate` 读）：
//     只在**整整一个回合都不在场**之后才移除该行，**不会**在更晚的回合里复活（快照只按「这一刻还在场上的那几位」
//     刷新，旧数字不会跟着新数据漂移；`round - seenRound >= 2` 时连快照一起丢掉）。
//
// **技能期的「综合 DPS」**（业主 2026-10-15：「预计伤害要算上开启技能后的伤害」）：干员行的**预期 DPS**、以及
// 「全量测试统计」第二块那两个预计值，都用
//
//     综合 DPS = 覆盖率 × 技能期 DPS + (1 − 覆盖率) × 常时 DPS
//
// 覆盖率（技能开着的时间占比）由 `chess` 这张只读表推，公式与取数都写在 `skillWindowOf()` 上：
//   * 技能时长：`durationType === 'AMMO'` 时 = 弹药数 × 技能期攻击间隔（`bb` 的 `attack@trigger_time` / `ammo` /
//     `cnt`，与 `server/sim/content/generic.js` 的取法同一条）；否则 = 技能自己的 `duration`（秒）；
//   * 充能时长：`spType === 'INCREASE_WHEN_ATTACK'` 时 = `spCost` × 基础攻击间隔（每次普攻 +1 技力）；
//     其余（时间回复 / 受击回复 / 部署给）一律按**时间回复**算 `spCost ÷ spRecovery`（`stats.spRecovery`，缺省 1）。
//   * **[ASSUMED] 稳态**：不看 `initSp`（第一次开得比这早）、不看可充能次数（`maxChargeTime`）、不看技能期间回不了
//     技力之外的任何中断（阻回 / 眩晕 / 走位 / 没目标）、也不看技能的黑板之外的效果（追加伤害、多目标、天赋）。
//     这些假设就写在注释与面板那两行小字里，不装作更准；技能不动攻击力 / 攻速时综合 DPS 就等于常时 DPS。
//
// 干员行里那两格常时 / 技能期的**理论值**互相独立、都保留：**预期 DPS** 是上面那个综合值，**技能 DPS** 仍是
// 「技能开着」那一档的参考（`skillDps`）。预期 DPS 在能读到这一位**当前生效**的属性时（`unitStats()` 的 `cur`，
// 已含这一位自己吃到的盟约 / 天赋 / 装备 / 正在跑的技能）用它，休整期没有在演的战斗时退回纸面模型并标注。

import { h, Fragment, render } from 'preact';
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import htm from 'htm';
// 官方战斗读数：浏览器本地战斗结束的结果由引擎的战斗运行器派发（`screens/game.js` 订阅的是同一个 `result` 事件）。
// 面板模块可以直接 import 引擎的**站点模块**（docs/WORKSHOP.md「你的面板模块可以直接 import 引擎的流程」，那里给的
// 例子正是从 `'/js/...'` 导入），因此这里直接读 `battleRunner`，拿到的 `perPlayer[pid].unitStats` 与服务端校验的
// 是同一份数字 —— 无需引擎为本包新造任何具名组件。
import { battleRunner } from '/js/battle/runner.js';

/**
 * htm 会把**全静态**子树的 vnode 缓存进模板对象里，而 Preact 挂载时会把 DOM 节点与父链写进那个共享 vnode ——
 * 屏幕卸载之后模块级缓存还指着旧 DOM。`this[0] = 3` 是 htm 的 opt-out（与引擎 `components.js` 的 `hFresh` 同一条）。
 */
const hFresh = function (type, props, ...children) {
  if (this && typeof this === 'object') this[0] = 3;
  return h(type, props, ...children);
};
const html = htm.bind(hFresh);

const CLS = 'db';
/** 阶级的罗马数字（chess.tier 1..6）。 */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
/** 阶段名（引擎 `shared/constants.js PHASE_NAMES` 的同一张表：改写拿不到引擎的 t()，这里照抄一份）。 */
const PHASE_TEXT = {
  LOBBY: '等待中', INFO_CHECK: '确认本局信息', BAND_DRAFT: '选择策略', BATTLE_CHECK: '协议启动',
  ROUND_START: '回合开始', SP_DRAFT: '机变阶段', PREP: '休整期', COMBAT: '作战中', UNITE: '联防阶段',
  SETTLE: '结算', FINAL_ASSAULT: '最终攻势', HIDDEN_CORE: '隐秘核心', RESULT: '模拟结束',
};
/** 三个选项卡。 */
const TABS = Object.freeze([
  { id: 'units', label: '干员', micro: '数据统计' },
  { id: 'unite', label: '协防', micro: '数据统计' },
  { id: 'misc', label: '其他', micro: '数据统计' },
]);
/**
 * 「全量测试统计」页：**只在「全量模拟」对局里出现**（`m.public` 那一帧带着 `dev === true`；其余任何模式的帧里
 * 根本没有这个键，于是这一页连同它的选项卡**一个字都不出现** —— 别模式的面板与前逐字节相同）。
 */
const DEV_TAB = Object.freeze({ id: 'dev', label: '全量', micro: '测试统计' });
/** 「全量测试统计」第三块按来源分的类目（顺序即显示顺序；`buffCategory` 按 buff key 前缀分派到这里）。 */
const BUFF_CATS = Object.freeze([
  { id: 'bond', label: '盟约' },
  { id: 'talent', label: '天赋' },
  { id: 'skill', label: '技能' },
  { id: 'misc', label: '其他/装备' },
  { id: 'dev', label: '开发者面板' },
]);
/** 「一场战斗开始」认的阶段：COMBAT 是每回合的正戏，后两个是首领回合。UNITE 是同一场战斗的后半段。 */
const BATTLE_PHASES = new Set(['COMBAT', 'FINAL_ASSAULT', 'HIDDEN_CORE']);
const isBattlePhase = (p) => BATTLE_PHASES.has(p);
/** 包通道名（`client.panels[].messages` 里声明过的那一个）。 */
const CHANNEL = 'roster';
/** 广播的最小间隔（`PACK_MSG_LIMITS` 是每会话 20 容量 / 每秒补 5）：变化时最快 400ms 一条，静止时 3s 一条心跳。 */
const SEND_MIN_MS = 400;
const SEND_HEARTBEAT_MS = 3000;
/** 多久没有别人心跳就认为对方那份不可信（对方没装本包 / 掉了）。 */
const PEER_STALE_MS = 12000;
/** DPS 的采样节拍（毫秒）：这是**实时读数**的采样间隔，不是每帧 —— 一秒两次足够看清一个速率，又不会把面板
 *  变成一条 60fps 的动画（每一拍只在数字真的变了时才通知重画）。 */
const DPS_TICK_MS = 500;
/** 台账的去重表最多记多少个 battleId（联赛局数很少，这只是防它无界）。 */
const COUNTED_MAX = 256;

/** 同盟成员表里的一行，以及行内那个写死的座位号（`P1`…`P4`，引擎 `ui/teamPanel.js` 的 `.team__seat`）。 */
const ROW_SEL = '.team__row';
const SEAT_SEL = '.team__seat';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const int = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const numText = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
/** 速率的取整显示（DPS 这类）；拿不到就是「—」。 */
const rateText = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—');
/** 某个速率占合计的百分比（一位小数）；合计不是正数时是「—」。 */
const pctText = (v, total) => (Number.isFinite(v) && Number.isFinite(total) && total > 0 ? `${(v / total * 100).toFixed(1)}%` : '—');
/** `extra` 里这一格有没有真值 —— 本机与「收到过广播的队友」都会填它，所以这些行按**值**判、不按身份判。 */
const has = (extra, key) => !!(extra && extra[key] != null);

// ---- 模块级的那张表 ---------------------------------------------------------------------------------------------

/** 顶栏那一帧给的对局数据（`Feed` 写的）。 */
let feed = { pub: null, priv: null, myId: null };
/** 别人广播来的棋阵 / 统计：playerId -> payload（见 `payloadOf`）。 */
const peers = new Map();
/** 面板的重画回调（每个挂载一份）。 */
const subs = new Set();
/** 本模块需要的几件只读工具（第一次 `mount` 时记下；同一页只有一个包实例，所以一份就够）。 */
const env = { chess: null, assets: null, bonds: null, config: null, data: null, bondIndex: null, send: null, log: null };
/** 面板重画之后的布局回调（每个 `mount` 设一次；面板内部 state 变化后也要重新贴一次）。 */
let requestLayout = () => {};

/**
 * 本机的逐干员伤害台账：playerId -> (baseId -> { last, total })。
 *
 * `last` = 最近一场战斗这一位造成的伤害；`total` = 一局之和。只统计 board 的 `baseId` 口径（重复个体与精锐形态
 * 同一个干员），与服务端校验的是同一份 `unitStats` 数字。
 * @type {Map<string, Map<string, { last: number, total: number }>>}
 */
const ledger = new Map();
/** 已经计入台账的 `battleId`（同一场战斗的结果可能重复到达：重试 / 断线恢复 / 换手，重复不累加）。 */
const counted = new Set();

/**
 * `playerId -> 协防成功接敌的次数`：某个回合的**联防阶段**（`pub.unite.helpers` 名单上有这一位）记一次。
 *
 * 服务端没有这一格（`stats` 里只有 `leaks` 这种「漏了几只」），所以这一格由**本机自己数**。名单是公开数据
 * （`pub.unite.helpers`），所以每一位博士的次数在任何一台客户端上都能数出来，不必走广播 —— 这也是它对队友
 * 同样有效的原因。
 * @type {Map<string, number>}
 */
const helped = new Map();
/** 已经记过的 UNITE 回合（`pub.round`）：同一回合只记一次，刷新后从存档里恢复，免得重记一遍。 */
let uniteRound = null;

/** 自己这一行之外的那张累计表（按 playerId 存，只有本机会有）：上场次数与阶段判定。见 `advance`。 */
const trackers = new Map();
const tworact = () => ({
  deploys: new Map(),     // baseId -> 打过几场战斗（每场战斗开始时 +1）
  phase: null,
});

/**
 * ---- 保留一回合（业主 2026-10-15：「上回合的伤害记录什么的要保留一回合」）------------------------------------------------
 *
 * `lastSeen`：playerId -> (baseId -> { round, row })。`row` 是这一位**最后一次出现在场上**那一刻整行的显示数据
 * （上回合伤害 / 累计伤害 / 上场次数 / 那一段的实测 DPS 与 HPS…），`round` 是当时那个 `pub.round`。
 * 面板据此把「这一回合刚下场、上一回合还在场上」的那几行照旧画出来（标 `is-past`），**整整一个回合不在场**
 * （`round - seenRound >= 2`）之后才连同快照一起删 —— 既不会无限攒，也不会在更晚的回合里把旧行复活。
 * 只有**这一刻还在场上**的那几位会刷新快照：旧数字因此不会跟着新数据漂移（下场之后的台账本来也不再动）。
 * @type {Map<string, Map<string, { round: number, row: object }>>}
 */
const lastSeen = new Map();
/**
 * `lastRates`：playerId -> { round, dps, hps }「最后一次真的量到的实测速率」（战斗在演的时候记，按回合）。
 * 战斗一停，屏上那一场就没了（`damage()` 返回 null ⇒ 实测那两格本来是空的）；这两格于是回落到**上一场的读数**，
 * 同样只留一个回合（`round - lastRates.round <= 1`）。正在演的那一场永远优先，`is-on` 那一档才是实时读数。
 * @type {Map<string, { round: number, dps: Map<string, number>, hps: Map<string, number> }>}
 */
const lastRates = new Map();

/** 当前这一帧的回合号（`pub.round`；不是整数时是 null —— 保留那一条规则要求它可数）。 */
function roundNow() {
  const r = feed.pub && feed.pub.round;
  return Number.isInteger(r) ? r : null;
}

/**
 * ---- 刷新页面不掉数据（业主 2026-10-14：「刷一下网页统计就没了，我要它留到这一局结束才清」）-------------
 *
 * 这一层的台账（`ledger` / `trackers` / `counted`）全在模块级变量里，而**刷新页面 = 模块重新求值一次**，
 * 于是一起归零。`ctx.session.getPref/setPref` 帮不上忙：那是**内存里**的一张表（`ui/extensions.js` 的 `prefs`），
 * 同样活不过刷新 —— 所以本模块直接写 `localStorage`（它本来就直接用 `document` / `window` / `MutationObserver`，
 * 同一个口径，不新增任何东西）。
 *
 * **一把键，不带房间码**：跨局串味的唯一入口是「上一局的数字出现在下一局」，而那条路在两头都被堵死 ——
 * 一局结束（`RESULT`）与新一局开始（`INFO_CHECK`，每局的第一阶段）都删档。房间码反而要等 `room.state` 那一帧，
 * 而它通常**早于**本面板挂载（面板挂在游戏屏根部的官方槽上，游戏屏是那一帧之后才出现的）—— 一个可能永远拿不到的
 * 键，比一把全局键更不可靠。
 *
 * 读写一律 try/catch：隐私模式 / 配额满 / 宿主里没有 `localStorage` 时**只点一次名**，面板照旧工作，
 * 只是这一局不再跨刷新。
 */
const LS_KEY = 'sp.dataBoard.v1';
/** 落盘的最小间隔（毫秒）：账本每帧都在推进，不能每帧写一次 localStorage。 */
const SAVE_MIN_MS = 1500;
/** 这一局的存档恢复过了吗（要等 `feed.myId` 到齐才动手）。 */
let restored = false;
/** 上一次落盘的时间。 */
let savedAt = 0;
/** `localStorage` 用不了时只点一次名。 */
let storageBroken = false;

/** @param {string} key @returns {any} */
function lsGet(key) {
  try {
    const raw = globalThis.localStorage ? globalThis.localStorage.getItem(key) : null;
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** @param {string} key @param {any} value @returns {boolean} 写成功了吗 */
function lsSet(key, value) {
  try {
    if (!globalThis.localStorage) return false;
    globalThis.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

function lsDel(key) {
  try { if (globalThis.localStorage) globalThis.localStorage.removeItem(key); } catch { /* 删不掉不是故障 */ }
}

/** 一局结束（`RESULT`）：删掉存档。**不**动内存里那几本台账 —— 结算屏上还在看着这一局的数字。 */
function dropLS() {
  lsDel(LS_KEY);
  savedAt = 0;
}

/** 开局那几个阶段（`INFO_CHECK` 是每局的第一阶段，但「全量模拟」局会跳过它 —— 见 `advance`）。 */
const START_PHASES = new Set(['INFO_CHECK', 'BAND_DRAFT', 'UNIT_DRAFT', 'BATTLE_CHECK', 'ROUND_START']);

/**
 * 上一帧见到的回合号与「这一局收摊了没有」：判**新一局开始**用（见 `advance`）。
 * 只靠 `INFO_CHECK` 是不够的 —— 「全量模拟」局跳过本局信息 / 策略阶段，那条判据永远等不到。
 * @type {number|null}
 */
let seenRound = null;
/** @type {boolean} */
let matchEnded = false;

/** 新一局开始（`INFO_CHECK`）：存档与内存台账一起清（否则新一局会带着上一局的数字继续往上加）。 */
function dropAll() {
  dropLS();
  ledger.clear();
  trackers.clear();
  counted.clear();
  helped.clear();
  // 「保留一回合」那两份快照也一起清：新一局的第一回合不该看见上一局的旧行与旧读数。
  lastSeen.clear();
  lastRates.clear();
  uniteRound = null;
  seenRound = null;
  matchEnded = false;
}

/**
 * 把这一局的台账写进 `localStorage`（节流；`force` 给「一场战斗刚结束」那种大事件用）。
 * 存的只有**本机自己那一份**：`ledger[myId]` 的逐干员累计、`trackers[myId]` 的上场次数与阶段，
 * 以及去重用的 `counted`。别人的那份由他们自己的心跳在 3 秒内重新送来，不必落盘。
 * @param {boolean} [force] 这一次不受 `SAVE_MIN_MS` 节流
 */
function saveLS(force = false) {
  if (!restored || !feed.myId) return;
  const phase = feed.pub && feed.pub.phase;
  // 一局已经结束 / 还没进入信息确认：这一段**不该**有档。删档那一处已经处理过，这里再挡一次，
  // 免得收摊时最后一次 `force` 把刚删掉的数字又写回去。
  if (phase === 'RESULT' || phase === 'INFO_CHECK') return;
  const now = Date.now();
  if (!force && now - savedAt < SAVE_MIN_MS) return;
  savedAt = now;
  const mine = ledger.get(feed.myId);
  const st = trackers.get(feed.myId);
  /** @type {Record<string, number[]>} */
  const dmg = {};
  for (const [base, cell] of mine || []) dmg[base] = [cell.last, cell.total];
  /** @type {Record<string, number>} */
  const deploys = {};
  for (const [base, n] of st && st.deploys ? st.deploys : []) deploys[base] = n;
  /** @type {Record<string, number>} */
  const helpedRec = {};
  for (const [pid, n] of helped) helpedRec[pid] = n;
  const ok = lsSet(LS_KEY, {
    v: 1, phase: (st && st.phase) || null,
    // 存档属于**哪一局**：回合号一起存 —— 恢复时拿它和当前帧的回合号比，「存档的更大」就说明这是上一局的
    // 数字（同一局刷新不会倒着走），于是不再恢复（见 `restore`）。
    round: Number.isInteger(feed.pub && feed.pub.round) ? feed.pub.round : null,
    dmg, deploys, counted: [...counted], helped: helpedRec, uniteRound,
  });
  if (ok || storageBroken) return;
  storageBroken = true;
  env.log?.warn?.('本局统计无法写入 localStorage（隐私模式 / 配额已满）：面板照常工作，只是刷新页面后这一局的数字不再保留');
}

/** 恢复这一局的台账（只做一次；`feed.myId` 还没到就先不动，下一次 `notify` 再来）。 */
function restore() {
  if (restored || !feed.myId) return;
  restored = true;
  const rec = lsGet(LS_KEY);
  if (!rec || rec.v !== 1) return;
  // 存档是**上一局**的就别恢复了（业主 2026-10-15：换一局必须清零，不能带着上一局的累计伤害继续加）。
  // 判据（任一条成立即清掉并放弃恢复）：
  //   * 存档里的回合号比这一帧的大（同一局刷新只会并列或更大，不会更小）；
  //   * 存档写在中后段阶段，而这一帧还停在开局那几个阶段（同一局的阶段不会倒着走）。
  const curPhase = feed.pub && feed.pub.phase;
  const nowRound = Number.isInteger(feed.pub && feed.pub.round) ? feed.pub.round : null;
  const staleRound = nowRound != null && Number.isInteger(rec.round) && rec.round > nowRound;
  const stalePhase = START_PHASES.has(curPhase) && typeof rec.phase === 'string' && rec.phase && !START_PHASES.has(rec.phase);
  if (staleRound || stalePhase) { dropAll(); return; }
  const mine = new Map();
  for (const [base, pair] of Object.entries(rec.dmg && typeof rec.dmg === 'object' ? rec.dmg : {})) {
    if (typeof base !== 'string' || !Array.isArray(pair) || pair.length !== 2) continue;
    const last = Math.max(0, Number(pair[0]) || 0);
    const total = Math.max(0, Number(pair[1]) || 0);
    if (last || total) mine.set(base, { last, total });
  }
  if (mine.size) ledger.set(feed.myId, mine);
  const st = trackers.get(feed.myId) || tworact();
  trackers.set(feed.myId, st);
  for (const [base, n] of Object.entries(rec.deploys && typeof rec.deploys === 'object' ? rec.deploys : {})) {
    const v = int(n);
    if (typeof base === 'string' && v != null && v > 0) st.deploys.set(base, v);
  }
  // 阶段也要还原：`advance` 靠「上一次的阶段」判「一场战斗开始了没有」，缺了它，刷新恰好落在战斗中那一次会把
  // 已经在场上的干员**再**记一次上场次数。
  if (typeof rec.phase === 'string' && rec.phase) st.phase = rec.phase;
  for (const id of Array.isArray(rec.counted) ? rec.counted : []) if (typeof id === 'string' && id) counted.add(id);
  // 协防成功接敌的次数（对**每个人**都恢复：这一格不是「本机自己那份」，是公开名单数出来的）。
  for (const [pid, n] of Object.entries(rec.helped && typeof rec.helped === 'object' ? rec.helped : {})) {
    const v = int(n);
    if (typeof pid === 'string' && pid && v != null && v > 0) helped.set(pid, v);
  }
  // 已经记过的那个回合也要恢复，否则刷新之后同一回合会再记一次。
  if (Number.isInteger(rec.uniteRound)) uniteRound = rec.uniteRound;
}

/** 通知：先恢复这一局的存档（刷新之后第一次走到这里），再把「自己这一行」的累计 / 广播推进一次，最后让每个面板重画。 */
function notify() {
  restore();
  try { advance(); } catch { /* 一份坏数据不该把面板弄没 */ }
  for (const fn of [...subs]) {
    try { fn(); } catch { /* 同上 */ }
  }
}

/**
 * 把 `priv.board` 上的棋子归并成「一个干员一行」。
 *
 * 归并键是 chess 记录里的 `baseId`（精锐形态与普通形态共用它），取不到记录时退回棋子自己的 id —— 这样
 * **重复个体**与**精锐化**都落进同一行。`copies` 是这一行此刻在场上的个体数。
 * @param {any[]} board m.private.board（pieceView 列表）
 * @param {any} chess chess 数据表（只读快照，按 chessId 索引）
 * @returns {Array<any>} 归并后的干员行（未排序）
 */
function mergeBoard(board, chess) {
  const byBase = new Map();
  for (const p of Array.isArray(board) ? board : []) {
    if (!p || p.kind !== 'chess') continue; // 召唤物（token）与装备（item）不是干员
    const rec = chess && typeof chess === 'object' ? chess[p.id] : null;
    const base = (rec && typeof rec.baseId === 'string' && rec.baseId) || p.id;
    const had = byBase.get(base);
    if (had) { had.copies++; continue; }
    const stats = rec && rec.stats && typeof rec.stats === 'object' ? rec.stats : {};
    byBase.set(base, {
      base,
      name: (rec && rec.name) || p.id,
      charId: (rec && rec.charId) || null,
      tier: int(rec && rec.tier) ?? int(p.tier) ?? 0,
      maxHp: stats.maxHp, atk: stats.atk, def: stats.def, block: stats.blockCnt,
      copies: 1,
    });
  }
  const rows = [...byBase.values()];
  rows.sort((a, b) => (b.tier - a.tier) || String(a.name).localeCompare(String(b.name), 'zh'));
  return rows;
}

/**
 * 干员头像（`data/assets.json` 的 `chars[charId].avatar`，精锐形态用 `avatarE2`）—— 与引擎
 * `ui/assetUrls.js chessAvatarUrl` 同一条口径，包这边自己算一份（拿不到引擎的函数）。
 * @param {any} assets assets 只读快照
 * @param {{ charId?: string|null, assets?: any }} rec chess 记录
 * @returns {string|null}
 */
function avatarOf(assets, rec) {
  const chars = assets && assets.chars;
  if (!chars || !rec) return null;
  const id = (rec.assets && rec.assets.avatar) || rec.charId;
  if (typeof id === 'string' && id.endsWith('_2') && !chars[id]) {
    const base = chars[id.slice(0, -2)];
    return (base && (base.avatarE2 || base.avatar)) || null;
  }
  const hit = typeof id === 'string' && id ? chars[id] : null;
  if (hit && hit.avatar) return hit.avatar;
  const byChar = rec.charId ? chars[rec.charId] : null;
  return (byChar && byChar.avatar) || null;
}

/** 这个棋子（按 chessId）的头像 URL；取不到记录就是 null。 */
const avatarForChessId = (chessId) => {
  const rec = env.chess && env.chess[chessId];
  return avatarOf(env.assets, rec);
};

/** 一个棋子 id 归并到「同一个干员」的那把钥匙：chess 记录的 `baseId`（精锐形态与普通形态共用它）。 */
const baseOf = (chessId) => {
  const rec = env.chess && typeof chessId === 'string' ? env.chess[chessId] : null;
  return (rec && typeof rec.baseId === 'string' && rec.baseId) || (typeof chessId === 'string' ? chessId : null);
};

/**
 * 这张只读表里这一位干员的**基础**攻击间隔（秒）：`stats.bat × 100 / stats.aspd`（与 `shared/protocol.js` 的
 * `intervalOf` 同一条公式；记录自带 `interval` 时优先用它）。拿不到就是 `null`。
 * @param {string} base baseId
 * @returns {number|null}
 */
function intervalOfBase(base) {
  const rec = env.chess && typeof base === 'string' ? env.chess[base] : null;
  const s = rec && rec.stats;
  if (!s) return null;
  if (Number.isFinite(s.interval) && s.interval > 0) return s.interval;
  const bat = Number(s.bat);
  const aspd = Number(s.aspd);
  return Number.isFinite(bat) && bat > 0 && Number.isFinite(aspd) && aspd > 0 ? (bat * 100) / aspd : null;
}

/**
 * 这一位干员的**技力回复速度**（每秒回多少技力，`stats.spRecovery`）—— 缺省 1，与 `server/sim/units.js` 构造
 * `unit.base` 时的缺省值（`spRecovery: 1`）同一条。只在算技能覆盖率时用到；`liveSpRec` 是这一次从战场单位上
 * 现读到的值（`unitBuffs().base.spRecovery`，含着 `spRecoveryMul` / `spRecoveryFlat` 这类增益），拿不到才退回表。
 * @param {any} rec chess 记录 @param {number|null} [liveSpRec]
 * @returns {number}
 */
function spRecoveryOf(rec, liveSpRec = null) {
  if (Number.isFinite(liveSpRec) && liveSpRec >= 0) return liveSpRec;
  const v = Number(rec && rec.stats && rec.stats.spRecovery);
  return Number.isFinite(v) && v >= 0 ? v : 1;
}

/** 某个**战场单位**这一场实际用的攻击间隔（秒）—— 问引擎那一格（含着攻速增减益、技能改过的间隔）。 */
function intervalOfUnit(u) {
  if (!u || !Number.isInteger(u.id) || !battleRunner || typeof battleRunner.unitStats !== 'function') return null;
  let st = null;
  try { st = battleRunner.unitStats(u.id); } catch { st = null; }
  const iv = st && Number(st.interval);
  return Number.isFinite(iv) && iv > 0 ? iv : null;
}

/**
 * **本机**（`ownerId`）此刻在**屏上那一场**里的逐干员**每秒伤害**与**每秒治疗** —— 两者的分母都是**攻击期间**
 * （业主 2026-10-14：「正常和技能期间不攻击的时间不计入」）。
 *
 * `伤害 / (attacks × 攻击间隔)` 与 `治疗 / (attacks × 攻击间隔)`：引擎的 `stats.attacks` 数着这一场打出过多少次
 * 普攻（医疗干员的「出手」就是它的治疗动作），乘上这位的实际攻击间隔就是它真正在出手的那段时间 —— 走位、蓄力、
 * 技能抬手、没有目标的那几段**不进分母**。攻击间隔优先取单位这一场的**有效**间隔（`battleRunner.unitStats`，含
 * 增益与技能改动），拿不到才退回 `chess` 表里的基础间隔。
 *
 * 与上面那两格仍是两条独立的口径：`上回合伤害` / `累计伤害` 来自**战斗结束后**才落的跨场台账，这两格读的是
 * **正在演的这一场** —— 战斗一停它们自己就没了，也不会回写台账。
 *
 * 拿不到就是 `null`，不编数：没有在演的战斗 / 演的那一场不包含本机（联防、观战看的是别人的场）；没打出过伤害
 * 的不进伤害那份账、没治疗过的不进治疗那份账（也都不把别人的数拉低）。
 * @param {string} ownerId
 * @returns {{ dps: Map<string, number>|null, hps: Map<string, number>|null }} baseId -> 每秒（伤害 / 治疗）
 */
function ratesFor(ownerId) {
  const none = { dps: null, hps: null };
  const d = battleRunner && typeof battleRunner.damage === 'function' ? battleRunner.damage() : null;
  if (!d) return none;
  const players = Array.isArray(d.players) ? d.players : [];
  if (!players.some((p) => p && p.playerId === ownerId)) return none;
  /** @type {Map<string, { v: number, w: number }>} */ const dmgAcc = new Map();
  /** @type {Map<string, { v: number, w: number }>} */ const healAcc = new Map();
  for (const u of Array.isArray(d.units) ? d.units : []) {
    if (!u || u.ownerId !== ownerId) continue; // 联防那一场里也有队友的单位，它们记在队友那本账上
    const base = baseOf(u.uid) || (u.defId ? baseOf(u.defId) : null);
    if (!base) continue;
    const attacks = Math.max(0, Number(u.attacks) || 0);
    const iv = intervalOfUnit(u) ?? intervalOfBase(base);
    if (!attacks || !(iv > 0)) continue;
    const win = attacks * iv;
    const dm = Math.max(0, Number(u.dmg) || 0);
    const hl = Math.max(0, Number(u.heal) || 0);
    if (dm > 0) { const c = dmgAcc.get(base) || { v: 0, w: 0 }; c.v += dm; c.w += win; dmgAcc.set(base, c); }
    if (hl > 0) { const c = healAcc.get(base) || { v: 0, w: 0 }; c.v += hl; c.w += win; healAcc.set(base, c); }
  }
  const dps = new Map();
  for (const [base, c] of dmgAcc) if (c.w > 0) dps.set(base, c.v / c.w);
  const hps = new Map();
  for (const [base, c] of healAcc) if (c.w > 0) hps.set(base, c.v / c.w);
  return { dps: dps.size ? dps : null, hps: hps.size ? hps : null };
}

/**
 * **预期 DPS（纸面模型）**：这一位干员按 `chess` 这张只读表算出来的**综合 DPS**（常时与技能期按覆盖率加权，
 * 见 `mixedDpsOf`）—— 两张基础量都来自表，所以**不在战斗中也能算**（与左边那格「实测·攻击期间」不同，那一格
 * 要有正在演的战斗才有数）。
 *
 * 它只看纸面：目标防御 / 抗性、这一位同时打几个目标、技能黑板之外的增伤（天赋 / 装备的额外节点）都不在里面
 * —— 所以标成「预期」，而实测那一格（已经扣过防御、含了增益与技能）与它互为上下界。`atk` 取这一行显示的那一份
 * （重复个体 / 精锐形态按 `mergeBoard` 的归并口径）。能读到这一位**当前生效**的属性时不用这一档，用
 * `mixedDpsOf` 直接喂 `unitStats()` 的 `cur`（见 `UnitRow` 与 `projectedDpsFor`）。
 * @param {{ base?: string, atk?: number }} row
 * @returns {{ dps: number|null, uptime: number|null, baseDps: number|null, skillDps: number|null }}
 */
function predictDps(row) {
  const base = row && row.base;
  const rec = env.chess && typeof base === 'string' ? env.chess[base] : null;
  return mixedDpsOf({ atk: Number(row && row.atk), iv: intervalOfBase(base), rec });
}

/**
 * 技能期的攻击间隔（秒）：`bat × (1 + bb.base_attack_time) × 100 ÷ (aspd + bb.attack_speed)` —— 与
 * `docs/design/engine.md`「`interval = bat × (1 + ΣbatPct) × 100 / aspd`，`base_attack_time` 按 `batPct` 算」
 * 同一条公式。拿不到就是 `null`。
 * @param {any} rec chess 记录
 * @returns {number|null}
 */
function skillIntervalOf(rec) {
  const st = rec && rec.stats;
  const bb = rec && rec.skill && rec.skill.bb && typeof rec.skill.bb === 'object' ? rec.skill.bb : null;
  if (!st || !bb) return null;
  const bat = Number(st.bat);
  const aspd = Number(st.aspd);
  if (!(bat > 0) || !(aspd > 0)) return null;
  const bp = Number(bb.base_attack_time);
  const da = Number(bb.attack_speed);
  const iv = (bat * (1 + (Number.isFinite(bp) ? bp : 0)) * 100) / (aspd + (Number.isFinite(da) ? da : 0));
  return iv > 0 ? iv : null;
}

/** 技能期**每击**伤害（理论值）：`攻击力 × (1 + bb.atk) × bb['attack@atk_scale']`。技能一点攻击力都不动时 `null`。 */
function skillPerHit(rec, atk, bb) {
  const a = Number(bb && bb.atk);
  const sc = Number(bb && bb['attack@atk_scale']);
  if (!Number.isFinite(a) && !Number.isFinite(sc)) return null;
  if (!Number.isFinite(atk) || atk <= 0) return null;
  return atk * (1 + (Number.isFinite(a) ? a : 0)) * (Number.isFinite(sc) ? sc : 1);
}

/** 一位干员的 chess 记录与其技能黑板（缺失时 `{rec, bb}` 里的 `bb` 是空对象）。 */
function chessAndBb(row) {
  const rec = env.chess && row && typeof row.base === 'string' ? env.chess[row.base] : null;
  const bb = rec && rec.skill && rec.skill.bb && typeof rec.skill.bb === 'object' ? rec.skill.bb : {};
  return { rec, bb };
}

/**
 * **技能期 DPS**（理论值，业主 2026-10-14）：一位干员**一次技能期间能造成的伤害 ÷ 技能的持续时长**。
 *
 * 两种技能时长模型下这个商是**同一个式子**（所以不必去分辨 `durationType`）：
 *   * `TIME` 档（`duration` 秒）：伤害 ≈ `(duration ÷ 间隔) × 每击伤害` ⇒ 商 = 每击伤害 ÷ 间隔；
 *   * `AMMO` 档（打光 N 发就结束）：技能时长 ≈ `N × 间隔` ⇒ 商还是 每击伤害 ÷ 间隔。
 * 于是这一格就是 **技能期的每击伤害 ÷ 技能期的攻击间隔**。技能**一点都不改攻击力 / 攻速**时（治疗、纯辅助）
 * 返回 `null` —— 画一个与普攻相同的数只会让人以为技能有用。只看纸面：目标防御 / 抗性、天赋、队友增益、技能里的
 * 额外伤害节点都不在里面。`atk` 是这一位这一档的攻击力（纸面那一份，或 `unitStats()` 的有效那一份）。
 * @param {any} rec chess 记录 @param {number} atk
 * @returns {number|null}
 */
function skillDpsOf(rec, atk) {
  if (!rec) return null;
  const bb = rec.skill && rec.skill.bb && typeof rec.skill.bb === 'object' ? rec.skill.bb : {};
  const touched = [bb.atk, bb['attack@atk_scale'], bb.base_attack_time, bb.attack_speed]
    .some((v) => Number.isFinite(Number(v)));
  if (!touched) return null;
  const perHit = skillPerHit(rec, Number(atk), bb);
  const iv = skillIntervalOf(rec);
  if (!(perHit > 0) || !(iv > 0)) return null;
  return perHit / iv;
}

/** 技能期 DPS（理论值）的「按行」入口：`atk` 取这一行显示的那一份。见 `skillDpsOf`。 */
const skillDps = (row) => skillDpsOf(row && env.chess && env.chess[row.base], row && row.atk);

/**
 * 技能黑板里一个键的读数：`attack@k` → `k` → `skill@k` 依次找 —— 与 `server/sim/content/generic.js` 的
 * `attackGetter` 同一条取法（一个键可能只写在某一档里）。找不到就是 `null`。
 * @param {any} bb 技能黑板 @param {string} key
 * @returns {number|null}
 */
function bbVal(bb, key) {
  if (!bb || typeof bb !== 'object') return null;
  for (const k of ['attack@' + key, key, 'skill@' + key]) {
    const v = Number(bb[k]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * **一次技能的「开 / 关」循环**：`{ on, recharge, uptime, kind }` —— 综合 DPS 的加权系数。全部由 `chess` 这张
 * 只读表推（技能自己的 `duration` / `durationType` / `spType` / `spCost` 与 `bb`），推不出来就是 `null`。
 *
 *   * **技能时长 `on`（秒）**：`AMMO` 档 = 弹药数 × **技能期**攻击间隔（打光 N 发就结束，弹药数取 `bb` 的
 *     `attack@trigger_time` / `ammo` / `cnt` —— 与 `generic.js` 的 `ammo = g('trigger_time') ?? g('ammo') ?? g('cnt')`
 *     同一条）；其余有 `duration` 的按 `duration` 秒算。
 *   * **充能时长 `recharge`（秒）**：`spType === 'INCREASE_WHEN_ATTACK'`（每次普攻 +1 技力）= `spCost ×` 基础攻击间隔
 *     （技能期间不回技力，所以按**普攻**的间隔算）；其余（`INCREASE_WITH_TIME` 时间回复 / `INCREASE_WHEN_TAKEN_DAMAGE`
 *     受击回复 / `ON_DEPLOY` 部署给）一律按时间回复算 `spCost ÷ spRecovery` —— 受击回复真正有多快取决于挨不挨打，
 *     冷却期本仓按技力条自己走秒，取不到更准的数就只能这么说。[ASSUMED]
 *   * `uptime = on ÷ (on + recharge)`，夹在 0..1。
 *   * **推不出来就返回 `null`**：没有技能 / 被动技能 / 免费的（`spCost <= 0`：一次部署只给一次，循环无从谈起）/
 *     既没 `duration` 又没弹药数 / 技力回复为 0（技力永远不满 —— 这类技能的循环由别的机制给，不在这里猜）。
 *
 * **[ASSUMED] 稳态假设**：不看 `initSp`（第一次开得比 `recharge` 快）、不看可充能次数（`maxChargeTime`）、
 * 不看「技能期间不回技力」之外的任何中断（阻回 / 眩晕 / 没目标 / 走位）。这些是黑板上没有、也不该由面板猜的东西。
 * @param {any} rec chess 记录 @param {number|null} ivBase 基础攻击间隔（秒） @param {number|null} [liveSpRec]
 * @returns {{ on: number, recharge: number, uptime: number, kind: 'ammo'|'duration' }|null}
 */
function skillWindowOf(rec, ivBase, liveSpRec = null) {
  const sk = rec && rec.skill;
  if (!sk || !(ivBase > 0)) return null;
  const bb = sk.bb && typeof sk.bb === 'object' ? sk.bb : {};
  const spCost = Number(sk.spCost);
  const ammo = sk.durationType === 'AMMO';
  const dur = Number(sk.duration);
  // 技能永远开着 / 一次部署只给一次：没有「开→关→再开」的循环可言（`genericKind` 同一条判据）
  if (sk.skillType === 'PASSIVE' || !(spCost > 0)) return null;
  if (!ammo && !(dur > 0)) return null;
  const ivS = skillIntervalOf(rec) ?? ivBase;
  let on = null;
  if (ammo) {
    const n = bbVal(bb, 'trigger_time') ?? bbVal(bb, 'ammo') ?? bbVal(bb, 'cnt');
    if (n > 0 && ivS > 0) on = n * ivS;
  } else if (dur > 0) on = dur;
  if (!(on > 0)) return null;
  const perAttack = String(sk.spType) === 'INCREASE_WHEN_ATTACK';
  const perSec = spRecoveryOf(rec, liveSpRec);
  if (!perAttack && !(perSec > 0)) return null; // 技力根本不回：循环由别的机制给，不在这里猜
  const recharge = perAttack ? spCost * ivBase : spCost / perSec;
  if (!(recharge >= 0)) return null;
  return { on, recharge, uptime: Math.min(1, Math.max(0, on / (on + recharge))), kind: ammo ? 'ammo' : 'duration' };
}

/**
 * **一位干员的「综合 DPS」**（业主 2026-10-15：「预计伤害要算上开启技能后的伤害」）：
 *
 *     综合 = 覆盖率 × 技能期 DPS + (1 − 覆盖率) × 常时 DPS
 *
 * `atk` / `iv` 是**这一位这一档要用的那一对**（纸面模型：表里的攻击力与基础间隔；能读到有效属性时：`unitStats()`
 * 的 `cur` —— 已含他吃到的盟约 / 天赋 / 装备 / 正在跑的技能），技能那一档再乘技能自己改的攻击力与间隔
 * （`skillPerHit` / `skillIntervalOf` 都只看 `bb`）。技能改不动攻击力 / 间隔、或循环推不出来时，综合就等于常时，
 * `uptime` 给 `null`（面板据此说「理论值：无技能期折算」）。
 * @param {{ atk: number, iv: number, rec: any, spRec?: number|null }} args
 * @returns {{ dps: number|null, uptime: number|null, baseDps: number|null, skillDps: number|null }}
 */
function mixedDpsOf({ atk, iv, rec, spRec = null }) {
  const none = { dps: null, uptime: null, baseDps: null, skillDps: null };
  if (!(iv > 0) || !Number.isFinite(atk) || atk <= 0) return none;
  const baseDps = atk / iv;
  const win = skillWindowOf(rec, iv, spRec);
  const sk = skillDpsOf(rec, atk);
  const out = { dps: baseDps, uptime: null, baseDps, skillDps: sk };
  if (!win || sk == null || !(sk > 0)) return out;
  out.dps = win.uptime * sk + (1 - win.uptime) * baseDps;
  out.uptime = win.uptime;
  return out;
}

/**
 * **纸面治疗模型**：每秒治疗量的两个理论值（基础 / 技能期）。只覆盖**能说清楚的**几种，其余一律 `null` ——
 * 一个错的治疗率比一个「—」更坏（本仓那条铁律：面板可以画错、不能算错）：
 *   1. **医疗**（`profession === 'MEDIC'`）：治疗量 = 攻击力（本作品的口径，模拟也是这么算的）⇒ 每秒治疗
 *      = 攻击力 ÷ 间隔；技能期再按技能的 `atk` / 攻速改动换算。
 *   2. 技能的 `heal_scale` / `attack@heal_scale`（治疗量 = 攻击力 × 系数）：只有**技能期**那一版有值 ——
 *      治疗是这条技能给的，基础版就该是「—」。
 *   3. 技能的 `attack@fixed_heal_value`（每次出手固定治疗 n 点）：同上。
 * 其余治疗机制（按伤害比例回血、每秒回血、护盾……）**不在这里**：口径各不相同，硬算只会装作更准。它们仍然会
 * 出现在**实测 HPS** 那一格 —— 那一格读的是引擎自己数出来的 `heal`。
 * @param {{ base?: string, atk?: number }} row
 * @returns {{ base: number|null, skill: number|null }|null}
 */
function healRates(row) {
  const { rec, bb } = chessAndBb(row);
  if (!rec || !rec.stats) return null;
  const atk = Number(row && row.atk);
  const ivBase = intervalOfBase(row.base);
  const ivSkill = skillIntervalOf(rec) ?? ivBase;
  const a = Number(bb.atk);
  const mul = 1 + (Number.isFinite(a) ? a : 0);
  const out = { base: null, skill: null };
  if (rec.profession === 'MEDIC' && Number.isFinite(atk) && atk > 0) {
    if (ivBase > 0) out.base = atk / ivBase;
    if (ivSkill > 0) out.skill = (atk * mul) / ivSkill;
  } else {
    const hs = Number(bb.heal_scale);
    const ahs = Number(bb['attack@heal_scale']);
    const scale = Number.isFinite(hs) ? hs : (Number.isFinite(ahs) ? ahs : null);
    const flat = Number(bb['attack@fixed_heal_value']);
    if (scale != null && Number.isFinite(atk) && atk > 0) {
      if (ivSkill > 0) out.skill = (atk * scale * mul) / ivSkill;
    } else if (Number.isFinite(flat) && flat > 0 && ivSkill > 0) {
      out.skill = flat / ivSkill;
    }
  }
  return out.base == null && out.skill == null ? null : out;
}

// ---- 「全量测试统计」页的取数（仅 `m.public.dev === true` 的全量模拟对局挂出）----------------------------------------
//
// 这一页的三块：盟约加成（总和 + 来源）、本回合预计伤害与每秒伤害、不同增益分别对总伤害的提升与占比。
// 全部现读：公开帧（`pub.players[].bonds`、`pub.round` / `pub.modeId`）、只读数据表（`bonds` / `config` / `chess`），
// 以及引擎战斗运行器的两格只读读数（`unitStats()` 的实测属性、`unitBuffs()` 的增益清单 + 折算式输入）。

/** `ctx.data.get(name)` 的懒读：数据层可能比本面板挂载晚一步到，所以这次拿不到、下次再试。 */
function dataTable(name) {
  const cached = env[name];
  if (cached != null) return cached;
  if (env.data && typeof env.data.get === 'function') {
    try { const v = env.data.get(name); if (v != null) env[name] = v; return v; } catch { return null; }
  }
  return null;
}

/**
 * `baseId -> Set(bondId)`：把 `chess` 这张只读表按 `baseId` 归并出每一位干员携带的盟约（精锐 / 重复形态共用
 * `baseId`，所以它们落在同一格）。只造一次，之后复用。
 * @returns {Map<string, Set<string>>}
 */
function baseBondsIndex() {
  if (env.bondIndex) return env.bondIndex;
  const m = new Map();
  const chess = env.chess;
  if (chess && typeof chess === 'object') {
    for (const key of Object.keys(chess)) {
      const rec = chess[key];
      if (!rec || !Array.isArray(rec.bonds)) continue;
      const base = typeof rec.baseId === 'string' && rec.baseId ? rec.baseId : key;
      let set = m.get(base);
      if (!set) m.set(base, (set = new Set()));
      for (const id of rec.bonds) if (typeof id === 'string' && id) set.add(id);
    }
  }
  env.bondIndex = m;
  return m;
}

/** 一个 buff key 的来源分类（前缀判据：`bond:` → 盟约，`talent:`/`trait:` → 天赋，`skill:` → 技能，`dev:` → 开发者面板，其余 → 其他/装备）。 */
function buffCategory(key) {
  const k = typeof key === 'string' ? key : '';
  if (k.startsWith('bond:')) return 'bond';
  if (k.startsWith('talent:') || k.startsWith('trait:')) return 'talent';
  if (k.startsWith('skill:')) return 'skill';
  if (k.startsWith('dev:')) return 'dev';
  return 'misc';
}

/**
 * `mods` 里与攻击力 / 攻击间隔这两条通道有关的那几个键（与 `server/sim/buffs.js` 的 `ADD_KEYS` / `MUL_KEYS` 对齐，
 * 名字逐字照 `server/sim/units.js` 的 `_recalc`）：加算键按层数求和、`*Mul` 键按层数连乘。
 */
const ATK_CHANNEL_KEYS = Object.freeze(['atkFlat', 'atkFinal', 'atkPct', 'atkMul']);
const IV_CHANNEL_KEYS = Object.freeze(['aspd', 'batPct']);

/**
 * **一条增益的「声明幅度」**（攻击力 / 攻击间隔两条通道各一个数）—— 与 `server/sim/units.js` 的 `_recalc` 同一条：
 *   * 攻击力通道 = `atkFlat + atkFinal + base.atk × atkPct + base.atk × (atkMul − 1)`（加算键 × 层数，`atkMul` 取
 *     层数次幂。最后一个 `atkMul` 那一项其实是**近似** —— 它本应作用在整条式子上，不是只乘 `base.atk`）；
 *   * 攻击间隔通道 = 把这一条增益的 `aspd` / `batPct` **单独**作用在裸 `base` 上，得到的那个间隔与基准间隔之差
 *     （`bat × max(0.1, 1 + ΣbatPct)`、`aspd` 夹在 20..600，与 `_recalc` 的换算同一条；间隔更短是增益）。
 * `known` = 这条增益有没有碰上这两条通道里任一键（没碰上的不进分摊、也不让这一位算「认得出」）。
 * @param {any} b `unitBuffs().buffs[]` 的一条 @param {number} baseAtk 当前裸基础攻击力
 * @param {number} baseBat 裸基础攻击间隔（秒） @param {number} baseAspd 裸基础攻击速度
 * @returns {{ atk: number, iv: number, known: boolean }}
 */
function magnitudesOf(b, baseAtk, baseBat, baseAspd) {
  const m = b && b.mods && typeof b.mods === 'object' ? b.mods : null;
  if (!m) return { atk: 0, iv: 0, known: false };
  const num = (k) => (Number.isFinite(Number(m[k])) ? Number(m[k]) : null);
  const st = Math.max(1, Math.trunc(Number(b.stacks) || 1));
  const add = (k) => { const v = num(k); return v == null ? 0 : v * st; };
  const mul = (k) => { const v = num(k); return v == null ? 1 : (st === 1 ? v : Math.pow(v, st)); };
  const known = ATK_CHANNEL_KEYS.some((k) => num(k) != null) || IV_CHANNEL_KEYS.some((k) => num(k) != null);
  const atk = add('atkFlat') + add('atkFinal') + baseAtk * add('atkPct') + baseAtk * (mul('atkMul') - 1);
  let iv = 0;
  if (IV_CHANNEL_KEYS.some((k) => num(k) != null)) {
    const aBat = Number(baseBat) > 0 ? Number(baseBat) : 1;
    const aAspd = Number.isFinite(Number(baseAspd)) ? Number(baseAspd) : 100;
    const clampAspd = (v) => Math.min(600, Math.max(20, v));
    const bat = aBat * Math.max(0.1, 1 + add('batPct'));
    iv = (aBat * 100) / clampAspd(aAspd) - (bat * 100) / clampAspd(aAspd + add('aspd'));
  }
  return { atk, iv, known };
}

/** 屏上那一场里这一位玩家的**干员单位**（`damage()` 的逐单位账）；`null` = 本机不在这一场。 */
function liveOpsFor(pid) {
  if (!battleRunner || typeof battleRunner.damage !== 'function') return null;
  let d = null;
  try { d = battleRunner.damage(); } catch { d = null; }
  if (!d || !Array.isArray(d.players) || !d.players.some((p) => p && p.playerId === pid)) return null;
  const list = (Array.isArray(d.units) ? d.units : []).filter((u) => u && u.ownerId === pid && u.kind === 'op');
  if (!list.length) return null;
  return { players: d.players, units: list };
}

/** `unitStats(id)` / `unitBuffs(id)` 的安全读（战斗运行器没接上时 `null`）。 */
function unitStatsOf(id) { return battleRunner && typeof battleRunner.unitStats === 'function' ? battleRunner.unitStats(id) : null; }
function unitBuffsOf(id) { return battleRunner && typeof battleRunner.unitBuffs === 'function' ? battleRunner.unitBuffs(id) : null; }

/**
 * 屏上那一场里这一批单位的 `baseId -> { st, bi, rec }`：`unitStats()` 的有效属性、`unitBuffs()` 的增益清单
 * （含它的裸 `base`，那里面有 `spRecovery`），以及 `chess` 表里这一位的记录（技能黑板 / 覆盖率都要它）。
 * 同一把 `baseId` 口径 —— 精锐 / 重复形态都落到同一个干员。`live` 为 null 时是空表。
 * @param {{ units: any[] }|null} live `liveOpsFor()` 的返回
 * @returns {Map<string, { st: any, bi: any, rec: any }>}
 */
function liveByBase(live) {
  const m = new Map();
  for (const u of live && Array.isArray(live.units) ? live.units : []) {
    const base = baseOf(u.uid) || (u.defId ? baseOf(u.defId) : null);
    if (!base) continue;
    const st = unitStatsOf(u.id);
    if (!st) continue;
    m.set(base, { st, bi: unitBuffsOf(u.id), rec: env.chess && typeof base === 'string' ? env.chess[base] : null });
  }
  return m;
}

/**
 * 本回合这一位玩家的**预计每秒伤害**（逐个干员相加），每一格都是**综合 DPS**（常时 × (1−覆盖率) + 技能期 ×
 * 覆盖率，见 `mixedDpsOf`）。
 *   * 本机在屏上那一场（`live` 非空）：每个干员**当前生效**的 `unitStats()` 那一对（已含此刻生效的增益 ——
 *     盟约 / 天赋 / 装备 / 正在跑的技能）再叠加技能期那一档 —— 有效口径；
 *   * 否则退回**纸面模型**：`chess` 表给的基础攻击力与基础攻击间隔（`predictDps`）—— 理论值。
 * @returns {{ dps: number|null, src: 'effective'|'paper'|null }}
 */
function projectedDpsFor(live, units) {
  if (live) {
    let sum = 0;
    let n = 0;
    for (const e of liveByBase(live).values()) {
      const spRec = e.bi && e.bi.base ? e.bi.base.spRecovery : null;
      const m = mixedDpsOf({ atk: Number(e.st.atk), iv: Number(e.st.interval), rec: e.rec, spRec });
      if (m.dps != null) { sum += m.dps; n++; }
    }
    if (n) return { dps: sum, src: 'effective' };
  }
  let sum = 0;
  let n = 0;
  for (const r of Array.isArray(units) ? units : []) {
    const m = predictDps(r);
    if (m.dps != null) { sum += m.dps; n++; }
  }
  return n ? { dps: sum, src: 'paper' } : { dps: null, src: null };
}

/**
 * 本回合战斗的**游戏内时长**（秒）—— 引擎拿它当战斗的 `timeLimit`。有在演的战斗就直接用引擎给的
 * `spec.timeLimit`（本就是游戏秒）；否则**照引擎的算法**从 `config` 推：`rounds[r].combatTimeLimit`（或模式级
 * 同名表的兜底，缺省 60）是**现实秒**，乘 `config.combatTimeScale`（缺省 2，`COMBAT_TIME_SCALE`）＝ 游戏秒。
 * @returns {{ sec: number|null }}
 */
function roundBattleSeconds() {
  const cb = battleRunner && typeof battleRunner.currentBattle === 'function' ? battleRunner.currentBattle() : null;
  const tl = cb && cb.spec ? Number(cb.spec.timeLimit) : NaN;
  if (Number.isFinite(tl) && tl > 0) return { sec: tl };
  const cfg = dataTable('config');
  const pub = feed.pub;
  const modeId = pub && pub.modeId;
  const round = pub && Number.isInteger(pub.round) ? pub.round : null;
  const mode = cfg && cfg.modes && modeId ? cfg.modes[modeId] : null;
  if (!mode || round == null) return { sec: null };
  const rc = mode.rounds && typeof mode.rounds === 'object' ? mode.rounds[String(round)] : null;
  const rcLimit = rc ? Number(rc.combatTimeLimit) : NaN;
  const modeLimit = mode.combatTimeLimit ? Number(mode.combatTimeLimit[String(round)]) : NaN;
  const real = Number.isFinite(rcLimit) && rcLimit > 0 ? rcLimit : (Number.isFinite(modeLimit) && modeLimit > 0 ? modeLimit : 60);
  const scale = cfg && Number.isFinite(Number(cfg.combatTimeScale)) && Number(cfg.combatTimeScale) > 0 ? Number(cfg.combatTimeScale) : 2;
  return { sec: real * scale };
}

/**
 * 这一位玩家**已激活的盟约**及**哪几块棋子供给它**：名单来自 `m.public` 的 `players[].bonds`（公开数据，
 * 每个人的都拿得到）；供体由这一行显示的那批干员（本机 `priv.board`，队友取广播）经 `chess` 表的 `bonds` 反查；
 * 描述文字 / 数字取 `bonds` 只读表。缺表时不编造，字段留空。`bb` 是这条盟约记录**自带的机器可读数字**
 * （`bonds[bondId].bb`）—— 只在引擎的实时增益读不到时用作**数据口径兜底**（`bondLinesOf`）。
 * @returns {Array<{ bondId: string, name: string, layers: number, tier: number, count: number, desc: string|null, bb: object|null, sources: string[] }>}
 */
function bondSourcesFor(row, units) {
  const list = row && Array.isArray(row.bonds) ? row.bonds : [];
  const index = baseBondsIndex();
  const bt = dataTable('bonds');
  const nameOf = new Map();
  for (const r of Array.isArray(units) ? units : []) if (r && typeof r.base === 'string') nameOf.set(r.base, r.name || r.base);
  const out = [];
  for (const b of list) {
    if (!b || b.active !== true || b.off) continue;
    const bondId = typeof b.bondId === 'string' ? b.bondId : null;
    if (!bondId) continue;
    const rec = bt && bt[bondId] ? bt[bondId] : null;
    const sources = [];
    for (const [base, set] of index) if (set.has(bondId) && nameOf.has(base)) sources.push(nameOf.get(base));
    out.push({
      bondId,
      name: (rec && typeof rec.name === 'string' && rec.name) || bondId,
      layers: Math.max(0, Number(b.layers) || 0),
      tier: Number.isFinite(Number(b.tier)) ? Number(b.tier) : 0,
      count: Math.max(0, Number(b.count) || 0),
      desc: rec && typeof rec.desc === 'string' && rec.desc ? rec.desc : null,
      bb: rec && rec.bb && typeof rec.bb === 'object' ? rec.bb : null,
      sources,
    });
  }
  return out;
}

/**
 * 增益的 `mods` 键 → 人话：`[名字, 量纲]`，量纲是 `pct`（`+0.3` 记成 `+30%`）/ `flat`（点数）/ `mul`（倍数）。
 * 这张表只列**说得清**的那些 —— 表外的键一律不写（推不出来的加成只留名字与层数，绝不编造）。
 * 名字与量纲照 `server/sim/units.js` 的 `_recalc` 与 `support/index.js` 的 `directMods`（`atk/def/hp` → 百分比，
 * `*Mul` → 乘算），以及本仓既有的界面用词。
 */
const MOD_LABEL = Object.freeze({
  atkPct: ['攻击力', 'pct'], atkFlat: ['攻击力', 'flat'], atkMul: ['攻击力', 'mul'], atkFinal: ['攻击力', 'flat'],
  defPct: ['防御力', 'pct'], defFlat: ['防御力', 'flat'], defMul: ['防御力', 'mul'],
  hpPct: ['生命上限', 'pct'], hpFlat: ['生命上限', 'flat'], hpMul: ['生命上限', 'mul'],
  resFlat: ['法术抗性', 'flat'], resMul: ['法术抗性', 'mul'],
  aspd: ['攻击速度', 'flat'], batPct: ['攻击间隔', 'pct'],
  defIgnorePct: ['无视防御', 'pct'], resIgnorePct: ['无视法抗', 'pct'],
  dmgDealtMul: ['造成伤害', 'mul'], dmgTakenMul: ['受到伤害', 'mul'], healingDealtMul: ['治疗量', 'mul'],
  atkScaleMul: ['技能伤害倍率', 'mul'], spRecoveryFlat: ['技力回复', 'flat'], spRecoveryMul: ['技力回复', 'mul'],
  redeployMul: ['再部署时间', 'mul'], rangeExtend: ['攻击范围', 'flat'], blockCnt: ['阻挡数', 'flat'],
  taunt: ['嘲讽等级', 'flat'],
});

/** 一位小数之内能写清的数值（去尾零）：`0.5 → '50'`、`12.25 → '12.3'`。 */
const fix1 = (v) => String(Math.round(v * 10) / 10);

/**
 * **一个 `mods` 键翻成一行人话**（`+50%攻击力` / `攻击速度+12` / `造成伤害×1.5`）。
 * 同一键在几位成员身上取值不同时（例如按层数叠出来的攻击力），写**绝对值最大的那一条**并在前面加「最多」——
 * 不把几个成员的值加在一起（那是成员的个数，不是加成的大小）。表外的键返回 `null`。
 * @param {string} key @param {{ min: number, max: number }} cell
 * @returns {string|null}
 */
function modPartText(key, cell) {
  const l = MOD_LABEL[key];
  if (!l || !cell) return null;
  const v = Math.abs(cell.min) >= Math.abs(cell.max) ? cell.min : cell.max;
  const many = Math.abs(cell.max - cell.min) > 1e-9 ? '最多' : '';
  const [name, kind] = l;
  if (kind === 'pct') return `${many}${v >= 0 ? '+' : '-'}${fix1(Math.abs(v) * 100)}%${name}`;
  if (kind === 'mul') return `${name}×${fix1(v)}`;
  return `${name}${many}${v >= 0 ? '+' : '-'}${fix1(Math.abs(v))}`;
}

/**
 * 这一位玩家身上**真的生效**的盟约增益，按**已激活盟约的 bondId** 归拢成 `mods 键 -> { min, max }`。
 *
 * 键 → 盟约的对应：`bond:<id>` / `bond:<id>:<后缀>` 取第二段（`bond:yan`、`bond:sargon:atk`），再搭一份
 * **去掉 `Ship` 后缀**的别名（官方盟约的 bondId 是 `yanShip`，而战斗里写的 key 是 `bond:yan`；
 * `bond:preciShip` 这种又用全名）；`bond:generic:<bondId>` 取第三段（`bonds/dataDriven.js buffKeyOf`）。
 * 只在**已激活盟约**这份名单里找 —— 名单外的 `bond:` 增益不往任何一行上贴。
 * @param {Array<{ bondId: string }>} bonds `bondSourcesFor()` 的结果
 * @param {{ units: any[] }|null} live `liveOpsFor()` 的结果
 * @returns {Map<string, Map<string, { min: number, max: number }>>} bondId -> mods 键 -> 取值区间
 */
function bondModsOf(bonds, live) {
  const alias = new Map();
  for (const b of bonds) {
    alias.set(b.bondId, b.bondId);
    alias.set(String(b.bondId).replace(/Ship$/, ''), b.bondId);
  }
  const out = new Map();
  for (const u of live && Array.isArray(live.units) ? live.units : []) {
    const bi = unitBuffsOf(u.id);
    for (const b of bi && Array.isArray(bi.buffs) ? bi.buffs : []) {
      const key = typeof b.key === 'string' ? b.key : '';
      if (!key.startsWith('bond:') || !b.mods) continue;
      const seg = key.split(':');
      const cand = key.startsWith('bond:generic:') ? [seg[2]] : [seg[1], String(seg[1]).replace(/Ship$/, '')];
      const hit = cand.find((c) => c && alias.has(c));
      if (!hit) continue;
      const id = alias.get(hit);
      let per = out.get(id);
      if (!per) out.set(id, (per = new Map()));
      for (const k of Object.keys(b.mods)) {
        const v = Number(b.mods[k]);
        if (!Number.isFinite(v) || v === 0) continue;
        const cell = per.get(k) || { min: v, max: v };
        cell.min = Math.min(cell.min, v);
        cell.max = Math.max(cell.max, v);
        per.set(k, cell);
      }
    }
  }
  return out;
}

/**
 * `bonds[bondId].bb` 里的键 → 人话属性名。`MOD_LABEL` 那张表只管**落在单位身上的 `bond:*` 增益**（引擎的键名），
 * 而盟约自己的 `bb` 用的是另一套键名（`base_atk` / `atk_per_stack` / `amoris_atk` …），所以这里按**词元**判：把
 * 键按非字母数字切开只看词元 —— `base_atk` → `base` + `atk` ⇒ 攻击力；而 `damage_resistance` → `resistance`
 * （≠ `res`）、`respawn_time` → `respawn` + `time`，两者都**不算**属性键。认不出的一律返回 null（原样列出）。
 * @param {string} key `bonds[].bb` 里的一个键
 * @returns {string|null} 攻击力 / 防御力 / 生命上限 / 法术抗性 / 攻击速度 / 攻击间隔；认不出就是 null
 */
function bondStatLabel(key) {
  const toks = String(key).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const has = (...names) => names.some((n) => toks.includes(n));
  if (has('aspd') || (has('attack') && has('speed'))) return '攻击速度';
  if (has('bat') || (has('attack') && has('time'))) return '攻击间隔';
  if (has('atk')) return '攻击力';
  if (has('def')) return '防御力';
  if (has('hp')) return '生命上限';
  if (has('res') || has('resist')) return '法术抗性';
  return null;
}

/**
 * 一个属性值翻成人话：**攻击速度是点数**（`+12`），其余一律按**分数记成百分比**（`0.3 → +30%`）；单一键的
 * 绝对值大于 1（例如 yanShip 的 `atk:1.5`）认成**倍数**（`×1.5`）—— 绝不把 `1.5` 写成 `150%`。
 */
function bondStatText(label, value, kind) {
  if (kind === 'flat') return `${label}${value >= 0 ? '+' : '-'}${fix1(Math.abs(value))}`;
  if (kind === 'mul') return `${label}×${fix1(value)}`;
  return `${label}${value >= 0 ? '+' : '-'}${fix1(Math.abs(value) * 100)}%`;
}

/**
 * 盟约记录自己的 `bb` → 一行人话（**数据口径，未实测**）：`{ parts, others }`。
 *   * **成对键**：`X` + `X_per` / `X_per_stack`（`base_X` 也认 —— 它的兄弟是去掉 `base_` 前缀的那个核心名，
 *     如 `base_atk` ↔ `atk_per_stack`）⇒ 取 `X + X_per × 层数`，并标 `（按 N 层）`；
 *   * **单个属性键**：原值直接翻（分数记百分比、绝对值大于 1 认成倍数）；
 *   * **认不出的数字键**：原样 `键=值` 收进 `others`（**不丢**）—— 既不硬套一个名字，也不编造数据里没有的数。
 * @param {any} bb `bonds[bondId].bb` @param {number} layers 这一位当前层数
 * @returns {{ parts: string[], others: string[] }}
 */
function bondBbSummary(bb, layers) {
  const parts = [];
  const others = [];
  if (!bb || typeof bb !== 'object') return { parts, others };
  const nums = new Map();
  for (const k of Object.keys(bb)) {
    const v = Number(bb[k]);
    if (Number.isFinite(v) && v !== 0) nums.set(k, v);
  }
  const used = new Set();
  const L = Number.isFinite(layers) && layers > 0 ? layers : 0;
  // 认不出的数字键要「原样可读」：`fix1` 会把 0.0005 抹成 0，所以这里另给一个保留有效数字的写法。
  const raw = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(4))));
  // ① 成对：X + X_per / X_per_stack（base_ 前缀先归一化到核心名）
  for (const [k, v] of nums) {
    if (used.has(k)) continue;
    const label = bondStatLabel(k);
    if (!label) continue;
    const core = k.startsWith('base_') ? k.slice(5) : k;
    const sib = [`${core}_per`, `${core}_per_stack`].find((s) => s !== k && nums.has(s) && !used.has(s));
    if (!sib) continue;
    const total = v + nums.get(sib) * L;
    const kind = label === '攻击速度' ? 'flat' : 'pct';
    parts.push(bondStatText(label, total, kind) + (L > 0 ? `（按 ${L} 层）` : ''));
    used.add(k);
    used.add(sib);
  }
  // ② 单键 + 认不出的数字键
  for (const [k, v] of nums) {
    if (used.has(k)) continue;
    used.add(k);
    const label = bondStatLabel(k);
    if (!label) { others.push(`${k}=${raw(v)}`); continue; }
    const kind = label === '攻击速度' ? 'flat' : (Math.abs(v) > 1 ? 'mul' : 'pct');
    parts.push(bondStatText(label, v, kind));
  }
  return { parts, others };
}

/**
 * 「盟约加成 · 总和与来源」下半块的取数：**逐盟约一行数值总结**（`【颂乐人偶】+50%攻击力、攻击速度+12`）。
 *
 * 数字**优先**从引擎真的落在那些成员身上的 `bond:*` 增益（`unitBuffs().mods`）来：`bondModsOf` 归拢、`modPartText`
 * 翻成人话。本机这一场一条都读不到（休整期 / 观战 / 队友行 / 成员还没上场 / 效果不是属性增益）时，**退回盟约
 * 自己的数据口径**（`bonds` 表那条记录的 `bb` → `bondBbSummary`），面板上标注「数据口径（未实测）」；`bb` 里
 * 认不出的数字键原样列在 `others` 里 —— 绝不编造一个数据里没有的数。
 * 合计那一格（`盟约加成合计`）**不是层数**，是**按比例分摊**算出来的**预计 DPS 提升**，由 `proratedSplitFor`
 * 的 `bond` 类目给。
 * @param {Array<any>} bonds `bondSourcesFor()` 的结果 @param {any} live `liveOpsFor()` 的结果
 * @returns {Array<{ bondId: string, name: string, layers: number, parts: string[], dataParts: string[], others: string[] }>}
 */
function bondLinesOf(bonds, live) {
  const mods = live ? bondModsOf(bonds, live) : new Map();
  return bonds.map((b) => {
    const per = mods.get(b.bondId);
    const parts = [];
    for (const [k, cell] of per || []) {
      const t = modPartText(k, cell);
      if (t) parts.push(t);
    }
    // 实测那一档有数就不翻数据口径（两者不并列）；实测拿不到才退回 `bb`。
    const data = parts.length ? { parts: [], others: [] } : bondBbSummary(b.bb, b.layers);
    return { bondId: b.bondId, name: b.name, layers: b.layers, parts, dataParts: data.parts, others: data.others };
  });
}

/**
 * **不同增益分别对总伤害的提升与占比（按比例分摊）**。
 *
 * 旧版是「把引擎的折算式原样重算一遍，对不上就不画」—— 它要求重算与 `unitStats()` 的实测**逐位吻合**，于是本场
 * 只要有一条读不懂的增益就整块消失（业主报的那个「增益拆分不可用（重算的属性与实测不符…）」）。现在改成**永远
 * 给得出数字**的口径：
 *   1. 先取**实测**的两个差：`Δatk = cur.atk − base.atk`、`Δinterval = base.interval − cur.interval`（间隔更短是增益）；
 *   2. 每条生效增益按 `magnitudesOf` 算出它在两条通道上的**声明幅度**（与 `server/sim/units.js` 的折算式同一条）；
 *   3. 每一通道的实测差**按幅度比例分摊**给各增益：`share_i = Δ × mag_i ÷ Σmag` —— 加算百分比那一档这是**精确**的，
 *      乘算键（`atkMul` / 攻击间隔的非线性换算）只是**近似**（面板小注里写明）；
 *   4. 每条增益的**提升** = `DPS(全都在) − DPS(拿掉这一条分到的份额)`，**占比** = 提升 ÷ 总 DPS；类目由同一些份额相加。
 * 一条增益都没碰上攻击力 / 攻击间隔（全是增伤 / 技力 / 控制…）时返回 `reason: 'none'`，面板画一行「—」。
 * @returns {{ available: boolean, reason: string|null, cats: Array<{ id: string, label: string, dps: number }>,
 *   list: Array<{ key: string, cat: string, dps: number }> }}
 */
function proratedSplitFor(pid) {
  const live = liveOpsFor(pid);
  if (!live) return { available: false, reason: 'noBattle', cats: [], list: [] };
  const catDps = new Map();
  const keyDps = new Map();
  let recognized = false;
  for (const u of live.units) {
    const bi = unitBuffsOf(u.id);
    const st = unitStatsOf(u.id);
    if (!bi || !bi.base || !st || !st.base) continue;
    const curAtk = Number(st.atk);
    const curIv = Number(st.interval);
    const baseAtk = Number(st.base.atk);
    const baseIv = Number(st.base.interval);
    if (!(curAtk > 0) || !(curIv > 0) || !(baseAtk >= 0) || !(baseIv > 0)) continue;
    const buffs = Array.isArray(bi.buffs) ? bi.buffs : [];
    if (!buffs.length) continue;
    const baseBat = Number(bi.base.bat) > 0 ? Number(bi.base.bat) : 1;
    const baseAspd = Number.isFinite(Number(bi.base.aspd)) ? Number(bi.base.aspd) : 100;
    const mags = buffs.map((b) => magnitudesOf(b, baseAtk, baseBat, baseAspd));
    const sumAtk = mags.reduce((s, x) => s + x.atk, 0);
    const sumIv = mags.reduce((s, x) => s + x.iv, 0);
    const dAtk = curAtk - baseAtk;
    const dIv = baseIv - curIv;
    const allDps = curAtk / curIv;
    for (let i = 0; i < buffs.length; i++) {
      if (!mags[i].known) continue;
      recognized = true;
      const aShare = Math.abs(sumAtk) > 1e-9 ? (dAtk * mags[i].atk) / sumAtk : 0;
      const ivShare = Math.abs(sumIv) > 1e-9 ? (dIv * mags[i].iv) / sumIv : 0;
      const a = curAtk - aShare;
      const iv = curIv + ivShare;
      const without = a > 0 && iv > 0 ? a / iv : 0;
      const uplift = allDps - without;
      if (!Number.isFinite(uplift) || Math.abs(uplift) < 1e-9) continue;
      const cat = buffCategory(buffs[i].key);
      catDps.set(cat, (catDps.get(cat) || 0) + uplift);
      keyDps.set(buffs[i].key, (keyDps.get(buffs[i].key) || 0) + uplift);
    }
  }
  if (!recognized) return { available: false, reason: 'none', cats: [], list: [] };
  const cats = BUFF_CATS.map((c) => ({ ...c, dps: catDps.get(c.id) || 0 })).filter((c) => Math.abs(c.dps) >= 1e-9);
  const list = [...keyDps.entries()].map(([key, dps]) => ({ key, cat: buffCategory(key), dps }))
    .sort((a, b) => Math.abs(b.dps) - Math.abs(a.dps)).slice(0, 24);
  return { available: true, reason: null, cats, list };
}

/**
 * 一场战斗结果里的逐单位伤害，按 `defId` → `baseId` 归并后记进台账，并去重（同一 `battleId` 只计一次）。
 *
 * `result.perPlayer[pid].unitStats` 是 0.2.4 的官方逐单位统计（`server/sim/spec.js compactResult`）：
 * `{ uid, defId, kind, dmg, kills, heal, taken, attacks }`。同一个 `baseId` 的多个 `defId` / 多个 `uid` 相加。
 * 一场战斗里没上场的干员其 `last` 归零、`total` 保留。
 *
 * @param {any} result the battle result（`perPlayer` 至少要有）
 * @param {string} battleId 这一场战斗的 id（去重键；缺省时不去重）
 * @returns {boolean} 是否真的记进去了（重复 / 没有可记的 ⇒ false）
 */
function recordResult(result, battleId) {
  if (!result || typeof result !== 'object') return false;
  const perPlayer = result.perPlayer && typeof result.perPlayer === 'object' ? result.perPlayer : null;
  if (!perPlayer) return false;
  if (typeof battleId === 'string' && battleId) {
    if (counted.has(battleId)) return false;
    counted.add(battleId);
    if (counted.size > COUNTED_MAX) counted.delete(counted.values().next().value);
  }
  let touched = false;
  for (const [pid, pp] of Object.entries(perPlayer)) {
    const list = pp && Array.isArray(pp.unitStats) ? pp.unitStats : null;
    if (!list) continue;
    const mine = ledger.get(pid) || new Map();
    ledger.set(pid, mine);
    const last = new Map(); // baseId -> 这一场的伤害
    for (const u of list) {
      if (!u || typeof u !== 'object') continue;
      const base = baseOf(u.defId);
      if (!base) continue;
      const dmg = Math.max(0, Number(u.dmg) || 0);
      last.set(base, (last.get(base) || 0) + dmg);
    }
    for (const [base, dmg] of last) {
      const cell = mine.get(base) || { last: 0, total: 0 };
      cell.last = dmg;
      cell.total += dmg;
      mine.set(base, cell);
    }
    for (const [base, cell] of mine) if (!last.has(base)) cell.last = 0;
    touched = true;
  }
  return touched;
}

/** `liveOpsFor(pid)` + `liveByBase()` 的一步写法：屏上那一场里这一位玩家的 `baseId -> { st, bi, rec }`。 */
function liveMapFor(pid) {
  const live = liveOpsFor(pid);
  return live ? liveByBase(live) : null;
}

/**
 * 自己这一行里某一位干员的**显示数据**（面板与广播载荷共用同一份口径）：`mergeBoard()` 的静态字段 + 上场次数 +
 * 台账那两格 + 本场实测速率 + 这一位**当前生效**的攻击力 / 间隔与技力回复（要屏上那一场里有他才读得到）。
 * @param {any} st 本机那份 trackers @param {Map|null} dmg 台账 @param {any} r `mergeBoard()` 的一行
 * @param {{ dps: Map|null, hps: Map|null }} rates @param {Map<string, any>|null} byBase `liveMapFor()` 的结果
 * @returns {object}
 */
function myUnitView(st, dmg, r, rates, byBase) {
  const cell = dmg && dmg.get(r.base);
  const eff = byBase ? byBase.get(r.base) : null;
  const atk = eff ? Number(eff.st.atk) : NaN;
  const iv = eff ? Number(eff.st.interval) : NaN;
  return {
    ...r,
    deploys: st.deploys.get(r.base) || 0,
    lastDmg: (cell && cell.last) || 0,
    totalDmg: (cell && cell.total) || 0,
    dps: rates && rates.dps && rates.dps.has(r.base) ? Math.round(rates.dps.get(r.base)) : null,
    hps: rates && rates.hps && rates.hps.has(r.base) ? Math.round(rates.hps.get(r.base)) : null,
    // 有效口径（**含这一位自己吃到的增益**，业主 2026-10-15 第 5 条）：休整期屏上没有战斗 ⇒ 两项都是 null，
    // 预期 DPS 于是退回纸面模型（`UnitRow` 里那两档就是这么分的）。
    effAtk: Number.isFinite(atk) ? atk : null,
    effIv: Number.isFinite(iv) && iv > 0 ? iv : null,
    spRec: eff && eff.bi && eff.bi.base ? eff.bi.base.spRecovery : null,
  };
}

/** 本机这一刻在场上那几位的显示数据（面板与「保留一回合」的快照共用一份）。 */
function myRows(st, priv, dmg, rates) {
  const byBase = liveMapFor(feed.myId);
  return mergeBoard(priv && priv.board, env.chess).map((r) => myUnitView(st, dmg, r, rates, byBase));
}

/**
 * 把这一刻**在场上**的那几位记进快照（`lastSeen`）。只刷新在场上的人，下场的一律不动 —— 见 `lastSeen` 的注释。
 * 回合号拿不到（`pub.round` 不是整数）时干脆不记：保留那一条规则判不了，宁可不留。
 */
function noteSeen(pid, rows) {
  const round = roundNow();
  if (!pid || round == null || !Array.isArray(rows) || !rows.length) return;
  let m = lastSeen.get(pid);
  if (!m) lastSeen.set(pid, (m = new Map()));
  for (const r of rows) if (r && typeof r.base === 'string') m.set(r.base, { round, row: { ...r } });
}

/** 把「最后一次真的量到的实测速率」记进 `lastRates`（只在真读到数的时候：战斗在演）。 */
function noteRates(pid, rates) {
  const round = roundNow();
  if (!pid || round == null || !rates || (!rates.dps && !rates.hps)) return;
  lastRates.set(pid, { round, dps: rates.dps || new Map(), hps: rates.hps || new Map() });
}

/**
 * 「保留一回合」要补出来的那几行：这一回合不在场上、但**上一回合还在场上**的干员（`round - seenRound === 1`）。
 * 顺手把**整整一个回合都不在场**（`>= 2`）的快照删掉 —— 快照因此有界，也不会在更晚的回合里把旧行复活。
 * @param {string} pid @param {Set<string>} present 这一刻在场上的 baseId 集合
 * @returns {Array<object>} 带 `retained: true` 的行（数值是最后一次在场上那一刻的）
 */
function retainedRowsFor(pid, present) {
  const m = lastSeen.get(pid);
  const round = roundNow();
  if (!m || round == null) return [];
  const out = [];
  for (const [base, cell] of [...m]) {
    if (present.has(base)) continue;
    if (round - cell.round >= 2) { m.delete(base); continue; }
    if (round - cell.round === 1) out.push({ ...cell.row, retained: true });
  }
  return out;
}

/**
 * 「上一场实测」那一档：本场没有在演的读数时（战斗刚停 / 休整期）回落到**最后一次量到的** DPS / HPS ——
 * 同样只留一个回合（`round - lastRates.round <= 1`）；更早的读数一律不画，于是不会出现「两个回合前的呆数字」。
 * @param {string} pid @param {string} base @param {'dps'|'hps'} kind
 * @returns {number|null}
 */
function pastRate(pid, base, kind) {
  const rec = lastRates.get(pid);
  const round = roundNow();
  if (!rec || round == null || round - rec.round > 1) return null;
  const m = rec[kind];
  return m && m.has(base) ? Math.round(m.get(base)) : null;
}

/**
 * 推进「自己这一行」的上场次数并（必要时）把自己的棋阵 / 伤害 / 几个数广播给同房间的人。
 * **每次顶栏给自己一份新数据时调用一次**。伤害来自 `ledger`（由战斗运行器的 `result` 事件喂）。
 */
function advance() {
  const { pub, priv, myId } = feed;
  if (!myId) return;
  const phase = (pub && pub.phase) || null;

  let st = trackers.get(myId) || tworact();
  trackers.set(myId, st);

  // **新一局的判定**（每帧都算，不能只靠 `INFO_CHECK`）：业主 2026-10-15 ——「全量模拟」局会跳过本局信息 /
  // 策略阶段（`platform.start` → `skipToBattle`），那条判据永远等不到，于是新一局带着上一局的累计伤害继续加。
  // 两条判据（任一条成立就是新一局）：
  //   * 见过 `RESULT`（这一局收摊了）之后又回到第 1 回合 / 开局那几个阶段；
  //   * 回合号**回退**（这一帧的 round 比上一帧小）—— 新一局从第 1 回合重开。
  const rd = pub && Number.isInteger(pub.round) && pub.round > 0 ? pub.round : null;
  const newMatch = (matchEnded && (rd === 1 || START_PHASES.has(phase)))
    || (rd != null && seenRound != null && rd < seenRound);
  if (newMatch) {
    dropAll();
    // 自己那一行也换成本局全新的台账：旧的上场次数 / 阶段不能跟过来（`st` 是这一帧早先取到的引用，
    // 清完 `trackers` 之后它已经成了孤儿，必须重新挂上新的那份）。
    st = tworact();
    trackers.set(myId, st);
  }
  if (rd != null) seenRound = rd;
  if (phase === 'RESULT') matchEnded = true;

  // 阶段真的变了才动（一场战斗的「开始」与一局的「结束 / 开始」都按这一条判）。
  if (st.phase !== phase) {
    // 一局结束（`RESULT`）删档、新一局开始（`INFO_CHECK`，每局的第一阶段）连内存一起清 ——
    // 业主 2026-10-14：刷新页面不掉数据，但换一局必须清干净。
    if (phase === 'RESULT') dropLS();
    else if (phase === 'INFO_CHECK' && !newMatch) dropAll();
    // 一场战斗开始（阶段从非战斗进入战斗）：当前在场上的每个干员上场次数 +1
    if (!isBattlePhase(st.phase) && isBattlePhase(phase)) {
      for (const row of mergeBoard(priv && priv.board, env.chess)) {
        st.deploys.set(row.base, (st.deploys.get(row.base) || 0) + 1);
      }
    }
    st.phase = phase;
  }
  saveLS(); // 台账动了就节流落一次盘（阶段 / 上场次数都在这里推进）

  // 协防成功接敌：这一回合的**联防阶段**里，在 `pub.unite.helpers` 名单上的每一位博士记一次（一个人一个回合只记
  // 一次 —— 名单是「谁在迎战」，不是「迎了几只」；服务端没有这只计数器，见 `helped` 的注释）。
  const unite = pub && phase === 'UNITE' && pub.unite && typeof pub.unite === 'object' ? pub.unite : null;
  if (unite && Number.isInteger(pub.round) && uniteRound !== pub.round) {
    uniteRound = pub.round;
    for (const pid of Array.isArray(unite.helpers) ? unite.helpers : []) {
      if (typeof pid === 'string' && pid) helped.set(pid, (helped.get(pid) || 0) + 1);
    }
    saveLS(true); // 这一格刚变，立刻落盘（一回合只发生一次）
  }

  // 本机这一刻在场上那几位的显示数据：实测速率是**实时**读数（屏上那一场），与台账那两格独立 —— 别人那一行
  // 显示的就是这里换算出来的数；同时也是「保留一回合」那份快照（`lastSeen` / `lastRates`）的来源。
  const rates = ratesFor(myId);
  const rows = myRows(st, priv, ledger.get(myId), rates);
  noteSeen(myId, rows);
  noteRates(myId, rates);

  // 广播：自己的棋阵 + 逐干员伤害 + 几个面板要用的数（别人那一行显示的就是这些）
  if (!env.send || !priv) return;
  const payload = payloadOf(rows, priv);
  const sig = JSON.stringify(payload);
  const now = Date.now();
  const last = st.sent || { sig: '', at: 0 };
  if (sig === last.sig && now - last.at < SEND_HEARTBEAT_MS) return;
  if (now - last.at < SEND_MIN_MS) return;
  st.sent = { sig, at: now };
  env.send(CHANNEL, payload);
}

/**
 * 自己那一行的广播载荷（键名都取短的：`PACK_MSG_LIMITS.bytes` 是 4096）。
 * @param {Array<any>} rows `myRows()` 的结果（本机这一刻在场上那几位）
 * @param {any} priv `m.private`
 */
function payloadOf(rows, priv) {
  const units = (Array.isArray(rows) ? rows : []).map((r) => [
    r.base, r.name, r.charId, r.tier, r.maxHp ?? null, r.atk ?? null, r.def ?? null, r.block ?? null,
    r.deploys || 0, r.copies, r.lastDmg || 0, r.totalDmg || 0,
    // 实测速率（本场实时读数，取整；不在战斗中 / 不是自己那一场 ⇒ null）。**最后两项**：老版本的读者读不到
    // 它们就是 `undefined`，那两格画成空，不会把它们当成 0。
    r.dps ?? null,
    r.hps ?? null,
  ]);
  const stats = priv.stats && typeof priv.stats === 'object' ? priv.stats : {};
  return {
    units,
    funds: Number.isFinite(priv.funds) ? priv.funds : null,
    kills: Number.isFinite(stats.kills) ? stats.kills : null,
    merges: Number.isFinite(stats.merges) ? stats.merges : null,
    leaks: Number.isFinite(stats.leaks) ? stats.leaks : null,
    itemMerges: Number.isFinite(stats.itemMerges) ? stats.itemMerges : null,
    deploy: [Number.isFinite(priv.deployCount) ? priv.deployCount : null, Number.isFinite(priv.deployCap) ? priv.deployCap : null],
  };
}

/** 把别人的广播解成面板用的形状（不信任对面：每一项都自己判一遍）。 */
function readPeer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const units = (Array.isArray(raw.units) ? raw.units : []).slice(0, 32).map((u) => {
    if (!Array.isArray(u) || typeof u[0] !== 'string') return null;
    return {
      base: u[0], name: typeof u[1] === 'string' ? u[1] : u[0], charId: typeof u[2] === 'string' ? u[2] : null,
      tier: int(u[3]) ?? 0, maxHp: int(u[4]), atk: int(u[5]), def: int(u[6]), block: int(u[7]),
      deploys: int(u[8]) ?? 0, copies: Math.max(1, int(u[9]) ?? 1),
      lastDmg: int(u[10]) ?? 0, totalDmg: int(u[11]) ?? 0,
      // 对面那一场打了多少 DPS / HPS（对面自己客户端现读的）。对面没在打 / 老版本 ⇒ null，那两格画成空。
      dps: int(u[12]),
      hps: int(u[13]),
    };
  }).filter(Boolean);
  const deploy = Array.isArray(raw.deploy) ? [int(raw.deploy[0]), int(raw.deploy[1])] : [null, null];
  return {
    units, funds: int(raw.funds), kills: int(raw.kills), merges: int(raw.merges),
    leaks: int(raw.leaks), itemMerges: int(raw.itemMerges), deploy, at: Date.now(),
  };
}

// ---- 改写链：只做「把这一帧的数据抄进来」这一件事 ---------------------------------------------------------------

/**
 * 顶栏 props 里的 `pub` / `priv` / `myId` 每次渲染都可能是新的一份（引擎给的是**只读快照**，同一份原始数据
 * 复用同一个快照对象），所以这里按**引用**判断有没有变。变了就更新表并通知面板重画。
 *
 * 它不画任何东西（返回 null）：这条改写链存在的唯一理由是「面板拿不到 store，而顶栏每一帧都有这一帧的数据」。
 * @param {{ pub?: any, priv?: any, myId?: any }} props
 */
function Feed({ pub, priv, myId }) {
  useEffect(() => {
    if (feed.pub === pub && feed.priv === priv && feed.myId === myId) return;
    feed = { pub: pub ?? null, priv: priv ?? null, myId: myId ?? null };
    notify();
  });
  return null;
}

/**
 * 改写工厂（每帧调用一次，必须只依赖 `ctx`）：引擎那一份原样返回，旁边挂一个不画东西的数据喂食器。
 *
 * 本包只声明了一条链：`game.hud.topBar` —— 这一帧的 `pub` / `priv` / `myId`（每帧都有，不必等 `m.public` 推送）。
 * @param {{ component: string, props: any }} ctx
 * @returns {(orig: any) => any}
 */
export function wrap(ctx) {
  const { pub, priv, myId } = ctx.props || {};
  return (orig) => html`<${Fragment}>${orig}<${Feed} pub=${pub} priv=${priv} myId=${myId} /></${Fragment}>`;
}

// ---- 面板 -------------------------------------------------------------------------------------------------------

/** 一个数值行：左边标签、右边数值（行与行的分隔线由 CSS 的 border-top 画）。 */
function StatRow({ label, value, tone = null }) {
  return html`<li class=${cx(`${CLS}__row`, tone && `is-${tone}`)}>
    <span class=${`${CLS}__k`}>${label}</span>
    <b class=${`${CLS}__v num`}>${value}</b>
  </li>`;
}

/**
 * 干员行：名字 + 阶级 / 上场次数，**名字下方是头像**，右边四项基础数值，随后是这一位**自己的**伤害统计
 * （上回合 / 一局累计）与速率那一行（DPS / 预期DPS / 技能DPS，会治疗的再带三格 HPS）。格子与顺序都没动，
 * 变的是两处口径（业主 2026-10-15）：
 *   * **预期 DPS** 现在是**综合 DPS**（常时 × (1−覆盖率) + 技能期 × 覆盖率，见 `mixedDpsOf`）：能读到这一位
 *     **当前生效**的攻击力 / 间隔时用它（**含他自己吃到的盟约 / 天赋 / 装备 / 正在跑的技能**），休整期读不到就退回
 *     纸面模型 —— 两档各有一条 `title` 说清。**技能 DPS** 那一格保留，仍是「技能开着」那一档的参考。
 *   * **实测 DPS / HPS**：正在演的那一场优先；战斗刚停 / 休整期时回落到**上一场真的量到的那一份**（标 `is-past`
 *     的淡色），同样只留一个回合（见 `pastRate`）。
 * `row.retained` 的那一行（这一回合刚下场、上一回合还在场上）也照旧画，整行标 `is-past` 并带一句说明。
 * @param {{ pid: string|null, row: any }} props
 */
function UnitRow({ pid, row }) {
  const url = row.charId ? avatarOf(env.assets, { charId: row.charId }) : avatarForChessId(row.base);
  // 医疗干员的**攻击力就是它的治疗量**（不是伤害）：那两格「预期 DPS」画成空，换成下面那一组 HPS。
  const rec = chessAndBb(row).rec;
  const isHealer = !!rec && rec.profession === 'MEDIC';
  const heal = healRates(row);
  // 综合 DPS 的两档：**有效**那一档（含这一位自身吃到的增益，读数里对得上就用它）优先，其次纸面那一档。
  const model = isHealer ? null
    : (row.effAtk != null && row.effIv > 0
      ? mixedDpsOf({ atk: row.effAtk, iv: row.effIv, rec, spRec: row.spRec })
      : predictDps(row));
  const skillPred = isHealer ? null : skillDps(row);
  // 实测那两格：本场实时 → 上一场量到的那一份（只留一个回合）→ 「—」。
  const dpsPast = row.dps != null || !pid ? null : pastRate(pid, row.base, 'dps');
  const dpsVal = row.dps != null ? row.dps : dpsPast;
  const hpsPast = row.hps != null || !pid ? null : pastRate(pid, row.base, 'hps');
  const hpsVal = row.hps != null ? row.hps : hpsPast;
  const canHeal = !!heal || hpsVal != null;
  const dpsTitle = '每秒伤害（攻击期间）：正在演的这一场的实时读数，分母只算它出手的那段时间（走位 / 蓄力 / '
    + '技能抬手 / 没有目标都不计入）；战斗刚停 / 休整期没有在演的战斗时，回落成上一场量到的那一份（淡色，保留一个回合）';
  const hpsTitle = '每秒治疗量（攻击期间）：分母只算它出手的那段时间（与 DPS 同一条分母）；正在演的那一场优先，'
    + '战斗刚停 / 休整期回落到上一场量到的那一份（淡色，保留一个回合）';
  const predictTitle = '预期 DPS：综合值 = 常时 × (1 − 技能覆盖率) + 技能期 × 技能覆盖率 —— 覆盖率由技能时长'
    + '（duration 秒，或弹药数 × 技能期攻击间隔）与充能时长（时间回复 spCost ÷ 每秒技力回复；攻击回复 spCost × 攻击间隔）推'
    + '（稳态假设，见注释）。'
    + (row.effAtk != null
      ? '这一份用的是这一位当前生效的攻击力 / 攻击间隔（含他自己吃到的盟约 / 天赋 / 装备 / 正在跑的技能）'
      : '这一份是理论值（纸面：chess 表的基础攻击力 ÷ 基础攻击间隔，不含任何增益）')
    + '；目标防御 / 抗性、同时打几个目标与技能黑板之外的增伤都不在里面';
  return html`<li class=${cx(`${CLS}__unit`, row.retained && 'is-past')}
    title=${row.retained ? '这一位已下场：上面的数字是它最后一次在场上时的，保留到下一回合' : null}>
    <span class=${`${CLS}__uhead`}>
      <b class=${`${CLS}__uname`}>${row.name}</b>
      ${row.copies > 1 ? html`<span class=${`${CLS}__copies num`}>×${row.copies}</span>` : null}
      <span class=${`${CLS}__umeta`}><span class="num">${ROMAN[row.tier] || row.tier || '—'}</span> 阶<span class=${`${CLS}__dot`} aria-hidden="true">·</span>上场 <span class="num">${row.deploys}</span> 次</span>
    </span>
    <span class=${`${CLS}__ubody`}>
      <span class=${`${CLS}__uavatar`}>${url ? html`<img src=${url} alt="" loading="lazy" />` : null}</span>
      <span class=${`${CLS}__ustats`}>
        <span class=${`${CLS}__stat`} title="生命上限"><i>生命</i><b class="num">${numText(row.maxHp)}</b></span>
        <span class=${`${CLS}__stat`} title="攻击"><i>攻击</i><b class="num">${numText(row.atk)}</b></span>
        <span class=${`${CLS}__stat`} title="防御"><i>防御</i><b class="num">${numText(row.def)}</b></span>
        <span class=${`${CLS}__stat`} title="阻挡数"><i>阻挡</i><b class="num">${numText(row.block)}</b></span>
      </span>
    </span>
    <span class=${`${CLS}__udmg`}>
      <span class=${cx(`${CLS}__dmg`, (row.lastDmg || 0) > 0 && 'is-on')}>上回合伤害 <b class="num">${numText(row.lastDmg)}</b></span>
      <span class=${cx(`${CLS}__dmg`, (row.totalDmg || 0) > 0 && 'is-on')}>累计伤害 <b class="num">${numText(row.totalDmg)}</b></span>
    </span>
    <span class=${`${CLS}__urate`}>
      <span class=${cx(`${CLS}__dmg`, `${CLS}__dps`, row.dps != null && row.dps > 0 && 'is-on', dpsPast != null && 'is-past')}
        title=${dpsTitle}>DPS <b class="num">${numText(dpsVal)}</b></span>
      ${model == null || model.dps == null ? null : html`<span class=${cx(`${CLS}__dmg`, `${CLS}__dps-predict`, row.effAtk != null && 'is-eff')}
        title=${predictTitle}>预期DPS <b class="num">${numText(model.dps)}</b></span>`}
      ${skillPred == null ? null : html`<span class=${cx(`${CLS}__dmg`, `${CLS}__dps-predict`)}
        title="技能期 DPS（理论值）：一次技能期间能造成的伤害 ÷ 技能的持续时长 = 技能期的每击伤害 ÷ 技能期攻击间隔（技能改的攻速 / 攻击间隔都在里面）；技能不动攻击力与攻速时不显示；同样只看纸面">技能DPS <b class="num">${numText(skillPred)}</b></span>`}
      ${!canHeal ? null : html`<${Fragment}>
        <span class=${cx(`${CLS}__dmg`, `${CLS}__hps`, `${CLS}__hps--first`, row.hps != null && row.hps > 0 && 'is-on', hpsPast != null && 'is-past')}
          title=${hpsTitle}>HPS <b class="num">${numText(hpsVal)}</b></span>
        <span class=${cx(`${CLS}__dmg`, `${CLS}__hps`)}
          title="预期 HPS（理论值）：医疗干员的治疗量就是它的攻击力 ⇒ 攻击力 ÷ 基础攻击间隔；其它治疗机制（按伤害比例回血、每秒回血、护盾…）不在这里，它们只在左边实测那一格出现">预期HPS <b class="num">${numText(heal && heal.base)}</b></span>
        <span class=${cx(`${CLS}__dmg`, `${CLS}__hps`)}
          title="技能期 HPS（理论值）：一次技能期间能造成的治疗量 ÷ 技能的持续时长（技能改的攻击力 / 攻速都在里面）；这条技能不治疗时不显示">技能HPS <b class="num">${numText(heal && heal.skill)}</b></span>
      </${Fragment}>`}
    </span>
  </li>`;
}

/** 调色板的格数（`.db__c0`…`.db__c7`，见 board.css；第 9 个人开始回到第 1 个颜色）。 */
const SLICE_TONES = 8;

/**
 * 一瓣的路径：圆心 → 弧起点，一段弧，再回圆心。角度是**度**，0 = 正右，顺时针为正（与 SVG 同向）。
 * @param {number} cx @param {number} cy @param {number} r @param {number} a0 起始角 @param {number} a1 结束角
 * @returns {string}
 */
function piePath(cx, cy, r, a0, a1) {
  const rad = (d) => (d * Math.PI) / 180;
  const x0 = (cx + r * Math.cos(rad(a0))).toFixed(3);
  const y0 = (cy + r * Math.sin(rad(a0))).toFixed(3);
  const x1 = (cx + r * Math.cos(rad(a1))).toFixed(3);
  const y1 = (cy + r * Math.sin(rad(a1))).toFixed(3);
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1} Z`;
}

/**
 * 一张扇形图（一瓣一个来源）：纯 SVG，不引图表库 —— 一瓣一条 `<path>`（一段 `A` 弧）；只有「一瓣占满 100%」那一档
 * 退回 `<circle>`（一整圈用一条弧画不出来：两个端点重合时浏览器直接不画）。
 *
 * 图本身只管画：一瓣的份额 = 这一项的 `value` ÷ 全部 `value` 之和（**同一条分母**，所以一瓣一色、加起来正好一圈），
 * 图例那一位小数就是它；`head` / `emptyNote` / `note` 由调用方给（干员页是「伤害占比」，全量页是「提升占比」）。
 * 空的时候画一个空环，占住这一列的位置，而不是把图表整块抽掉。
 * @param {{ rows: Array<{ key: string, label: string, value: number }>, head: any, ariaLabel: string,
 *   emptyNote: string, note?: any }} props
 */
function SlicePie({ rows, head, ariaLabel, emptyNote, note = null }) {
  const total = (Array.isArray(rows) ? rows : []).reduce((s, r) => s + r.value, 0);
  if (!(total > 0)) {
    return html`<div class=${`${CLS}__chart`}>
      ${head}
      <svg class=${`${CLS}__pie`} viewBox="0 0 100 100" aria-hidden="true">
        <circle class=${`${CLS}__pie-empty`} cx="50" cy="50" r="46" />
      </svg>
      <span class=${`${CLS}__chart-note`}>${emptyNote}</span>
    </div>`;
  }
  const CX = 50; const CY = 50; const R = 46;
  let acc = 0;
  const slices = rows.map((r, i) => {
    const a0 = acc * 360 - 90;
    acc += r.value / total;
    return { ...r, pct: r.value / total, a0, a1: acc * 360 - 90, tone: i % SLICE_TONES };
  });
  return html`<div class=${`${CLS}__chart`}>
    ${head}
    <svg class=${`${CLS}__pie`} viewBox="0 0 100 100" role="img" aria-label=${ariaLabel}>
      ${slices.map((s) => (s.pct >= 1
        ? html`<circle key=${s.key} class=${cx(`${CLS}__slice`, `${CLS}__c${s.tone}`)} cx=${CX} cy=${CY} r=${R} />`
        : html`<path key=${s.key} class=${cx(`${CLS}__slice`, `${CLS}__c${s.tone}`)} d=${piePath(CX, CY, R, s.a0, s.a1)} />`))}
    </svg>
    ${note}
    <ul class=${`${CLS}__legend`}>
      ${slices.map((s) => html`<li key=${s.key} class=${`${CLS}__lrow`}>
        <i class=${cx(`${CLS}__swatch`, `${CLS}__c${s.tone}`)} aria-hidden="true"></i>
        <span class=${`${CLS}__lname`}>${s.label}</span>
        <b class=${`${CLS}__lpct num`}>${(s.pct * 100).toFixed(1)}%</b>
      </li>`)}
    </ul>
  </div>`;
}

/**
 * 干员页右边那张图：这一位（自己或队友）**累计伤害**的总占比，一人一瓣。
 *
 * 口径与上面那张表**是同一份数字**（每行的 `totalDmg`，按 `baseId` 归并后的累计），所以「100%」永远等于
 * 表里那些「累计伤害」之和 —— 不存在第二套口径。0 伤害的干员不进图（不画一个看不见的 0 度扇形），但仍在
 * 左边的列表里有自己的行。「干员」这一页右边**永远**是这块扇形图的落点（业主 2026-10-14：它就该长在那里）。
 * @param {{ units: Array<any> }} props 已经按累计伤害降序排好的干员行
 */
function DamagePie({ units }) {
  const rows = (Array.isArray(units) ? units : [])
    .map((r) => ({ key: r.base, label: r.name, value: Math.max(0, r.totalDmg || 0) }))
    .filter((r) => r.value > 0);
  return html`<${SlicePie} rows=${rows} ariaLabel="各干员累计伤害占比" emptyNote="尚无伤害记录"
    head=${html`<span class=${`${CLS}__chart-k`}>伤害占比 <i>DAMAGE SHARE</i></span>`} />`;
}

/**
 * 「全量测试统计」页（**只在 `pub.dev === true` 的全量模拟对局里挂出**）。三块：
 *   1. 盟约加成 · 总和与来源（`pub.players[].bonds` + `chess`/`bonds` 表）+ 下面那块**逐盟约的数值总结**
 *      （实测的 `bond:*` 增益优先，读不到就退回盟约自己的 `bb` 数据口径并标注）；
 *   2. 本回合预计伤害与每秒伤害（每个干员的**综合 DPS**（技能期按覆盖率加权）之和 × 回合战斗时长；
 *      能读到有效属性时用它 —— 含这一位吃到的增益 —— 否则退回纸面模型，面板上标出来）；
 *   3. 不同增益分别对总伤害的提升与占比（**按比例分摊**：实测属性差按各增益的声明幅度分摊，再对每条算留一法，
 *      `proratedSplitFor`）—— 类目 / 逐条的数字 + 一张**扇形图**（各来源占「提升合计」的份额）。
 * 数据全部现读，**没有一处写对局状态**。
 * @param {{ pid: string|null, row: any, units: any[] }} props
 */
function DevStats({ pid, row, units }) {
  const bonds = bondSourcesFor(row, units);
  const layers = bonds.reduce((s, b) => s + (b.layers || 0), 0);
  const live = liveOpsFor(pid);
  // 逐盟约的数值总结：实测的 `bond:*` 增益优先，读不到就退回盟约自己的 `bb`（数据口径，面板上标出来）。
  const bondLines = bondLinesOf(bonds, live);
  const split = proratedSplitFor(pid);
  const proj = projectedDpsFor(live, units);
  const round = roundBattleSeconds();
  const total = proj.dps != null && round.sec != null ? proj.dps * round.sec : null;
  const dealtRow = live ? live.players.find((p) => p && p.playerId === pid) || null : null;
  const dealt = dealtRow ? dealtRow.dmg : null;
  // 「盟约加成合计」= **预计 DPS 提升**（按比例分摊里 `bond` 那一类的合计），不是层数。
  const bondUplift = split.available ? (split.cats.find((c) => c.id === 'bond') || {}).dps ?? null : null;
  // B：合计量后面补一个**占比**（与各条 / 各类目同一分母 —— 预计每秒伤害）。拿不到预计 DPS 时只给绝对值。
  const bondUpliftText = bondUplift == null ? '—'
    : (Number.isFinite(proj.dps) && proj.dps > 0
      ? `+${rateText(bondUplift)}/s（占预计 DPS 的 ${pctText(bondUplift, proj.dps)}）`
      : `+${rateText(bondUplift)}/s`);
  const upliftSum = split.available ? split.cats.reduce((s, c) => s + c.dps, 0) : null;
  // 第三块那张扇形图：一瓣一个类目，份额 = 这一类 ÷ **提升合计**（正的那几条；负的提升进不了图，仍在数字栏里）。
  const shareRows = split.cats.map((c) => ({ key: c.id, label: c.label, value: Math.max(0, c.dps) })).filter((r) => r.value > 0);
  return html`<${Fragment}>
    <div class=${`${CLS}__devh`}>盟约加成 · 总和与来源</div>
    ${bonds.length ? html`<ul class=${`${CLS}__bonds`}>
      ${bonds.map((b) => html`<li class=${`${CLS}__bond`} key=${b.bondId}>
        <span class=${`${CLS}__bond-head`}>
          <b class=${`${CLS}__bond-name`}>${b.name}</b>
          <span class=${`${CLS}__bond-meta`}><span class="num">${b.layers}</span> 层 · <span class="num">${ROMAN[b.tier] || b.tier || '—'}</span> 阶</span>
        </span>
        ${b.sources.length ? html`<span class=${`${CLS}__bond-src`}>来源：${b.sources.join('、')}</span>` : null}
        ${b.desc ? html`<span class=${`${CLS}__bond-desc`} title=${b.desc}>${b.desc.split('\n')[0]}</span>` : null}
      </li>`)}
    </ul>` : html`<div class=${`${CLS}__empty`}>本局没有已激活的盟约</div>`}
    ${!bondLines.length ? null : html`<ul class=${`${CLS}__bondsum`}>
      <li class=${`${CLS}__bondsum-k`}>加成总结（实测优先，数据口径兜底）</li>
      ${bondLines.map((b) => html`<li class=${`${CLS}__bondline`} key=${b.bondId}>
        <b class=${`${CLS}__bondline-n`}>【${b.name}】</b>
        ${b.parts.length
          ? html`<span class=${`${CLS}__bondline-v`}>${b.parts.join('、')}</span>`
          : (b.dataParts.length || b.others.length
            ? html`<span class=${`${CLS}__bondline-data`}>
              <i class=${`${CLS}__bondline-tag`}>数据口径（未实测）</i>
              ${b.dataParts.join('、')}${b.others.length ? html`<span class=${`${CLS}__bondline-extra`}>${(b.dataParts.length ? '，' : '') + '其余：' + b.others.join('、')}</span>` : null}
            </span>`
            : html`<span class=${`${CLS}__bondline-none`}><span class="num">${b.layers}</span> 层 · 数值推不出（本场没见到它的属性类加成，数据里也没有可辨认的属性键）</span>`)}
      </li>`)}
    </ul>`}
    <ul class=${`${CLS}__list`}>
      <${StatRow} label="已激活盟约" value=${bonds.length} />
      <${StatRow} label="合计层数" value=${layers} />
      <${StatRow} label="盟约加成合计（预计 DPS 提升）" value=${bondUpliftText}
        tone=${bondUplift > 0 ? 'mint' : null} />
    </ul>

    <div class=${`${CLS}__devh`}>本回合预计伤害与每秒伤害</div>
    <ul class=${`${CLS}__list`}>
      <${StatRow} label="预计每秒伤害（合计）" value=${rateText(proj.dps)} />
      <${StatRow} label="本回合战斗时长" value=${round.sec == null ? '—' : `${Math.round(round.sec)} 秒`} />
      <${StatRow} label="预计本回合总伤害" value=${total == null ? '—' : numText(total)} />
      <${StatRow} label="本场已造成伤害" value=${dealt == null ? '—' : numText(dealt)} />
    </ul>
    <div class=${`${CLS}__devnote`}>${proj.src === 'effective'
      ? '综合口径：每个干员 = 常时 DPS × (1 − 技能覆盖率) + 技能期 DPS × 技能覆盖率；常时那一档用当前生效的攻击力 / 攻击间隔（含他自己吃到的增益）'
      : '理论值（纸面）：chess 表的基础攻击力 ÷ 基础攻击间隔，再按技能覆盖率与技能期加权 —— 不含增益、目标防御 / 抗性'}</div>

    <div class=${`${CLS}__devh`}>不同增益分别对总伤害的提升与占比</div>
    ${!split.available ? html`<div class=${`${CLS}__empty`}>${split.reason === 'none'
      ? '没有落在攻击力 / 攻击间隔上的增益（无可分摊的幅度）'
      : '本机不在屏上这一场（无实时增益数据）'}</div>`
    : html`<${Fragment}>
      <${SlicePie} rows=${shareRows} ariaLabel="各来源对总伤害的提升占比"
        emptyNote="没有正提升可画（见下面的数值）"
        head=${html`<span class=${`${CLS}__chart-k`}>提升占比 <i>UPLIFT SHARE</i></span>`}
        note=${html`<div class=${`${CLS}__devnote`}>口径：一瓣 ÷ <b>提升合计</b>；右栏与下面的数值栏是「提升 ÷ 预计每秒伤害」</div>`} />
      <ul class=${`${CLS}__list`}>
        ${split.cats.map((c) => html`<${StatRow} key=${c.id} label=${c.label}
          value=${`+${rateText(c.dps)} · ${pctText(c.dps, proj.dps)}`} tone=${c.dps > 0 ? 'mint' : 'red'} />`)}
        <${StatRow} label="提升合计" value=${upliftSum == null ? '—' : `+${rateText(upliftSum)}`} tone=${upliftSum < 0 ? 'red' : null} />
        <${StatRow} label="实测合计（本场已造成伤害）" value=${dealt == null ? '—' : numText(dealt)} />
      </ul>
      ${split.list.length ? html`<ul class=${`${CLS}__buffs`}>
        ${split.list.map((b) => html`<li class=${`${CLS}__buffrow`} key=${b.key} title=${b.key}>
          <span class=${`${CLS}__buffk`}>${b.key}</span>
          <b class=${`${CLS}__buffv num`}>+${rateText(b.dps)} · ${pctText(b.dps, proj.dps)}</b>
        </li>`)}
      </ul>` : html`<div class=${`${CLS}__devnote`}>没有落在攻击力 / 攻击间隔上的增益</div>`}
      <div class=${`${CLS}__devnote`}>口径：按实测差值（当前生效属性 − 裸基础属性）与各增益的声明幅度**按比例分摊**；加算百分比那一档精确，乘算键（攻击力× / 攻击间隔）为近似 —— 其余增伤不在其中</div>
    </${Fragment}>`}
  </${Fragment}>`;
}

/**
 * 一个玩家行的面板。`pid` 是 **这一行此刻的 playerId**（挂载侧每次同步行时现读，见 `rowPlayerId`）。
 * @param {{ pid: string|null }} props
 */
function Panel({ pid }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('units');

  // 收起 / 展开会改变面板高度与锚点（收起态垂直居中于该行、展开态与该行顶对齐），所以每次重画后重新贴一次。
  // 这里必须用 useLayoutEffect 而不是 useEffect：前者在 DOM 改完、浏览器绘制之前**同步**触发（后者的回调被
  // 推迟到这一帧画完之后才跑）。切换展开态时 `.db` 由 `<div>` 换成 `<section>`、锚点也从「行中心」跳到「行顶」，
  // 若等这一帧画完再重新贴坐标，用户就会先看到以旧锚点（收起态那根居中坐标 + translateY(-50%)）画出的面板、
  // 再看到它跳到正确位置 —— 那就是「点开时闪一下」。改用布局副作用后，重贴坐标的 rAF 一定赶在下一帧绘制前执行，
  // 展开的那一帧永远不会以旧锚点被画出来。
  useLayoutEffect(() => { requestLayout(); });

  const { pub, priv, myId } = feed;
  const players = Array.isArray(pub && pub.players) ? pub.players : [];
  const row = players.find((p) => p && p.playerId === pid) || null;
  const me = !!pid && pid === myId;
  const phase = (pub && pub.phase) || null;

  // 自己和别人的干员行来自两处：自己的现算，别人的取广播
  const peer = me ? null : peers.get(pid) || null;
  const fresh = !!(peer && Date.now() - peer.at < PEER_STALE_MS);
  let units = [];
  let extra = null;
  if (me) {
    const st = trackers.get(myId) || tworact();
    const dmg = ledger.get(myId) || null;
    // 本场（屏上那一场）的实时速率：伤害与治疗两份，与 `dmg`（跨场台账）分开读，每次渲染现读一份。
    // 有效属性（含这位自己吃到的增益）也从这一份读数里取，给「综合 DPS」那一格用。
    const rates = ratesFor(myId);
    units = myRows(st, priv, dmg, rates);
    const stats = priv && priv.stats && typeof priv.stats === 'object' ? priv.stats : null;
    extra = priv ? {
      funds: priv.funds, kills: stats && stats.kills, merges: stats && stats.merges,
      leaks: stats && stats.leaks, itemMerges: stats && stats.itemMerges,
      deploy: [priv.deployCount, priv.deployCap],
    } : null;
  } else if (fresh) {
    units = peer.units;
    extra = {
      funds: peer.funds, kills: peer.kills, merges: peer.merges,
      leaks: peer.leaks, itemMerges: peer.itemMerges, deploy: peer.deploy,
    };
  }

  // **保留一回合**（业主 2026-10-15）：这一刻不在场上、但上一回合还在场上的那几位照旧画出来（`retained` 标着），
  // 一整个回合都不在场之后由 `retainedRowsFor` 把快照删掉，于是不会无限攒、也不会在更晚的回合里复活。
  if (pid) {
    const present = new Set(units.map((r) => r.base));
    const kept = retainedRowsFor(pid, present);
    if (kept.length) units = units.concat(kept);
  }

  // 干员页固定按**累计伤害从高到低**排：并列时保持原顺序（`mergeBoard` 已按阶级 / 名字排好，JS 排序是稳定的）。
  units = units.slice().sort((a, b) => (b.totalDmg || 0) - (a.totalDmg || 0));

  // 协防：联防阶段里这一位是迎战的还是漏怪的
  const unite = pub && pub.phase === 'UNITE' && pub.unite && typeof pub.unite === 'object' ? pub.unite : null;
  const inUnite = !!unite;
  const role = !inUnite ? '—'
    : (Array.isArray(unite.leakers) && unite.leakers.includes(pid) ? '漏敌方（待协防）'
      : (Array.isArray(unite.helpers) && unite.helpers.includes(pid) ? '协防方（迎战）' : '—'));

  if (!open) {
    return html`<div class=${cx(CLS, 'is-collapsed')}>
      <button type="button" class=${`${CLS}__tab`} aria-expanded="false" title="展开数据统计"
        onClick=${() => setOpen(true)}>
        <span class=${`${CLS}__tab-label`}>数据统计</span>
        <svg class=${`${CLS}__chev`} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
          <path d="M9 6l6 6-6 6z" fill="currentColor" />
        </svg>
      </button>
    </div>`;
  }

  const deployText = extra && Array.isArray(extra.deploy) && Number.isFinite(extra.deploy[0])
    ? `${numText(extra.deploy[0])} / ${numText(extra.deploy[1])}` : '—';
  // 全量测试统计只在「全量模拟」对局出现：`pub` 带 `dev === true` 时才多这一页。换模式 / 换局后旧的 tab 值不再
  // 有效（例如上一局停在 dev 页），这里回落到「干员」，所以别模式的面板连一个多余的键都不会画出来。
  const isDev = !!(pub && pub.dev === true);
  const tabs = isDev ? [...TABS, DEV_TAB] : TABS;
  const activeTab = tabs.some((t) => t.id === tab) ? tab : 'units';
  // 「干员」这一页右边多一列扇形图（业主 2026-10-14），所以只有它加宽（`is-units`，见 board.css）。
  const isUnits = activeTab === 'units';
  // 「全量测试统计」页行更宽（盟约来源 / 增益清单），所以它也加宽（`is-dev`，见 board.css）。
  const isDevTab = activeTab === 'dev';

  return html`<section class=${cx(CLS, 'is-open', isUnits && 'is-units', isDevTab && 'is-dev')} aria-label="数据统计">
    <header class=${`${CLS}__head`}>
      <span class=${`${CLS}__title`}>数据统计</span>
      ${row ? html`<span class=${`${CLS}__who`}>${row.name || '博士'}</span>` : null}
      <button type="button" class=${`${CLS}__close`} aria-expanded="true" title="收起数据统计"
        aria-label="收起数据统计" onClick=${() => setOpen(false)}>
        <svg class=${`${CLS}__chev`} viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
          <path d="M15 6l-6 6 6 6z" fill="currentColor" />
        </svg>
      </button>
    </header>

    <div class=${`${CLS}__tabs`} role="tablist" aria-label="数据分类">
      ${tabs.map((t) => html`<button key=${t.id} type="button" role="tab"
        class=${cx(`${CLS}__tabbtn`, activeTab === t.id && 'is-on')}
        aria-selected=${activeTab === t.id ? 'true' : 'false'} onClick=${() => setTab(t.id)}>
        <b class=${`${CLS}__tabbtn-label`}>${t.label}</b>
        <span class=${`${CLS}__tabbtn-micro`}>${t.micro}</span>
      </button>`)}
    </div>

    <div class=${cx(`${CLS}__body`, isUnits && `${CLS}__body--units`)} role="tabpanel">
      ${isUnits ? html`<${Fragment}>
        <ul class=${`${CLS}__list`}>
          ${units.length ? units.map((r) => html`<${UnitRow} key=${r.base} pid=${pid} row=${r} />`)
            : html`<li class=${`${CLS}__empty`}>${me
              ? (priv ? '当前没有在场上阵的干员' : '观战席不显示本人数据')
              : (fresh ? '对方当前没有在场上阵的干员' : '尚未收到对方数据（对方可能未安装本包）')}</li>`}
        </ul>
        <${DamagePie} units=${units} />
      </${Fragment}>` : null}

      ${activeTab === 'unite' ? html`<ul class=${`${CLS}__list`}>
        <${StatRow} label="阶段" value=${PHASE_TEXT[phase] || phase || '—'} />
        <${StatRow} label="联防中" value=${inUnite ? '是' : '否'} tone=${inUnite ? 'mint' : null} />
        <${StatRow} label="我方身份" value=${role} />
        <${StatRow} label="我方剩余敌人" value=${row && Number.isFinite(row.uniteLeft) ? String(row.uniteLeft) : '—'} />
        <${StatRow} label="本回合扣除" value=${row && Number.isFinite(row.pendingLp) ? `−${row.pendingLp} 点` : '—'}
          tone=${row && row.pendingLp > 0 ? 'red' : null} />
        <${StatRow} label="目标生命" value=${numText(row && row.lp)} />
        <${StatRow} label="漏敌数" value=${has(extra, 'leaks') ? String(extra.leaks) : '—'}
          tone=${has(extra, 'leaks') && extra.leaks > 0 ? 'red' : null} />
        <${StatRow} label="协防成功接敌" value=${pid ? numText(helped.get(pid) || 0) : '—'}
          tone=${(pid && (helped.get(pid) || 0) > 0) ? 'mint' : null} />
      </ul>` : null}

      ${activeTab === 'misc' ? html`<ul class=${`${CLS}__list`}>
        <${StatRow} label="回合" value=${numText(pub && pub.round)} />
        <${StatRow} label="阶段" value=${PHASE_TEXT[phase] || phase || '—'} />
        <${StatRow} label="目标生命" value=${numText(row && row.lp)} />
        <${StatRow} label="部署" value=${deployText} />
        ${has(extra, 'funds') ? html`<${StatRow} label="资金" value=${numText(extra.funds)} />` : null}
        ${has(extra, 'kills') ? html`<${StatRow} label="击杀" value=${numText(extra.kills)} />` : null}
        ${has(extra, 'merges') ? html`<${StatRow} label="干员精锐化次数" value=${numText(extra.merges)} />` : null}
        ${has(extra, 'itemMerges') ? html`<${StatRow} label="装备进阶次数" value=${numText(extra.itemMerges)} />` : null}
      </ul>` : null}

      ${activeTab === 'dev' && isDev ? html`<${DevStats} pid=${pid} row=${row} units=${units} />` : null}
    </div>
  </section>`;
}

// ---- 挂载：官方槽 + 自行找行 / 定位（替代引擎的 `screen.game.teamRow` 可重复宿主） -----------------------------------

/** 行内 `.team__seat` 的座位号（文本 `P1`…`P4`）→ 0 基座位；读不到就是 null。 */
function rowSeat(row) {
  const el = row && typeof row.querySelector === 'function' ? row.querySelector(SEAT_SEL) : null;
  const m = el && typeof el.textContent === 'string' ? /^P(\d+)\s*$/.exec(el.textContent.trim()) : null;
  return m ? Number(m[1]) - 1 : null;
}

/**
 * 座位号 → playerId：`pub.players[].seat`，与引擎渲染那一行用的是**同一份对局数据**（`p.seat` 也正对应于行内
 * `P{n}` 的 n−1）。这样面板不必依赖任何引擎为它新造的宿主属性。
 */
function playerIdBySeat() {
  const players = Array.isArray(feed.pub && feed.pub.players) ? feed.pub.players : [];
  const by = new Map();
  for (const p of players) if (p && Number.isInteger(p.seat) && typeof p.playerId === 'string') by.set(p.seat, p.playerId);
  return by;
}

/**
 * 挂载（每个对局屏一次；宿主是官方槽 `screen.game.overlay` 里的一块 `.mod-host`）。
 *
 * 面板自己找对局左侧同盟成员表里的每一个 `.team__row`，为每行渲染 / 定位一块。行增删、换局、第二局都经过
 * `refresh()`：它让内部的 `slots` 与当前 DOM 里的行一致 —— 这就是替代引擎「可重复宿主脱离文档后自动重挂」修复的那一半。
 * @param {{ host: any, hostKey: string|null, data: any, net: any, me: any, log: any }} ctx
 * @returns {{ unmount?: () => void }}
 */
export function mount(ctx) {
  const host = ctx && ctx.host;
  if (!host || typeof host.appendChild !== 'function') return {};
  // 只读数据表：第一次挂载时记下（同一页里所有面板共用一份）。`bonds` / `config` 只在「全量测试统计」页用
  // （盟约描述 / 回合战斗时长），同样在这里声明并读一份只读快照；数据层可能晚一步到，所以 `dataTable()` 还会再试。
  if (!env.chess) env.chess = ctx.data.get('chess');
  if (!env.assets) env.assets = ctx.data.get('assets');
  if (!env.data) env.data = ctx.data;
  if (!env.bonds) env.bonds = ctx.data.get('bonds');
  if (!env.config) env.config = ctx.data.get('config');
  // 广播口：**两个参数**（通道 + 载荷）—— `net.send(channel, data)` 就是这个签名。这里曾经写成一个参数
  // （`(data) => net.send(CHANNEL, data)`），而调用点是 `env.send(CHANNEL, payload)`（`advance()`）：于是
  // 真正上线的是**通道名那个字符串**（`data: 'roster'`），载荷被整份丢掉。接收端拿到一个字符串 ⇒ `readPeer`
  // 判它不是对象 ⇒ 直接返回 ⇒ 队友那一块**永远是「尚未收到对方数据」**。单机看不出：自己那一行是本机现算的。
  if (!env.send) env.send = (channel, data) => { ctx.net.send(channel, data); };
  if (!env.log) env.log = ctx.log || null;

  const root = document.createElement('div');
  root.className = `${CLS}-root`;
  host.appendChild(root);

  /** playerId -> { row: Element, box: HTMLElement }（box 贴在对应行右边，Preact 往里面画）。 */
  const slots = new Map();

  const paintOne = (pid, box) => render(html`<${Panel} pid=${pid} />`, box);

  /** 把一个 box 贴到它该在的位置：收起态垂直居中于该行，展开态与该行顶对齐（与头像同高那条横线）。 */
  const positionBox = (box, row) => {
    if (!box || !row || typeof row.getBoundingClientRect !== 'function') return;
    const r = row.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) { box.style.display = 'none'; return; }
    box.style.display = '';
    const db = box.firstElementChild;
    const collapsed = !db || db.classList.contains('is-collapsed');
    box.style.left = `${Math.round(r.right)}px`;
    if (collapsed) {
      box.style.top = `${Math.round(r.top + r.height / 2)}px`;
      box.style.transform = 'translateY(-50%)';
    } else {
      box.style.top = `${Math.round(r.top)}px`;
      box.style.transform = 'none';
    }
  };

  const positionAll = () => { for (const slot of slots.values()) positionBox(slot.box, slot.row); };

  let posRaf = null;
  const schedulePosition = () => {
    if (posRaf != null) return;
    posRaf = requestAnimationFrame(() => { posRaf = null; positionAll(); });
  };
  const requestLayoutNow = () => schedulePosition();

  const paintAll = () => { for (const [pid, slot] of slots) paintOne(pid, slot.box); };

  /**
   * 让 `slots` 与当前 DOM 里的玩家行一致：新行补一块、消失的行收掉、身份变了的（行元素被复用）重画。
   */
  const syncRows = () => {
    const rows = [...document.querySelectorAll(ROW_SEL)];
    /** @type {Map<string, Element>} */
    const seen = new Map();
    const bySeat = playerIdBySeat();
    for (const r of rows) {
      const seat = rowSeat(r);
      const pid = seat == null ? null : bySeat.get(seat);
      if (pid && !seen.has(pid)) seen.set(pid, r);
    }
    // 收掉：整行消失，或同一个 playerId 换了另一个行元素
    for (const [pid, slot] of [...slots]) {
      const row = seen.get(pid);
      if (!row) {
        if (slot.box.firstElementChild) render(null, slot.box);
        slot.box.remove();
        slots.delete(pid);
      } else if (slot.row !== row) {
        slot.row = row;
        paintOne(pid, slot.box);
      }
    }
    // 新行：补一块并画
    for (const [pid, row] of seen) {
      if (slots.has(pid)) continue;
      const box = document.createElement('div');
      box.className = `${CLS}-slot`;
      box.setAttribute('data-db-player', pid);
      root.appendChild(box);
      slots.set(pid, { row, box });
      paintOne(pid, box);
    }
  };

  // ResizeObserver：行高变化（「前往查看」展开 / 语气泡 / 状态行）时重新贴。
  const sizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedulePosition()) : null;
  const observed = new Set();
  const observeRows = () => {
    if (!sizes) return;
    for (const r of document.querySelectorAll(ROW_SEL)) if (!observed.has(r)) { observed.add(r); sizes.observe(r); }
    for (const r of [...observed]) if (r.isConnected === false) { observed.delete(r); sizes.unobserve(r); }
  };

  /** DOM 变了（行增删 / 换局 / 对局屏挂上或拆掉）：重新对表、重新贴。 */
  const refresh = () => { syncRows(); observeRows(); schedulePosition(); };
  // 对局里 HUD 每帧都在动，`subtree` 观察会密集触发 —— 每个动画帧至多跑一次 `refresh`。
  let refreshRaf = null;
  const scheduleRefresh = () => {
    if (refreshRaf != null) return;
    refreshRaf = requestAnimationFrame(() => { refreshRaf = null; refresh(); });
  };

  // 数据变化 → 重画（每个面板各自读 `feed` / `ledger` / `peers`）；顺带重对一次行 —— `pub.players` 可能比 DOM 晚到。
  const onFeed = () => { paintAll(); scheduleRefresh(); };
  subs.add(onFeed);

  // 别人的棋阵：包自己的通道（引擎把 `pack.msg` 发给整个房间，这里按包 + 通道筛自己那一份）
  const offRoster = ctx.net.on(CHANNEL, (data, msg) => {
    const from = msg && typeof msg.from === 'string' ? msg.from : null;
    if (!from || (feed.myId && from === feed.myId)) return;
    const parsed = readPeer(data);
    if (!parsed) return;
    peers.set(from, parsed);
    // 「保留一回合」：对面这一刻在场上那几位记进快照（他们下场之后由本机替他们把那几行多留一个回合），
    // 对面报来的实测速率（非 null 的那几个）另记一份 —— 他们那场打完、下一帧报 null 时，这两格才留得住。
    noteSeen(from, parsed.units);
    const pdps = new Map();
    const phps = new Map();
    for (const u of parsed.units) {
      if (u.dps != null) pdps.set(u.base, u.dps);
      if (u.hps != null) phps.set(u.base, u.hps);
    }
    noteRates(from, { dps: pdps.size ? pdps : null, hps: phps.size ? phps : null });
    notify();
  });

  // 同盟解散 / 一局结束（`room.closed`）：这一局的存档到此为止 —— 与 `RESULT` 同一条口径，只是那一条走不到时
  // 这一条兜住（离开房间、掉线被清、房主解散都算「这局结束了」）。
  const offClosed = ctx.net.on('room.closed', () => { dropAll(); });

  // 本机自己那一场的逐单位伤害：引擎战斗运行器的官方结果事件（与服务端校验同一份数字）。
  const offResult = battleRunner && typeof battleRunner.on === 'function'
    ? battleRunner.on('result', ({ battleId, result }) => {
      if (!recordResult(result, battleId)) return;
      // 一场战斗刚结束：这一次不节流，立刻落盘 —— 刷新恰好落在「结算完但还没写盘」那个窗口里也不会丢。
      saveLS(true);
      notify();
    })
    : null;

  // 行增删 / 换局：观察整个文档（行在 `.team` 里，`.team` 随对局屏出现、消失）
  const watcher = typeof MutationObserver === 'function' ? new MutationObserver(() => scheduleRefresh()) : null;
  if (watcher && document.body) watcher.observe(document.body, { childList: true, subtree: true });
  const onWin = () => schedulePosition();
  window.addEventListener('resize', onWin);

  requestLayout = requestLayoutNow;
  // 早一点试一次恢复：顶栏（`Feed`）通常先于本槽渲染完，所以挂载这一刻 `feed` 里可能已经有 `myId` 了 ——
  // 那样第一帧就是带数字的，不会先空一下。`myId` 还没到就交给 `notify()` 那条路，下一次它再来。
  restore();
  refresh();

  // DPS 是**实时**读数：战斗在演的时候每 `DPS_TICK_MS` 看一次引擎那一格，数字真的变了才通知重画 ——
  // 休整期 / 结算 / 没有战斗时这个定时器一拍都不重画（`sig` 一直是 null，与上一拍相同就直接返回）。
  let lastDpsSig = null;
  const dpsTick = setInterval(() => {
    const d = battleRunner && typeof battleRunner.damage === 'function' ? battleRunner.damage() : null;
    const sig = d
      ? `${d.battleId}|${Math.round(Number(d.gt) * 10)}|${(Array.isArray(d.players) ? d.players : []).map((p) => `${p.playerId}:${p.dmg}`).join(',')}`
      : null;
    if (sig === lastDpsSig) return;
    lastDpsSig = sig;
    notify();
  }, DPS_TICK_MS);

  return {
    unmount() {
      saveLS(true); // 收摊前把最后一次变化落盘：否则「改完不到 1.5 秒就刷新」会丢掉那一次
      clearInterval(dpsTick);
      subs.delete(onFeed);
      watcher?.disconnect?.();
      sizes?.disconnect?.();
      observed.clear();
      window.removeEventListener('resize', onWin);
      try { offRoster?.(); } catch { /* 退订失败无所谓 */ }
      try { offClosed?.(); } catch { /* 同上 */ }
      try { offResult?.(); } catch { /* 同上 */ }
      if (posRaf != null) { cancelAnimationFrame(posRaf); posRaf = null; }
      if (refreshRaf != null) { cancelAnimationFrame(refreshRaf); refreshRaf = null; }
      for (const slot of slots.values()) render(null, slot.box);
      slots.clear();
      if (root.parentNode) root.parentNode.removeChild(root);
      requestLayout = () => {};
    },
  };
}