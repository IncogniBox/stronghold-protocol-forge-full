// server/match/match/reconTrials.js — Match methods: 重构模拟的「试炼首领」（模式扩展-重构模拟）。
//
// 预重构里选定 / 抽中的那一只「·重构」首领在 RECON_TRIAL_ROUNDS（4 / 8 / 12 / 16）的第 4 回合作为**普通敌人**
// 加入这一回合的战场：它按自己记录里的数值出战（engine 的普通出怪路径），**没有**共享血量池、**没有** Final
// Assault 阶段（那是 bossRound / hiddenRound 的事，见 bossRounds.js），漏了也按它自己的 `lpr` 扣目标生命。
//
// 候选表在 `shared/reconModes.js`（RECON_TRIAL_BOSSES，键是工坊包 workshop/mode-recon 的）。本模块只做两件事：
//   1. **解析**这一回合该出哪一个**候选**（reconTrialBossFor）—— 返回的是候选的 **choice id**（单选时 id = 它的 enemy key）；
//   2. 给出这一回合的追加出怪列表（reconTrialSpawnsFor），交 phases.startRound 挂到 `this.reconTrialSpawns`，
//      由 combat.js 的 `_normalOpts` 并进每个玩家的战场 spawns、views.js 的 `nextEnemiesFor` 并进预览。
//
// 「一次选择两只」：候选的 `keys` 可以有 1 或 2 个（第 8 回合第 3 项 = 梅菲斯特·重构 + 浮士德·重构）。`reconTrialSpawnsFor`
// 把 id 解析回它的 `keys` 后**每个 key 各出一条**追加出怪 —— 一条选择，两只怪，与业主给的那一项一致。
//
// 与「开发者面板追加敌人」（`this.devExtraEnemies`：intents.js `spawnEnemy`、combat.js `_normalOpts`、
// views.js `nextEnemiesFor`）**同一条形状与同一条纪律**：只在添加的那一个回合出现，新回合开始即被清掉。
// 差别只有一个 —— 这一格只在 `this.gd.isRecon` 为真时才被赋值（官方对局连这个键都不写 ⇒ 逐字节不变）。
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { createRng, deriveSeed } from '../../sim/rng.js';
import { RECON_TRIAL_BOSSES } from '../../../shared/reconModes.js';

/**
 * 追加的试炼首领在回合开始后**几游戏秒**入场（与波次里敌人 `time` 同一口径：游戏秒）。业主给的是「进场稍晚于
 * 开局那几波，让玩家先布好防线」—— 取 3 s：晚于第 1 波，又不会拖到波次中段。
 */
export const RECON_TRIAL_SPAWN_TIME = 3;
/** 抽签流的名字（与既有的 `'boss-pairs'` / `'waves'` / `'setup'` … 同一张表）。**独占一口流**，不动别人的随机数。 */
const TRIAL_STREAM = 'recon-trial';
/** 追加出怪用的路线下标：本回合波次的第一条（official 波次模板恒有 routes；没有 route 的模板沿用 dev 那边同样的 0）。 */
const TRIAL_ROUTE_INDEX = 0;

/** 这一回合候选里 `id` 匹配的那一条 choice（没有则 null）—— id → keys 的解析只在这里。 */
function choiceById(r, id) {
  const choices = RECON_TRIAL_BOSSES[Number(r)];
  return Array.isArray(choices) ? (choices.find((c) => c && c.id === id) ?? null) : null;
}

export class MatchReconTrials {
  /**
   * 这一个回合该出哪一个候选，没有则 null（返回的是候选的 **choice id**：单选时它等于那个 enemy key）。
   *
   * * 不是重构对局（`this.gd.isRecon` 为假）或这一回合没有候选（RECON_TRIAL_BOSSES 里没有它）：null —— 官方对局
   *   恒走这一条，一个字节都不动。
   * * 有人提交了合法选择：**座位序（`this.order`）里第一个**交上来了合法 choice id 的玩家赢。这是本模式的协同规则
   *   [ASSUMED]（业主未定）：同一份 `reconChoices` 在服务端与每个客户端上都是同一张表，所以任何一端算出来的都是
   *   同一条 —— 确定性优先于「谁先交」。业主裁令后改成别的规则只动这一处。
   * * 没人交（或交的都不在候选里）：从**独占**的一口种子流 `deriveSeed(this.seed, 'recon-trial')` 抽一条。
   *   这一口流只被这里用，`rngWaves` 等既有流一个数都不动；每次调用都新建一份 rng（首抽恒定）⇒ 反复调用同一回合
   *   拿到同一条（幂等），相邻两端也一致。
   * @param {number} r 回合号
   * @returns {string|null}
   */
  reconTrialBossFor(r) {
    if (!this.gd.isRecon) return null;
    const choices = RECON_TRIAL_BOSSES[Number(r)];
    if (!Array.isArray(choices) || !choices.length) return null;
    for (const ps of this.order) {
      const c = this.reconChoices ? this.reconChoices[ps.playerId] : null;
      const pick = c && c.bosses && typeof c.bosses === 'object' ? c.bosses[String(r)] : null;
      if (typeof pick === 'string' && choices.some((ch) => ch && ch.id === pick)) return pick;
    }
    const rng = createRng(deriveSeed(this.seed, TRIAL_STREAM));
    const drawn = rng.pick(choices);
    return drawn && typeof drawn.id === 'string' ? drawn.id : null;
  }

  /**
   * 这一回合的追加出怪列表（`this.reconTrialSpawns` 的形状）：没有试炼首领 ⇒ `[]`；一条选择里可能含**两只**
   * （第 8 回合第 3 项）⇒ 每个 key 各出一条（同一 `time` / `routeIndex`）。
   *
   * 只对**普通回合**有效（`isBoss` 为真 = 这一回合是官方/强制的首领回合 ⇒ 出怪表另有来源、追加进去也无人消费）。
   * 一条一条是 `{ enemyKey, time, count, interval, routeIndex }` —— 与 devExtraEnemies 逐字段同形。
   * @param {number} r 回合号
   * @param {boolean} [isBoss] 这一回合是不是首领回合（phases.startRound 算出来的那一个）
   * @returns {Array<{ enemyKey: string, time: number, count: number, interval: number, routeIndex: number }>}
   */
  /**
   * 首领回合（第 20 回合）用来**替换**抽到的那只首领的 enemy key：候选 choice 的第一个 key（单选时就是它）。
   * 非重构对局 / 没候选 / 没人选且种子抽不到 ⇒ null（官方路径一个字节不动）。
   * @param {number} r
   * @returns {string|null}
   */
  reconBossSpawnKeyFor(r) {
    const id = this.reconTrialBossFor(r);
    const choice = id ? choiceById(r, id) : null;
    return choice && Array.isArray(choice.keys) && choice.keys.length ? choice.keys[0] : null;
  }

  /**
   * 把首领回合波次里 **tag: 'boss'** 的那一条 spawn 换成候选的 key（其它出怪原样保留）。
   * 波次模板仍按通常抽到的首领取（护送怪 / 路线沿用那一份）；只有首领本体的 key 变成「·重构」记录。
   * @param {number} r
   * @param {any} wave buildBossWave 的产出
   * @returns {any} 同一个 wave（没有候选时逐字返回）
   */
  reconBossWaveFor(r, wave) {
    const key = this.reconBossSpawnKeyFor(r);
    if (!key || !wave || !Array.isArray(wave.spawns)) return wave;
    return { ...wave, spawns: wave.spawns.map((s) => (s && s.tag === 'boss' ? { ...s, key } : s)) };
  }

  reconTrialSpawnsFor(r, isBoss = false) {
    if (isBoss || !this.gd.isRecon) return [];
    const id = this.reconTrialBossFor(r);
    const choice = id ? choiceById(r, id) : null;
    if (!choice || !Array.isArray(choice.keys)) return [];
    return choice.keys.map((enemyKey) => ({ enemyKey, time: RECON_TRIAL_SPAWN_TIME, count: 1, interval: 0, routeIndex: TRIAL_ROUTE_INDEX }));
  }
}
