// server/match/player/items.js — PlayerState methods: items — g.equip (max 2, a 3rd replaces the one the player picks;
// consume-on-equip items), g.art (Arts on a tile, rotated by the facing), g.destroy (hand / temp items; equipped
// ones are locked) and g.unequip (DESIGN §36.15, only when the room's unequip rule is allow).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR, GEO } from '../../../shared/constants.js';
import { morphSlotPolicy, ruleOption } from '../../../shared/plugins/rules.js';
import { behaviourValue } from '../../../shared/behaviour.js';
import { matchSlotPolicy } from '../../../shared/morph.js';
import { tileKey, inField, parseDir, freeSlot } from '../board.js';
import { offsetTile } from '../../sim/dir.js';
import { itemKey } from '../gamedata.js';
import { OK, fail } from './common.js';

/**
 * 装备拆卸是否被允许（行为开关 `unequip: "allow"`）：**工坊包声明依赖的读取点**
 * （`shared/modSurface.js` 里 `{ symbol: "unequipAllowed", module: "items" }` 那一条）。
 * 判据只有一份 —— 玩家状态的 `unequip()` 与它读同一个开关。
 * @param {Record<string, string>|null|undefined} rules 这一局的房间规则
 * @returns {boolean}
 */
export function unequipAllowed(rules, decl = null) {
  // 两种调用形态都收：**传数组 = 模块层的归一化声明**（老调用方 `unequipAllowed(decl)`），
  // **传对象 = 这一局的房间规则**（新口径，与 `ruleOption` 一致）。
  if (Array.isArray(rules)) { decl = rules; rules = null; }
  if (ruleOption(rules, 'unequip') === 'allow') return true;
  return decl ? behaviourValue(decl, 'unequip') === 'allow' : false;
}

export class PlayerItems {
  /**
   * A copy that actually leaves the match repays shared-item debt first (#624). Equipping, selling a carrier
   * (the item returns to the hand) and a merge that keeps the golden do not call this.
   * @param {any} piece
   * @returns {number} copies repaid
   */
  releaseItemStock(piece) {
    if (!piece || piece.kind !== 'item' || !this.m?.itemPool) return 0;
    return this.m.itemPool.repay(piece.id, this.m.itemPool.need(piece.id));
  }

  /**
   * g.equip {itemUid, targetUid, replaceUid?}. A third item on a carrier with both slots used replaces the equipped item
   * the player picked in the replace dialog (`replaceUid`, research 09 §1.2 UseEquipUp.unloadInstId; absent ⇒ the
   * oldest); the replaced item is destroyed. A `replaceUid` that is not one of the target's equipped items is refused.
   * A consume-on-equip item replaces the same way before it resolves (GitHub #263): the carrier keeps a free slot, and a
   * target its effect refuses (博士投影 on an elite) gets the picked item back — nothing is destroyed.
   */
  equip(itemUid, targetUid, replaceUid = null) {
    const g = this._gate(); if (g) return g;
    const iloc = this.find(itemUid);
    if (!iloc || iloc.piece.kind !== 'item' || (iloc.area !== 'hand' && iloc.area !== 'temp')) return fail(ERR.BAD_TARGET);
    const rec = this.gd.item(iloc.piece.id);
    if (!rec || rec.itemType !== 'EQUIP') return fail(ERR.BAD_TARGET, 'not equipment');
    const tloc = this.find(targetUid);
    if (!tloc || tloc.piece.kind !== 'chess' || tloc.area === 'equipped') return fail(ERR.BAD_TARGET);
    const item = iloc.piece;
    const target = tloc.piece;
    if (replaceUid != null && !(Number.isInteger(replaceUid) && (target.items || []).some((x) => x.uid === replaceUid))) return fail(ERR.BAD_TARGET, 'replace: not equipped on the target');
    const policy = this._slotPolicy();
    // 顶替点必须是一件**真占格**的装备：变形同构体不占位，顶掉它等于凭空销毁（plus 档的 [ASSUMED] 口径）。
    // official 档 `occupies` 恒真，所以这一条对它逐字无影响。
    if (replaceUid != null) {
      const picked = (target.items || []).find((x) => x.uid === replaceUid);
      if (picked && !policy.occupies(picked)) return fail(ERR.BAD_TARGET, 'replace: not a slotted item');
    }
    // 每名干员最多一件变形同构体：第二件在**任何东西动之前**就拒（official 档 `accepts` 恒真）。
    if (!policy.accepts(target.items || [], rec)) return fail(ERR.BAD_TARGET, 'morph already equipped');
    const consume = typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip');
    if (consume) {
      const key = 'item:' + itemKey(item.id);
      if (!this.m.registry.has(key)) return fail(ERR.BAD_TARGET, 'effect not available');
      // a full carrier replaces first, consumables included (PRTS 卫戍协议/帮助 "达到上限强行佩戴会改为替换装备：指定一件已佩戴
      // 装备替换为将要佩戴的装备，并销毁被指定的装备"; GitHub #263): the pick (else the oldest) comes off before the effect —
      // which so sees the carrier without it (its bonds) — and is destroyed once the effect went through, leaving the slot
      // free (the normal 博士投影 then takes it: ev.keep, so it no longer pushes the oldest item out). A refusal puts it back.
      const off = this._takeReplaced(target, replaceUid, rec);
      const ev = { item, target, golden: !!rec.isGolden, keep: false, error: null, consumed: true };
      this.m.dispatchItem(this, item, target, 'onEquip', ev);
      if (ev.error) {
        if (off) target.items.splice(Math.min(off.idx, target.items.length), 0, off.piece);
        return fail(ERR[ev.error] ? ev.error : ERR.BAD_TARGET, typeof ev.detail === 'string' ? ev.detail : undefined);
      }
      if (off) {
        this.m.dispatchItem(this, off.piece, target, 'onDestroy', { item: off.piece, holder: target, reason: 'replace' });
        this.releaseItemStock(off.piece);
      }
      // the handler may have destroyed the target (信标) — resolve the item again
      const again = this.find(item.uid);
      if (again && again.area !== 'equipped') this._detach(again);
      if (ev.keep) {
        const holder = this.find(target.uid);
        if (holder && holder.piece.kind === 'chess') this._attach(holder.piece, item);
      }
      // !ev.keep, or the carrier is gone: the consumed item left play. A kept item is on the carrier.
      if (!this.find(item.uid)) this.releaseItemStock(item);
      this.stats.itemsEquipped++;
      this.checkItemMerges();
      this.recompute();
      return OK;
    }
    this._detach(iloc);
    if (this.completesItemMerge(item.id)) {
      // an identical normal copy is already owned (equipped somewhere): merge instead of equipping — the golden
      // item goes to the hand (research 04 §2 "copies in hand and on operators both count")
      if (this._mergeItem(item.id, item)) { this.recompute(); return OK; }
      if (!this.find(item.uid)) this.stow(item, { allowTemp: true });
    }
    this._attach(target, item, replaceUid);
    this.stats.itemsEquipped++;
    this.m.dispatchItem(this, item, target, 'onEquip', { item, target, golden: !!rec.isGolden, consumed: false });
    this.checkItemMerges();
    this.recompute();
    return OK;
  }

  /**
   * Attach an item. With both slots used the item `replaceUid` names (the player's pick) is replaced, else the oldest;
   * the replaced item is destroyed.
   */
  /** The room's equip-slot policy. Official returns the shared frozen singleton, so the numbers stay today's. */
  _slotPolicy() {
    // 房间规则（上游 0.3.1）优先；没声明时退到我们自有的模块层 behaviour.morphPairing。
    // 两条来源都归一成**一份声明**，交给 `matchSlotPolicy`（这一格唯一的对局入口）——
    // 服务端四处读取点与不变量因此读的是同一个对象，不会各算一套。
    const rule = ruleOption(this.m?.rules, 'morphPairing');
    const decl = rule !== 'official' ? [{ switch: 'morphPairing', option: rule }] : (this.m?.behaviour ?? null);
    const p = matchSlotPolicy({ behaviour: decl });
    // 这一页的项是**棋子**（带 uid + id，没有 canGiveBond）；判据要的那条信息在 items 记录里。
    // 把解析器绑进来，调用点就不必各传一次（漏传会静默把变形同构体当成普通装备 —— 真出过一次）。
    const getItem = (arg) => this.gd.item(arg && typeof arg === 'object' ? arg.id : arg);
    return {
      active: p.active,
      maxItems: p.maxItems,
      isSlotless: (rec) => p.isSlotless(getItem(rec)),
      occupies: (rec) => p.occupies(rec, getItem),
      accepts: (items, rec) => p.accepts(items, rec, getItem),
      canHold: (items, rec, cap) => p.canHold(items, rec, cap, getItem),
      slotsUsed: (items) => p.slotsUsed(items, getItem),
      slotCap: (cap) => p.slotCap(cap),
      replacedIndex: (items, uid) => p.replacedIndex(items, uid, getItem),
    };
  }

  _attach(target, item, replaceUid = null) {
    target.items = target.items || [];
    const policy = this._slotPolicy();
    const rec = this.gd.item(item.id);
    // 上限 = 官方 2 + 携带装备的 params.slot_cap（源石辅助仪 +2/+4，`shared/equipSlots.js`）：`equipCapacity`
    // 把**这一件**也算进去，所以满格的携带者仍能装下装置。A plus morph does not occupy a slot, so this while does
    // not run for it. Official occupies() is always true and slotsUsed is items.length, so the comparison and the
    // splice index stay today's.
    while (policy.occupies(rec) && policy.slotsUsed(target.items) >= this.gd.equipCapacity(target.items, item)) { // loop-cap: splices one item each pass
      const i = policy.replacedIndex(target.items, replaceUid);
      const [old] = target.items.splice(i >= 0 ? i : 0, 1);
      replaceUid = null;
      this.m.dispatchItem(this, old, target, 'onDestroy', { item: old, holder: target, reason: 'replace' });
      this.releaseItemStock(old);
    }
    target.items.push(item);
  }

  /**
   * A consume-on-equip item on a full carrier: take the item `replaceUid` names (else the oldest) off `target` — not yet
   * destroyed — and return { piece, idx } (null while a slot is free).
   */
  _takeReplaced(target, replaceUid = null, incoming = null) {
    target.items = target.items || [];
    const policy = this._slotPolicy();
    // A plus morph does not replace anyone. Official occupies() is always true.
    if (incoming && !policy.occupies(incoming)) return null;
    // 同上：`equipCapacity` 把**这一件**算进去（源石辅助仪的 +2/+4 —— 装置自身能把格位撑开）。
    if (policy.slotsUsed(target.items) < this.gd.equipCapacity(target.items, incoming)) return null;
    const idx = policy.replacedIndex(target.items, replaceUid);
    const [piece] = target.items.splice(idx >= 0 ? idx : 0, 1);
    return { piece, idx: idx >= 0 ? idx : 0 };
  }

  /** g.art {itemUid, row, col, dir?}: the Art's range grid is rotated by `dir` (absent ⇒ RIGHT). */
  useArt(itemUid, row, col, dir) {
    const g = this._gate(); if (g) return g;
    const d = parseDir(dir);
    if (!d) return fail(ERR.BAD_TARGET, 'bad dir');
    const loc = this.find(itemUid);
    if (!loc || loc.piece.kind !== 'item' || (loc.area !== 'hand' && loc.area !== 'temp')) return fail(ERR.BAD_TARGET);
    const rec = this.gd.item(loc.piece.id);
    if (!rec || rec.itemType !== 'MAGIC') return fail(ERR.BAD_TARGET, 'not an art');
    if (!this._inField(row, col)) return fail(ERR.BAD_TILE);
    if (this.round.arts >= this.gd.maxArtsPerRound) return fail(ERR.BAD_TARGET, 'art limit');
    const key = 'item:' + itemKey(loc.piece.id);
    if (!this.m.registry.has(key)) return fail(ERR.BAD_TARGET, 'effect not available');
    const grid = Array.isArray(rec.rangeGrid) && rec.rangeGrid.length ? rec.rangeGrid : [[0, 0]];
    const targets = [];
    for (const [dr, dc] of grid) {
      const [tr, tc] = offsetTile(row, col, dr, dc, d);
      const p = this.board.get(tileKey(tr, tc));
      if (p) targets.push(p);
    }
    const ev = { item: loc.piece, row, col, dir: d, targets, error: null, used: true };
    this.m.dispatchItem(this, loc.piece, null, 'onArt', ev);
    if (ev.error) return fail(ERR[ev.error] ? ev.error : ERR.BAD_TARGET, typeof ev.detail === 'string' ? ev.detail : undefined);
    if (ev.used !== false) {
      const again = this.find(itemUid);
      if (again) this._detach(again);
      this.releaseItemStock(loc.piece);
      this.round.arts++;
    }
    this.recompute();
    return OK;
  }

  /**
   * g.destroy {uid}: an item in the hand / temp (Arts included). Equipped items are locked (research 04 §2 / addendum:
   * they leave the operator only on promotion, merge or sale); replacing one is g.equip's `replaceUid`.
   */
  destroy(uid) {
    const g = this._gate(); if (g) return g;
    const loc = this.find(uid);
    if (!loc || loc.piece.kind !== 'item') return fail(ERR.BAD_TARGET, 'only items can be destroyed');
    if (loc.area === 'equipped') return fail(ERR.BAD_TARGET, 'equipped items are locked');
    this._detach(loc);
    this.releaseItemStock(loc.piece);
    this.m.dispatchItem(this, loc.piece, loc.holder || null, 'onDestroy', { item: loc.piece, holder: loc.holder || null, reason: 'player' });
    this.recompute();
    return OK;
  }

  /**
   * 内容层（`ctx.destroyItem`）用的**无条件**销毁：手牌 / 临时 / **已装备**三处都能销毁。
   *
   * 与 `destroy(uid)`（`g.destroy`，玩家意图）的两条差别，都是刻意的：
   *   * **不过 `_gate()`** —— 内容层的销毁是「某条规则到期了」，不该因为玩家点了就绪、或当前不在休整期就停下
   *     （`destroy` 的那道闸正是为玩家意图设的）；
   *   * **已装备的也销毁** —— 玩家意图那条路一律锁着已装备的装备（research 04 §2「只能在精英化 / 合成 / 卖出时
   *     离开干员」，`unequip` 那一格才是把它放回手牌）。
   *
   * 收尾与 `destroy(uid)` 逐字相同：移出原位 → 归还装备池 → 发 `onDestroy`（`reason` 由调用方给）→ recompute。
   * 一件都没销毁（uid 不存在 / 不是装备件）返回 false，不抛。
   * @param {number} uid @param {string} [reason] 写进 `onDestroy` 的理由（DESIGN §28.43.2 的「另立一刀」）
   * @returns {boolean} 真的销毁了一件
   */
  destroyItem(uid, reason = 'content') {
    const loc = this.find(uid);
    if (!loc || !loc.piece || loc.piece.kind !== 'item') return false;
    const piece = loc.piece;
    const holder = loc.holder || null;
    this._detach(loc);
    this.releaseItemStock(piece);
    this.m.dispatchItem(this, piece, holder, 'onDestroy', { item: piece, holder, reason: String(reason || 'content') });
    this.recompute();
    return true;
  }

  /**
   * g.unequip {itemUid}（行为开关 `unequip: "allow"`，DESIGN §28.43.1）：把一件**已装备**的装备从干员身上取下，
   * 放回手牌（右→左优先），手牌满则进**临时整备区**（`stow`，pieces.js）。
   *
   * **缺省档（`official`）逐字不变**：`unequipAllowed` 为假 ⇒ 回 `destroy` 今天那句
   * `'equipped items are locked'`（`items.js` 的 destroy 用的就是它），于是一个不声明这一格的房间在这条意图上的
   * 行为与从前**一字不差**。
   *
   * **原子性**：`_detach` 之后 `stow` 可能返回 `null`（手牌与临时都满）。那时按**原下标**把它塞回 `holder.items`，
   * 并回 `HAND_FULL` —— 先摘后塞没有回滚的话，装备会**凭空消失**。「没地方放」是一件独立、可处理的事，所以用
   * `HAND_FULL` 而不是 `BAD_TARGET`。
   *
   * **池不变式**：装备只是从**装备位**移到**手牌 / 临时**，`piece` 与 `uid` 都不变 ⇒ `SharedItemPool.held()`
   * （遍历 hand / temp / board，以及 `p.items`）前后都数得到它 ⇒ `held` / `cap` / `left` 全不变，不变式
   * `raw left + Σ held == cap` 一字不动。**没有「归还」这回事**（这与 destroy / sell 不同：那两者才真让池子少一件）。
   *
   * **不发内容钩子**（刻意的第一版决定，DESIGN §28.43.2）：`HOOKS` 那 19 个是契约面（进 `META`），而「卸下」用
   * 哪一个都不贴切（不是 `onDestroy`、不是 `onEquip`），今天也没有任何包需要被通知。将来真有需要，另立一刀并
   * 按 `META` 契约面扩展。
   *
   * 判据只有一份（`unequipAllowed`，`shared/modSurface.js` 的 `items` 锚）：房间规则（`m.rules`，上游 0.3.1）
   * 与模块层 `behaviour`（本仓的包声明）两处来源都读它。
   */
  unequip(itemUid) {
    const g = this._gate(); if (g) return g;
    if (!unequipAllowed(this.m?.rules, this.m?.behaviour)) return fail(ERR.BAD_TARGET, 'equipped items are locked');
    const loc = this.find(itemUid);
    if (!loc || loc.piece.kind !== 'item') return fail(ERR.BAD_TARGET);
    if (loc.area !== 'equipped') return fail(ERR.BAD_TARGET, 'not equipped on an operator');
    const holder = loc.holder;
    const idx = holder && Array.isArray(holder.items) ? holder.items.indexOf(loc.piece) : -1;
    const piece = loc.piece;
    this._detach(loc);
    // 归宿：手牌右→左优先，其次临时整备区。本仓的 `stow`（pieces.js）把临时区当作**无界队列**（五个显示格只是
    // 窗口，不是容量）⇒ `allowTemp` 为真时它不再返回 null；这里保留原子回滚，装备永不凭空消失。
    if (!this.stow(piece, { allowTemp: true })) {
      if (holder && Array.isArray(holder.items)) holder.items.splice(idx < 0 ? 0 : Math.min(idx, holder.items.length), 0, piece);
      return fail(ERR.HAND_FULL);
    }
    this.recompute();
    return OK;
  }
}
