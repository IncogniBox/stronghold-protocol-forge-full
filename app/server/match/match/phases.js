// server/match/match/phases.js — Match methods: the round flow up to the prep — INFO_CHECK, the strategy draft
// (BAND_DRAFT: one countdown of BAND_TURN_SECONDS per turn, 队友已选, the highlighted strategy on a timeout, skips),
// BATTLE_CHECK and ROUND_START (the round's enemies — a normal wave or the boss pairing — planned before the players'
// round start).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { msg } from '../../../shared/i18n.js';
import { buildNormalWave, buildBossWave } from '../waves.js';
import { pairPlayers } from '../finalAssault.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { botPickBand } from '../bot.js';
import { OK, fail, DELAYS, BAND_TURN_SECONDS } from './common.js';

/**
 * 「试玩时直接发到手上」—— 哪些干员要在第一回合进手牌（业主 2026-10-08 提的开关）。
 *
 * 为什么只在试玩里生效：工坊/助战干员的正规来路是**商店**（0.5.0 起「不白送」，见 docs/WORKSHOP.md §2.3），
 * 直接把牌塞进手里会让正式对局的规则变形。作者真正要的是「试玩时立刻拿它开一局」，所以这里读的是编辑器
 * spawn 出来的那个一次性服务器进程的环境变量（`SP_PLAYTEST=1`，editor/playtest.mjs 设的）：
 * **正式服务器一个都不发** —— 即使装了一个声明了这个开关的包，`SP_PLAYTEST` 也不是 `1`。
 *
 * 名单是**两个来源的并集**：
 *   ① 记录里自带 `directToHand: true` 的（非覆盖的工坊件；今天的写法，向后兼容，一个字都没改）；
 *   ② `pack.json.playtest.directToHand` 声明的（覆盖模式靠这条 —— 覆盖时记录必须与官方同形，
 *      `directToHand` 那个键写不进去，见 editor/server.mjs 的 `stripEditorOnlyKeys`）。
 * ②由编辑器在 `/api/playtest/start` 算出来，经 `SP_DIRECT_TO_HAND=<逗号分隔 id>` 交给子进程（与 `SP_STAGE` 同一条路）。
 *
 * 名单里一个 `visibleChess` 里没有的 id 只是**不出现在结果里**，不抛错：那是声明侧该拦的事
 * （`PLAYTEST_UNKNOWN_CHESS`），引擎不该为了一个坏 id 把一局打不开。
 *
 * 取牌走 `PlayerState.poolOf` —— 唯一分派点（design-level A, docs/PS100-MIGRATION.md §10-A）：`≤ MAX_SEATS` 时它就是共享池
 * （同一个 `m.pool` 对象），座位变体打开时是本玩家自己的池。两种情况下「池里那一份」都是真的被拿走的 —— 与开局礼包不同，
 * 这里不会凭空多出一份拷贝。
 * @param {object} gd 这一局的 GameData
 * @param {Record<string, string|undefined>} [env] 默认 `process.env`（单测直接喂一个假环境）
 * @returns {string[]} 可见、非精锐、且被两个来源之一点名的干员 id
 */
export function directToHandIds(gd, env = process.env) {
  if (String((env && env.SP_PLAYTEST) || '') !== '1') return [];
  const fromEnv = new Set(
    String((env && env.SP_DIRECT_TO_HAND) || '').split(',').map((s) => s.trim()).filter(Boolean),
  );
  return ((gd && gd.visibleChess) || []).filter((id) => {
    const rec = gd.chess(id);
    if (!rec || rec.isGolden) return false;
    return rec.directToHand === true || fromEnv.has(id);
  });
}

export class MatchPhases {
  enterInfoCheck() {
    this.phase = PHASE.INFO_CHECK;
    for (const ps of this.order) if (ps.botControlled) ps.infoReady = true;
    // solo: no time limit (the player confirms); co-op: the official 25 s guard
    this.setDeadline(this.soloUntimed ? 0 : this.gd.timer('infoCheck'), () => this.enterBandDraft());
    this.markPublic();
    for (const ps of this.order) this.markPrivate(ps);
    this.flush(true);
    this.maybeEndInfo();
  }

  maybeEndInfo() {
    if (this.phase !== PHASE.INFO_CHECK || this.setupVote || this._infoAdvanceTimer) return;
    if (this.order.every((p) => p.isBot || p.left || p.infoReady)) {
      this.setDeadline(0);
      this._infoAdvanceTimer = this.later(0, () => {
        this._infoAdvanceTimer = null;
        if (this.phase === PHASE.INFO_CHECK && !this.setupVote) this.enterBandDraft();
      });
    }
  }

  /**
   * The strategy draft (user playtest #4 item 4): ONE countdown — every turn has the same clock, BAND_TURN_SECONDS, and
   * m.public.deadline is the current turn's end (= draft.turnDeadline; the step header and the turn indicator show the
   * same number). No separate step cap: the turns bound the step (≤ (seats + skips) × turn). AI seats pick at once. A
   * turn that runs out takes the strategy the player has highlighted (g.bandFocus) while it is free, else the default
   * (timeoutBand). Solo, and any single-human match (soloUntimed): untimed. Solo also keeps seat order and has no skip.
   */
  enterBandDraft() {
    if (this.phase !== PHASE.INFO_CHECK) return;
    this.phase = PHASE.BAND_DRAFT;
    let order = this.order.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    order = this.humansFirst(order);
    const skips = this.isSolo ? 0 : this.gd.bandDraft.skipsPerPlayer;
    const untimed = this.soloUntimed;
    this.draft = {
      order, idx: 0, picks: {}, skipsLeft: Object.fromEntries(order.map((pid) => [pid, skips])), untimed, turnDeadline: 0,
      /** playerId → the strategy highlighted in the draft screen (g.bandFocus) */
      focus: new Map(),
    };
    this.setDeadline(0);
    this.startDraftTurn();
    this.markPublic();
  }

  /**
   * The co-op room option 「AI 队友最后选择」 (this.aiPicksLast, GitHub #338): every human seat before every AI seat, each
   * group in the order the draft drew (a stable partition applied AFTER the shuffle — no extra random draw: the order
   * with the option off is unchanged, and with it on every random stream stands where it would without it; only the
   * picks made in the new order can differ). A human is any seat that is not an AI seat (room.addBot): under AI 托管,
   * disconnected or departed it still counts as a human. Used by the strategy draft and the 机变 draft
   * (MatchSpDraft.enterSpDraft).
   * @param {string[]} order playerIds in drawn order
   * @returns {string[]}
   */
  humansFirst(order) {
    if (!this.aiPicksLast) return order;
    const bot = (pid) => !!this.players.get(pid)?.isBot;
    return [...order.filter((pid) => !bot(pid)), ...order.filter(bot)];
  }

  draftTurn() {
    const d = this.draft;
    if (!d) return null;
    return d.order[d.idx] ?? null;
  }

  /** Real ms of one strategy-draft turn (BAND_TURN_SECONDS × timerScale). */
  bandTurnMs() { return this.scaled(BAND_TURN_SECONDS * 1000); }

  startDraftTurn() {
    const d = this.draft;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    if (this.test) this.setDeadline(0);
    while (d.idx < d.order.length && d.picks[d.order[d.idx]]) d.idx++; // loop-cap: draft order
    if (d.idx >= d.order.length) {
      d.turnDeadline = 0;
      this.deadline = 0;
      this.later(0, () => this.finishBandDraft(false));
      return;
    }
    const token = ++this._turnToken;
    if (!d.untimed) {
      const ms = this.bandTurnMs();
      d.turnDeadline = this.sched.now() + ms;
      // the step's countdown IS the turn's (one number everywhere)
      this.deadline = d.turnDeadline;
      const expire = () => {
        if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
        const pid = this.draftTurn();
        if (pid) this._applyBand(this.players.get(pid), this.timeoutBand(pid));
      };
      if (this.test) { this.setDeadline(ms / 1000 / (this.timerScale || 1), expire); d.turnDeadline = this.deadline; }
      else this._turnTimer = this.later(ms, expire);
    } else {
      d.turnDeadline = 0;
      this.deadline = 0;
    }
    const cur = this.players.get(this.draftTurn());
    if (cur && cur.botControlled) this.scheduleBandBot();
    this.markPublic();
  }

  /** An AI seat's (or an AI 托管 seat's) turn: it picks at once (user playtest #4 item 4 — nobody waits on the AI). */
  scheduleBandBot() {
    const token = this._turnToken;
    this.later(0, () => {
      if (this.phase !== PHASE.BAND_DRAFT || token !== this._turnToken) return;
      const ps = this.players.get(this.draftTurn());
      if (!ps || !ps.botControlled) return;
      // a strategy a teammate already took is not selectable (队友已选): the bot re-draws, else the first free one
      let id = botPickBand(this, ps);
      for (let k = 0; k < 8 && this.bandTaken(id, ps.playerId); k++) id = botPickBand(this, ps);
      if (this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
      this._applyBand(ps, id, { dedupe: true });
    });
  }

  /**
   * Whether `bandId` was already picked by another player of this draft. Research 09 §5 / DESIGN §14 corrections:
   * the strategy draft marks a teammate's pick as 队友已选 and it cannot be chosen again (co-op). The automatic
   * assignments — a turn that runs out and a departing seat — obey the same rule: see timeoutBand / defaultBand.
   */
  bandTaken(bandId, playerId) {
    const picks = this.draft?.picks || {};
    for (const [pid, id] of Object.entries(picks)) if (pid !== playerId && id === bandId) return true;
    return false;
  }

  /**
   * The strategy an automatic assignment gives `playerId` (a departing seat; a timed-out turn without a usable
   * highlight, timeoutBand): the official default 「华法琳」 (bandDraft.timeoutBandId) while no teammate holds it, else the
   * first strategy of the mode (sortId order, gd.bandIds) that nobody else picked — never a duplicate (队友已选; the
   * client shows the same choice: public/js/screens/bandDraft.js timeoutBand). Solo drafts have no teammates, so it is
   * always the default.
   * @param {string} playerId
   */
  defaultBand(playerId) {
    const def = this.gd.bandDraft.timeoutBandId;
    if (!this.bandTaken(def, playerId)) return def;
    return this.gd.bandIds().find((b) => !this.bandTaken(b, playerId)) || def;
  }

  /**
   * What a turn that runs out assigns (user playtest #4 item 4): the strategy the player has highlighted in the draft
   * screen (g.bandFocus — the detail pane's band, the one 确认选择 would take) while it is allowed and no teammate holds
   * it, else defaultBand.
   * @param {string} playerId
   */
  timeoutBand(playerId) {
    const f = this.draft && this.draft.focus instanceof Map ? this.draft.focus.get(playerId) : null;
    if (typeof f === 'string' && this.gd.bandAllowed(f) && !this.bandTaken(f, playerId)) return f;
    return this.defaultBand(playerId);
  }

  /**
   * g.bandFocus { bandId? }: the strategy the player highlights in the draft screen (any time before its pick; also
   * while waiting for its turn). A missing / null bandId clears it. Only a timed-out turn reads it (timeoutBand).
   */
  bandFocus(ps, bandId) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (!(d.focus instanceof Map)) d.focus = new Map();
    if (bandId == null) { d.focus.delete(ps.playerId); return OK; }
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    d.focus.set(ps.playerId, bandId);
    return OK;
  }

  pickBand(ps, bandId) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    if (this.draft.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (typeof bandId !== 'string' || !this.gd.bandAllowed(bandId)) return fail(ERR.BAD_TARGET);
    if (this.bandTaken(bandId, ps.playerId)) return fail(ERR.BAD_TARGET, '队友已选'); // i18n-ignore: developer detail (players see ERR_TEXT)
    this._applyBand(ps, bandId);
    return OK;
  }

  _applyBand(ps, bandId, { dedupe = false } = {}) {
    const d = this.draft;
    if (!d || !ps || d.picks[ps.playerId]) return;
    let id = this.gd.bandAllowed(bandId) ? bandId : this.defaultBand(ps.playerId);
    if (dedupe && this.bandTaken(id, ps.playerId)) id = this.gd.bandIds().find((b) => !this.bandTaken(b, ps.playerId)) || id;
    d.picks[ps.playerId] = id;
    ps.bandId = id;
    ps.lp = this.gd.startLp(id);
    this.markPrivate(ps);
    this.markPublic();
    this.startDraftTurn();
  }

  skipBand(ps) {
    if (this.phase !== PHASE.BAND_DRAFT || !this.draft) return fail(ERR.WRONG_PHASE);
    const d = this.draft;
    if (this.isSolo) return fail(ERR.WRONG_PHASE, 'no skip in solo');
    if (d.picks[ps.playerId]) return fail(ERR.ALREADY);
    if (this.draftTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!(d.skipsLeft[ps.playerId] > 0)) return fail(ERR.ALREADY, 'no skip left');
    if (d.order.length - d.idx <= 1) return fail(ERR.BAD_TARGET, 'nobody to pass to');
    d.skipsLeft[ps.playerId]--;
    d.order.splice(d.idx, 1);
    // the skipper goes to the end; with 「AI 队友最后选择」 to the end of the humans still to pick — behind them, ahead of
    // the AI seats — and to the very end only when no other human is left to pass to [ASSUMED: the option's intent,
    // humans before AI, kept through a skip; no source, a remake option]
    let at = d.order.length;
    if (this.aiPicksLast) {
      for (let j = d.order.length - 1; j >= d.idx; j--) {
        if (!this.players.get(d.order[j])?.isBot) { at = j + 1; break; }
      }
    }
    d.order.splice(at, 0, ps.playerId);
    this.startDraftTurn();
    return OK;
  }

  finishBandDraft(timeout) {
    if (this.phase !== PHASE.BAND_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    for (const ps of this.order) {
      if (!this.draft.picks[ps.playerId]) {
        // one after another in seat order, so each default sees the ones assigned before it (no duplicates)
        const id = this.defaultBand(ps.playerId);
        this.draft.picks[ps.playerId] = id;
        ps.bandId = id;
        ps.lp = this.gd.startLp(id);
      }
      this.markPrivate(ps);
    }
    void timeout;
    // 重构模拟（模式扩展-重构模拟）：策略选择之后插入「预重构」（盟约倾向 / 首领与协助负载的占位选择）；
    // 其它模式逐字节走今天那条路。
    if (this.gd.isRecon) this.enterPreRecon(); else this.enterBattleCheck();
  }

  /**
   * 预重构（PHASE.PRE_RECON，模式扩展-重构模拟专属，room mode 'recon' ⇒ mode_recon_*）：策略选择之后、协议启动
   * 之前的 60 s（config.timers.preRecon）。玩家在这一屏交 `g.reconChoice`（盟约倾向 / 试炼首领 / 协助与负载 /
   * 自主禁用的盟约）；本局机制按它生效（4/8/12 首领、全局增益/减益、按玩家收窄的卡池）。
   *
   * **两段收尾**（业主 2026-10-26「选择完毕后先看队伍总览，点继续再进入」）：
   *   * 全员提交齐（AI 立刻交空选择）⇒ 进入**总览**（`reconSummary`）：本阶段不结束，等每位在场真人交
   *     `g.reconContinue`；齐了才 `finishPreRecon`。
   *   * 计时耗尽 ⇒ 没交的按「空选择」处理，同时进入总览（`reconDeadline`），再给 15 s 兜底 —— 有人一直不点
   *     也不会把这一局卡死。
   */
  enterPreRecon() {
    if (this.phase !== PHASE.BAND_DRAFT) return;
    this.phase = PHASE.PRE_RECON;
    /** @type {Record<string, { major?: string[], minor?: string[], story?: string|null, bosses?: object|null, assist?: string|null, load?: string|null, ban?: string|null }>} */
    this.reconChoices = {};
    /** 全员交齐后的「队伍总览」：true 时阶段仍停在 PRE_RECON，等真人点继续。 */
    this.reconSummary = false;
    /** 已在总览上点过「继续」的座位（AI 由 enterReconSummary 直接记入）。 @type {Set<string>} */
    this.reconContinues = new Set();
    for (const ps of this.order) if (ps.botControlled) this.reconChoices[ps.playerId] = {};
    this.setDeadline(this.soloUntimed ? 0 : this.gd.timer('preRecon'), () => this.reconDeadline());
    this.markPublic();
    this.flush(true);
    this.maybeEndPreRecon();
  }

  /** 计时耗尽：先切到总览（没交的按空选择），再 15 s 兜底强制进入下一阶段。 */
  reconDeadline() {
    if (this.reconSummary) { this.finishPreRecon(); return; }
    this.enterReconSummary();
    this.later(15000, () => this.finishPreRecon());
  }

  maybeEndPreRecon() {
    if (this.phase !== PHASE.PRE_RECON || this._reconAdvanceTimer || this.reconSummary) return;
    if (this.order.every((p) => p.isBot || p.left || this.reconChoices[p.playerId])) {
      this._reconAdvanceTimer = this.later(0, () => {
        this._reconAdvanceTimer = null;
        if (this.phase === PHASE.PRE_RECON) this.enterReconSummary();
      });
    }
  }

  /** 切到「队伍预重构总览」：选择锁死，等每位在场真人点「继续」（AI 自动算已确认）。 */
  enterReconSummary() {
    if (this.phase !== PHASE.PRE_RECON || this.reconSummary) return;
    this.reconSummary = true;
    for (const ps of this.order) if (ps.isBot) this.reconContinues.add(ps.playerId);
    this.markPublic();
    this.flush(true);
    this.maybeFinishReconSummary();
  }

  /** 总览上点「继续」：记下这名真人；全齐 ⇒ 进入下一阶段。 */
  reconContinue(ps) {
    if (this.phase !== PHASE.PRE_RECON || !this.reconSummary) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.reconContinues.has(ps.playerId)) return OK;
    this.reconContinues.add(ps.playerId);
    this.markPublic();
    this.maybeFinishReconSummary();
    return OK;
  }

  maybeFinishReconSummary() {
    if (this.phase !== PHASE.PRE_RECON || !this.reconSummary) return;
    const waiting = this.order.some((p) => p.alive && !p.left && !p.isBot && !this.reconContinues.has(p.playerId));
    if (!waiting) this.finishPreRecon();
  }

  finishPreRecon() {
    if (this.phase !== PHASE.PRE_RECON) return;
    this.setDeadline(0);
    this.reconSummary = false;
    // 自主禁用（每名玩家自己禁的 1 个盟约）在阶段结束、第 1 回合开打之前生效：只收窄这名玩家自己的卡池
    // （自选编队的库存与商店 / 奖励 / 内容抽卡），不动队友、也不改盟约本身。
    this.applyReconSelfBans();
    this.enterBattleCheck();
  }

  /**
   * `g.reconChoice`：一名玩家在预重构阶段提交（可多次，后到覆盖先到；空选择也是合法提交 —— 表示「看完了，
   * 不另选」）。形状层（shared/protocol.js）已卡过形状；这里只认在场活人。
   */
  reconChoice(ps, msg) {
    if (this.phase !== PHASE.PRE_RECON) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    // 总览已经亮起来 = 全员交齐了：选择锁死（总览展示的就是这一份），不再接受改选。
    if (this.reconSummary) return fail(ERR.WRONG_PHASE);
    const cur = this.reconChoices[ps.playerId] || {};
    this.reconChoices[ps.playerId] = {
      major: msg.major !== undefined ? [...msg.major] : cur.major,
      minor: msg.minor !== undefined ? [...msg.minor] : cur.minor,
      story: msg.story !== undefined ? msg.story : cur.story,
      bosses: msg.bosses !== undefined ? (msg.bosses ? { ...msg.bosses } : null) : cur.bosses,
      assist: msg.assist !== undefined ? msg.assist : cur.assist,
      load: msg.load !== undefined ? msg.load : cur.load,
      ban: msg.ban !== undefined ? msg.ban : cur.ban,
    };
    this.markPublic();
    this.maybeEndPreRecon();
    return OK;
  }

  /**
   * 开发者模式（工坊包 dev-ext 的「全量模拟」，`Match.dev`）：**跳过 INFO_CHECK 与 BAND_DRAFT 两屏**，直接进战斗。
   * 策略按 `finishBandDraft` 的默认逻辑**逐个**分配（座位顺序分配 ⇒ 后一位的默认看得见前一位的选择，不会重复），
   * 再把每位在场玩家标记为「已确认本局信息」，然后走 `enterBattleCheck()` → 第 1 回合 → 休整期/战斗。
   */
  skipToBattle() {
    for (const ps of this.order) {
      const id = this.defaultBand(ps.playerId);
      ps.bandId = id;
      ps.lp = this.gd.startLp(id);
      ps.infoReady = true;
      this.markPrivate(ps);
    }
    this.enterBattleCheck();
  }

  enterBattleCheck() {
    this.phase = PHASE.BATTLE_CHECK;
    this.setDeadline(this.gd.timer('battleCheck'), () => this.afterBattleCheck(), { silent: this.soloUntimed });
    this.markPublic();
  }

  /**
   * BATTLE_CHECK is over: R1 is about to begin. A plugin window declared at `battleCheck` for this round opens here —
   * "before the round begins", the host's own step first (docs/PLUGINS.md §10b) — and holds R1 back until it closes; a
   * content set without a window continues exactly as before (`openOfferWindow` returns before it touches anything).
   */
  afterBattleCheck() {
    this.startRound(1);
  }

  startRound(r, afterStart = null) {
    // Every round, including boss rounds. [ASSUMED] Expire nonblocking windows at the next round.
    for (const w of this.offerWin) this._closeOffer(w);
    this.offersDispose(); // A test-console round jump must discard the older continuation too.
    const step = () => { this._startRoundAfterOffers(r); afterStart?.(); };
    if (this.openOfferWindow('battleCheck', r) !== 'open') { step(); return; }
    this._offerResume = step;
  }

  _startRoundAfterOffers(r) {
    this.phase = PHASE.ROUND_START;
    this.round = r;
    this.fields = [];
    this.watchers.clear();
    this.unitePlan = null;
    this.uniteResultView = null;
    this.sp = null;
    this.wave = null;
    this.bossWaves = null;
    // 开发者面板（「全量模拟」）追加的敌人与它们的数值覆盖**只在添加的那一个回合**里出现（预览与战斗是同一份列表，
    // 见 views.js nextEnemiesFor / combat.js _normalOpts）：新回合开始即清空。
    this.devExtraEnemies = [];
    this.devEnemyOverrides = Object.create(null);
    const alive = this.alivePlayers();
    // the round's enemies (shared composition, generated now so the prep preview is exact). Planned BEFORE the players'
    // round start: its recompute() checks the board on the field the player deploys on this round (deployFieldOf reads
    // the boss pairing), so R14 → R15 never re-checks a boss-field board against the normal field (user playtest #5
    // item 7). rngWaves is used only here, so the order leaves every random stream unchanged.
    // 开发者面板「场景相关」：一次性强制的战斗类型（消费后清空）；否则按模式的 首领 / 隐秘核心 回合
    const forcedKind = this.devRoundKind;
    this.devRoundKind = null;
    // 强制首领：记下「这一个回合号是首领回合」（endPrep / _planBossWaves / m.public 都按这个号判定）；强制普通则清掉覆盖
    this.devBossRound = forcedKind === 'boss' ? r : null;
    const isBoss = forcedKind ? forcedKind === 'boss' : (r === this.gd.bossRound || r === this.gd.hiddenRound);
    if (isBoss) {
      this._planBossWaves();
    } else {
      // stageId: a workshop stage may bind its own wave table to a round (shared/waveAuthoring.js; waves.js buildNormalWave)
      // 「全量模拟」回合数无限（首领战打完不结算）：超出试验场绑定范围的回合沿用**最后一个有绑定的回合**那条波次，
      // 出怪才始终只有面板加的那些（否则 >15 的回合会退回模式的官方波次）
      this.wave = buildNormalWave(this.gd, this.rngWaves, this.factions, this.devWaveRound(r), this.stageId);
    }
    // 重构模拟的「试炼首领」（模式扩展-重构模拟，reconTrials.js）：预重构里选定的那一只「·重构」由本局**最靠前的
    // 座位**的合法选择定下（没人交 ⇒ 从独占种子流抽一只），作为**普通敌人**追加进这一回合的出怪表（预览与战斗是
    // 同一份列表 —— combat.js _normalOpts / views.js nextEnemiesFor），与开发者面板的 devExtraEnemies 逐条同形、
    // 同一回合有效。首领回合（isBoss）不追加：它的出怪表另有来源。**官方对局连这一格都不写**（`this.gd.isRecon`
    // 为假 ⇒ 不赋值，读点全走缺省路径）。注意：这一步不消费任何既有随机流（reconTrialBossFor 自带一口流）。
    if (this.gd.isRecon) this.reconTrialSpawns = this.reconTrialSpawnsFor(r, isBoss);
    for (const ps of alive) ps.startRound(r);
    // 助战 (shared/support.js): re-check what each player brought against the pool ONE more time at the first round's
    // start and record what it really got (data/support.json can change between the lobby check and here). Nothing is
    // handed out: the operators are in the shop (Match.supportSupply puts them in the pool), priced like any other
    // piece — `granted` is what the player can actually buy, which is what the client echoes back.
    if (r === 1) for (const ps of alive) ps.prepareSupports();
    // 「试玩时直接发到手上」（记录里的 `directToHand`，或 `pack.json.playtest.directToHand`，业主 2026-10-08）：
    // 只有编辑器 spawn 的试玩服务器会发牌（见 directToHandIds）
    if (r === 1) this.grantDirectToHand(alive);
    for (const ps of alive) this.dispatch(ps, 'onRoundStart', { round: r });
    // an eliminated player's pending 信标 gift still goes to its teammate (effects flagged afterElimination; GitHub #86)
    for (const ps of this.order) {
      if (ps.alive) continue;
      try { this.dispatcher.dispatchEliminated(ps, 'onRoundStart', { round: r }); } catch (e) { this.reportError('dispatch onRoundStart (eliminated)', e); }
    }
    for (const ps of alive) ps.recompute();
    this.setDeadline(DELAYS.ROUND_START / 1000, () => this.afterRoundStart(), { silent: this.soloUntimed });
    this.markPublic();
    // eliminated humans and spectator seats scout the board of the player they follow through the round's prep, not
    // their own empty board (community report of 2026-10-06, item 56; MatchWatch._followScout)
    for (const ps of this._viewers()) this._followScout(ps);
  }

  /**
   * @param {Array<object>} players 这一局的人类席位
   */
  grantDirectToHand(players) {
    const ids = directToHandIds(this.gd, process.env);
    if (!ids.length) return;
    for (const ps of players) {
      if (!ps || ps.isBot) continue;
      const got = [];
      for (const id of ids) {
        const slot = ps.hand.findIndex((x) => x == null);
        if (slot < 0) break;
        try {
          const rec = this.gd.chess(id);
          const base = this.gd.baseIdOf(id);
          // 份数走 `PlayerState.poolOf` —— 唯一分派点（design-level A, docs/PS100-MIGRATION.md §10-A）：自选槽走本人 stock、
          // 100 座变体走本玩家自己的池，≤ MAX_SEATS 时它就是 `this.pool` 本身（同一个对象上的同一条语句）。
          // 从共享目录直接 take 会让变体下的目录 `left < cap`，正是变体要消灭的东西。
          const taken = ps.poolOf(base).take(base, rec && rec.isGolden ? this.gd.goldenCopies : 1);
          ps.hand[slot] = ps.newPiece('chess', id, { poolCopies: taken });
          got.push(id);
        } catch (e) {
          this.reportError?.(`directToHand ${id}`, e);
        }
      }
      if (got.length) {
        // 让作者一眼看到「试玩直接发牌」生效了（试玩服务器是编辑器起的，不会有人误解成正式对局）
        this.toast(ps, 'ok', msg('试玩：标了「直接发到手上」的 {0} 名干员已进手牌', { 0: got.length }));
      }
      ps.recompute?.();
      ps.dirty?.();
    }
  }

  /** Stable per-match pairs and their templates, generated before the prep preview / board validation. */
  _planBossWaves() {
    const r = this.round;
    // 开发者面板强制的首领回合：本回合号在官方表里没有首领模板，取**官方首领回合**那一套（模板 / 波次 / 血量）
    const wr = this.devBossRound === r ? this.gd.bossRound : r;
    const bossId = r === this.gd.hiddenRound && r !== this.gd.bossRound ? this.hiddenBossId : this.bossId;
    // 重构模拟的 R20 预选：波次仍按通常抽到的首领取模板，只把首领本体的 spawn 换成「·重构」
    const reconKey = this.gd.isRecon && r === this.gd.bossRound ? this.reconBossSpawnKeyFor(r) : null;
    // Pairing uses an independent seeded draw, consuming no shop, wave, draft or battle randomness.
    const groups = pairPlayers(this.alivePlayers(), createRng(deriveSeed(this.seed, 'boss-pairs')), this.bossPairs);
    this.bossPairs = groups.map(g => g.map(p => p.playerId));
    this.bossWaves = groups.map((g) => ({
      players: g.map((p) => p.playerId),
      wave: this.reconBossWaveFor(r, buildBossWave(this.gd, this.rngWaves, this.factions, wr, { bossId, solo: this.isSolo || g.length === 1 }, this.stageId)),
    }));
    // 首领战自身的 id（HUD / 血池）也切到候选那一只：pack 记录不在 bosses 表里时按 500000 的池子兜底
    if (reconKey) this.bossId = reconKey;
  }

  /**
   * 「全量模拟」的波次回合号：试验场把所有回合都绑到空波次表，但 `stage.rounds` 的键只到 15，回合数无限后
   * （>15）沿用**最后一个有绑定的回合**那条 —— 出怪才始终只有面板加的那些。非 dev 对局原样返回（逐字节不变）。
   */
  devWaveRound(r) {
    if (!this.dev) return r;
    const stage = this.gd.stage(this.stageId);
    const rounds = stage && stage.rounds;
    if (!rounds || typeof rounds !== 'object') return r;
    if (rounds[String(r)]) return r;
    const below = Object.keys(rounds).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < r);
    return below.length ? Math.max(...below) : r;
  }

  afterRoundStart() {
    if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
    else this.beforePrepOffers();
  }

  beforePrepOffers() {
    // The official round start and its draw/draft finish first; only entering prep waits.
    this.sp = null;
    const step = () => this.enterPrep();
    if (this.openOfferWindow('prep', this.round) !== 'open') { step(); return; }
    this._offerResume = step;
  }
}
