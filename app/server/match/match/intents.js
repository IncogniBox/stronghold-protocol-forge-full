// server/match/match/intents.js — Match methods: the g.* / b.* intent router (_handle: the prep intents go to
// PlayerState, the drafts, watching, the pause and the battle reports to the match), emotes, AI 托管 (setAutoplay,
// kickBot) and g.unitStats (the stats the board's units start their next battle with: a preview battle, started, read
// and dropped).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { unitStatsEntry } from '../../../shared/protocol.js';
import { PHASE, ERR, EMOTES, EMOTE_COOLDOWN_MS, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { layoutOf } from '../../../shared/layout.js';
import { OK, fail } from './common.js';
import { onHumanEmote } from '../botEmotes.js';

export class MatchIntents {
  _handle(ps, msg) {
    switch (msg.t) {
      case 'g.infoReady':
        if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
        if (this.setupVote) return fail(ERR.WRONG_PHASE, 'setup reroll vote in progress');
        if ((msg.setupRevision ?? 0) !== this.setupRevision) return fail(ERR.BAD_TARGET, 'setup changed; confirm the current revision');
        if (!ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
        return OK;
      case 'g.rerollVote': return this.voteSetupReroll(ps, msg.voteId, msg.agree);
      case 'g.band': return this.pickBand(ps, msg.bandId);
      case 'g.bandSkip': return this.skipBand(ps);
      // the strategy highlighted in the draft screen (what a timed-out turn takes, timeoutBand)
      case 'g.bandFocus': return this.bandFocus(ps, msg.bandId ?? null);
      // 预重构提交（模式扩展-重构模拟，PHASE.PRE_RECON）：盟约倾向 / 首领占位 / 协助与负载占位
      case 'g.reconChoice': return this.reconChoice(ps, msg);
      case 'g.reconTrain': return ps.reconTrain(msg);
      case 'g.reconTrainCancel': return ps.reconTrainCancel(msg);
      case 'g.buy': return ps.buy(msg.slot);
      case 'g.refresh': return ps.refresh();
      case 'g.freeze': return ps.freeze();
      case 'g.levelUp': return ps.levelUp();
      case 'g.sell': return ps.sell(msg.uid);
      // dir: the deploy wheel's facing (DESIGN §3; absent ⇒ PlayerState reads to.dir, then RIGHT)
      case 'g.move': return ps.move(msg.uid, msg.to, msg.dir);
      case 'g.equip': return ps.equip(msg.itemUid, msg.targetUid, msg.replaceUid ?? null);
      case 'g.art': return ps.useArt(msg.itemUid, msg.row, msg.col, msg.dir);
      case 'g.destroy': return ps.destroy(msg.uid);
      // 装备拆卸（行为开关 `unequip: "allow"`，DESIGN §28.43.1）：把一件已装备的装备退回手牌 / 临时整备区。
      // 缺省档下 `PlayerState.unequip` 回的就是 `destroy` 那句 `'equipped items are locked'` ⇒ 这一行在缺省档与
      // 「意图不存在」**行为等价**。
      case 'g.unequip': return ps.unequip(msg.itemUid);
      case 'g.reward': return ps.pickReward(msg.idx);
      case 'g.choice': return msg.choiceId !== undefined
        ? this.pickPersonalChoice(ps, msg.idx, msg.choiceId)
        : this.pickCard(ps, msg.idx);
      // a plugin interaction window (PLUGIN API v2, docs/PLUGINS.md §10b): the window's own id, not a draft card —
      // the host applies the declared primitive, a plugin never reaches the match state itself
      case 'g.offer': return this.requestOffer(ps, msg.offerId, msg.idx, msg);
      case 'g.offerRefresh': return this.requestOfferRefresh(ps, msg.offerId, msg.idx, msg);
      case 'g.ready': return ps.setReady(!!msg.ready);
      case 'g.emote': return this.emote(ps, msg.id);
      // playerId: the player tapped (a shared field names two) — the watch preference (item 56)
      case 'g.watch': return this.watch(ps, msg.fieldId, msg.playerId ?? null);
      case 'g.autoplay': return this.setAutoplay(ps, !!msg.on);
      case 'g.pause': return this.setPause(ps, !!msg.on);
      // the stats the board's units start their next battle with (the detail card in prep, user playtest #4 item 7)
      case 'g.unitStats': return this.unitStats(ps, msg.seq ?? null);
      case 'g.leave': this.onLeave(ps.playerId); return OK;
      // dev 通道：本地调试 / 开发者面板（仅 SP_DEV=1 或本局 Match.dev；见 shared/protocol.js 'g.dev'）
      case 'g.dev': return this.devEdit(ps, msg);
      // the client could not merge an incremental m.public frame and asks for the full one again
      // (DESIGN §8.2 "incremental frame", the self-healing ask; shared/protocol.js 'g.publicFull')
      case 'g.publicFull': return this.resendPublic(ps.playerId);
      case 'g.test': return this.applyTestCommand(ps, msg);
      case 'b.progress': return this._onProgress(ps, msg);
      case 'b.result': return this._onResult(ps, msg);
      // the host's answer to a delegated bot layout rehearsal (DESIGN §14): a report, never an error — an unknown,
      // expired or foreign task is ignored (MatchRehearsal._onRehearsalResult)
      case 'b.rehearsalResult': this._onRehearsalResult(ps, msg); return OK;
      default: return fail(ERR.BAD_MSG);
    }
  }

  /**
   * `g.dev` — 本地调试 / **开发者面板**指令（本 Forge 发行版自加，非上游协议）。两种门禁：
   *   * `process.env.SP_DEV === '1'`：只认旧形状 `{ funds }`（浏览器控制台 `__SP__.net.send('g.dev', { funds: 1000 })`）；
   *   * `this.dev === true`（「全量模拟」对局）：认 action 化形状（`shared/protocol.js DEV_ACTIONS`）。
   * 其它情况一律 `BAD_MSG`（默认关闭；**切勿**在对外 / 公网服务器上开启 —— 任何连上来的客户端都能因此改这一局）。
   */
  devEdit(ps, msg) {
    const devMatch = this.dev === true;
    const legacy = process.env.SP_DEV === '1';
    if (!devMatch && !legacy) return fail(ERR.BAD_MSG, 'dev channel disabled');
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const action = msg.action ?? 'funds';
    // 旧形状（浏览器控制台）：`{ funds }` —— SP_DEV 与 dev 对局都认
    if (action === 'funds' || (!devMatch && msg.funds !== undefined)) {
      if (!Number.isInteger(msg.funds) || msg.funds === 0) return fail(ERR.BAD_TARGET, 'bad funds');
      const delta = ps.addFunds(msg.funds, { reason: 'dev' });
      // English by design: a dev-only line stays out of the i18n catalogue (test/i18n.test.js requires every Chinese
      // user-facing literal to be a wrapped msgid in public/i18n/en.js).
      this.toast(ps, 'info', `[DEV] funds ${delta >= 0 ? '+' : ''}${delta} -> ${ps.funds}`);
      return OK;
    }
    if (!devMatch) return fail(ERR.BAD_MSG, 'dev channel disabled (this match is not a dev match)');
    switch (action) {
      case 'lp': {
        if (!Number.isInteger(msg.lp)) return fail(ERR.BAD_TARGET, 'bad lp');
        ps.lp = Math.max(0, Math.min(99, msg.lp));
        ps.dirty();
        this.markPublic();
        return OK;
      }
      case 'shopLevel': {
        if (!Number.isInteger(msg.shopLevel)) return fail(ERR.BAD_TARGET, 'bad shopLevel');
        ps.shop.level = Math.max(1, Math.min(this.gd.maxShopLevel, msg.shopLevel));
        ps.rollShop();
        return OK;
      }
      case 'shopSlots': {
        if (!Number.isInteger(msg.chessSlots) && !Number.isInteger(msg.itemSlots)) return fail(ERR.BAD_TARGET, 'bad shopSlots');
        const lvl = String(ps.shop.level);
        const cur = { ...(this.gd.shopSlotOverride || {}) };
        cur[lvl] = {
          ...(cur[lvl] || {}),
          ...(Number.isInteger(msg.chessSlots) ? { chess: msg.chessSlots } : {}),
          ...(Number.isInteger(msg.itemSlots) ? { item: msg.itemSlots } : {}),
        };
        this.gd.shopSlotOverride = cur;
        ps.rollShop();
        return OK;
      }
      case 'layers': {
        if (typeof msg.bondId !== 'string' || !Number.isInteger(msg.layers)) return fail(ERR.BAD_TARGET, 'bad layers');
        ps.addLayers(msg.bondId, msg.layers, { reason: 'dev' });
        this.markPublic();
        return OK;
      }
      case 'band': {
        if (typeof msg.bandId !== 'string' || !this.gd.bandAllowed(msg.bandId)) return fail(ERR.BAD_TARGET, 'bad bandId');
        ps.bandId = msg.bandId;
        ps.recompute();
        this.markPublic();
        return OK;
      }
      case 'item': {
        if (typeof msg.itemId !== 'string' || !this.gd.item(msg.itemId)) return fail(ERR.BAD_TARGET, 'bad itemId');
        if (!ps.acquireItem(msg.itemId, { source: 'dev', requirePool: false })) return fail(ERR.BAD_TARGET, 'item not granted (bench full)');
        return OK;
      }
      case 'grantChess': {
        if (typeof msg.chessId !== 'string' || !this.gd.chess(msg.chessId)) return fail(ERR.BAD_TARGET, 'bad chessId');
        const piece = ps.acquireChess(msg.chessId, { source: 'dev', fromPool: false });
        if (!piece) return fail(ERR.BAD_TARGET, 'operator not granted (bench full)');
        // 数值覆盖随这个棋子进战斗（`piece.meta.data.devExt` → `u.pieceData`，由 dev-ext 包的服务端战斗逻辑读它挂 mods）
        if (msg.overrides && typeof msg.overrides === 'object' && Object.keys(msg.overrides).length) {
          if (!piece.meta) piece.meta = {};
          piece.meta.data = { ...(piece.meta.data || {}), devExt: msg.overrides };
          ps.dirty();
        }
        return OK;
      }
      case 'spawnEnemy': {
        if (typeof msg.enemyKey !== 'string' || !this.gd.enemy(msg.enemyKey)) return fail(ERR.BAD_TARGET, 'bad enemyKey');
        const count = Number.isInteger(msg.count) && msg.count > 0 ? msg.count : 1;
        // 路线：本回合波次表自带的那几条（试验场的地图设计器里画的就是它们）。多次添加按顺序轮着走 ——
        // 优先用面板显式给的 `routeIndex`（形状层已判 0..7），否则取「下一条路线」（0、1、2… 循环）。
        const routes = Array.isArray(this.wave && this.wave.routes) ? this.wave.routes : [];
        const routeIndex = Number.isInteger(msg.routeIndex) || !routes.length
          ? Math.max(0, Math.min(routes.length ? routes.length - 1 : 0, msg.routeIndex ?? 0))
          : this.devExtraEnemies.length % routes.length;
        this.devExtraEnemies.push({ enemyKey: msg.enemyKey, time: 0, count, interval: 2, routeIndex });
        if (msg.overrides && typeof msg.overrides === 'object') this.devEnemyOverrides[msg.enemyKey] = msg.overrides;
        this.markPrivate(ps);
        return OK;
      }
      case 'enemyOverride': {
        if (typeof msg.enemyKey !== 'string' || !this.gd.enemy(msg.enemyKey)) return fail(ERR.BAD_TARGET, 'bad enemyKey');
        if (msg.overrides && typeof msg.overrides === 'object') this.devEnemyOverrides[msg.enemyKey] = msg.overrides;
        this.markPrivate(ps);
        return OK;
      }
      // 场景相关：换这一局的地图（**立刻**生效：地图与部署区都跟着换）
      case 'stage': {
        if (typeof msg.stageId !== 'string' || !this.gd.stage(msg.stageId)) return fail(ERR.BAD_TARGET, 'bad stageId');
        this.stageId = msg.stageId;
        this.stage = this.gd.stage(msg.stageId);
        this.layout = layoutOf(this.stage);
        // 部署图是按当时那张图算出来的：换了图必须让它重算（与编辑器 SP_STAGE 那条覆盖同一步）
        for (const p of this.players.values()) { p.invalidateDeployMap?.(); p.recompute?.(); }
        this.markPublic();
        // 重新发一次自己的场地帧：客户端照新的 stageId 重画地图（只影响 prep 视图，不改本回合的出怪表）
        for (const p of this.players.values()) {
          if (!p.alive) continue;
          try { this._sendField?.(p.playerId, `n:${p.playerId}`); } catch { /* the prep view is best-effort */ }
        }
        return OK;
      }
      // 场景相关：下一回合打**普通**还是**首领**（`phases.js startRound` 消费这个一次性开关）
      case 'roundKind': {
        if (msg.kind !== 'normal' && msg.kind !== 'boss') return fail(ERR.BAD_TARGET, 'bad kind');
        this.devRoundKind = msg.kind;
        this.markPublic(); // 让面板看到「已武装」（m.public.devNextKind）
        this.toast(ps, 'info', `[DEV] next round: ${msg.kind}`);
        return OK;
      }
      // 场景相关：替换首领场景正中的首领（本场最终攻势 / 隐秘核心的领袖），并可选地改它的数值
      case 'boss': {
        if (typeof msg.bossId !== 'string' || !this.gd.boss(msg.bossId)) return fail(ERR.BAD_TARGET, 'bad bossId');
        this.bossId = msg.bossId;
        // 隐秘核心那一场用的是**另一只**领袖（hiddenBossId）：本回合就是核心回合时一并替换
        if (this.round === this.gd.hiddenRound && this.gd.hiddenRound !== this.gd.bossRound) this.hiddenBossId = msg.bossId;
        if (msg.overrides && typeof msg.overrides === 'object') {
          this.devBossOverrides[msg.bossId] = msg.overrides;
          // 血条（共享血量池）立刻跟着改；领袖单位的 atk/def/res 由这一场的 `enemyOverrides` 在开战时生效
          const st = msg.overrides.stats && typeof msg.overrides.stats === 'object' ? msg.overrides.stats : null;
          if (st && Number.isFinite(st.maxHp) && this.bossPool) {
            this.bossPool.maxHp = Math.max(1, Math.round(st.maxHp));
            if (this.bossPool.hp > this.bossPool.maxHp) this.bossPool.hp = this.bossPool.maxHp;
            this._broadcastPool(true);
          }
        }
        // 本回合已经是首领回合（官方或已被强制）：立刻按新首领重排配对与波次；否则作用于下一场首领战
        const r = this.round;
        if (r === this.gd.bossRound || r === this.devBossRound) {
          this._planBossWaves();
          this.markPublic();
          for (const p of this.players.values()) this.markPrivate(p);
        }
        this.toast(ps, 'info', `[DEV] boss: ${msg.bossId}`);
        return OK;
      }
      default: return fail(ERR.BAD_MSG, 'unknown dev action');
    }
  }

  emote(ps, id) {
    if (!EMOTES.includes(id)) return fail(ERR.BAD_MSG, 'unknown emote');
    const now = this.sched.now();
    if (now - ps.lastEmoteAt < EMOTE_COOLDOWN_MS) return fail(ERR.RATE);
    ps.lastEmoteAt = now;
    this.broadcast({ t: 'm.emote', playerId: ps.playerId, id });
    // an AI teammate can react to a human's emote (enabled by default: server/match/botEmotes.js, SP_BOT_EMOTES=0 silences it)
    onHumanEmote(this, ps.playerId, id);
    return OK;
  }

  setAutoplay(ps, on) {
    if (ps.autoplay === on) return OK;
    ps.autoplay = on;
    this.markPublic();
    if (on) this.kickBot(ps);
    return OK;
  }

  /** Let the bot act for a (newly) bot-controlled seat in the current phase. */
  kickBot(ps) {
    if (!ps.botControlled || this.ended) return;
    this.offersChanged();
    if (this.phase === PHASE.INFO_CHECK && !ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
    else if (this.phase === PHASE.BAND_DRAFT && this.draftTurn() === ps.playerId) this.scheduleBandBot();
    else if (this.phase === PHASE.SP_DRAFT && this.spTurn() === ps.playerId) this.scheduleSpBot();
    else if (this.phase === PHASE.PREP && ps.alive && !ps.ready) this.scheduleBotPrep(ps, 0);
  }

  /**
   * g.unitStats { seq? } (user playtest #4 item 7: the detail card showed fixed record stats): the stats every unit of
   * the player's board will fight with at the start of its next battle — equipment, bonds and their layers, 特质, the
   * band and 机变 effects — computed exactly by the shared sim. The player's battle input after the onBattleStart meta
   * handlers (`ev.preview: true`, no enemies — those handlers must not change the match for a preview) builds a Battle
   * of the battle's options that is started (initial deployment + battleStart hooks), read and dropped: it is never
   * stepped: deployment skills contribute their initial stats but their timers do not advance. No SP / skill timer is
   * sent, and the real battle gets fresh units. Pushed to the player as `m.unitStats { seq, round, units }`
   * (units: shared/protocol.js unitStatsEntry, board operators and summons by uid); cached per input (a build costs
   * ≈ 0.3–0.7 ms). Prep phases only (ROUND_START, 机变, PREP); a battle's live stats come from the browser's own sim.
   * @param {PlayerState} ps @param {number|null} seq echoed (the client keeps the newest answer)
   */
  unitStats(ps, seq = null) {
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.phase !== PHASE.ROUND_START && this.phase !== PHASE.SP_DRAFT && this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    const units = this._unitStatsOf(ps);
    this.sendTo(ps.playerId, { t: 'm.unitStats', seq: Number.isInteger(seq) ? seq : null, round: this.round, units });
    return OK;
  }

  /** The start-of-battle stats of a player's board units (see unitStats); [] when the preview battle cannot be built. */
  _unitStatsOf(ps) {
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    const ev = { input, kind: 'normal', round: this.round, preview: true };
    this.dispatch(ps, 'onBattleStart', ev);
    const players = [ev.input && typeof ev.input === 'object' ? ev.input : input];
    let key = null;
    try { key = JSON.stringify([this.round, this.stageId, this.battleContent, players]); } catch { key = null; }
    if (!this._unitStatsCache) this._unitStatsCache = new WeakMap(); // PlayerState → { key, units } (the last preview)
    const cached = this._unitStatsCache.get(ps);
    if (key && cached && cached.key === key) return cached.units;
    const units = [];
    // the flags of the battle it previews: a normal round gains IN_BATTLE layers from its start (a <战斗开始时> layer gain
    // raises bond stats at t = 0 there too); the Final Assault / Hidden Core fight without (previewed as a normal field)
    const bossRound = this.round === this.gd.bossRound || this.round === this.gd.hiddenRound;
    const b = this.newBattle({
      seed: deriveSeed(this.seed, `preview:${this.round}:${ps.seat}`), kind: 'normal', modeId: this.modeId, round: this.round,
      stageId: this.stageId, rect: { ...this.layout.battle.normal }, timeLimit: 60, players, spawns: [], routes: this.wave ? this.wave.routes : [],
      sharedBoss: null, flags: { layerGainsEnabled: !bossRound, ...this.gd.dp }, fieldId: `n:${ps.playerId}`, recordEvents: false,
    });
    try {
      if (typeof b.start === 'function') b.start();
      for (const u of Array.isArray(b.allyUnits) ? b.allyUnits : []) {
        if (u && Number.isInteger(u.uid) && (u.kind === 'op' || u.kind === 'token')) units.push(unitStatsEntry(u, u.s));
      }
    } catch (e) { this.reportError('unitStats', e); }
    this._unitStatsCache.set(ps, { key, units });
    return units;
  }
}
