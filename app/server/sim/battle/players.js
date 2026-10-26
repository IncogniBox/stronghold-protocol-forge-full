// server/sim/battle/players.js — Battle methods: players and units: board → field tiles and directions, ally creation
// from the PlayerBattleInput, token defs for an owner's loadout, and the kit / profile / skill setup of a unit.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { COLS } from '../constants.js';
import { GEO } from '../../../shared/constants.js';
import { stageRowOfBoard, deployRectOf, boardRectOf, benchBottomRow, isDualLayout, bossRectLayout } from '../../../shared/layout.js';
import { Unit } from '../units.js';
import { normDir, mirrorDir } from '../dir.js';
import { SkillRuntime } from '../skills.js';
import { resolveProfile } from '../professions.js';
import { normalizeToken } from '../simdata.js';
import { isPotential, isCultivate } from '../../../shared/potential.js';
import { setupUnitKit, kitPackOf } from '../content/index.js';
import { installTraitAttackSpeed } from '../content/traitMods.js';
import { clone } from './util.js';

/**
 * The deploy field a battle of `kind` fights on for the player whose input carries `side`: the boss half in a boss /
 * hidden battle, otherwise — on a map whose ordinary band is a mirrored pair — that player's own half of it ('normalL'
 * for 'L', 'normalR' for the mirrored 'R'), else the own ordinary board. Only a normal-kind battle ever splits: 联防
 * ('unite') keeps the single ordinary board plus its `colOffset` columns.
 */
const boardField = (kind, side, layout) => {
  if (kind === 'boss' || kind === 'hidden') return side === 'R' ? 'bossR' : 'bossL';
  if (kind !== 'normal' || !isDualLayout(layout)) return 'normal';
  return side === 'R' ? 'normalR' : 'normalL';
};

export class BattlePlayers {
  _addPlayer(p) {
    const side = p.side === 'R' ? 'R' : 'L';
    // 第 2… 块 boss 场地：这位棋手带着**自己那条部署矩形**（`bossRect`，地图坐标）—— 每人一块、不镜像（业主
    // 2026-10-24「boss区域2/3/4 和 boss区域1 一样可设置」）。它的棋盘就是那条矩形，战斗取景是这块场地的战斗矩形。
    const bossRect = Array.isArray(p.bossRect) ? p.bossRect : null;
    const layoutP = bossRect ? bossRectLayout(this.layout, bossRect, this.rect) : this.layout;
    // 镜像的不是「boss 那个 kind」，而是**这一场这一位棋手站的那个半场**：boss 的右半场，或一张左右两半的图的普通带
    // 右半场（业主 2026-10-21「左右各一位玩家同场」）。`colOffset` 侧（联防的右帮手）不镜像。
    const field = bossRect ? 'bossL' : boardField(this.kind, side, this.layout);
    const mirror = !bossRect && (field === 'normalR' || field === 'bossR');
    const ps = {
      playerId: p.playerId,
      seat: p.seat ?? this.players.length,
      side,
      colOffset: Number(p.colOffset) || 0,
      deployField: field,
      /** 这位棋手自己的布局（第 2… 块 boss 场地每人一条矩形；其余就是这张图的布局）。 */
      layout: layoutP,
      rowOffset: p.rowOffset,
      coords: p.coords ?? 'board',
      mirror,
      facing: mirror ? -1 : 1,
      // default direction of this player's units on this field (the FA right side is mirrored: RIGHT ↔ LEFT)
      dir: mirror ? 'LEFT' : 'RIGHT',
      // 自己一块矩形（不镜像）的场地上，半场就是自己那一侧（敌人的归属按 side，不按列）
      half: bossRect ? (side === 'R' ? 'R' : 'L') : mirror || (Number(p.colOffset) || 0) >= 8 ? 'R' : 'L',
      bonds: clone(p.bonds ?? {}),
      bandId: p.bandId ?? null,
      playerEffects: clone(p.playerEffects ?? []),
      lpForBoss: p.lpForBoss ?? null,
      dp: this.flags.dpInit,
      units: [],
      input: p,
    };
    if (this.opts.morphPairing === 'plus') ps.morphPairing = 'plus';
    this.players.push(ps);
    this._perPlayer[ps.playerId] = {
      // `killed` / `total` / `leaked` / `perfect` keep the official `counted` reading (DESIGN §5.1); `killedInTotal` /
      // `leakedInTotal` are the HUD capsule's counters of this player's own field (only enemies the round scheduled:
      // spawns.js `_queueSpawn` / `inTotal`, deploy.js), `resolved` is derived from them at result time.
      killed: 0, total: 0, leaked: [], perfect: true, killedInTotal: 0, leakedInTotal: 0,
      layerGains: {}, coins: 0, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [],
    };
    const late = [];
    for (const u of p.units ?? []) {
      try {
        const unit = this._createAllyFromInput(ps, u);
        if (unit && unit.kind === 'token' && !unit.ownerUnit && u.ownerUid != null) late.push([unit, u]);
      } catch (e) { this._internalError('createUnit', e); }
    }
    // a token piece listed before its owner (board order is top→bottom) is linked once every unit exists, and takes
    // the owner-level variant (elite owners: `_b` stats) of the owner's loadout (DESIGN §16)
    for (const [t, inp] of late) {
      const owner = ps.units.find((x) => x.kind === 'op' && x.uid === inp.ownerUid);
      if (!owner) continue;
      t.ownerUnit = owner;
      const def = inp.def ? null : this._tokenDef(inp.tokenId ?? inp.chessId, owner, null);
      if (!def || def === t.def) continue;
      const st = def.stats;
      t.def = def; t.defId = def.id; t.name = def.name; t.rangeGrid = def.rangeGrid;
      Object.assign(t.base, {
        maxHp: st.maxHp, atk: st.atk, def: st.def, res: st.res, aspd: st.aspd, bat: st.bat, blockCnt: st.blockCnt, spRecovery: st.spRecovery,
        tauntLevel: st.tauntLevel, massLevel: st.massLevel, hpRecoveryPerSec: st.hpRecoveryPerSec, cost: st.cost, respawnTime: st.respawnTime,
      });
      t.markDirty();
      t.hp = t.s.maxHp;
    }
  }

  /** Board → field tile for a player (see header). */
  mapTile(ps, row, col, abs = false) {
    if (abs || ps.coords === 'field') return [row, col];
    return this._boardTile(ps, row, col);
  }

  /**
   * Whether field tile (r, c) lies on player `ps`'s own board: the board region GEO.FIELD (rows 9–12, cols 2–10, the
   * tiles its pieces are deployed on) mapped onto this field — the 联防 right-hand helper's +8 columns, the boss field's
   * rows 2–5, the mirrored right half of a pair (whatever coordinates the player's input uses). Never the hand / 临时
   * 整备区 rows of a boss field (rows 0–1, inside BOSS_RECT) nor the other half of a 联防 or boss field. Automatic
   * redeployments and moves that must stay where the player could deploy read it (the 突袭 landing, bonds/addon/battle.js
   * raidTile; 乌尔比安's S3 【移动】, kits/ops/chess_char_5_05-ulpia.js). The 突袭 landing additionally admits the empty
   * deployment half in multiplayer boss/hidden battles only (§31.13); this method itself stays unchanged.
   */
  onOwnBoard(ps, r, c) {
    if (!ps) return false;
    let keys = ps._boardKeys;
    if (!keys) {
      keys = ps._boardKeys = new Set();
      const B = boardRectOf(ps.layout || this.layout, ps.deployField || boardField(this.kind, ps.side, this.layout));
      for (let br = B.r0; br <= B.r1; br++) {
        for (let bc = B.c0; bc <= B.c1; bc++) { const [fr, fc] = this._boardTile(ps, br, bc); keys.add(fr * COLS + fc); }
      }
    }
    return keys.has(r * COLS + c);
  }

  /**
   * Whether field tile (r, c) lies on the board of a player standing on this field: onOwnBoard of one of `players`,
   * the players whose units this battle holds (a teammate eliminated before it or playing another field is not one).
   * Both halves on the two-helper 联防 field and on a Final Assault / Hidden Core pair field; the own half only for a
   * lone 联防 helper and on a solo boss field; never a boss field's hand / 临时整备区 rows. The 突袭 landing reads it
   * (bonds/addon/battle.js raidTile — the owner's decision of 2026-10-07, DESIGN §26.1), then separately admits the
   * empty deployment half in multiplayer boss/hidden battles only (§31.13); this general method is unchanged.
   *
   * 社群报告「协防时候突袭干员不能跳到队友的棋盘上」的落地：共享战场上逃逸的敌人是**跨两个半场**走的
   * （escaped_multi 从第 18 列进场往左走），所以左手玩家的成员必须能跳去追一个还在队友半场上的敌人。
   * 被排除的正好是「没有任何玩家的棋盘覆盖到」的地方：boss 战场的手牌行 0 / 临时整备区行 1（§25.18.1 第 40 条）
   * 与单帮手的联防地图右半场（第 16.3 条，escaped_single —— 谁的棋盘都到不了）。乌尔比安 S3 的【移动】仍用
   * `onOwnBoard`：它不需要敌人，同样的放宽会让它停在队友的门线上（§25.17.2）。
   */
  onFieldBoard(r, c) {
    for (const ps of this.players) if (this.onOwnBoard(ps, r, c)) return true;
    return false;
  }

  _boardTile(ps, row, col) {
    const L = (ps && ps.layout) || this.layout;
    const field = ps.deployField || boardField(this.kind, ps.side, L);
    let r = row;
    // a board row ≥ the 整备行 lands on the band this battle fights in: the boss band on a boss field, the normal
    // band (which the 联防 field widens) otherwise. Officially both are the identity map (normal [9,12], boss +7), but
    // on a big map the bands sit higher — board row 9 is the map row the map's own `normal` deploy rect starts at —
    // and a map that declares a bigger board (shared/layout.js `boardRectOf`) also moves its 整备行 up two rows.
    if (ps.rowOffset != null) r = row + ps.rowOffset;
    else if (row >= benchBottomRow(L, field)) r = stageRowOfBoard(L, field, row);
    // the mirrored right side reflects the PLACEMENT through the map's own axis (reflecting the column number itself
    // would only coincide when the window's middle column is 10); the plain side lands the board's left edge on THIS
    // map's own rect (officially FIELD.c0 = 2, i.e. no shift). `colOffset` is the extra hand / 整备区 shift the caller
    // passes (0 for the left side, 8 for the boss field's right half / a 联防 right-hand helper).
    const mirrored = field === 'normalR' || field === 'bossR';
    // 镜像前先落回**它那一侧左半场那块矩形**（bossR → bossLeft、normalR → normalLeft）：官方两块左界都是 2，
    // 一张把普通带放得更宽的图上两者才会分开。
    const baseName = field === 'normalR' ? 'normalLeft' : field === 'bossR' ? 'bossLeft' : field;
    const placed = deployRectOf(L, baseName)[2] + (col - GEO.FIELD.c0);
    const c = mirrored && col <= L.mirrorCol / 2 ? L.mirrorCol - placed : placed + ps.colOffset;
    return [r, c];
  }

  /**
   * Board direction → field direction for a player (DESIGN §3): as given (default RIGHT) except on the mirrored Final
   * Assault right side, where RIGHT ↔ LEFT (UP / DOWN unchanged). `abs` / field coordinates are taken as they are.
   */
  mapDir(ps, dir, abs = false) {
    const d = normDir(dir);
    return ps && ps.mirror && !abs && ps.coords !== 'field' ? mirrorDir(d) : d;
  }

  _createAllyFromInput(ps, inp) {
    // coerce (a string row would otherwise concatenate: "10" + -7 → "10-7"); non-integers never deploy
    const row = Number(inp.row), col = Number(inp.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) { this.log(`bad tile ${inp.row},${inp.col} for ${inp.chessId ?? inp.tokenId}`); return null; }
    const [r, c] = this.mapTile(ps, row, col, !!inp.abs);
    const dir = this.mapDir(ps, inp.dir, !!inp.abs);
    if (inp.kind === 'token') {
      const owner = inp.ownerUid != null ? ps.units.find((x) => x.uid === inp.ownerUid) : null;
      const def = this._tokenDef(inp.tokenId ?? inp.chessId, owner, inp.def);
      if (!def) { this.log(`unknown token ${inp.tokenId}`); return null; }
      const u = this._makeAlly(ps, def, 'token', r, c, { uid: inp.uid, ownerUnit: owner, dir });
      u.carry = inp.carryState ?? null;
      return u;
    }
    // the unit's own loadout (DESIGN §16): an entry without loadout fields is the DEFAULT — never another player's
    // choice for the same chess id in a multi-player field (the per-battle data view maps id-only lookups); `standIn:
    // true` fields the chess as its 补位 stand-in (simdata getStandIn: the stand-in's body, the chess's identity); `diy`
    // fills a 自选 slot with its pick (simdata getDiy: the slot's identity, the operator's body, skill and module);
    // `potential` (潜能 1–6, 0.2.2) composes the def at it (never a stand-in's); `skin` (docs/SKINS.md) is the
    // appearance the owning player chose and rides through to the unit, so every client draws that model (never a rule)
    const lo = { skillIndex: inp.skillIndex ?? null, moduleId: inp.moduleId ?? null };
    if (inp.standIn === true) lo.standIn = true;
    if (inp.diy && typeof inp.diy === 'object') lo.diy = inp.diy;
    if (inp.standIn !== true && isPotential(inp.potential)) lo.potential = inp.potential;
    // 特训学员（重构模拟，shared/reconModes.js）：**叠加式**——学员保留自己的技能 / 模组选择（自己的 def、kit 与
    // 技能照常），`traineeOf` 只带教官的 chessId 与它选定的技能 / 模组：getTrainee 并入教官的盟约并挂
    // `traineeMentor` 指针，content 层再把教官的技能效果作为「影子技能」并进学员自己的技能、教官的特质 / 天赋
    // installer 追加到学员的 kit（content/index.js applyTraineeMentor）。
    if (inp.reconTrainee && typeof inp.reconTrainee === 'object' && inp.reconTrainee.chessId) {
      lo.traineeOf = { chessId: String(inp.reconTrainee.chessId), loadout: inp.reconTrainee.loadout ?? null, diy: inp.reconTrainee.diy ?? null, ratio: inp.reconTrainee.ratio };
    }
    const def = this.data.getChess(inp.chessId, lo);
    if (!def) { this.log(`unknown chess ${inp.chessId}${lo.diy ? ' (illegal 自选 pick)' : ''}`); return null; }
    // a DIY slot has no body of its own (甄选干员): it fights only as a 自选 piece (its `diy` pick)
    if (def.raw?.isDiy && !def.diyFor) { this.log(`自选 slot ${inp.chessId} without a pick`); return null; }
    const u = this._makeAlly(ps, def, 'op', r, c, { uid: inp.uid, dir, pieceData: inp.pieceData, skin: inp.skin });
    // 特训（叠加式）的展示通道：unitInfo 带上教官的身份与它选定的技能槽（客户端据此把教官技能的官方特效 / 音效
    // 叠在学员的施放上 —— render/vfx/skillfx.js 的 mentorPlan 与 audio.js 的 cast 叠音）。教官是甄选干员时按
    // traineeMentor.diy 的 pick 解析（getDiy——否则查到的是空槽位记录）；查无教官 def 就不带。
    if (def.traineeMentor) {
      const tm = def.traineeMentor;
      // 教官是补位（loadout.standIn）时按补位 def 解析：它的 spine / defId / 技能槽都是替补干员的
      const mLo = tm.diy && typeof tm.diy === 'object' ? { diy: tm.diy }
        : tm.loadout && tm.loadout.standIn === true ? { standIn: true }
        : tm.loadout && typeof tm.loadout === 'object' ? { skillIndex: tm.loadout.skillIndex ?? null, moduleId: tm.loadout.moduleId ?? null } : null;
      const mdef = this.data.getChess(tm.chessId, mLo ?? null);
      if (mdef) {
        // 教官**当前时装**也随这条供给下去（`battleInput` 按同一个主人的选择放进 `reconTrainee.skin`）：客户端把教官
        // 时装的特效变体（`skins[stem].fx`）与该时装自己的战斗音效（`skins[].sfx`）用在教官那一层。
        const mskin = inp.reconTrainee.skin;
        u.reconMentorInfo = {
          defId: tm.chessId, spine: mdef.spine ?? mdef.charId, skillIndex: Number.isInteger(mdef.skill?.index) ? mdef.skill.index : null,
          ...(typeof mskin === 'string' && mskin ? { skin: mskin } : {}),
        };
      }
    }
    u.items = [...(inp.items ?? [])];
    u.carry = inp.carryState ?? null;
    // 练度 (自持有, 0.2.2): the owned operator's ×ATK / ×DEF / ×max HP (units.js Πmul) — never a 补位 stand-in's nor a
    // prototype 自选 pick's (another character than the one the player owns)
    if (isCultivate(inp.cultivate) && !def.standInFor && !def.raw?.diyProto) {
      const mul = typeof this.data.cultivateMul === 'function' ? this.data.cultivateMul(inp.cultivate) : null;
      if (mul) { u.cultivate = inp.cultivate; u.cultMul = Object.freeze({ ...mul }); u.markDirty(); }
    }
    return u;
  }

  /**
   * Token def: an inline def (PlayerBattleInput `def`, spawnToken `opts.def`) as given, else the data record's variant
   * for the owner — `owner` = the owning ally unit (its chess and its selected skill / module: getToken(id,
   * owner.defId, owner.def.loadout), DESIGN §16), a chess id, or null.
   */
  _tokenDef(tokenId, owner, inline) {
    if (inline) return normalizeToken(tokenId, inline);
    if (!this.data.getToken) return null;
    if (owner && typeof owner === 'object') return this.data.getToken(tokenId, owner.defId ?? null, owner.def?.loadout ?? null);
    return this.data.getToken(tokenId, owner ?? null);
  }

  _makeAlly(ps, def, kind, r, c, extra = {}) {
    const st = def.stats;
    const u = new Unit({
      id: ++this._idSeq, side: 'ally', kind, def, defId: def.id, name: def.name, ownerId: ps ? ps.playerId : null,
      uid: extra.uid ?? null, ownerUnit: extra.ownerUnit ?? null, skin: extra.skin ?? null, x: c, y: r, tileR: r, tileC: c,
      dir: extra.dir != null ? normDir(extra.dir) : extra.facing != null ? normDir(extra.facing) : ps ? ps.dir : 'RIGHT',
      base: {
        maxHp: st.maxHp, atk: st.atk, def: st.def, res: st.res, aspd: st.aspd, bat: st.bat, blockCnt: st.blockCnt,
        moveSpeed: 0, spRecovery: st.spRecovery, tauntLevel: st.tauntLevel, massLevel: st.massLevel,
        hpRecoveryPerSec: st.hpRecoveryPerSec, cost: st.cost, respawnTime: st.respawnTime,
      },
    });
    u.alive = false;
    u.deployed = false;
    u.items = [];
    // 引擎级**逐棋子数据**（PlayerBattleInput `pieceData`，休整期由 `ctx.setPieceData` 写在棋子的 `meta.data` 上）：
    // 内容层的战斗逻辑读它（`server/sim/content/support/index.js` 的 `u.pieceData.bondGrants`、哥伦比亚 mod 的
    // 源石辅助仪、dev-ext 的干员数值覆盖）。**不带上来的话，那些回调永远读到 undefined。**
    if (extra.pieceData && typeof extra.pieceData === 'object') u.pieceData = { ...extra.pieceData };
    u.rangeGrid = def.rangeGrid;
    u.player = ps;
    this.units.push(u);
    this.allyUnits.push(u);
    if (ps) ps.units.push(u);
    return u;
  }

  /** Resolve kit/profile/skill for a unit (called by content/index.js; safe to call again). */
  _setupUnit(u, kit = null) {
    if (!kit) {
      try { kit = setupUnitKit(this, u, this.contentMode); } catch (e) {
        if (e?.contentFault || this.contentFault) throw e;
        this._internalError('setupUnitKit', e);
        kit = null;
      }
    }
    u.kit = kit || {};
    // kit 的**归属包**（DESIGN §28.52 的 kit 那一半）：`kits/<id>.js` 的逐单位回调真正注册的地方就是下面两行
    // （`talents[].install` / `kit.install`），所以包的标记要在**这里**盖 —— 只把 `setupUnitKit` 里那次构造调用
    // 包进作用域是空转（包通常在 `install` 里挂钩子）。`kitPackOf` 是装载期那张归属表的唯一读者；`null` = 引擎
    // 自己的内容（或调用方直接递进来的 kit，例如包在回调里 `_setupUnit(t, kit)` 生成的召唤物 —— 那时 `_safe` 的
    // 第四个参数是 null，作用域会落到**当前**那个包上，正是我们要的）。
    const pack = kitPackOf(u.kit);
    u.profile = resolveProfile(u.def, u.kit.trait || null);
    if (u.def.untargetable) this.addBuff(u, { key: 'trait:untargetable', flags: { untargetable: true }, persist: true, allowDead: true });
    // abnormal effects a summon holds (tokens.json `abnormal`, PRTS; user playtest #6 item 18): 禁疗 — no heal reaches it;
    // 孤立 ("无法被同阵营选中") — no ally heal or ally selection (auras over a range) reaches it
    const ab = u.def.abnormal;
    if (Array.isArray(ab) && ab.length) {
      const flags = {};
      if (ab.includes('healFree')) flags.noHeal = true;
      if (ab.includes('isolated')) { flags.isolated = true; flags.noHeal = true; }
      if (Object.keys(flags).length) this.addBuff(u, { key: 'trait:abnormal', flags, persist: true, allowDead: true });
    }
    const spec = u.kit.skill || null;
    u.skill = new SkillRuntime(this, u, u.def.skill, spec, u.def.skill?.bb ?? {});
    if (u.profile.install && !u._profInstalled) {
      u._profInstalled = true;
      this._safe(() => u.profile.install(this, u), 'profile.install', u);
    }
    for (const t of u.kit.talents || []) {
      if (t && typeof t.install === 'function') this._safe(() => t.install(this, u), 'talent.install', u, pack);
    }
    if (typeof u.kit.install === 'function') this._safe(() => u.kit.install(this, u), 'kit.install', u, pack);
    // trait lines the ENGINE owns for every operator (content/traitMods.js: the module attack-speed riders whose
    // condition is a pure function of the field — 「攻击范围内存在N名及以上敌人时攻击速度+X」). Runs after kit.install:
    // a kit that implements its own line for this trait is never double-counted — traitMods.js refuses every condition
    // shape a kit already owns (`reason: 'kit'`), and the kits whose line it DOES take over (the two REA-Y ones) had
    // their hand-written copy deleted in the same change. Calling it before kit.install would let a kit's own buff and
    // this rule both land on the same unit.
    this._safe(() => installTraitAttackSpeed(this, u), 'traitMods.attackSpeed', u);
    return u.kit;
  }
}
