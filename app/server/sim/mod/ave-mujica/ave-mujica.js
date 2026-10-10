// server/sim/mod/ave-mujica.js — 颂乐人偶/Ave Mujica 盟约的 sim 侧实现（Forge 版）。
//
// 数据（bonds.json / chess.json / kits）在创意工坊包 workshop/ave-mujica/；本模块只保留引擎侧逻辑：
//   bonds/core.js        registerBondInstaller   (颂乐人偶 盟约安装器：5 名成员特质 + Fever 系统)
//   休整期 registerMeta   registry.bond            (1/2/3/4/5 人数 tier 效果)
// 官方文件只保留扩展点本身，不含任何 mod 内容。与雷姆必拓 mod 共用同一批扩展点，互不干扰。
//
// 简化假设（见 workshop/ave-mujica/bonds.json spec.assumed）：
//   * Fever 为每场战斗共享团队值（上限 450）：成员每次普通攻击造成伤害 +FEVER_PER_HIT；
//     三角初华在场 ×fever_ratio，5 人翻倍再 ×2；满 450 触发 20 s Fever 状态：期间成员持续获得大量 SP
//     回复（近似官方「无视技力限制持续释放技能」），且 Fever 不再积累。
//   * 「使已激活的盟约层数+2」= 所有已激活盟约（同蜜莓官方写法），含颂乐人偶自身。
//   * 丰川祥子 25%：非成员干员获得 Amoris/Timoris/Mortis 三项战斗效果的 25%（随 5 人翻倍）。
//   * 「可部署干员数量上限+1」= 玩家部署上限 +1（4人；5人盟约效果翻倍 → +2；deployCap 默认 8，placement.js 强制执行）。

import * as S from '../../content/support/index.js';
import {
  registerBondInstaller, reached, onLayers, onUnitDamaged, isEnemyTarget, ownTag,
} from '../../content/bonds/core.js';
import { registerGarrisonInstaller } from '../../content/garrisons/battle.js';
import { bondOrder, num, ids } from '../../content/garrisons/meta.js';

/** 卡池干员 kit 注册表（baseChessId → (bb, chess, def) => Kit）。4 名新干员的 kit 已迁入工坊包
 * workshop/ave-mujica/kits/（经 battle.opts.kits 注入，优先于 MOD.kits），这里置空。 */
export const kits = {};

/** 每场战斗的额外安装（本 mod 的注册都在 boot 完成，这里无需每场逻辑）。 */
export function install() {}

// =====================================================================================================================
// 颂乐人偶 核心盟约

/** 基础 chess id → 成员角色（丰川祥子 Oblivionis / 三角初华 Doloris / 祐天寺若麦 Amoris / 八幡海铃 Timoris / 若叶睦 Mortis）。 */
const ROLE_BY_CHESS = Object.freeze({
  chess_char_6_30: 'oblivionis',
  chess_char_5_30: 'doloris',
  chess_char_5_31: 'amoris',
  chess_char_5_32: 'timoris',
  chess_char_5_25: 'mortis',
});
const roleOf = (u) => {
  const b = String(u && (u.defId || u.def?.id) || '').replace(/_[ab]$/, '');
  return ROLE_BY_CHESS[b] || null;
};

const FEVER_CAP = 450;
const FEVER_TIME = 20;
const FEVER_PER_HIT = 2;
const FEVER_BUF = 'bond:avemujica:fever';
const FEVER_SP_FLAT = 1000; // Fever 状态下每秒回复的 SP（近似「持续释放技能」）

/**
 * 颂乐人偶: 只要有成员在场即激活（thresholds [1..5]）。成员特质（每层叠加，5 人全部 ×2）：
 *   Amoris   全体颂乐人偶成员 ATK +(amoris_atk + amoris_atk_per·L)
 *   Timoris  成员攻击命中敌人：prob = (timoris_prob + timoris_prob_per·L) 停顿 timoris_dur 秒
 *   Mortis   成员攻击附带凋亡损伤 = (mortis_pct + mortis_pct_per·L) × 攻击力
 *   Doloris  Fever 获得量 ×fever_ratio
 *   Oblivionis 非成员干员获得上述三项效果的 obliv_share（5 人时再 ×2）
 *   Fever 系统见头注释。
 */
function installAveMujica(battle, pid, bb, members) {
  const memberSet = new Set(members);
  const st = S.battleStore(battle, 'avemujica:st', () => ({ fever: 0, until: -Infinity }));
  const L = () => S.bondLayers(battle, pid, 'aveMujica');
  const dbl = () => (reached(battle, pid, 'aveMujica', 5) ? 2 : 1);
  const roles = () => {
    const r = { amoris: false, timoris: false, mortis: false, doloris: false, oblivionis: false };
    for (const u of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
      const k = roleOf(u);
      if (k) r[k] = true;
    }
    return r;
  };
  const feverOn = () => battle.time < st.until;
  const allOps = () => S.playerOps(battle, pid, { fieldOnly: true });

  // ---- Amoris: 成员 ATK buff（refresh: deploy / layerGain / battleStart）
  const applyAtk = () => {
    const r = roles();
    const d = dbl();
    const pct = (num(bb.amoris_atk, 0.25) + num(bb.amoris_atk_per, 0.005) * L()) * d;
    const share = num(bb.obliv_share, 0.25) * d;
    for (const u of allOps()) {
      const isM = memberSet.has(u);
      const eff = isM ? pct : (r.oblivionis ? pct * share : 0);
      if (r.amoris && eff > 0) S.passiveBuff(battle, u, 'bond:avemujica:atk', S.directMods({ atk: eff }));
      else battle.removeBuff(u, 'bond:avemujica:atk');
    }
  };
  applyAtk();
  onLayers(battle, pid, 'aveMujica', applyAtk);
  battle.on('deploy', ({ unit }) => { if (unit.ownerId === pid) applyAtk(); });
  battle.on('battleStart', applyAtk);

  // ---- Timoris / Mortis / Fever 的伤害钩子（对每个己方干员注册；丰川祥子在场时非成员吃 25%）
  const gainFever = (n) => {
    if (feverOn()) return;
    const r = roles();
    const mult = (r.doloris ? num(bb.fever_ratio, 2) : 1) * dbl();
    st.fever = Math.min(FEVER_CAP, st.fever + n * mult);
    if (st.fever >= FEVER_CAP) {
      st.fever = 0;
      st.until = battle.time + FEVER_TIME;
      S.fxOn(battle, 'fever', null, 'bond:avemujica', 'fever', { duration: FEVER_TIME });
    }
  };
  const onDmg = (ctx) => {
    const u = ctx.source, t = ctx.target, dmg = ctx.dmg;
    if (!u || !dmg || !dmg.isAttack || !isEnemyTarget(t) || ownTag(dmg, 'bond:avemujica')) return;
    const r = roles();
    const d = dbl();
    const share = memberSet.has(u) ? 1 : (r.oblivionis ? num(bb.obliv_share, 0.25) * d : 0);
    if (!(share > 0)) return;
    if (r.timoris) {
      const p = (num(bb.timoris_prob, 0.25) + num(bb.timoris_prob_per, 0.001) * L()) * d * share;
      if (p > 0 && battle.rng() < Math.min(1, p)) {
        battle.applyStatus(t, 'sluggish', { duration: num(bb.timoris_dur, 1), source: u });
      }
    }
    if (r.mortis) {
      const pct = (num(bb.mortis_pct, 0.25) + num(bb.mortis_pct_per, 0.0025) * L()) * d * share;
      if (pct > 0) {
        battle.dealDamage(u, t, { amount: pct * u.s.atk, type: 'element', element: 'apoptosis', canDodge: false, tags: ['bond:avemujica'] });
      }
    }
    gainFever(FEVER_PER_HIT);
  };
  for (const u of S.playerOps(battle, pid, { fieldOnly: false })) onUnitDamaged(battle, u, onDmg);

  // ---- Fever 状态: 每 0.5 s 给在场成员大量 SP 回复（近似持续释放技能）
  battle.every(0.5, () => {
    if (!feverOn()) {
      for (const m of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) battle.removeBuff(m, FEVER_BUF);
      return;
    }
    for (const m of S.bondMembers(battle, pid, 'aveMujica', { fieldOnly: true })) {
      if (!m.skill) continue;
      battle.addBuff(m, { key: FEVER_BUF, duration: 0.6, refresh: 'replace', mods: { spRecoveryFlat: FEVER_SP_FLAT } });
    }
  }, { immediate: true });
}

registerBondInstaller('aveMujica', installAveMujica);

// =====================================================================================================================
// 干员个人特质（workshop/ave-mujica/garrisons.json）
//   祥子  AVEMUJICA_FEVER_KILL    <战斗开始时>Fever += 层数×fever_ratio；击倒敌人 → 所有活跃盟约层数 +kill_layers
//   初华  AVEMUJICA_EXTRA_TRIGGER 放大器（extra_trigger 次）+ 源为祥子时所有活跃盟约 +partner_layers（每场 1 次）
//   海铃  AVEMUJICA_REFRESH_LAYERS <刷新时>自身所属已激活盟约层数 +layers（prep，registry.garrison）
//   若麦  AVEMUJICA_PREP_REWARD    <进入休整期时>成员<check_count → 免费刷新 refresh 次；否则 +fund 资金（prep）

/** 所有活跃盟约层数 +n（「使所有已激活的盟约层数+…」——同蜜莓官方写法，含颂乐人偶自身）。 */
function addLayersToActive(battle, pid, n, source) {
  const ps = S.player(battle, pid);
  if (!ps || !ps.bonds || !(n > 0)) return;
  for (const [bid, bs] of Object.entries(ps.bonds)) {
    if (!bs || !bs.active) continue;
    S.gainLayers(battle, { playerId: pid, bonds: [bid], n, requireActive: false, source, reason: 'garrison' });
  }
}

registerGarrisonInstaller('AVEMUJICA_FEVER_KILL', (battle, list) => {
  for (const it of list) {
    const u = it.unit;
    battle.on('battleStart', () => {
      if (!u || !S.onField(u)) return;
      const st = S.battleStore(battle, 'avemujica:st', () => ({ fever: 0, until: -Infinity }));
      const L = S.bondLayers(battle, u.ownerId, 'aveMujica');
      const add = Math.floor(L * S.num(it.bb.fever_ratio, 0.5));
      if (add > 0) st.fever = Math.min(FEVER_CAP, st.fever + add);
    });
    battle.on('kill', ({ killer }) => {
      if (!killer || killer !== u || !S.onField(u)) return;
      addLayersToActive(battle, u.ownerId, Math.max(1, Math.floor(S.num(it.bb.kill_layers, 1))), u);
      // 初华连携: 触发干员为丰川祥子（祥子的击倒特质触发）时, 场上有初华 → 所有活跃盟约 +partner_layers（每场 1 次）
      const st = S.battleStore(battle, 'avemujica:partner', () => ({ used: false }));
      if (st.used) return;
      let partner = null;
      for (const m of S.bondMembers(battle, u.ownerId, 'aveMujica', { fieldOnly: true })) {
        if (roleOf(m) === 'doloris') { partner = m; break; }
      }
      if (!partner) return;
      const g = S.garrisonRecord(partner.def?.raw?.garrisonIds?.[0] || partner.def?.garrisonIds?.[0]);
      if (!g || g.effectKey !== 'AVEMUJICA_EXTRA_TRIGGER') return;
      st.used = true;
      addLayersToActive(battle, u.ownerId, Math.max(1, Math.floor(S.num(g.bb.partner_layers, 2))), partner);
    });
  }
});

registerGarrisonInstaller('AVEMUJICA_EXTRA_TRIGGER', (battle, list) => {
  if (!battle._rbAmplifiers) battle._rbAmplifiers = [];
  for (const it of list) {
    const amp = { unit: it.unit, bb: it.bb, usedOnce: false };
    amp.onAmp = (b2, srcIt, src) => {
      if (amp.usedOnce || roleOf(src) !== 'oblivionis') return;
      amp.usedOnce = true; // 每回合（= 每场战斗）1 次
      addLayersToActive(b2, src.ownerId, Math.max(1, Math.floor(S.num(it.bb.partner_layers, 2))), amp.unit);
    };
    battle._rbAmplifiers.push(amp);
  }
});

// =====================================================================================================================
// 休整期 (prep) 侧

const BOND_KEY = 'act2autochess_bond_eff_avemujica';
/** 派发时从 ctx.gd（匹配的合并数据）读参数 —— 不在 boot 注册时读 sim 侧 gameData()。 */
function params(ctx) {
  const rec = ctx.gd && typeof ctx.gd.bond === 'function' ? ctx.gd.bond('aveMujica') : null;
  const buff = rec && Array.isArray(rec.buffs) ? rec.buffs.find((b) => b && (b.bbStr?.key === BOND_KEY || b.key === BOND_KEY)) : null;
  return buff ? { ...(buff.bb || {}) } : {};
}
const tierOf = (ctx) => { const b = typeof ctx.bond === 'function' ? ctx.bond('aveMujica') : null; return b && Number.isInteger(b.tier) ? b.tier : 0; };
const dblOf = (ctx) => (tierOf(ctx) >= 5 ? 2 : 1);
const memberCount = (ctx) => { const b = typeof ctx.bond === 'function' ? ctx.bond('aveMujica') : null; return b && Number.isInteger(b.count) ? b.count : 0; };

/** 休整期处理器的注册（server boot 时由 content/index.js registerAllMeta 调用）。 */
export function registerMeta(registry) {
  registry.bond('aveMujica', {
    // 1人: 每刷新6次（5人时每3次），获得1名阶级不超过调度中心的随机颂乐人偶干员
    onRefresh(ctx) {
      if (tierOf(ctx) < 1) return;
      const p = params(ctx);
      const every = Math.max(1, Math.floor(num(p.refresh_every, 6) / dblOf(ctx)));
      const next = ctx.counter('avemujica:refresh') + 1;
      ctx.setCounter('avemujica:refresh', next);
      if (next % every !== 0) return;
      const tier = Math.max(1, ctx.shopLevel());
      const id = ctx.rollChess({ bond: 'aveMujica', maxTier: tier });
      if (id) ctx.grantChess(id, { source: 'bond:aveMujica' });
    },
    // 2人: 休整期结束时，每有1名颂乐人偶成员，使已激活的盟约层数 +2（5人时 +4）
    onPrepEnd(ctx) {
      if (tierOf(ctx) < 2) return;
      const p = params(ctx);
      const per = Math.max(1, Math.floor(num(p.prep_layer, 2) * dblOf(ctx)));
      const n = memberCount(ctx) * per;
      if (!(n > 0)) return;
      for (const b of bondOrder(ctx)) if (ctx.bondActive(b)) ctx.addLayers(b, n, { requireActive: false });
    },
    // 3人: 进入休整期（新轮开始）时，每有1名颂乐人偶成员，额外获得 prep_fund 资金（5人时翻倍）
    onRoundStart(ctx) {
      if (tierOf(ctx) < 3) return;
      const p = params(ctx);
      const fund = Math.max(1, Math.floor(num(p.prep_fund, 1) * dblOf(ctx)));
      const n = memberCount(ctx);
      if (n > 0) ctx.addFunds(n * fund, 'bond:aveMujica');
    },
    // 4人: 可部署干员数量上限 +1（5人盟约效果翻倍 → +2）。固定值，不再随成员数变化；随 tier 增减动态调整 deployCapBonus。
    onPrepStart(ctx) {
      const p = params(ctx);
      const want = tierOf(ctx) >= 4 ? Math.max(1, Math.floor(num(p.deploy_slot, 1) * dblOf(ctx))) : 0;
      const prev = ctx.counter('avemujica:deploy');
      if (want !== prev) {
        ctx.addDeployCap(want - prev);
        ctx.setCounter('avemujica:deploy', want);
      }
    },
  });

  // 海铃: <刷新时>使自身所属已激活盟约层数 +layers
  registry.garrison('AVEMUJICA_REFRESH_LAYERS', {
    run(ctx) {
      const src = ctx.source || {};
      const piece = src.piece;
      const bb = src.bb || {};
      if (!piece || !piece.id) return;
      const rec = ctx.gd.chess(piece.id);
      const n = Math.max(1, Math.floor(num(bb.layers, 1)));
      if (!rec || !Array.isArray(rec.bonds)) return;
      for (const b of rec.bonds) if (ctx.bondActive(b)) ctx.addLayers(b, n, { requireActive: false });
    },
  });

  // 若麦: <进入休整期时>成员数 <check_count → 免费刷新 refresh 次；否则 +fund 资金
  registry.garrison('AVEMUJICA_PREP_REWARD', {
    run(ctx) {
      const src = ctx.source || {};
      const bb = src.bb || {};
      const count = typeof ctx.bondCount === 'function' ? ctx.bondCount('aveMujica') : 0;
      const check = Math.max(1, Math.floor(num(bb.check_count, 3)));
      if (count < check) {
        const f = Math.max(1, Math.floor(num(bb.refresh, 1)));
        if (typeof ctx.grantFreeRefresh === 'function') ctx.grantFreeRefresh(f);
      } else {
        const v = Math.max(1, Math.floor(num(bb.fund, 1)));
        ctx.addFunds(v, 'bond:aveMujica');
      }
    },
  });

  // 策略【无忧梦呓】（band_wuyouyoumeng，图标干员丰川祥子，初始生命21）: 每回合首次获得<颂乐人偶>干员时，
  // 获得1位阶级等于调度中心的随机干员。经白名单扩展点 Registry.band 注册（band 分发覆盖 onGain，ev 含被获得
  // 干员），无需改官方 bands/meta.js。数据见 workshop/ave-mujica/bands.json + effects.json。
  registry.band('band_wuyouyoumeng', {
    onGain(ctx, ev) {
      const KEY = 'band:wuyouyoumeng:used';
      const BUFF = 'band_wuyouyoumeng_first_gain_bond_gain_random_char';
      // 每回合首次：本回合已触发过则不再触发
      if (ctx.counter(KEY) === ctx.round) return;
      const piece = ev && ev.piece;
      if (!piece || piece.kind !== 'chess') return;
      const rec = typeof ctx.gd.chess === 'function' ? ctx.gd.chess(piece.id) : null;
      if (!rec || !Array.isArray(rec.bonds) || !rec.bonds.includes('aveMujica')) return;
      // 读参数（未来可调 count/bond；默认获得 1 位）
      const buff = Array.isArray(ctx.band && ctx.band.buffs)
        ? ctx.band.buffs.find((b) => b && b.key === BUFF) : null;
      const count = Math.max(1, Math.floor(num(buff && buff.bb && buff.bb.count, 1) || 1));
      ctx.setCounter(KEY, ctx.round);
      const tier = Math.max(1, ctx.shopLevel());
      for (let k = 0; k < count; k++) {
        const id = ctx.rollChess({ maxTier: tier });
        if (id) ctx.grantChess(id, { source: 'band' });
      }
    },
  });
}
