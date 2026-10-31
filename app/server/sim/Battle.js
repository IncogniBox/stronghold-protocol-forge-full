// server/sim/Battle.js — one field simulation (normal / unite / boss / hidden). Public API: DESIGN §5.1.
//
//   const b = new Battle({ seed, kind, modeId, round, stage|stageId, rect, timeLimit, players, spawns, routes,
//                          sharedBoss, flags, fieldId?, data?, content?, recordEvents?, logger? })
//   b.step(); b.finished; b.forceEnd(reason); b.time; b.result(); b.snapshot(); b.drainEvents(); b.on/off(...)
//
// Construction creates every ally unit (undeployed) and installs content (kits + domain modules). The first
// step() (or an explicit start()) deploys everything (operators by column from the left, top to bottom within a
// column — mirrored for the right boss side —, then the summon pieces the same way — except a piece content flags
// `deferDeploy`, which waits on its tile; the players of a shared field side by side), fires `deploy` (initial) for
// each unit, forces out the operators that enter already knocked out (`carryState.down`, 联防: constants.js
// FORCED_EXIT — down on their tile, redeploy timer running) and then fires `battleStart`.
// An operator that left the field — knocked out, or forced out by its own effects (史尔特尔's 余烬 …, GitHub #60) — lies
// on its `body` tile — where it fell, or its own home when it fell on another board piece's home — and redeploys there;
// no ally deploys or moves onto that tile meanwhile (PRTS 卫戍协议/帮助 §作战阶段 单位部署; `isDown`, `_layBody`, `downOn`,
// `restTile`, `isReservedTile`; docs/SIM.md §1).
// Tick order: scheduled callbacks → spawns → DP → buffs → enemies (attack, move, block) → enemy index →
//   allies (skill tick, attack) → projectiles → redeploys → boss sync → `tick` hook → release hooks of removed units →
//   time += TICK → end checks. A forceEnd() requested mid-step ends the step after the current phase (docs/SIM.md §1.4).
// Board → field coordinates: units are given in board coordinates (rows 9–12, cols 2–10). Normal/unite:
//   (row, col + colOffset). Boss/hidden: row − 7 when row ≥ 7 (board rows → boss rows 2–5); side 'R' mirrors
//   the column (col → 20 − col) and mirrors the direction (RIGHT ↔ LEFT, UP / DOWN kept). Every ally has a direction
//   `dir` (UP|RIGHT|DOWN|LEFT, default RIGHT — PlayerBattleInput unit `dir`, sim/dir.js) that rotates its range grid.
//   `abs: true` on a unit (or player `coords: 'field'`) = field tiles (and field directions).
// Robustness: every content callback and every step phase is wrapped; errors are logged once per key and the
// battle continues. After MAX_INTERNAL_ERRORS the battle force-ends as a timeout.
//
// Code layout: this file keeps the constructor (fields, players, spawn queue, content install); the methods live in
// server/sim/battle/, one module per concern, and are installed on Battle.prototype below in a fixed order, with the
// descriptors of class methods (non-enumerable; `this` is the battle, subclasses and `super` calls work as before):
//   players.js       board → field tiles / directions, ally creation, kit / profile / skill setup
//   lifecycle.js     start (the battle-start deployment), step (the tick order above), end checks, BattleResult
//   hooks.js         hook bus (on / off / emit), timers (after / every), content-callback isolation and errors
//   spawns.js        spawn queue, routes, spawnEnemy; hidden enemies, boss pool sync, field clamp, list compaction
//   deploy.js        deploy, kill, retreat, removal bookkeeping, redeploys, leaks
//   blocking.js      contact blocking, block release, the 隐匿 switch-off after a block
//   status.js        buffs, catalogue statuses (抵抗, 寒冷 → 冻结, 诱导, 恐惧 …), "同名效果取最高", the buff tick
//   combat.js        damage / heal / HP loss (damage.js pipeline), projectiles, forced attacks
//   queries.js       enemy tile index, unit queries (tiles, grid, radius, selectability), players, range rebuilds
//   summons.js       tokens (summons), devices, stage devices
//   tiles.js         obstacles, relocation / 【移动】, knocked-out bodies, reserved tiles, tactical points, ground paths
//   displacement.js  push / pull / displace (受力等级 = force − weight); pushTiles
//   economy.js       DP, IN_BATTLE bond layers, bounty coins
//   events.js        client events, snapshot, field meta, fx, the sim log
//   util.js          fin / clone

import { TICK, ROWS, COLS, DP_DEFAULTS, MAX_HOOK_DEPTH, AUTO_OP_COOLDOWN } from './constants.js';
import { GEO } from '../../shared/constants.js';
import { layoutOf } from '../../shared/layout.js';
import { createRng } from './rng.js';
import { Grid } from './grid.js';
import { ProjectileSystem } from './projectiles.js';
import { remainingDistance } from './ai.js';
import { toDataSource, normalizeRoute, normalizeStage, DataSource, withUnitLoadouts } from './simdata.js';
import { installContent } from './content/index.js';
import { withGameData, withMorphPairing } from './content/support/index.js';
// 重构模拟的盟约别名（`recon_<官方 id>` → 官方 id；服务端复算、浏览器战斗、试玩与重放共用这一份口径）
import { reconData, isReconModeId } from '../../shared/reconModes.js';
import { BattlePlayers } from './battle/players.js';
import { BattleLifecycle } from './battle/lifecycle.js';
import { BattleHooks } from './battle/hooks.js';
import { BattleSpawns } from './battle/spawns.js';
import { BattleDeploy } from './battle/deploy.js';
import { BattleBlocking } from './battle/blocking.js';
import { BattleStatus } from './battle/status.js';
import { BattleCombat } from './battle/combat.js';
import { BattleQueries } from './battle/queries.js';
import { BattleSummons } from './battle/summons.js';
import { BattleTiles } from './battle/tiles.js';
import { BattleDisplacement } from './battle/displacement.js';
import { BattleEconomy } from './battle/economy.js';
import { BattleEvents } from './battle/events.js';

export { pushTiles } from './battle/displacement.js';

const DEFAULT_RECTS = { normal: GEO.NORMAL_RECT, unite: GEO.UNITE_RECT, boss: GEO.BOSS_RECT, hidden: GEO.BOSS_RECT };

/**
 * The whole data object behind `Battle opts.data` (W-B): a DataSource / loadout view carries it as `source`, a raw data
 * object IS it, and anything else (undefined, a stub) means "the process data" — `null` in the data scope.
 *
 * 重构模拟（`mode_recon_*`）：这一场读的盟约表换成包里 `recon_<id>` 的那一份（`shared/reconModes.js reconBondData`）。
 * **必须落在这里**：生产默认是浏览器跑战斗（`clientCombat`），准备期 `Match` 那份别名到不了浏览器，而这里正是
 * 服务端复算、浏览器、试玩与重放共用的唯一入口（业主 2026-10-27「重构后的效果没有生效，还是原本的效果」）。
 * @param {any} data
 * @param {string|null} [modeId]
 * @returns {object|null}
 */
function dataObjectOf(data, modeId = null) {
  if (!data || typeof data !== 'object') return null;
  const src = data.source && typeof data.source === 'object' ? data.source : (typeof data.getChess === 'function' ? null : data);
  return (src && reconData(src, modeId)) || src;
}

export class Battle {
  constructor(opts = {}) {
    // 对局自己的数据作用域（W-B, DESIGN §28.16）：构造期与每一步都是同步的，而 content/support 的记录读取走
    // `gameData()` —— 不套这一层，一个只声明了部分包的房间仍会读到进程级那份（装了全部包）的盟约 / 道具 / 策略。
    // 行为开关 `morphPairing`（DESIGN §28.43.1）走**同一条作用域纪律**：`unitBonds` 读它，所以构造期与每一步都要压上。
    withGameData(dataObjectOf(opts.data, opts.modeId), () => withMorphPairing(opts.morphPairing, () => this._init(opts)));
  }

  _init(opts = {}) {
    this.opts = opts;
    this.seed = (Number(opts.seed) >>> 0) || 1;
    this.rng = createRng(this.seed);
    this.kind = opts.kind ?? 'normal';
    this.modeId = opts.modeId ?? null;
    this.round = opts.round ?? 0;
    this.fieldId = opts.fieldId ?? null;
    this.logger = opts.logger ?? console;
    this.recordEvents = opts.recordEvents !== false;
    /** When false the battle only ends by time limit / boss pool / forceEnd (tests, sandboxes). */
    this.autoFinish = opts.autoFinish !== false;
    /**
     * 限伤 override (`shared/constants.js bossHitLimitFrom`): the deploy-time `SP_BOSS_HIT_LIMIT`, threaded through
     * Match → battle opts / the battle spec → here. `undefined` = keep `BOSS_HIT_LIMIT`, so a battle built without the
     * option is byte-for-byte the old battle (server/sim/damage.js leaderHitCancelled reads this field).
     */
    this.bossHitLimit = opts.bossHitLimit;
    /**
     * 本场战斗的数据源。重构模拟（`mode_recon_*`）要在这一层也换成**别名后**的棋子表（业主 2026-10-31
     * 「新增的干员战斗开始后模型消失」）：`withGameData` 只把别名压进内容 / 支援那一条作用域（盟约、道具、
     * 特质），而单位自己的 `getChess`（`players.js` 的 `_createAllyFromInput`、召唤物按主人取变体）读的是
     * `this.data` —— 那里还是未别名的表，`chess_ws_recon_*`（包里新增、官方没有的 id）查不到记录，
     * 整名干员不出场；覆盖用的记录（星熊 / 诗怀雅 …）则仍按官方数值开打。这里把棋盘表换成同一份别名对象
     * （`reconData` 按数据对象只建一次，与 `withGameData` 共用），并保留原来的 `forms` 口径视图与每场
     * 技能 / 模组视图（`withUnitLoadouts`）。非重构对局（`reconData` → null）逐字节走原路。
     *
     * 别名表只有**正式 id**，而包里那份记录自己的键是 `recon_*`（内容测试与旧重放直接按它出人）——
     * 这里把两张表并起来：正式 id 用别名后的那份，`recon_*` 键留着原记录，同一条记录两种 id 都查得到。
     */
    const reconRaw = isReconModeId(this.modeId) && opts.data
      ? (opts.data.source && typeof opts.data.source === 'object' ? opts.data.source : opts.data)
      : null;
    const reconSource = reconRaw ? reconData(reconRaw, this.modeId) : null;
    if (reconSource) {
      const base = toDataSource(opts.data);
      const source = reconSource.chess && reconRaw.chess
        ? { ...reconSource, chess: { ...reconRaw.chess, ...reconSource.chess } }
        : reconSource;
      this.data = withUnitLoadouts(new DataSource(source, base.fallback ?? null, { forms: base.forms ?? null }), opts.players);
    } else {
      this.data = toDataSource(opts.data);
    }
    let stage = opts.stage ?? (opts.stageId ? this.data.getStage(opts.stageId) : null);
    if (stage && !stage._norm) stage = normalizeStage(stage.id ?? opts.stageId, stage);
    this.stage = stage || { id: 'empty', rows: [], devices: [] };
    this.stageId = this.stage.id ?? opts.stageId ?? null;
    /**
     * The map's own layout (shared/layout.js): its window size, its three deploy rects, its battle / pen rects and its
     * boss mirror axis. Official 19×21 records carry no `layout`, so `layoutOf` derives the official numbers — every
     * reader below can therefore use `this.layout` instead of a hard-coded GEO constant, and an official stage gets
     * exactly what it always got.
     */
    this.layout = layoutOf(this.stage);
    /**
     * 第几块 boss 场地（`layout.bossAreas` 的下标，1 = 第二块；0 / 缺省 = 第 1 块）。它只用于**显示**：客户端的
     * 场帧把它带回去，让渲染器按这块场地的布局（`battle.boss` / `bossPrep`）取景与点亮当前战场。
     */
    this.area = Number.isInteger(opts.area) && opts.area > 0 ? opts.area : null;
    /**
     * The field rect this battle fights in: whatever the caller passed, else **the map's own rect for this kind**
     * (`layoutOf`). On an official 19×21 stage that is `DEFAULT_RECTS[kind]` verbatim (deep-equal, so every caller and
     * test that passed nothing keeps the rect it always got); on a big map a normal battle defaults to the map's own
     * normal band, which is where its board sits.
     */
    /**
     * The map's own rect for a battle kind: `normal` / `unite` / `boss` (`hidden` reads the boss one), and the same
     * numbers the historical `DEFAULT_RECTS` carried when the map is an official 19×21 one.
     */
    const kindRect = (kind) => this.layout.battle[kind === 'hidden' ? 'boss' : kind] ?? this.layout.battle.normal;
    this.rect = { ...(opts.rect ?? kindRect(this.kind)) };
    { // a malformed rect (non-integers, inverted, off the map) falls back to the kind's default field
      const R = this.rect;
      const ok = [R.r0, R.r1, R.c0, R.c1].every(Number.isInteger) && R.r0 >= 0 && R.c0 >= 0 && R.r1 < ROWS && R.c1 < COLS && R.r0 <= R.r1 && R.c0 <= R.c1;
      if (!ok) this.rect = { ...kindRect(this.kind) };
    }
    this.grid = new Grid(this.stage, this.rect);
    const bossLike = this.kind === 'boss' || this.kind === 'hidden';
    // A bad limit (0, negative, NaN — e.g. a missing config row) must not turn a normal round into an endless one:
    // non-boss kinds fall back to 60 s; only boss/hidden (or an explicit Infinity) run without a limit.
    const tl = Number(opts.timeLimit);
    this.timeLimit = opts.timeLimit == null || !(tl > 0) ? (bossLike ? Infinity : 60) : tl;
    // startOpCooldown: the operation cooldown of the battle-start deployment (skills.js AUTO_OP_COOLDOWN)
    this.flags = { layerGainsEnabled: this.kind === 'normal', ...DP_DEFAULTS, startOpCooldown: AUTO_OP_COOLDOWN, ...(opts.flags || {}) };
    const soc = Number(this.flags.startOpCooldown);
    this.flags.startOpCooldown = this.flags.startOpCooldown != null && Number.isFinite(soc) && soc >= 0 ? soc : AUTO_OP_COOLDOWN;
    // DP knobs may arrive as undefined/null/strings (e.g. a template without `dp`): never let them poison DP with NaN.
    for (const k of ['dpInit', 'dpPerSec', 'dpMax']) {
      const v = Number(this.flags[k]);
      this.flags[k] = this.flags[k] != null && Number.isFinite(v) && v >= 0 ? v : DP_DEFAULTS[k];
    }
    this.sharedBoss = opts.sharedBoss ?? null;
    this.routes = (opts.routes ?? []).map((r) => normalizeRoute(r));
    /** Per-template enemy overrides `{ [enemyKey]: { stats: {…partial} } }` (waves.json `overrides`). */
    this.enemyOverrides = opts.enemyOverrides ?? {};
    this.dt = TICK;
    this.time = 0;
    this.tickCount = 0;
    this.finished = false;
    this.reason = null;
    this.started = false;
    this._startDeploying = false;
    /** @type {import('./units.js').Unit[]} every unit ever created */
    this.units = [];
    /** @type {import('./units.js').Unit[]} alive enemies (compacted each tick) */
    this.enemies = [];
    /** @type {import('./units.js').Unit[]} every ally unit (ops, tokens, devices; dead included) */
    this.allyUnits = [];
    this._hooks = Object.create(null);
    this._emitDepth = 0;
    this._frameName = new Array(MAX_HOOK_DEPTH).fill(null);   // open hook/callback frames (diagnostics, _chain)
    this._frameOwner = new Array(MAX_HOOK_DEPTH).fill(null);
    this._frameCtx = new Array(MAX_HOOK_DEPTH).fill(null);
    // 每局每插件的调用预算（DESIGN §28.52）：一本账 = 一个声明了 `pack.json.callBudget` 的包。没声明的包不在
    // `_packBudget` 里 ⇒ 记账那一步立刻放行，module 档一行都不多跑（这是「按档启用」的落点）。
    // `_packScope` = 当前正在装机 / 正在跑的那个包；`on` / `after` / `every` / `addBuff` 据此给新东西盖 `pack` 标记。
    this._packBudget = new Map();
    this._packUsed = new Map();
    this._packRolled = new Set();
    this._packScope = null;
    this._toRelease = [];   // permanently removed units whose hooks / periodic timers are dropped at step end
    this._sched = [];
    this._evq = [];
    this.projectiles = new ProjectileSystem(this);
    this._occ = new Array(ROWS * COLS).fill(null);
    this._eb = new Array(ROWS * COLS);   // range buckets (colliders: queries.js _buildEnemyIndex)
    for (let i = 0; i < this._eb.length; i++) this._eb[i] = [];
    this._ebUsed = [];
    this._et = new Array(ROWS * COLS);   // tile buckets (格子判定: the position's tile, a huge enemy's rectangle tiles)
    for (let i = 0; i < this._et.length; i++) this._et[i] = [];
    this._etUsed = [];
    this._idSeq = 0;
    this._attackSeq = 0;   // DamageInfo.attackId of normal attacks (one id per attack, all its damage instances)
    this._deploySeq = 0;
    this._spawnSeq = 0;
    this._enemiesDirty = false;
    this.killed = 0;
    this.total = 0;
    this.leakedCount = 0;
    // The HUD capsule's own counters (DESIGN §14, PR #157 semantics): only the enemies the field itself scheduled
    // (`inTotal`, spawns.js `_queueSpawn` — `total` is their denominator) count here. `killed` / `leakedCount` above keep
    // the official LP / 完美作战 reading: every `counted` enemy, runtime splits and summons included.
    this.killedInTotal = 0;
    this.leakedInTotal = 0;
    this.errors = [];
    this.errorCount = 0;
    this._errKeys = new Set();
    this._result = null;
    this._skills = { onDamaged: (u) => { if (u.skill) u.skill.onDamaged(); } };
    this.remainingDistance = (e) => remainingDistance(this, e);

    // ---- players
    this.players = [];
    this._perPlayer = Object.create(null);
    for (const p of opts.players ?? []) if (p && typeof p === 'object') this._addPlayer(p);

    // ---- spawns
    this._pending = [];
    for (const s of opts.spawns ?? []) if (s && typeof s === 'object') this._safe(() => this._queueSpawn(s, true), 'queueSpawn');
    this._pending.sort((a, b) => a.time - b.time || a.seq - b.seq);

    // ---- content
    this.contentMode = opts.content ?? 'full';
    // D17：结构取 upstream（contentFault ⇒ 不 forceEnd、直接给强制结果）；**我们的 `installers`（mod 层装载器）保留**
    try {
      installContent(this, { mode: this.contentMode, extra: opts.extraContent, installers: opts.battleInstallers });
    } catch (e) {
      if (!this.contentFault) this._handlerError('installContent', null, e);
    }
    if (this.contentFault) {
      // [ASSUMED] A DSL kit that still throws after the set was built means the content set is corrupt.
      // Do not call forceEnd: that would start() and deploy. The player sees the ordinary forced result;
      // battle.errors carries content:dsl and the code (DESIGN **§34**，上游原文 `§32`). Host and page share this constructor.
      this.finished = true;
      this.started = true;
      this.reason = 'forced';
      try { this._result = this._buildResult(); }
      catch { this._result = { time: this.time, reason: 'forced', perPlayer: {}, killed: this.killed, total: this.total, resolved: this.resolved, errors: this.errorCount }; }
    } else {
      for (const u of this.allyUnits) if (!u.kit) this._setupUnit(u);
      if (typeof opts.setup === 'function') this._safe(() => opts.setup(this), 'opts.setup');
    }
  }

  /**
   * The HUD capsule's numerator (DESIGN §14): the field's own scheduled enemies (`inTotal`) that are 已解决 — knocked
   * down (`killedInTotal`) or leaked (`leakedInTotal`) — never above the denominator `total`. The official reading:
   * 开局 0/3 → 漏一个 1/3 → 打死一个 2/3 → 打死会分裂的 3/3; on a normal round a leaked split child still costs LP
   * (`leakedCount`) and breaks 完美作战, but it is no enemy of the stage's own list and moves no capsule number — and on
   * a 联防 field a runtime spawn is tagged `uniteRuntime` (spawns.js), so the 联防's billing never charges it either.
   */
  get resolved() {
    return Math.min(this.total, this.killedInTotal + this.leakedInTotal);
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Battle<${this.kind} seed=${this.seed} t=${this.time.toFixed(2)} units=${this.units.length}${this.finished ? ' ' + this.reason : ''}>`;
  }
}

// the method modules, in this order (a name defined twice is an error, never a silent override)
for (const part of [BattlePlayers, BattleLifecycle, BattleHooks, BattleSpawns, BattleDeploy, BattleBlocking, BattleStatus, BattleCombat, BattleQueries, BattleSummons, BattleTiles, BattleDisplacement, BattleEconomy, BattleEvents]) {
  for (const key of Reflect.ownKeys(part.prototype)) {
    if (key === 'constructor') continue;
    if (Object.prototype.hasOwnProperty.call(Battle.prototype, key)) throw new Error(`Battle.${String(key)} is defined twice`);
    Object.defineProperty(Battle.prototype, key, Object.getOwnPropertyDescriptor(part.prototype, key));
  }
}

// ---- 对局的数据作用域（W-B, DESIGN §28.16）
// Every entry point a caller can reach the simulation through is SYNCHRONOUS, so the battle's own data (its DataSource
// `source`) is pushed around it and popped again. Two matches in one process interleave BETWEEN steps, never inside
// one, which is why a stack is safe where "set a global before the match" is not (the meta-registry ruling, §29).
for (const name of ['start', 'step', 'runToEnd', 'forceEnd', 'result']) {
  const desc = Object.getOwnPropertyDescriptor(Battle.prototype, name);
  if (!desc || typeof desc.value !== 'function') continue;
  const inner = desc.value;
  Object.defineProperty(Battle.prototype, name, {
    ...desc,
    value: function scopedEntry(...args) {
      return withGameData(dataObjectOf(this.data, this.opts?.modeId), () => withMorphPairing(this.opts?.morphPairing, () => inner.apply(this, args)));
    },
  });
}

export default Battle;
