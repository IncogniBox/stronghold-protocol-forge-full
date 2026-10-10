// server/sim/mod/rimbilliton.js — 雷姆必拓 mod 的 sim 侧实现（Forge 版：数据与 9 个干员 kit 已迁入创意工坊包
// workshop/rimbilliton/，本模块只保留引擎侧逻辑）。
//
// 注册走引擎扩展点（本模块顶层执行一次，content/index.js 载入时）：
//   bonds/core.js        registerBondInstaller     (雷姆必拓盟约)
//   garrisons/battle.js  registerGarrisonInstaller (若叶睦/暴行/阿米娅/莱伊 战斗特质)
//                        registerGarrisonReader    (珊比 每5层减伤)
//   items/battle.js      registerItemBehaviour     (绿叶菜罐头 / “幸福在途”补给包)
//   tokens.js            registerTokenKit          (沙地兽)
//   休整期 registerMeta   registry.band / registry.garrison (开拓大地 / 予愿安洁莉娜 / 暴行 / 蜜莓)
// 官方文件只保留扩展点本身，不含任何 mod 内容。
//
// 浏览器安全：本模块只 import content 域模块（/sim/ 一并服务），不依赖任何 server-only 模块。

import * as S from '../../content/support/index.js';
import { frontOf } from '../../dir.js';
import { FORCED_EXIT } from '../../constants.js';
import {
  registerBondInstaller, reached, onLayers, onUnitDamaged, isEnemyTarget, ownTag,
} from '../../content/bonds/core.js';
import {
  registerGarrisonInstaller, registerGarrisonReader, byUnit, fireGain, garrisonIdsOf,
} from '../../content/garrisons/battle.js';
import { metaBonds } from '../../content/support/meta.js';
import {
  registerItemBehaviour, bp, isProc, procTags, memberOf,
} from '../../content/items/battle.js';
import { registerTokenKit } from '../../content/tokens.js';
import { ids, num, bondOrder, chessOnBoard } from '../../content/garrisons/meta.js';

/** 卡池干员 kit 注册表（baseChessId → (bb, chess, def) => Kit）。Forge 版：9 个干员 kit 已迁入工坊包
 * workshop/rimbilliton/kits/（经 battle.opts.kits 注入，优先于 MOD.kits），这里置空。 */
export const kits = {};

/** 每场战斗的额外安装（本 mod 的注册都在 boot 完成，这里无需每场逻辑）。 */
export function install() {}

// =====================================================================================================================
// 雷姆必拓 核心盟约

/**
 * 雷姆必拓: 3 — the last-deployed 雷姆必拓 operator gains "开拓心": every distinct 雷姆必拓 operator on the field cuts
 * its damage taken by 10 % each; the holder's max HP +(base + per·L) %; its attacks deal extra true damage =
 * (base_true + per_true·L) of its own max HP. 6 — every 雷姆必拓 operator on the field gains ATK (flat) = atk_hp_share
 * of the holder's max HP. The mark follows the most recent deployment; on the holder's death it passes to the most
 * recently deployed surviving 雷姆必拓 operator (research-consistent with "最后上场的1名").
 */
function installRimBilliton(battle, pid, bb, members) {
  const memberSet = new Set(members);
  const st = { holder: null, order: [] };
  // live holder unit, shared with the mod items (幸福在途补给包 reads its max HP): battleStore namespace
  const rt = S.battleStore(battle, 'rimbilliton:rt', () => ({ holder: null }));
  const L = () => S.bondLayers(battle, pid, 'rimBilliton');
  const three = () => reached(battle, pid, 'rimBilliton', bb.power_bond_char_cnt);
  const six = () => reached(battle, pid, 'rimBilliton', bb.ex_bond_char_cnt);
  const rbOnField = () => S.bondMembers(battle, pid, 'rimBilliton', { fieldOnly: true });
  const hpPct = () => num(bb.hp, 0) + num(bb.hp_per_stack, 0) * L();
  const truePct = () => num(bb.true_dmg, 0) + num(bb.true_dmg_per_stack, 0) * L();
  const clearSix = () => {
    for (const m of S.bondMembers(battle, pid, 'rimBilliton')) battle.removeBuff(m, 'bond:rimbilliton:six');
  };
  const refresh = () => {
    const u = st.holder;
    if (!u || !S.onField(u)) { clearSix(); return; }
    // 开拓心 on the holder: damage taken −10 % per distinct 雷姆必拓 on the field, max HP +hpPct()
    battle.addBuff(u, {
      key: 'bond:rimbilliton:heart', persist: true, refresh: 'replace',
      mods: Object.assign(S.directMods({ hp: hpPct() }), { dmgTakenMul: Math.max(0, 1 - num(bb.taken_reduce, 0) * rbOnField().length) }),
    });
    clearSix();
    if (!six()) return;
    // 6: every 雷姆必拓 on the field gets ATK (flat) = atk_hp_share of the holder's current max HP
    const share = num(bb.atk_hp_share, 0) * u.s.maxHp;
    if (!(share > 0)) return;
    for (const m of rbOnField()) {
      battle.addBuff(m, { key: 'bond:rimbilliton:six', persist: true, refresh: 'replace', mods: { atkFlat: share } });
    }
  };
  const setHolder = (u) => {
    if (st.holder === u) { refresh(); writeExtra(); return; }
    if (st.holder) battle.removeBuff(st.holder, 'bond:rimbilliton:heart');
    st.holder = u;
    rt.holder = u;
    refresh();
    writeExtra();
  };
  // 开拓心持有者跨阶段带到休整期（combat.js → ps.counters['rimbilliton:holder']，meta 安洁莉娜读取）
  const writeExtra = () => {
    const pp = battle._perPlayer && battle._perPlayer[pid];
    if (!pp) return;
    pp.rbExtra = { ...(pp.rbExtra || {}), holder: st.holder ? st.holder.defId : null };
  };
  const lastOnField = (exclude) => {
    for (let i = st.order.length - 1; i >= 0; i--) {
      const u = st.order[i];
      if (u !== exclude && u.alive && S.onField(u)) return u;
    }
    return null;
  };
  // 休整期最后摆上场的雷姆必拓干员（prep 记录摆放顺序；战斗初始部署按列序，holder 应与玩家摆放顺序一致）
  const rbInput = (battle.players || []).find((p) => p.playerId === pid);
  const prepLastUid = rbInput && rbInput.input && Number.isInteger(rbInput.input.rbLastDeploy) ? rbInput.input.rbLastDeploy : null;
  const byUid = new Map(battle.allyUnits.map((u) => [u.uid, u]));
  const prepHolder = prepLastUid != null ? byUid.get(prepLastUid) ?? null : null;
  battle.on('deploy', ({ unit, initial }) => {
    if (!memberSet.has(unit) || unit.ownerId !== pid) return;
    const idx = st.order.indexOf(unit);
    if (idx >= 0) st.order.splice(idx, 1);
    st.order.push(unit);
    if (!three()) return;
    // 初始部署保持休整期确定的 holder（最后摆上场者）；战斗中的再部署才更新
    if (initial && st.holder) { refresh(); writeExtra(); return; }
    setHolder(unit);
  });
  battle.on('death', ({ unit }) => {
    if (!memberSet.has(unit)) return;
    if (unit === st.holder) {
      const u = lastOnField(unit);
      if (u) setHolder(u);
      else { battle.removeBuff(st.holder, 'bond:rimbilliton:heart'); st.holder = null; rt.holder = null; writeExtra(); }
    } else refresh();
  });
  onLayers(battle, pid, 'rimBilliton', refresh);
  // 初始 holder = 休整期最后摆上场的雷姆必拓干员（若为盟约成员；战斗初始部署保持它，不再按列序覆盖）
  if (prepHolder && memberSet.has(prepHolder)) setHolder(prepHolder);
  // 攻击附带真实伤害 (holder only)
  const onDmg = (ctx) => {
    const u = ctx.source;
    if (!u || u !== st.holder) return;
    const t = ctx.target, dmg = ctx.dmg;
    if (!dmg || !dmg.isAttack || !isEnemyTarget(t) || ownTag(dmg, 'bond:rimbilliton')) return;
    const pct = truePct();
    if (!(pct > 0)) return;
    battle.dealDamage(u, t, { amount: pct * u.s.maxHp, type: 'true', canDodge: false, tags: ['bond:rimbilliton'] });
  };
  for (const u of members) onUnitDamaged(battle, u, onDmg);
}

registerBondInstaller('rimBilliton', installRimBilliton);

// =====================================================================================================================
// 战斗侧特质 (IN_BATTLE)

// 若叶睦 "受到伤害时使自身已激活的层数+N（最多M次）"：M = 触发次数上限
registerGarrisonInstaller('act_gar_event_onhurt_add_bond_layer', (battle, list) => {
  const m = byUnit(list);
  battle.on('damaged', ({ target, amount }) => {
    const arr = m.get(target);
    if (!arr || !(amount > 0)) return;
    for (const it of arr) {
      if (num(it.bb.max_count, 0) > 0 && (it.fired || 0) >= num(it.bb.max_count)) continue;
      it.fired = (it.fired || 0) + 1;
      fireGain(battle, it);
    }
  });
});

// 暴行 "若没有陷入过再部署状态，使下个休整期额外获得雷姆必拓干员"
registerGarrisonInstaller('SERVER_ADD_CHAR_NO_REDEPLOY', (battle, list) => {
  const units = new Set(list.map((it) => it.unit));
  const fell = new Set(); // 本场战斗中陷入过再部署（被击倒 / 退场进入再部署计时）的干员
  battle.on('death', ({ unit, reason }) => {
    if (!units.has(unit) || reason === FORCED_EXIT) return; // 联防上一阶段退场的延续不算本场新陷入
    if (Number.isFinite(unit.respawnAt)) fell.add(unit);    // _remove 对非永久退场设置 respawnAt（永久退场保持 Infinity）
  });
  battle.on('battleEnd', () => {
    for (const it of list) {
      const u = it.unit;
      const pp = battle._perPlayer && battle._perPlayer[u.ownerId];
      if (!pp) continue;
      if (!pp.rbExtra) pp.rbExtra = {};
      // 未陷入过再部署（上场后未被击倒 / 退场）→ 发放（defId）；否则 null（每场战斗后重置休整期发放标记）
      if (pp.rbExtra.noRedeployChess === undefined) pp.rbExtra.noRedeployChess = null;
      if (!fell.has(u)) pp.rbExtra.noRedeployChess = u.defId;
    }
  });
});

// 阿米娅 "其他干员触发的战斗时类效果额外触发N次（每名干员最多M次）"（fireGain 的放大器列表）
registerGarrisonInstaller('SERVER_EXTRA_TRIGGER_BATTLE_EFFECT', (battle, list) => {
  if (!battle._rbAmplifiers) battle._rbAmplifiers = [];
  for (const it of list) battle._rbAmplifiers.push(it);
});

// 莱伊 "战斗开始时复制身前一格/两格内的其他干员的战斗中类效果"
registerGarrisonInstaller('SERVER_COPY_FRONT_EFFECT_BATTLE', (battle, list) => {
  battle.on('battleStart', () => {
    for (const it of list) {
      const u = it.unit;
      if (!S.onField(u)) continue;
      const fc = Math.max(1, num(it.bb.front_count, 1));
      for (let k = 1; k <= fc; k++) {
        const [fr, fcol] = frontOf(u.tileR, u.tileC, u.dir, k);
        const t = S.allyAt(battle, fr, fcol, u.ownerId);
        if (!t || !S.isOp(t) || t === u || !S.onField(t)) continue;
        for (const gid of garrisonIdsOf(t)) {
          const g = S.garrisonRecord(gid);
          if (g && g.eventType === 'IN_BATTLE') battle.rbAddGarrison(u, g);
        }
      }
    }
  });
});

// 珊比 (层数 reader): 每叠加5层，本干员受到的伤害降低 taken_reduce
// applyReader 已先算好 it.k（守卫 + 更新）——这里只按 it.k 应用 buff（与官方 reader case 同款）。
registerGarrisonReader('act_gar_eff_takenReduceByBond', (battle, it) => {
  const k = it.k;
  const u = it.unit;
  const key = `gar:${it.gid}`;
  if (k > 0) S.passiveBuff(battle, u, key, { dmgTakenMul: Math.max(0, 1 - num(it.bb.taken_reduce, 0) * k) });
  else battle.removeBuff(u, key);
});

/** 雷姆必拓 开拓心 holder unit of `pid` (installRimBilliton keeps it in its battleStore), or null. */
const rimbHolder = (battle, pid) => {
  const h = S.battleStore(battle, 'rimbilliton:rt').holder;
  return h && h.ownerId === pid ? h : null;
};

// =====================================================================================================================
// 装备 (battle side)

// 绿叶菜罐头: 受到的伤害 ×dmg_taken_mul — its giveBondId rimBilliton only matters with 变形同构体
// (the carrier then counts as a 雷姆必拓 member; the can alone grants nothing — support unitBonds)
registerItemBehaviour('chess_item_2_08_e', (battle, u, rec, scope) => {
  const p = bp(rec, 'mod_rimbilliton_greens_can');
  const v = p ? num(p.dmg_taken_mul, 1) : 1;
  if (v !== 1) scope.stat('taken', { dmgTakenMul: v });
});

// “幸福在途”补给包: 造成的伤害 ×damage_scale (dmgDealtMul); 若携带者为【雷姆必拓】盟约干员，造成伤害时
// 额外造成1次真实伤害 = true_damage_hp_scale × 开拓心 holder 的生命上限 (bonds/core.js battleStore 'rimbilliton:rt')
registerItemBehaviour('chess_item_6_12_e', (battle, u, rec, scope) => {
  const p = bp(rec, 'mod_rimbilliton_happy_supply');
  if (!p) return;
  const sc = num(p.damage_scale, 1);
  if (sc !== 1) scope.stat('dmg', { dmgDealtMul: sc });
  const hp = num(p.true_damage_hp_scale);
  if (!(hp > 0)) return;
  scope.on('damaged', (c) => {
    if (c.source !== u || isProc(c.dmg) || c.type === 'element' || !c.target || c.target.side !== 'enemy' || !c.target.alive) return;
    if (!memberOf(battle, u, 'rimBilliton')) return;
    const h = rimbHolder(battle, u.ownerId);
    if (!h || !h.alive || !S.onField(h)) return;
    battle.dealDamage(u, c.target, { amount: h.s.maxHp * hp, type: 'true', canDodge: false, tags: procTags('happy_supply') });
  });
});

// =====================================================================================================================
// 沙地兽 token kit（token_10034_ray_sndbst）— 不攻击 / 无敌 / 禁疗（不可选中来自其 trait 文本, simdata normalizeToken）

function sandbeastKit() {
  return {
    skill: null,
    trait: { noAttack: true },
    talents: [],
    install(battle, t) {
      battle.addBuff(t, { key: 'ray:sandbeast', flags: { invulnerable: true, noHeal: true }, persist: true, allowDead: true });
    },
  };
}

registerTokenKit('token_10034_ray_sndbst', sandbeastKit);

// =====================================================================================================================
// 休整期 (prep) 侧

// 开拓大地 (band_kaituo): 首次激活 <bond> 盟约（成员数跨过激活阈值）时，随机获得 count 名阶级等于调度中心的精锐化
// <bond> 干员（「首次」 = once per match）。层数 ≠ 人数：层数变化时只检查盟约是否已激活，激活才发放。
//
// 参数在派发时从 ctx.gd（匹配的合并数据，含 pack 补丁）读取 —— 不能在 boot 注册时读 sim 侧 gameData()
// （server/data.js getData 只读原始 data/*.json，不合并 pack：包式安装下 band_kaituo 只在 pack 里，
// boot 时读到 undefined → handler 永不注册 → 「开拓大地不发放」，实机 0.2.2 根因）。
const KAITUO_DEFAULT = { count: 1, bond: 'rimBilliton' };
function kaituoParams(ctx) {
  const band = ctx.gd && typeof ctx.gd.band === 'function' ? ctx.gd.band('band_kaituo') : null;
  const buff = band && Array.isArray(band.buffs) ? band.buffs.find((b) => b && b.key === 'first_activate_bond_gain_golden_bond_char') : null;
  if (!buff) return KAITUO_DEFAULT;
  const p = { ...(buff.bb || {}), ...(buff.bbStr || {}) };
  return { count: Math.max(1, num(p.count, 1)), bond: p.bond || KAITUO_DEFAULT.bond };
}
function kaituoHandler() {
  const grant = (ctx) => {
    // 幂等：先标记再发放 —— 发放触发获得时效果（onGain → 加层 → onLayers 递归）会重入本函数
    if (ctx.counter('band:kaituo:done') > 0) return;
    ctx.setCounter('band:kaituo:done', 1);
    const p = kaituoParams(ctx);
    const tier = Math.max(1, ctx.shopLevel());
    for (let k = 0; k < p.count; k++) {
      // 优先精确阶级（「阶级等于调度中心」）；池中该阶级无可发副本时回退到 ≤ 调度中心阶级（同 choices.js 的兜底写法）
      const id = ctx.rollChess({ bond: p.bond, tier, filter: (x) => !!ctx.gd.goldenIdOf(x) })
        || ctx.rollChess({ bond: p.bond, maxTier: tier, filter: (x) => !!ctx.gd.goldenIdOf(x) });
      if (id) ctx.grantChess(id, { golden: true, source: 'band' });
    }
  };
  return {
    // 激活 = <bond> 的成员数跨过其激活阈值（rimBilliton 3 人数羁绊：thresholds[0] / activeCount → bondActive）。
    onLayers(ctx) {
      const p = kaituoParams(ctx);
      if (!p.bond || ctx.counter('band:kaituo:done') > 0) return;
      if (!ctx.bondActive(p.bond)) return;
      grant(ctx);
    },
    // 休整期结束：盟约已激活但奖励未发（摆位激活不走层数事件）→ 本轮立即发放，无需等下一休整期
    onPrepEnd(ctx) {
      const p = kaituoParams(ctx);
      if (!p.bond || !ctx.bondActive(p.bond) || ctx.counter('band:kaituo:done') > 0) return;
      grant(ctx);
    },
  };
}

// 予愿安洁莉娜 "获得N名开拓心干员": 复制上场战斗最后的开拓心持有者棋子（无持有者不触发）。
function gainPioneerHolder(ctx) {
  const holder = ctx.rawCounter('rimbilliton:holder');
  if (typeof holder !== 'string' || !holder) return;
  const base = (ctx.gd.baseIdOf ? ctx.gd.baseIdOf(holder) : String(holder).replace(/_b$/, '_a')) || holder;
  const n = Math.max(1, num(ctx.source.bb.count, 1));
  for (let i = 0; i < Math.min(10, n); i++) if (!ctx.grantChess(base)) break;
}

// 暴行 (休整期发放): 上场战斗未陷入过再部署状态（未被击倒 / 退场）→ 获得N名阶级不超过调度中心的【雷姆必拓】干员。
function grantNoRedeployChar(ctx) {
  const mark = ctx.rawCounter('rimbilliton:noredeploy');
  if (typeof mark !== 'string' || !mark) return;
  const n = Math.max(1, num(ctx.source.bb.count, 1));
  for (let i = 0; i < Math.min(10, n); i++) {
    const id = ctx.rollChess({ bond: 'rimBilliton', maxTier: ctx.shopLevel() });
    if (!id || !ctx.grantChess(id)) break;
  }
}

// 蜜莓 "场上每有1名不同的雷姆必拓干员，使所有已激活的层数+N"（无需激活盟约，加给所有已激活盟约）。
function addActBondLayerByBoardBondChar(ctx) {
  const { bb, bbStr } = ctx.source;
  const bondId = ids(bbStr.bond_id)[0] || null;
  if (!bondId) return;
  const seen = new Set();
  let n = 0;
  for (const p of chessOnBoard(ctx)) {
    const base = (ctx.gd.baseIdOf ? ctx.gd.baseIdOf(p.id) : String(p.id).replace(/_b$/, '_a')) || p.id;
    if (seen.has(base)) continue;
    seen.add(base);
    if (metaBonds(ctx, p).includes(bondId)) n++;
  }
  if (!(n > 0)) return;
  const count = num(bb.count, 1);
  if (!(count > 0)) return;
  for (const b of bondOrder(ctx)) if (ctx.bondActive(b)) ctx.addLayers(b, n * count, { requireActive: false });
}

/** 休整期处理器的注册（server boot 时由 content/index.js registerAllMeta 调用）。 */
export function registerMeta(registry) {
  // 开拓大地 (band_kaituo)：无条件注册；参数（count / bond）在派发时从 ctx.gd 的 band 数据读（kaituoParams）
  registry.band('band_kaituo', kaituoHandler());
  registry.garrison('SERVER_GAIN_PIONEER_HOLDER', { run: gainPioneerHolder });
  registry.garrison('SERVER_GRANT_NO_REDEPLOY_CHAR', { run: grantNoRedeployChar });
  registry.garrison('SERVER_ADD_ACT_BOND_LAYER_BY_BOARD_BOND_CHAR', { run: addActBondLayerByBoardBondChar });
}
