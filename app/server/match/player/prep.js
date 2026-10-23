// server/match/player/prep.js — PlayerState methods: the gate of every prep intent (_gate: alive, PREP, not ready),
// g.reward (a reward offer's pick), Ready (refused while temp holds pieces) and the resolution of the temp pieces due
// at a prep's deadline.
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR, PHASE } from '../../../shared/constants.js';
import { boardOrder, freeSlot } from '../board.js';
import { RECON_BOND_ID, RECON_TRAINING_ROUNDS } from '../../../shared/reconModes.js';
import { OK, fail } from './common.js';

export class PlayerPrep {
  _gate({ allowWhenReady = false } = {}) {
    if (!this.alive) return fail(ERR.ELIMINATED);
    if (this.m.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (this.ready && !allowWhenReady) return fail(ERR.WRONG_PHASE, 'ready');
    return null;
  }

  /** 场上 + 待部署区 + 手牌里 uid 命中的那枚棋子（特训的两角从这三处出；商店 / 奖励不算）。查无 ⇒ null。 */
  trainPieceOf(uid) {
    if (!Number.isInteger(uid)) return null;
    for (const p of this.temp || []) if (p && p.kind === 'chess' && p.uid === uid) return p;
    for (const p of this.hand || []) if (p && p.kind === 'chess' && p.uid === uid) return p;
    for (const { piece } of boardOrder(this.board)) if (piece && piece.kind === 'chess' && piece.uid === uid) return piece;
    return null;
  }

  /**
   * g.reconTrain { mentor, trainee }（重构协议·特训，shared/reconModes.js）：从场上、待部署区与手牌里各点一名干员——
   * 前者教官、后者学员。学员本局永久**叠加**教官的技能效果 / 特质 / 天赋（战斗侧 content/index.js
   * applyTraineeMentor，player/round.js battleInput 把 `reconTrainee` 带进输入条目）并攻 / 防 / 生命 = 学员 +
   * 教官 ×0.5（RECON_TRAINEE_STAT_RATIO），同时被授予附加盟约：bond_recon + **教官的盟约**（教官 chess 记录的 bonds + 特质授予的
   * `trait.grantsBonds`，业主 2026-10-22「盟约也要加上；和教官同时上场时各算各的」）。两条都走棋子
   * `meta.data.bondGrants` 的引擎级授予通道 —— bondsMeta.pieceBonds（match 激活计数：学员与教官是两枚不同棋子、
   * 各算一个成员，不去重）、unitBonds（战斗侧效果承受，与 sim getTrainee 的 def.bonds 并集同集合）与客户端棋子
   * 芯片三处同源。每名博士每个特训回合一条（重交覆盖同回合那条——教官 / 学员都可换）；重构对局的回合号不在
   * RECON_TRAINING_ROUNDS、非重构且非全量模拟（m.dev —— 全量模拟不限回合）、已就绪 ⇒ WRONG_PHASE；
   * 两角同一个人 / 任一角不是场上或待部署区的干员 ⇒ BAD_TARGET。
   */
  reconTrain(msg) {
    const g = this._gate();
    if (g) return g;
    // 重构对局按特训回合表收；「全量模拟」（开发者试验场，m.dev，业主 2026-10-22）**不限回合**——任何 PREP 都能交，方便测试。
    if (!this.gd.isRecon && !this.m.dev) return fail(ERR.WRONG_PHASE, 'mode');
    if (this.gd.isRecon && !RECON_TRAINING_ROUNDS.includes(this.m.round)) return fail(ERR.WRONG_PHASE, 'round');
    const mentor = this.trainPieceOf(msg.mentor);
    const trainee = this.trainPieceOf(msg.trainee);
    if (!mentor || !trainee || mentor.uid === trainee.uid) return fail(ERR.BAD_TARGET);
    // 同一学员重复特训：后一条覆盖前一条（数值固定「学员 + 教官 ×0.5」不叠加）——按回合记，同回合重交即覆盖。
    this.reconTraining = (this.reconTraining || []).filter((t) => t.trainee !== trainee.uid);
    this.reconTraining.push({ round: this.m.round, mentor: mentor.uid, trainee: trainee.uid });
    // 授予附加盟约（引擎级授予通道，与哥伦比亚源石辅助仪的 `bondGrants` 同一条）：棋子级、本局跟人走。
    const meta = trainee.meta ?? (trainee.meta = {});
    const data = meta.data && typeof meta.data === 'object' ? meta.data : (meta.data = {});
    const grants = Array.isArray(data.bondGrants) ? data.bondGrants : (data.bondGrants = []);
    // 授予**来源**（`bondGrantSrc`：`recon:<回合>` → 这一次实际新加进去的那几条）——取消本回合特训时只回收这一条
    // 关系加的那几条，不碰别的来源（装备继承的 bondGrants、别的回合的特训）。
    const srcKey = `recon:${this.m.round}`;
    const added = [];
    if (!grants.includes(RECON_BOND_ID)) { grants.push(RECON_BOND_ID); added.push(RECON_BOND_ID); }
    // 教官的盟约（chess 记录的 bonds + 特质授予，static data —— 与 sim getTrainee 的动态并集逐字同集合；
    // 重交换教官时旧教官的盟约不撤销：特训叠加只进不退，与战斗侧的影子技能同口径）。
    const mrec = this.gd.chess(mentor.id);
    const mb = [
      ...(Array.isArray(mrec?.bonds) ? mrec.bonds : []),
      ...(Array.isArray(mrec?.trait?.grantsBonds) ? mrec.trait.grantsBonds : []),
    ];
    for (const b of mb) if (typeof b === 'string' && this.gd.bond(b) && !grants.includes(b)) { grants.push(b); added.push(b); }
    if (added.length) {
      const src = data.bondGrantSrc && typeof data.bondGrantSrc === 'object' && !Array.isArray(data.bondGrantSrc)
        ? data.bondGrantSrc : (data.bondGrantSrc = {});
      // 同回合换教官再交：旧教官那几条仍由「这回合的关系」授予（只进不退），来源表里累计而不是覆盖
      const list = Array.isArray(src[srcKey]) ? src[srcKey] : (src[srcKey] = []);
      for (const b of added) if (!list.includes(b)) list.push(b);
    }
    this.dirty();
    return OK;
  }

  /**
   * 棋子的**特质**列表（garrisons.json 的 `garrisonIds`）：自己的 ∪ 特训教官的（这名棋子是学员时）。
   * 特训是叠加式（业主 2026-10-27 第 6 条）：教官那名干员的整备 / 作战能力也由学员这一枚棋子派发 ——
   * 修行期的 `_garrisons` / `triggerGarrisons`、内容钩子的 `garrisonsOf` 与战斗结果校验都读这一份，
   * 与战斗侧 simdata.getTrainee 的 `raw.garrisonIds` 并集同集合。教官查无（已售 / 已合）⇒ 只有自己的。
   */
  pieceGarrisonIds(piece) {
    const rec = piece && this.gd.chess(piece.id);
    const out = Array.isArray(rec?.garrisonIds) ? [...rec.garrisonIds] : [];
    if (!piece || !Number.isInteger(piece.uid)) return out;
    const tr = (this.reconTraining || []).find((x) => x && x.trainee === piece.uid);
    const mp = tr ? this.trainPieceOf(tr.mentor) : null;
    const mrec = mp ? this.gd.chess(mp.id) : null;
    for (const gid of Array.isArray(mrec?.garrisonIds) ? mrec.garrisonIds : []) {
      if (typeof gid === 'string' && !out.includes(gid)) out.push(gid);
    }
    return out;
  }

  /**
   * g.reconTrainCancel { trainee }：取消**本回合**给这名学员的那条特训（选错了 / 换人前先撤掉）。
   * 回合表 / 阶段闸与 reconTrain 相同；本回合没有这名学员的特训 ⇒ BAD_TARGET。学员的 `meta.data.bondGrants`
   * 只回收**这条关系实际加进去的**那几条（`meta.data.bondGrantSrc['recon:<回合>']`），其它来源（装备继承、
   * 别的回合的特训）原样保留。技能 / 三围的叠加本来就在战斗输入里按 reconTraining 现算，条目一撤即失效。
   */
  reconTrainCancel(msg) {
    const g = this._gate();
    if (g) return g;
    if (!this.gd.isRecon && !this.m.dev) return fail(ERR.WRONG_PHASE, 'mode');
    if (this.gd.isRecon && !RECON_TRAINING_ROUNDS.includes(this.m.round)) return fail(ERR.WRONG_PHASE, 'round');
    const list = Array.isArray(this.reconTraining) ? this.reconTraining : [];
    const i = list.findIndex((t) => t && t.trainee === msg.trainee && t.round === this.m.round);
    if (i < 0) return fail(ERR.BAD_TARGET);
    const [entry] = list.splice(i, 1);
    this.reconTraining = list;
    const piece = this.trainPieceOf(entry.trainee);
    const data = piece && piece.meta && piece.meta.data && typeof piece.meta.data === 'object' ? piece.meta.data : null;
    if (data && Array.isArray(data.bondGrants)) {
      const srcKey = `recon:${entry.round}`;
      const src = data.bondGrantSrc && typeof data.bondGrantSrc === 'object' && !Array.isArray(data.bondGrantSrc) ? data.bondGrantSrc : null;
      let gone = null;
      if (src && Array.isArray(src[srcKey])) { gone = src[srcKey]; delete src[srcKey]; }
      if (!gone) {
        // 没有来源记录（旧条目）：保守地只认这条关系本该授予的那几条，且仍被其它来源需要的一律留下
        const needed = new Set();
        if (src) for (const v of Object.values(src)) if (Array.isArray(v)) for (const b of v) needed.add(b);
        const mrec = this.gd.chess(entry.mentor?.id);
        gone = [
          RECON_BOND_ID,
          ...(Array.isArray(mrec?.bonds) ? mrec.bonds : []),
          ...(Array.isArray(mrec?.trait?.grantsBonds) ? mrec.trait.grantsBonds : []),
        ].filter((b) => !needed.has(b));
      }
      const removed = new Set(Array.isArray(gone) ? gone : []);
      for (const v of src ? Object.values(src) : []) if (Array.isArray(v)) for (const b of v) removed.delete(b);
      if (removed.size) data.bondGrants = data.bondGrants.filter((b) => !removed.has(b));
      if (data.bondGrants && !data.bondGrants.length) delete data.bondGrants;
      if (src && !Object.keys(src).length) delete data.bondGrantSrc;
    }
    this.recompute();
    return OK;
  }

  /**
   * 特训关系的精锐化续接（重构协议·特训，业主 2026-10-22「干员精锐化后也要保留特训的效果」）：精锐化
   * （_mergeChess）消耗若干普通件、**新建一枚新 uid 的精锐件** —— 被消耗件若是学员 / 教官，特训关系的 uid
   * 重映射到精锐件（同一名干员，只是精锐了），学员棋子上的 `meta.data.bondGrants`（bond_recon + 教官的盟约）
   * 也一并搬到精锐件上。两名角色被合进同一枚精锐（同名两件一起喂）⇒ 那条关系失效，移除。
   * 升华（promote）原地改 id 不换 uid，特训天然保留，不走这里。
   * @param {any[]} mergedPieces 被消耗的棋子对象（_mergeChess 的 consumed——调用时它们已从棋盘 / 手牌 / 待部署区
   *   摘除，只能按对象传，查不着了）
   * @param {number} eliteUid 精锐件的 uid
   */
  retainReconTraining(mergedPieces, eliteUid) {
    const tr = this.reconTraining;
    if (!Array.isArray(tr) || !tr.length || !Number.isInteger(eliteUid)) return;
    const list = (Array.isArray(mergedPieces) ? mergedPieces : []).filter((p) => p && Number.isInteger(p.uid));
    if (!list.length) return;
    const map = new Map(list.map((p) => [p.uid, eliteUid]));
    // 学员的 bondGrants 跟人走：被消耗的件里是学员的，把它的授予并到精锐件上
    const elite = this.trainPieceOf(eliteUid);
    if (elite) {
      const em = elite.meta ?? (elite.meta = {});
      const ed = em.data && typeof em.data === 'object' ? em.data : (em.data = {});
      for (const p of list) {
        if (!p.meta || !p.meta.data) continue;
        const grants = Array.isArray(p.meta.data.bondGrants) ? p.meta.data.bondGrants : null;
        if (grants && grants.length) {
          const eg = Array.isArray(ed.bondGrants) ? ed.bondGrants : (ed.bondGrants = []);
          for (const b of grants) if (!eg.includes(b)) eg.push(b);
        }
        // 授予来源（取消特训时只回收这条关系加的那几条）也跟着走
        const src = p.meta.data.bondGrantSrc;
        if (src && typeof src === 'object' && !Array.isArray(src)) {
          const es = ed.bondGrantSrc && typeof ed.bondGrantSrc === 'object' && !Array.isArray(ed.bondGrantSrc)
            ? ed.bondGrantSrc : (ed.bondGrantSrc = {});
          for (const [k, v] of Object.entries(src)) if (!es[k]) es[k] = Array.isArray(v) ? [...v] : v;
        }
      }
    }
    this.reconTraining = tr
      .map((t) => (t && Number.isInteger(t.trainee) && Number.isInteger(t.mentor)
        ? { round: t.round, mentor: map.get(t.mentor) ?? t.mentor, trainee: map.get(t.trainee) ?? t.trainee }
        : t))
      .filter((t) => t && t.mentor !== t.trainee);
    this.dirty();
  }

  /**
   * g.reward {idx}: the pick of the first queued offer (promotion reward, a strategy's special refresh, an item offer).
   * A pick is a 招募 like a purchase: a full regular hand refuses it, also when it would complete a merge (PRTS
   * 卫戍协议/帮助 §手牌区, see buy; GitHub #82).
   */
  pickReward(idx) {
    const g = this._gate(); if (g) return g;
    const offer = this.offers[0];
    if (!offer) return fail(ERR.BAD_TARGET, 'no reward');
    if (!Number.isInteger(idx) || idx < 0 || idx >= offer.slots.length) return fail(ERR.BAD_TARGET);
    const slot = offer.slots[idx];
    if (!slot || slot.sold) return fail(ERR.SOLD_OUT);
    const handFull = freeSlot(this.hand) < 0;
    if (slot.kind === 'item') {
      if (!this.gd.item(slot.id)) return fail(ERR.BAD_TARGET);
      // Already displayed equipment rewards survive stock exhaustion (#624, maintainer 2026-10-14).
      if (handFull) return fail(ERR.HAND_FULL);
    } else if (slot.kind === 'chess') {
      const rec = this.gd.chess(slot.id);
      if (!rec || (rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
      // Owner decision 2026-10-11 (#498): already displayed operator rewards survive stock exhaustion.
      // acquireChess records the deficit. Displayed item rewards do the same (acquireItem displayed).
      if (handFull) return fail(ERR.HAND_FULL);
    } else return fail(ERR.BAD_TARGET);
    const price = Number.isFinite(slot.price) && slot.price > 0 ? Math.trunc(slot.price) : 0;
    if (price > this.funds) return fail(ERR.NO_FUNDS);
    slot.sold = true;
    this.offers.shift();
    if (price > 0) this.spend(price);
    if (slot.kind === 'item') {
      const gained = this.acquireItem(slot.id, { source: 'reward', displayed: true });
      // #677: maintainer decision 2026-10-17 (official play memory): one Cathy cell per player/match.
      // [ASSUMED] Only a successful pick from this source counts; Quintus's grant is independent.
      if (gained && offer.source === 'band:band_cathy' && slot.id === 'chess_item_5_08_e_a') {
        this.counters['band:cathy:cellTaken'] = 1;
        // [ASSUMED] Remove the cell from queued Cathy offers too, retaining their other choices without rerolling.
        for (const pending of this.offers) if (pending.source === 'band:band_cathy') {
          pending.slots = pending.slots.filter((s) => s.id !== slot.id);
        }
        this.offers = this.offers.filter((pending) => pending.slots.length);
      }
    } else this.acquireChess(slot.id, { source: 'reward' });
    this._afterSpend(price, 'reward');
    this.recompute();
    return OK;
  }

  setReady(on) {
    if (!this.alive) return fail(ERR.ELIMINATED);
    if (this.m.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (on && this.personalChoice) return fail(ERR.BAD_TARGET, '请先完成教鞭选择'); // i18n-ignore: developer error detail
    if (on && !this.tempEmpty) return fail(ERR.TEMP_NOT_EMPTY);
    if (this.ready === !!on) return OK;
    this.ready = !!on;
    // un-ready: the player can act again, so what overflowed while it was ready is due at this prep's deadline
    if (!on) for (const p of this.temp) if (p && this.tempDue(p) > this.prepsEnded) this._tempDue.set(p.uid, this.prepsEnded);
    this.dirty();
    this.m.onReadyChanged(this);
    return OK;
  }

  /**
   * Prep deadline: every temp piece due at this prep (tempDue ≤ prepsEnded) is resolved — a chess is sold back (its
   * pool copies return, its summons are removed), items are destroyed, the summon stack of an owner still on the board
   * is removed and comes back at the next round start (startRound → grantTokensFor; PRTS "干员所属召唤物会于下一回合
   * 返还"). Pieces that overflowed after the player could no longer act on them (after Ready, at the prep end) are kept
   * for the next prep.
   */
  resolveTemp() {
    let changed = false;
    for (let i = 0; i < this.temp.length; i++) {
      const p = this.temp[i];
      if (!p || this.tempDue(p) > this.prepsEnded) continue;
      this.temp[i] = null;
      this._tempDue.delete(p.uid);
      changed = true;
      if (p.kind === 'chess') {
        this.removeTokensOf(p.uid);
        this.returnCopies(p);
        for (const it of p.items || []) this.releaseItemStock(it);
        p.items = [];
      } else if (p.kind === 'item') this.releaseItemStock(p);
    }
    if (changed) this.recompute();
  }
}
