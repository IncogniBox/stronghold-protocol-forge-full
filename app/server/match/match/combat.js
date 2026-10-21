// server/match/match/combat.js — Match methods: the battles of a normal round — Battle construction (newBattle, the
// spawn list sanitised, a player's normal field after the onBattleStart handlers), the COMBAT phase in both modes
// (server-run streaming, client-side combat), the per-field results and the sim-error log, then 联防 or SETTLE.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO } from '../../../shared/constants.js';
import { boardRectOf } from '../../../shared/layout.js';
import { deriveSeed } from '../../sim/rng.js';
import { withBounties, bountySpawns } from '../waves.js';
import { planUnite } from '../unite.js';
import { FieldRunner, DeadBattle } from '../fields.js';
import { DELAYS } from './common.js';
import { battleOptsFromMatch } from './battleOpts.js';
import { previewPlayer } from '../preview.js';
import { morphBattleOpt } from '../../../shared/plugins/rules.js';

export class MatchCombat {
  /** Construct a battle; a constructor failure yields a finished stand-in (clean result) and is logged. */
  newBattle(opts, { preview = false } = {}) {
    // The assembly both Battle paths share (server/match/match/battleOpts.js): `this.ds` / `this.battleContent` /
    // `this.log` under the caller's own options, then the match's kit tables (`kits`, `tokenKits` — docs/WORKSHOP.md
    // §4 / §4.7, the room-trimmed `roomAssets.forRoom(room.modSet)` maps), the pack's battle installers
    // (DESIGN §28.17) and the 限伤 override. An explicit opts.<key> always wins; a match without packs sets no key, so
    // a plain install builds byte-for-byte the battle it built before each feature landed. `_specBattle` (复算) calls
    // the same helper, so a sixth key cannot reach one path and stop at the other.
    // 上游 0.3.1 的房间规则（`morphBattleOpt(this.rules)`，DESIGN §36.x）：没有这一格时它返回 {}，我们的
    // `owner.morphPairing`（模块层 behaviour）原样保留。
    const full = { ...battleOptsFromMatch(this, opts), ...morphBattleOpt(this.rules),
      ...(preview ? { logger: {}, quiet: true } : {}) };
    try {
      return new this.BattleClass(full);
    } catch (e) {
      if (!preview) this.reportError(`battle ${opts.fieldId} construct`, e);
      return new DeadBattle(full, 'forced');
    }
  }

  /**
   * Spawn list of a field after the onBattleStart handlers (which may edit `ev.spawns`): malformed entries are dropped
   * and a kill bounty is copied into `mods.bountyCoins`, so a leaked bounty enemy keeps paying its killer in 联防.
   */
  _sanitizeSpawns(list, ownerPlayerId = null) {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || typeof s !== 'object' || typeof s.enemyKey !== 'string' || !this.gd.enemy(s.enemyKey)) continue;
      const spec = { ...s, mods: s.mods && typeof s.mods === 'object' ? { ...s.mods } : {} };
      if (ownerPlayerId && spec.ownerPlayerId == null) spec.ownerPlayerId = ownerPlayerId;
      const coins = spec.bounty && typeof spec.bounty === 'object' ? Math.trunc(Number(spec.bounty.coins) || 0) : 0;
      if (coins > 0 && spec.mods.bountyId == null && spec.mods.bountyCoins == null) spec.mods.bountyCoins = coins;
      out.push(spec);
    }
    return out;
  }

  _normalBattle(ps) { return this.newBattle(this._normalOpts(ps)); }

  /**
   * Battle options of a player's normal field (after the onBattleStart handlers). `side` / `colOffset` are the caller's
   * half of the field: 'L' / 0 for a single-player field (today's numbers, unchanged), and for the second player of a
   * two-half field 'R' + the board's own column shift (set by `_normalPairOpts`).
   */
  _normalOpts(ps, { preview = false, board = ps.board, side = 'L', colOffset = 0 } = {}) {
    const wave = preview ? structuredClone(this.wave) : this.wave;
    if (preview) ps = previewPlayer(ps, board);
    const input = ps.battleInput({ side, colOffset });
    // the client's list: bounty units inserted among their host action's own units, which are re-timed around them
    const spawns = withBounties(this.gd, this.round, wave, ps.bounties, ps.playerId).map((s) => ({ ...s, ownerPlayerId: ps.playerId }));
    // 开发者模式（「全量模拟」）：面板「添加至怪物预览区」追加的敌人 —— 与预览同一份列表（match/views.js
    // nextEnemiesFor），在 onBattleStart 之前插入，让这一回合的战斗真的带着它们出现。
    if (Array.isArray(this.devExtraEnemies) && this.devExtraEnemies.length) {
      for (const s of this.devExtraEnemies) spawns.push({ ...s, ownerPlayerId: ps.playerId });
    }
    // 重构模拟的「试炼首领」（reconTrials.js）：这一回合的·重构首领也是**普通敌人**，与 devExtraEnemies 并排插进同一
    // 份列表（`this.reconTrialSpawns` 只在重构对局里被 phases.startRound 赋值 ⇒ 官方对局取到 undefined，跳过）。
    if (Array.isArray(this.reconTrialSpawns) && this.reconTrialSpawns.length) {
      for (const s of this.reconTrialSpawns) spawns.push({ ...s, ownerPlayerId: ps.playerId });
    }
    const ev = { input, kind: 'normal', round: this.round, spawns, ...(preview ? { preview: true } : {}) };
    // Preview construction failures go to the rehearsal's discard path, never Match.dispatch's live error sink.
    if (preview) this.dispatcher.dispatch(ps, 'onBattleStart', ev);
    else this.dispatch(ps, 'onBattleStart', ev);
    // 开发者模式的数值覆盖并进这一场的 `enemyOverrides`（wave 自带的优先，面板的补在后面）
    const enemyOverrides = { ...(wave.overrides && typeof wave.overrides === 'object' ? wave.overrides : {}), ...(this.devEnemyOverrides || {}) };
    return {
      seed: deriveSeed(this.seed, `n:${this.round}:${ps.seat}`),
      kind: 'normal',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...this.layout.battle.normal },
      timeLimit: wave.timeLimit,
      players: [ev.input && typeof ev.input === 'object' ? ev.input : input],
      spawns: this._sanitizeSpawns(Array.isArray(ev.spawns) ? ev.spawns : spawns, ps.playerId),
      routes: wave.routes,
      sharedBoss: null,
      flags: { layerGainsEnabled: true, ...this.gd.dp },
      fieldId: `n:${ps.playerId}`,
      enemyOverrides,
      waveId: wave.templateId,
      // 限伤 override for the CLIENT-run spec (shared/constants.js bossHitLimitFrom): only present when a deployment
      // set it, so an unconfigured server sends byte-for-byte the old spec (and server/sim/spec.js is left untouched
      // by the key's absence).
      ...(this.bossHitLimit === undefined ? {} : { bossHitLimit: this.bossHitLimit }),
    };
  }

  /**
   * The field id of an ordinary field: `n:<playerId>` for a lone player (unchanged), `n:<L>+<R>` for a pair field on a
   * map whose ordinary band is a mirrored pair (the two ids in side order, so the id identifies the pair).
   */
  _normalFieldId(group) { return `n:${group.map((x) => x.ps.playerId).join('+')}`; }

  /** Battle options of one ordinary field (a lone player, or a pair on a two-half map). */
  _normalGroupOpts(group, opts = {}) {
    if (group.length > 1) return this._normalPairOpts(group, opts);
    return { ...this._normalOpts(group[0].ps, opts), fieldId: this._normalFieldId(group) };
  }

  /** The column shift the mirrored right half of an ordinary field gets: its board's own width − 1. */
  dualColOffset() { return Math.max(0, boardRectOf(this.layout, 'normalL').cols - 1); }

  /**
   * Battle options of a **two-player ordinary field** (业主 2026-10-21「普通对战部署区左右各一位玩家同时在场的」): the two
   * players of one pair fight on the same field, each on its own half of the map's ordinary band. Shaped like a boss
   * field (bossRounds.js startFinalAssault): ONE spawn list shared by both (the round's wave, plus each player's own
   * bounties on its half), every player's onBattleStart handler editing it in place, `side` + `colOffset` per input.
   */
  _normalPairOpts(group, { preview = false } = {}) {
    const wave = preview ? structuredClone(this.wave) : this.wave;
    // the round's own units, one copy per field (a boss field's list); each player's bounties follow its own half
    const spawns = (wave && Array.isArray(wave.spawns) ? wave.spawns : []).map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    const mid = this.layout.mirrorCol / 2;
    for (const { ps, side } of group) {
      for (const b of bountySpawns(this.gd, this.round, wave, ps.bounties, ps.playerId, { side, mid })) spawns.push(b);
    }
    const ownerId = group[0].ps.playerId;
    // 开发者模式（「全量模拟」）追加的敌人与重构模拟的「试炼首领」：与单人对局一样并进这一场的 spawns（同一条列表）
    if (Array.isArray(this.devExtraEnemies) && this.devExtraEnemies.length) {
      for (const s of this.devExtraEnemies) spawns.push({ ...s, ownerPlayerId: ownerId });
    }
    if (Array.isArray(this.reconTrialSpawns) && this.reconTrialSpawns.length) {
      for (const s of this.reconTrialSpawns) spawns.push({ ...s, ownerPlayerId: ownerId });
    }
    const colOffset = this.dualColOffset();
    const inputs = group.map(({ ps, side }, j) => {
      const p = preview ? previewPlayer(ps, ps.board) : ps;
      const input = p.battleInput({ side, colOffset: j === 0 ? 0 : colOffset });
      // `side`: which half of the shared field this player is on (spawn-list edits for one player, like a boss field)
      const ev = { input, kind: 'normal', round: this.round, spawns, side, ...(preview ? { preview: true } : {}) };
      if (preview) this.dispatcher.dispatch(p, 'onBattleStart', ev);
      else this.dispatch(p, 'onBattleStart', ev);
      return ev.input && typeof ev.input === 'object' ? ev.input : input;
    });
    const enemyOverrides = { ...(wave.overrides && typeof wave.overrides === 'object' ? wave.overrides : {}), ...(this.devEnemyOverrides || {}) };
    return {
      seed: deriveSeed(this.seed, `n:${this.round}:${group[0].ps.seat}`),
      kind: 'normal',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...this.layout.battle.normal },
      timeLimit: wave.timeLimit,
      players: inputs,
      spawns: this._sanitizeSpawns(spawns),
      routes: wave.routes,
      sharedBoss: null,
      flags: { layerGainsEnabled: true, ...this.gd.dp },
      fieldId: this._normalFieldId(group),
      enemyOverrides,
      waveId: wave.templateId,
      ...(this.bossHitLimit === undefined ? {} : { bossHitLimit: this.bossHitLimit }),
    };
  }

  startCombat() {
    if (this.clientCombat) { this._startCombatClient(); return; }
    this.phase = PHASE.COMBAT;
    this.lastResults = new Map();
    this.fields = this.normalGroups().map((g) => ({
      fieldId: this._normalFieldId(g), kind: 'normal', players: g.map((x) => x.ps.playerId),
      battle: this.newBattle(this._normalGroupOpts(g)), live: true,
    }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, { onDone: (runner) => this.combatDone(runner) });
    this.runner.start();
  }

  _startCombatClient() {
    this.phase = PHASE.COMBAT;
    this.lastResults = new Map();
    this.watchers.clear();
    const fields = this.normalGroups().map((g) => this._ccField({
      fieldId: this._normalFieldId(g), kind: 'normal', players: g.map((x) => x.ps.playerId), opts: this._normalGroupOpts(g),
    }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._launch(fields);
    // every fighting human runs its own field; eliminated humans (and spectator seats) keep watching (research 09 §3.1
    // "Keep-watching auto-observes the first available field", switching freely with 前往查看): a replica of the field
    // of the player they follow — the one they last watched, else the first player still in (item 56) — else the first
    for (const f of fields) for (const pid of f.players) {
      const ps = this.players.get(pid);
      if (!ps || ps.isBot || ps.left) continue;
      this.watchers.set(pid, f.fieldId);
      this._sendStart(pid, f);
    }
    const first = fields.find((f) => f.mode === 'client') || fields[0] || null;
    if (first) {
      for (const ps of this._viewers()) {
        if (ps.alive || this.watchers.has(ps.playerId)) continue;
        const f = this._watchTargetField(ps, fields) || first;
        this.watchers.set(ps.playerId, f.fieldId);
        this._sendStart(ps.playerId, f, { watch: true });
      }
    }
    this.markPublic();
  }

  /** Aggregate a finished field's content/engine errors (battle.errors: unique records) for diagnostics. */
  _collectSimErrors(f, res) {
    this.simErrors += Number(res && res.errors) || 0;
    const list = f && f.battle && Array.isArray(f.battle.errors) ? f.battle.errors : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const key = `${e.label}|${e.who || ''}|${e.message}`;
      let rec = this.simErrorLog.get(key);
      if (!rec) {
        if (this.simErrorLog.size >= 500) continue;
        rec = { label: String(e.label), who: String(e.who || ''), message: String(e.message), stack: e.stack ? String(e.stack) : null, battles: 0, count: 0 };
        this.simErrorLog.set(key, rec);
      }
      rec.battles++;
      rec.count++;
    }
  }

  combatDone(runner) { this._finishCombat((f) => runner.resultOf(f)); }

  /** Every normal field has its result: record them, then 联防 or SETTLE. */
  _finishCombat(resultOf) {
    if (this.phase !== PHASE.COMBAT) return;
    this._stopClientCombat();
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        this.lastResults.set(pid, pp || { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, unitsEnd: [], unitStats: [] });
        // the views show the layers the battle reached until settle() makes them persistent (DESIGN §20.15)
        const ps = this.players.get(pid);
        const gains = pp && pp.layerGains && typeof pp.layerGains === 'object' ? pp.layerGains : null;
        if (ps && gains && Object.keys(gains).length) { ps.pendingLayerGains = { ...gains }; ps.dirty(); }
        // 战斗 → 休整期的**通用标记**（`battle._perPlayer[pid].marks`，`@battle/setBattleMark` 写）：每场战斗结束
        // **整体替换**，所以上一场没写的键在这次休整期就是 null。
        if (ps) {
          const marks = pp && pp.marks && typeof pp.marks === 'object' && Object.keys(pp.marks).length ? { ...pp.marks } : null;
          // 干净对局（两边都没有标记）不置脏：视图帧与从前逐字节相同
          if (marks || ps.marks) { ps.marks = marks; ps.dirty(); }
        }
      }
    }
    for (const f of this.fields) f.live = false;
    this.deadline = 0;
    this.markPublic();
    this.later(this.scaled(DELAYS.COMBAT_END), () => this._afterCombat());
  }

  /**
   * After the COMBAT_END pause: 联防 or SETTLE. The plan is made now, from the players still in — a player who quit
   * during the last field or the pause (中途退出 = eliminated, board cleared) is neither a helper nor a leaker whose
   * enemies re-enter.
   */
  _afterCombat() {
    if (this.phase !== PHASE.COMBAT) return;
    const plan = planUnite(this, this.lastResults);
    if (plan) this.startUnite(plan);
    else this.settle(null, null);
  }
}
