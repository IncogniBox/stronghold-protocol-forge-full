// shared/reconModes.js — 重构模拟（模式扩展-重构模拟，room mode 'recon' ⇒ mode_recon_<diff>）的模式表合成。
//
// **为什么不落盘**：`data/config.json` 是 generated（tools/build-data.mjs），且被 test/data.test.js 逐字节钉住；
// 而重构模拟是**本地实验模式**（大厅入口 devAllowed 门控，不同步线上）。所以它的条目由这里在**运行时**合成 —
// 服务器 `server/data.js getMode` 缺项时调一次、客户端加载 config 后调一次，两端同一份口径，官方 data 一个字节不动。
//
// 形状（骨架轮）：把 mode_multi_<diff> 拉长到 20 回合；第 20 回合照 mode_multi 的 bossRound 那个回合抄
// （bossTemplates 同一张表 ⇒ Match 的首领抽取照旧在 bossWeights 里按权重抽，骨架轮不另配首领）；隐秘核心挪到
// 第 21 回合（波次照 mode_multi 的 hidden round 抄）；11–19 回合沿用第 (lastRound−1) 回合的模板与数值表占位。
// 4/8/12/16 回合首领化、「重构协议·特训」、盟约/敌人数值调整都是机制轮的事 —— 引擎只认键（gamedata.js 的
// mode 表读取逐键回退），所以这里的占位表不改变任何缺省对局。

/** 重构模拟的整局形状（一个数只许一个真相）。 */
export const RECON_LAST_ROUND = 20;
export const RECON_HIDDEN_ROUND = 21;
/** 预重构里「4/8/12/16 首领选择」与「重构协议·特训」的回合（机制轮消费；骨架轮只是常量在案）。 */
/** 预重构选中「试炼首领」的回合（**只有普通回合**：R20 / R21 属于原版首领，进入关卡时已定，不进选择面板）。 */
export const RECON_TRIAL_ROUNDS = Object.freeze([4, 8, 12, 16]);
export const RECON_TRAINING_ROUNDS = Object.freeze([4, 8, 12, 16, 20]);
/**
 * 特训学员从教官那里继承的**三围比例**（业主 2026-10-27）：攻 / 防 / 生命上限 = **学员自己的 + 教官的 ×0.5**，
 * 固定不叠加。其余一切（部署费用 / 阻挡数 / 攻击间隔 / 再部署时间 / 攻击范围 / 技能时长 / 弹药数 / 技能触发规则）
 * 全是学员自己的。**链式**（业主 2026-10-29）：教官自己也是学员时，它的三围先按同一条比例组成
 * （B + C×0.5），学员再 ×0.5 叠加 ⇒ A + B×0.5 + C×0.25 —— 每一层都用这一个常量，只是逐层递减；
 * 只有三围沿链，盟约 / 特质 / 天赋 / 技能仍取直接教官自己的。战斗侧只此一处读（server/sim/simdata.js getTrainee /
 * _chainStats 的缺省也是它，但显式传）。
 */
export const RECON_TRAINEE_STAT_RATIO = 0.5;
/**
 * 本模式**专属**的附加盟约（特训的学员身上那一条，记录由工坊包 mode-recon 提供）。
 * 它不是玩家能「倾向」的东西 —— 预重构的候选池按 id 把它排除（screens/preRecon.js），所以这个 id 在这里只许写一处。
 */
export const RECON_BOND_ID = 'bond_recon';

/**
 * 预重构里「重构协助 / 熔芯负载」的候选 id（各单选 1 项，共六个；拼写与客户端屏上的 ASSIST_OPTS / LOAD_OPTS、
 * 工坊包 mode-recon 的 meta / battle 分支共用同一份 —— test/match/recon-copy.test.js 钉着）。
 * 放在 shared 是为了**服务端**：没人选的座位要在进入总览时**随机补 1 个**（Match.fillReconChoices，业主 2026-10-29），
 * 引擎不该把六个 id 再抄一遍。
 */
export const RECON_ASSIST_IDS = Object.freeze(['recon_assist_bond', 'recon_assist_equip', 'recon_assist_data']);
export const RECON_LOAD_IDS = Object.freeze(['recon_load_bond', 'recon_load_equip', 'recon_load_data']);

/**
 * 「试炼首领」的候选表：`{ 回合号 → 候选 choice[] }`，每条 choice = `{ id, keys: ['<包里的 enemy key>', …] }`。
 * **只在有候选的回合**出现这个键 —— 其余回合仍是「默认随机」，
 * 但那一份随机**不在本表**里：引擎自己从它那口种子流抽（server/match/match/reconTrials.js），所以这里绝不替它编候选。
 *
 * 为什么是 **choice（含 id + keys）** 而不是裸 key[]：业主给的第 8 回合第 3 项**一次选择刷两只首领**
 * （梅菲斯特·重构 + 浮士德·重构，业主明确确认「它们算一次选择」）。客户端提交的是 **choice 的 `id`**，
 * `reconTrials.js` 把 id 解析回 `keys` 再**每个 key 各出一条**追加出怪。单选（keys 长度 1）的 id **等于它的 key**
 * —— 第 4 回合的五个 id 与从前逐字相同，所以那一轮已验证的流程与已提交的值一个字节都不变。
 *
 * 键是**工坊包**的（`workshop/mode-recon/enemies.json` 的「·重构」首领，与 RECON_BOND_ID 同一个先例：
 * 引擎只认键、包提供记录）。没装那个包的安装里，这些 key 查无此敌 ⇒ 引擎解析出的键会在
 * `_sanitizeSpawns` 处被丢掉，一个字节都不多出（与「包提供的盟约缺席」同一条纪律）。
 *
 * 这张表**取代**了引擎侧「首领表第二轮才进工坊包」的那个占位：预重构的 R04 / R08 / R12 / R16 / R20 / R21 格按它变成真选择器，
 * 第 4 / 8 / 12 / 16 回合按它出怪（reconTrials.js / phases.startRound）；**第 20 回合**（首领回合）与 **第 21 回合**（隐秘核心）
 * 用它替换随机抽到的那只首领，见 `reconBossWaveFor`（多 key 的选择会一并追加部位出怪）。
 * @type {Readonly<Record<number, readonly { id: string, keys: readonly string[] }[]>>}
 */
export const RECON_TRIAL_BOSSES = Object.freeze({
  4: Object.freeze([
    Object.freeze({ id: 'enemy_ws_recon_skulsr', keys: Object.freeze(['enemy_ws_recon_skulsr']) }), // 碎骨·重构
    Object.freeze({ id: 'enemy_ws_recon_lslime', keys: Object.freeze(['enemy_ws_recon_lslime']) }), // “庞贝”·重构
    Object.freeze({ id: 'enemy_ws_recon_cqbw', keys: Object.freeze(['enemy_ws_recon_cqbw']) }),     // W·重构
    Object.freeze({ id: 'enemy_ws_recon_mdrock', keys: Object.freeze(['enemy_ws_recon_mdrock']) }), // 泥岩·重构
    Object.freeze({ id: 'enemy_ws_recon_mousek', keys: Object.freeze(['enemy_ws_recon_mousek']) }), // 鼠王·重构（业主 2026-10-27 替换萨卡兹百夫长）
  ]),
  8: Object.freeze([
    // 第 1 项：**一次选择两只**（腐败骑士·重构 + 凋零骑士·重构）
    Object.freeze({ id: 'enemy_ws_recon_dekght_pair', keys: Object.freeze(['enemy_ws_recon_dekght', 'enemy_ws_recon_dekght_2']) }),
    Object.freeze({ id: 'enemy_ws_recon_xi', keys: Object.freeze(['enemy_ws_recon_xi']) }),           // 自在·重构
    // 第 3 项：**一次选择两只**（梅菲斯特·重构 + 浮士德·重构）
    Object.freeze({ id: 'enemy_ws_recon_mephi_faust', keys: Object.freeze(['enemy_ws_recon_mephi', 'enemy_ws_recon_faust']) }),
    Object.freeze({ id: 'enemy_ws_recon_jakill', keys: Object.freeze(['enemy_ws_recon_jakill']) }),   // 杰斯顿·威廉姆斯·重构
    Object.freeze({ id: 'enemy_ws_recon_frstar2', keys: Object.freeze(['enemy_ws_recon_frstar2']) }), // 霜星，“冬痕”·重构
  ]),
  12: Object.freeze([
    Object.freeze({ id: 'enemy_ws_recon_talula', keys: Object.freeze(['enemy_ws_recon_talula']) }),   // 塔露拉·重构
    Object.freeze({ id: 'enemy_ws_recon_blkswb', keys: Object.freeze(['enemy_ws_recon_blkswb']) }),   // 锏·重构
    Object.freeze({ id: 'enemy_ws_recon_patrt', keys: Object.freeze(['enemy_ws_recon_patrt']) }),     // 爱国者·重构
    Object.freeze({ id: 'enemy_ws_recon_reid', keys: Object.freeze(['enemy_ws_recon_reid']) }),       // “复仇者”·重构
    Object.freeze({ id: 'enemy_ws_recon_mirbst', keys: Object.freeze(['enemy_ws_recon_mirbst']) }),   // 狂躁异质裂兽·重构
  ]),
  16: Object.freeze([
    Object.freeze({ id: 'enemy_ws_recon_mandra', keys: Object.freeze(['enemy_ws_recon_mandra']) }),     // 蔓德拉·重构
    Object.freeze({ id: 'enemy_ws_recon_bldkgt', keys: Object.freeze(['enemy_ws_recon_bldkgt']) }),   // 血骑士狄开俄波利斯·重构
    Object.freeze({ id: 'enemy_ws_recon_morphis', keys: Object.freeze(['enemy_ws_recon_morphis']) }), // 莫菲丝·重构
    Object.freeze({ id: 'enemy_ws_recon_dirctr', keys: Object.freeze(['enemy_ws_recon_dirctr']) }),   // “酒神”·重构
    Object.freeze({ id: 'enemy_ws_recon_dywqgs', keys: Object.freeze(['enemy_ws_recon_dywqgs']) }),   // “望”·重构
  ]),
  20: Object.freeze([
    Object.freeze({ id: 'enemy_ws_recon_bsnake', keys: Object.freeze(['enemy_ws_recon_bsnake']) }), // “不死的黑蛇”·重构
    Object.freeze({ id: 'enemy_ws_recon_skzjkl', keys: Object.freeze(['enemy_ws_recon_skzjkl']) }), // 奎隆，摩诃萨埵权化·重构
    Object.freeze({ id: 'enemy_ws_recon_syskad', keys: Object.freeze(['enemy_ws_recon_syskad']) }), // 伊莎玛拉，腐化之心·重构
    Object.freeze({ id: 'enemy_ws_recon_shchmr', keys: Object.freeze(['enemy_ws_recon_shchmr']) }), // 玻利瓦尔，症结之核·重构
    Object.freeze({ id: 'enemy_ws_recon_dycyue', keys: Object.freeze(['enemy_ws_recon_dycyue']) }), // 朔壳·重构
  ]),
  // 第 21 回合（隐秘核心）：业主 2026-10-28 的五组候选，第 3 / 4 / 5 组一次登场多个（与第 8 回合的「一对」同一形状）。
  // 业主 2026-10-29 按房间人数分档：≤5 人只有伤心的大锁 / 阿米娅；6–7 人加洛伦茨组与“终始”那组（AMa-10 三只）；
  // ≥8 人才加岁四部位（四块场地齐了才摆得下）。
  21: Object.freeze([
    Object.freeze({ id: 'enemy_ws_recon_csdoll', keys: Object.freeze(['enemy_ws_recon_csdoll']) }), // 伤心的大锁·重构
    Object.freeze({ id: 'enemy_ws_recon_skzamy', keys: Object.freeze(['enemy_ws_recon_skzamy']) }), // “阿米娅”，炉芯终曲·重构
    Object.freeze({
      id: 'enemy_ws_recon_ama_group',
      minPlayers: 6, // 「终始」那组（AMa-10 / 异构体 / 终始）：6 人（3 块场地）起才抽得到
      keys: Object.freeze(['enemy_ws_recon_muama', 'enemy_ws_recon_mutwin', 'enemy_ws_recon_musnake']),
    }), // AMa-10 / AMa-10异构体 / “终始”·重构 三只
    Object.freeze({
      id: 'enemy_ws_recon_sui_group',
      minPlayers: 8, // 岁四部位要四块场地（8 人 = 4 组）才加进来
      keys: Object.freeze(['enemy_ws_recon_suisho', 'enemy_ws_recon_suizzh', 'enemy_ws_recon_suiyzh', 'enemy_ws_recon_suiwei']),
    }), // 岁 / 左爪 / 右爪 / 尾·重构 四部位
    Object.freeze({
      id: 'enemy_ws_recon_shp_group',
      // 业主 2026-10-29：≤5 人不抽洛伦茨（6 人起）；洛伦茨只出现在 boss 区域2/3/4，共享血量 = 3000000 × 只数。
      minPlayers: 6,
      keys: Object.freeze(['enemy_ws_recon_shophm', 'enemy_ws_recon_shorbb']),
    }), // 洛伦茨，扰动之谬 / 源阶方·重构 一对
  ]),
});

/**
 * 重构模拟**只保留终极难度**（业主 2026-10-27：其它难度整体移除）。`abyss` = config 里的「终极模拟」。
 * 仍然保留 `difficulty` 参数位（合成函数与读取侧都要判它），但只认这一个值。
 */
export const RECON_DIFFICULTY = 'abyss';
const DIFFS = [RECON_DIFFICULTY];

/**
 * 重构模拟自己的**难度曲线**（业主 2026-10-27 给定，逐字照抄；只服务本模式，官方 4 档一个字节都不动）。
 * 例外：涤墨 6 个固定回合（R2/5/7/10/13/17）的 `count` 按业主 2026-10-29 的**固定出怪表**改写 —— 那 6 张模板
 * 直接写涤墨键与数量，所以模板的 `totalCount` 就是这 6 个回合的计划数。其余 13 回合仍是 10-27 的曲线。
 *
 * 每行：`{ count, hp, atk, time, prep, sp }`
 *   * `count` —— 本回合**计划出场数**（由下发给模板的波次决定；模板到齐前引擎只校验、不使用它）；
 *   * `hp` / `atk` —— 敌方数值倍率（`enemyScale.hp` / `.atk`，`speed` 恒 1）；
 *   * `time` —— 战斗时限（**真实秒**，首领 / 隐秘回合是关卡倒计时）；
 *   * `prep` —— 休整时长（真实秒，填进 `prepTime` / `prepTimeData`）；
 *   * `sp` —— 是否有 SP 准备（同时反映在 `spRounds` 与回合条目的 `isSpPrepare`）。业主 2026-10-28：**先把所有回合的
 *     SP 选择移除**，所以今天 21 个回合全是 `false`；机变机制（`CURVE_SP_ROUNDS` / `choices.js` 的重构家族）保留，
 *     等业主给「重构决策」的具体效果后再把要开的那几个回合改成 `true`。
 * @type {Readonly<Record<number, Readonly<{ count: number|null, hp: number, atk: number, time: number, prep: number, sp: boolean }>>>}
 */
export const RECON_CURVE = Object.freeze({
  1: Object.freeze({ count: 7, hp: 1.2, atk: 1.2, time: 60, prep: 80, sp: false }),
  2: Object.freeze({ count: 8, hp: 1.5, atk: 1.3, time: 60, prep: 80, sp: false }),
  3: Object.freeze({ count: 22, hp: 1.9, atk: 1.4, time: 75, prep: 100, sp: false }),
  4: Object.freeze({ count: 25, hp: 2.4, atk: 1.5, time: 90, prep: 100, sp: false }),
  5: Object.freeze({ count: 14, hp: 2.9, atk: 1.6, time: 90, prep: 100, sp: false }),
  6: Object.freeze({ count: 35, hp: 3.5, atk: 1.7, time: 100, prep: 120, sp: false }),
  7: Object.freeze({ count: 15, hp: 4.2, atk: 1.8, time: 100, prep: 120, sp: false }),
  8: Object.freeze({ count: 48, hp: 5.2, atk: 1.9, time: 120, prep: 150, sp: false }),
  9: Object.freeze({ count: 55, hp: 5.8, atk: 2, time: 120, prep: 150, sp: false }),
  10: Object.freeze({ count: 18, hp: 6.4, atk: 2.1, time: 125, prep: 160, sp: false }),
  11: Object.freeze({ count: 69, hp: 7.1, atk: 2.2, time: 125, prep: 160, sp: false }),
  12: Object.freeze({ count: 80, hp: 8.5, atk: 2.4, time: 150, prep: 180, sp: false }),
  13: Object.freeze({ count: 52, hp: 9.1, atk: 2.6, time: 150, prep: 180, sp: false }),
  14: Object.freeze({ count: 94, hp: 9.9, atk: 2.8, time: 150, prep: 180, sp: false }),
  15: Object.freeze({ count: 100, hp: 10.8, atk: 3, time: 150, prep: 180, sp: false }),
  16: Object.freeze({ count: 110, hp: 12.4, atk: 3.4, time: 180, prep: 200, sp: false }),
  17: Object.freeze({ count: 44, hp: 13.6, atk: 3.7, time: 180, prep: 200, sp: false }),
  18: Object.freeze({ count: 130, hp: 15, atk: 4, time: 180, prep: 200, sp: false }),
  19: Object.freeze({ count: 140, hp: 16.8, atk: 4.3, time: 180, prep: 200, sp: false }),
  20: Object.freeze({ count: null, hp: 18.4, atk: 4.6, time: 210, prep: 240, sp: false }),
  21: Object.freeze({ count: null, hp: 20, atk: 5, time: 240, prep: 300, sp: false }),
});

/** 曲线里有 SP 准备的回合（同时写进 `spRounds` 与回合条目的 `isSpPrepare`）。业主 2026-10-28：**先全部移除**（空表）。 */
const CURVE_SP_ROUNDS = Object.freeze([]);

/** 重构模拟的出怪模板 id（工坊包 `mode-recon` 的 `waves.json`）：`recon_r01` … `recon_r19`。 */
export const reconTemplateId = (r) => `recon_r${String(r).padStart(2, '0')}`;

/**
 * 重构模拟的**阵营排程**（模式级键 `factionSetup`；官方模式没有这个键，所以官方抽取一个字节都不变）。
 *
 * * `rounds` —— 类型排程覆盖到隐秘回合（21），官方是 `generation.maxLevelCnt`（15）；
 * * `forceTypes` —— 涤墨每局必选（业主：一局内要把涤墨的种类都刷出来）；
 * * `typeCounts.DIMO` —— 6 个涤墨回合（官方 3）；`fixedRounds.DIMO` 把它们钉在 R2/5/7（基础档）+ R10/13/17
 *   （R11 起走强化档），避开试炼首领回合 4/8/12/16/20；
 * * 涤墨 6 个固定回合的出怪**写死在模板里**（`workshop/mode-recon/waves.json` 的 `recon_rNN`，业主 2026-10-29 的固定表：
 *   键 + 数量直接写在 `spawns` 里，不走占位符替换）。
 */
export const RECON_FACTION_SETUP = Object.freeze({
  rounds: RECON_HIDDEN_ROUND,
  forceTypes: Object.freeze(['DIMO']),
  typeCounts: Object.freeze({ DIMO: 6 }),
  fixedRounds: Object.freeze({ DIMO: Object.freeze([2, 5, 7, 10, 13, 17]) }),
});


/**
 * 一个 mode_multi_<diff> 条目的重构变体，或 null（基表不在 —— 数据不全时 engine 的回退照旧）。
 * 返回的是**新对象**（基表一个字节不动）；`rounds` 的每个回合条目是浅拷贝。
 * **只认终极难度**（`RECON_DIFFICULTY`）：其它难度返回 null（业主 2026-10-27 整体移除）。
 * 数值 / 时限 / 休整 / SP 一律来自 `RECON_CURVE`（本模式自己的曲线，官方数据不改）。
 * @param {string} difficulty 'abyss'
 * @param {Record<string, any>} modes data/config.json 的 `config.modes`
 * @returns {any | null}
 */
export function reconModeFor(difficulty, modes) {
  if (difficulty !== RECON_DIFFICULTY) return null;
  const baseId = `mode_multi_${difficulty}`;
  const base = modes && typeof modes === 'object' ? modes[baseId] : null;
  if (!base || typeof base !== 'object') return null;
  const baseLast = Number.isInteger(base.lastRound) && base.lastRound > 0 ? base.lastRound : 14;
  const rounds = {};
  const enemyScale = {};
  const combatTimeLimit = {};
  for (let r = 1; r <= RECON_HIDDEN_ROUND; r++) {
    let entry = null;
    let src = null;
    if (r === RECON_HIDDEN_ROUND) {
      src = base.rounds?.[String(base.hiddenRound)] ?? null;
      entry = src ? { ...src } : null;
    } else if (r === RECON_LAST_ROUND) {
      // 新首领回合：形状照 mode_multi 的 bossRound 那个回合抄；isHidden 恒 false（它是明首领）。
      src = base.rounds?.[String(base.bossRound)] ?? null;
      entry = src ? { ...src, isHidden: false } : null;
    } else {
      // 14–19 沿用第 13 回合的波次形状占位；模板 id 在下面统一换成重构自己的（recon_rNN）。
      src = base.rounds?.[String(Math.min(r, baseLast - 1))] ?? null;
      entry = src ? { ...src } : null;
    }
    const cur = RECON_CURVE[r];
    if (entry) {
      const bossLike = r === RECON_LAST_ROUND || r === RECON_HIDDEN_ROUND;
      // R1–R19 换成重构自己的出怪模板（工坊包 mode-recon 的 waves.json）；包缺席时按 templateFallback 退回官方基底，
      // 不会出现「有回合但没有出怪」的空场。
      if (!bossLike) {
        entry.template = reconTemplateId(r);
        entry.templateFallback = typeof src?.template === 'string' ? src.template : null;
      }
      entry.combatTimeLimit = bossLike ? null : cur.time;
      entry.levelMaxPlayTime = cur.time;
      entry.prepTime = cur.prep;
      entry.prepTimeData = cur.prep;
      entry.isSpPrepare = cur.sp;
      rounds[r] = entry;
    }
    enemyScale[r] = { hp: cur.hp, atk: cur.atk, speed: 1 };
    combatTimeLimit[r] = entry ? (entry.combatTimeLimit ?? null) : null;
  }
  return {
    ...base,
    modeId: `mode_recon_${difficulty}`,
    name: `recon_${difficulty}`, code: 'RECON',
    desc: '重构模拟（本地实验模式）：20 回合制 · 终极难度 · 预重构 · 重构协议。', // i18n-ignore — 数据形状照官方 mode 条目（每个官方 mode 都带 desc）；界面从不读 config.modes[].desc（客户端的模式文案在 screens/lobby.js 的 MODE_CARDS）
    effectDescList: [],
    // 【重构】盟约（特训的附加盟约）由 workshop/mode-recon 包提供；本表只点名，包缺席时盟约列表查无此 id 不影响运行。
    activeBondIds: [...(base.activeBondIds || []), RECON_BOND_ID],
    lastRound: RECON_LAST_ROUND, bossRound: RECON_LAST_ROUND, hiddenRound: RECON_HIDDEN_ROUND,
    rounds,
    spRounds: [...CURVE_SP_ROUNDS],
    combatTimeLimit,
    enemyScale,
    stages: [...(base.stages || [])],
    bossWeights: { ...(base.bossWeights || {}) },
    hiddenBossWeights: { ...(base.hiddenBossWeights || {}) },
    // 类型排程 / 涤墨必选 / 21 回合长度（官方模式没有这个键 ⇒ 官方抽取逐字节不变）。
    factionSetup: RECON_FACTION_SETUP,
  };
}

/**
 * `config.modes` 的**读取侧合成**：`mode_recon_<diff>` 缺项时合成之，其余键逐字节返回原表里的对象。
 * 与 getMode 同一个语义：查无此 id ⇒ null。
 * @param {unknown} modeId
 * @param {Record<string, any> | null | undefined} modes data/config.json 的 `config.modes`
 * @returns {any | null}
 */
export function modeWithRecon(modeId, modes) {
  if (typeof modeId !== 'string' || !modes || typeof modes !== 'object') return null;
  if (Object.hasOwn(modes, modeId) && modes[modeId] && typeof modes[modeId] === 'object') return modes[modeId];
  if (!/^mode_recon_abyss$/.test(modeId)) return null;
  return reconModeFor(RECON_DIFFICULTY, modes);
}

/** 这个模式 id 是不是重构模拟（`mode_recon_*`）。 */
export const isReconModeId = (modeId) => typeof modeId === 'string' && modeId.startsWith('mode_recon_');

/**
 * 重构盟约的**对局别名**：把 `recon_<官方 id>` 记录覆盖到官方 id 上，返回新的 `bonds` 表（原表一个字节不动）。
 * 记录里的 `bondId` 改回官方 id —— 引擎、客户端、视图读的都是官方 id，只有那一份记录换成了重构版。
 * @param {Record<string, any>|null|undefined} bonds bonds.json 的合并结果
 * @returns {{ bonds: Record<string, any>, alias: Readonly<Record<string, string>> }|null} 没有这类记录 ⇒ null
 */
export function reconBondAlias(bonds) {
  if (!bonds || typeof bonds !== 'object') return null;
  const overlay = {};
  const alias = {};
  for (const [id, rec] of Object.entries(bonds)) {
    if (!id.startsWith('recon_') || !rec || typeof rec !== 'object') continue;
    const base = id.slice('recon_'.length);
    if (!bonds[base]) continue;
    overlay[base] = Object.freeze({ ...rec, bondId: base });
    alias[base] = id;
  }
  if (!Object.keys(overlay).length) return null;
  return { bonds: Object.freeze({ ...bonds, ...overlay }), alias: Object.freeze(alias) };
}

/** 别名后的整份数据（按原数据对象缓存 —— `Battle` 每一步都要它，不缓存就是每 tick 拷一遍盟约表）。 */
const ALIASED_DATA = new WeakMap();

/**
 * 一局重构模拟要读的**整份数据**：`reconBondAlias` 那一层叠在 `data.bonds` 上，其余键原样。
 *
 * **为什么必须在战斗这一层也做**（业主 2026-10-27「重构后的效果没有生效，还是原本的效果」）：生产默认是**浏览器**
 * 跑战斗（`clientCombat`），`Match` 准备期那份别名到不了浏览器 —— `Battle` 的数据作用域读的是它自己那一份
 * 冻结的 `/data/*.json`。别名下沉到这里之后，服务端复算（`SP_VERIFY`）、浏览器、试玩与重放读的是同一份。
 * @param {object|null|undefined} data 整份数据（要有 bonds）
 * @param {string|null|undefined} modeId 这一场战斗的 modeId（`Battle opts.modeId`）
 * @returns {object|null} 别名后的数据，或 null（非重构模式 / 没有 `recon_*` 记录）
 */
export function reconBondData(data, modeId) {
  if (!isReconModeId(modeId) || !data || typeof data !== 'object') return null;
  if (ALIASED_DATA.has(data)) return ALIASED_DATA.get(data) ?? null;
  const aliased = reconBondAlias(data.bonds);
  const out = aliased ? Object.freeze({ ...data, bonds: aliased.bonds }) : null;
  ALIASED_DATA.set(data, out);
  return out;
}

/**
 * 客户端加载 config 后的一次性补齐：往 `config.modes` 里写**终极难度**那一条（已存在的键不动）。
 * 返回同一个 config 对象（就地补键 —— `config.modes` 是 data 缓存里的对象，补键让后续每个 `modes[modeId]`
 * 读点都拿到它；官方键逐字节不变）。
 * @param {any} config data/config.json 的 config
 * @returns {any}
 */
export function ensureReconModes(config) {
  const modes = config && typeof config === 'object' ? config.modes : null;
  if (!modes || typeof modes !== 'object') return config;
  for (const d of DIFFS) {
    const id = `mode_recon_${d}`;
    if (!Object.hasOwn(modes, id)) {
      const entry = reconModeFor(d, modes);
      if (entry) modes[id] = entry;
    }
  }
  return config;
}
