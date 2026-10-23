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
export const RECON_TRIAL_ROUNDS = Object.freeze([4, 8, 12, 16, 20]);
export const RECON_TRAINING_ROUNDS = Object.freeze([4, 8, 12, 16, 20]);
/**
 * 特训学员从教官那里继承的**三围比例**（业主 2026-10-27）：攻 / 防 / 生命上限 = **学员自己的 + 教官的 ×0.5**，
 * 固定不叠加。其余一切（部署费用 / 阻挡数 / 攻击间隔 / 再部署时间 / 攻击范围 / 技能时长 / 弹药数 / 技能触发规则）
 * 全是学员自己的。战斗侧只此一处读（server/sim/simdata.js getTrainee 的缺省也是它，但显式传）。
 */
export const RECON_TRAINEE_STAT_RATIO = 0.5;
/**
 * 本模式**专属**的附加盟约（特训的学员身上那一条，记录由工坊包 mode-recon 提供）。
 * 它不是玩家能「倾向」的东西 —— 预重构的候选池按 id 把它排除（screens/preRecon.js），所以这个 id 在这里只许写一处。
 */
export const RECON_BOND_ID = 'bond_recon';

/**
 * 「试炼首领」的候选表：`{ 回合号 → 候选 choice[] }`，每条 choice = `{ id, keys: ['<包里的 enemy key>', …] }`。
 * **只在有候选的回合**出现这个键 —— 其余试炼回合（RECON_TRIAL_ROUNDS 里没被点名的 16）仍是「默认随机」，
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
 * 这张表**取代**了引擎侧「首领表第二轮才进工坊包」的那个占位：预重构的 R04 / R08 格按它变成真选择器，
 * 第 4 / 8 / 12 / 16 回合按它出怪（reconTrials.js / phases.startRound）；**第 20 回合**（首领回合）用它替换抽到的那只首领 —— 见 `reconBossWaveFor`。
 * 目前只有 4 / 8 / 12 三个回合有候选；16 / 20 回合没有（其余十六只·重构首领已移除、等重新制作），引擎按自己的种子流随机抽。
 * @type {Readonly<Record<number, readonly { id: string, keys: readonly string[] }[]>>}
 */
export const RECON_TRIAL_BOSSES = Object.freeze({
  4: Object.freeze([
    Object.freeze({ id: 'enemy_ws_recon_skulsr', keys: Object.freeze(['enemy_ws_recon_skulsr']) }), // 碎骨·重构
    Object.freeze({ id: 'enemy_ws_recon_lslime', keys: Object.freeze(['enemy_ws_recon_lslime']) }), // “庞贝”·重构
    Object.freeze({ id: 'enemy_ws_recon_cqbw', keys: Object.freeze(['enemy_ws_recon_cqbw']) }),     // W·重构
    Object.freeze({ id: 'enemy_ws_recon_mdrock', keys: Object.freeze(['enemy_ws_recon_mdrock']) }), // 泥岩·重构
    Object.freeze({ id: 'enemy_ws_recon_demonk', keys: Object.freeze(['enemy_ws_recon_demonk']) }), // 萨卡兹百夫长·重构
  ]),
  8: Object.freeze([
    Object.freeze({ id: 'enemy_ws_recon_bigadam', keys: Object.freeze(['enemy_ws_recon_bigadam']) }), // 大亚当·重构
    Object.freeze({ id: 'enemy_ws_recon_xi', keys: Object.freeze(['enemy_ws_recon_xi']) }),           // 自在·重构
    Object.freeze({ id: 'enemy_ws_recon_jakill', keys: Object.freeze(['enemy_ws_recon_jakill']) }),   // 杰斯顿·威廉姆斯·重构
    Object.freeze({ id: 'enemy_ws_recon_blkswb', keys: Object.freeze(['enemy_ws_recon_blkswb']) }),   // 锏·重构
  ]),
  12: Object.freeze([
    Object.freeze({ id: 'enemy_ws_recon_reid', keys: Object.freeze(['enemy_ws_recon_reid']) }),       // “复仇者”·重构
  ]),
  // 16 / 20 回合暂无可用的·重构首领（其余十六只已整体移除、等重新制作）⇒ 不出现该键，引擎按自己的种子流随机抽。
});

const DIFFS = ['funny', 'normal', 'hard', 'abyss'];

/**
 * 一个 mode_multi_<diff> 条目的重构变体，或 null（基表不在 —— 数据不全时 engine 的回退照旧）。
 * 返回的是**新对象**（基表一个字节不动）；`rounds` 的每个回合条目是浅拷贝。
 * @param {string} difficulty 'funny' | 'normal' | 'hard' | 'abyss'
 * @param {Record<string, any>} modes data/config.json 的 `config.modes`
 * @returns {any | null}
 */
export function reconModeFor(difficulty, modes) {
  const baseId = `mode_multi_${difficulty}`;
  const base = modes && typeof modes === 'object' ? modes[baseId] : null;
  if (!base || typeof base !== 'object') return null;
  const baseLast = Number.isInteger(base.lastRound) && base.lastRound > 0 ? base.lastRound : 14;
  const rounds = {};
  const enemyScale = {};
  const combatTimeLimit = {};
  for (let r = 1; r <= RECON_HIDDEN_ROUND; r++) {
    let entry = null;
    if (r === RECON_HIDDEN_ROUND) {
      entry = base.rounds?.[String(base.hiddenRound)] ? { ...base.rounds[String(base.hiddenRound)] } : null;
    } else if (r === RECON_LAST_ROUND) {
      // 新首领回合：形状照 mode_multi 的 bossRound 那个回合抄；isHidden 恒 false（它是明首领）。
      entry = base.rounds?.[String(base.bossRound)] ? { ...base.rounds[String(base.bossRound)], isHidden: false } : null;
    } else {
      const src = base.rounds?.[String(Math.min(r, baseLast - 1))];
      entry = src ? { ...src } : null;
    }
    if (entry) rounds[r] = entry;
    const es = base.enemyScale?.[String(Math.min(r, baseLast))] || { hp: 1, atk: 1, speed: 1 };
    enemyScale[r] = { ...es };
    combatTimeLimit[r] = entry ? (entry.combatTimeLimit ?? null) : null;
  }
  return {
    ...base,
    modeId: `mode_recon_${difficulty}`,
    name: `recon_${difficulty}`, code: 'RECON',
    desc: '重构模拟（本地实验模式）：20 回合制 · 预重构 · 重构协议（机制开发中）。', // i18n-ignore — 数据形状照官方 mode 条目（每个官方 mode 都带 desc）；界面从不读 config.modes[].desc（客户端的模式文案在 screens/lobby.js 的 MODE_CARDS）
    effectDescList: [],
    // 【重构】盟约（特训的附加盟约）由 workshop/mode-recon 包提供；本表只点名，包缺席时盟约列表查无此 id 不影响运行。
    activeBondIds: [...(base.activeBondIds || []), RECON_BOND_ID],
    lastRound: RECON_LAST_ROUND, bossRound: RECON_LAST_ROUND, hiddenRound: RECON_HIDDEN_ROUND,
    rounds,
    spRounds: (base.spRounds || []).filter((r) => r < RECON_LAST_ROUND),
    combatTimeLimit,
    enemyScale,
    stages: [...(base.stages || [])],
    bossWeights: { ...(base.bossWeights || {}) },
    hiddenBossWeights: { ...(base.hiddenBossWeights || {}) },
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
  const m = /^mode_recon_(funny|normal|hard|abyss)$/.exec(modeId);
  if (!m) return null;
  return reconModeFor(m[1], modes);
}

/**
 * 客户端加载 config 后的一次性补齐：往 `config.modes` 里写 4 个 recon 条目（已存在的键不动）。
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
