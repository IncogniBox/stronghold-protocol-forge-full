// server/sim/content/bonds/core.js — the 8 core bonds (核心盟约, research 02 §3.1–3.8), battle side + prep side.
//
//   炎 yanShip           members ATK +(base_atk + atk_per_stack·L); 6: one “炎佑” (its template ATK / max HP + 30 %
//                        of the 炎 ATK / max HP sums at battle start — PRTS "增加…（最终加算）"); 9: two 炎佑, ATK ×atk,
//                        damage taken ×(1 − damage_resistance)
//   (every bond "+X%" ATK / max HP here is 直接乘算 — S.directMods, additive with the other percentages, PRTS 盟约记录)
//   萨尔贡 sargonShip    member skill start → every member on the field gets an independent stack (ASPD +base_attack_speed
//                        for base_time + time_per_stack·L s, ≤ max_buff_stack_cnt); 6: each stack also ATK +base_atk
//                        (additive, one 直接乘算 buff); 6 + band_narant: instead lends the caster's equipment (tier ≤
//                        filter_item_level) to the 8 surrounding operators (items.js lendItemEffects)
//   维多利亚 victoriaShip members carrying equipment deal ×(base_damage_scale + damage_scale_per_stack·L);
//                        6: ATK +atk_normal_equip per item (+atk_golden_equip more per golden item; 直接乘算);
//                        prep: every `layer` layers → `count` item(s) from `pool` (bond_layer_added_reward_equip)
//   谢拉格 kjeragShip    members deal ×base_damage_scale, vs cold / frozen enemies ×(base_ex_damage_scale +
//                        ex_damage_scale_per_stack·L) instead; 6: cold wind (devices.js kjeragColdWind)
//   拉特兰 lateranoShip  member ammo skills start with floor(ammo × (1 + base_ammo_percent + ammo_percent_per_stack·L));
//                        6: every ammo used by a member → all members ATK +atk_per_consume (≤ max_atk_for_consume)
//   阿戈尔 egirShip      members max HP +(base_max_hp + max_hp_per_stack·L) (直接乘算); battle start devour (see devour():
//                        the marker's gained base ATK is a 最终加算, `atkFinal`, not scaled by its ATK +%);
//                        5: max_free_respawn_cnt free redeploys, one per member on its first knock-out — the devour's
//                        knock-outs by board position once every devour is over (egirReviveScan), later ones at once
//   叙拉古 siracusaShip  every member deployment: ASPD +(base + per·L) for (base_duration + per·L) s; 6: 隐匿 for the same
//                        time, and while hidden / end_duration s after, every 普通伤害 hit (siracusaRolls) procs (PRD,
//                        nominal `prob`) base_damage + damage_per_stack·L true damage + fear `fear` s
//   卡西米尔 kazimierzShip every deployment of one of the player's operators (initial ones included): members ATK
//                        +atk_when_born, total ≤ base_max_atk_when_born + max_atk_when_born_per_stack·L; 6: blocking
//                        members pulse damage_atk_scale×ATK true damage + stun around them every damage_interval s,
//                        non-blocking members' attacks add pure_atk_scale×ATK true damage
//
// Numbers: data/bonds.json buffs (support.buffParams by bbStr.key); 炎佑's 30 % is parsed from the effect text.
// Tiers: a bond's upper tier is reached when count ≥ the blackboard threshold (power_bond_char_cnt / ex_bond_char_cnt)
// or the bond's tier index says so. Members = support.isMember (own bonds, 变形同构体, 调和 enjoying core bonds).
// Live layers: effects that read L at a moment (stack duration, ammo, deploy buffs, proc damage, cold multiplier) read
// the live value; standing buffs (炎 ATK, 维多利亚, 阿戈尔 HP, 卡西米尔 cap) are refreshed one tick after a `layerGain`.
// Two players in one field: everything is per player (own members, own deployments); the 谢拉格 wind and 炎佑 act on
// every enemy of the field (debuffs on shared enemies help both, research 06 §8.6).
// Hook priorities: 拉特兰 skillStart −10 (after kits' own ammo changes), 阿戈尔 death 11 (5-tier revive, before 不屈's
// death 10; every `fatal` saver runs before any death hook), layerGain −100 (after 魔王-style modifiers).

import * as S from '../support/index.js';
import { mitigate } from '../../damage.js';
import { spawnYanyou, spawnWolfLord } from '../tokens.js';
import { kjeragColdWind } from '../devices.js';
import * as items from '../items.js';
import { FORCED_EXIT } from '../../constants.js';
import { msg } from '../../../../shared/i18n.js';
import { bbCap } from '../../../../shared/plugins/officialBounds.js';
import { textFinite } from '../../../../shared/plugins/textNumber.js';

const num = S.num;

/** Injection point for tests (lendItemEffects stub); null ⇒ items.js export. */
export const deps = { lendItemEffects: null };

const BUFF_KEYS = Object.freeze({
  yanShip: 'act1autochess_bond_eff_yan',
  sargonShip: 'act1autochess_bond_eff_sargon',
  victoriaShip: 'act1autochess_bond_eff_victoria',
  kjeragShip: 'act1autochess_bond_eff_kjerag',
  lateranoShip: 'act1autochess_bond_eff_laterano',
  egirShip: 'act1autochess_bond_eff_egir',
  siracusaShip: 'act2autochess_bond_eff_siracusa',
  kazimierzShip: 'act2autochess_bond_eff_kazimierz',
});
const SARGON_SHARE_KEY = 'act2autochess_bond_eff_sargon[share]';
const VICTORIA_REWARD_KEY = 'bond_layer_added_reward_equip';
const VICTORIA_COUNTER = 'bond:victoria:hammers';

/**
 * Bond effect blackboard `{ ...bb, ...bbStr }` of a core bond (null when the data record is missing).
 *
 * `key` 默认取 `BUFF_KEYS[bondId]`：官方盟约的 buff 记录不止一条，中心表按效果 buff 键选定「效果」那一条。
 * **取不到就回退到记录自己的 `bbStr.key`** —— 工坊 mod 盟约的记录就是它自己，效果 buff 键已经写在记录里；
 * 有了回退，新增 mod 盟约不必再到引擎里手工登记一行，也就不会因为漏登记而让 `install()` 里
 * `if (!bb) continue` 静默跳过整块战斗效果（哥伦比亚盟约 2026-10-12 实测踩过这个坑）。
 */
export function bondBb(bondId, key = BUFF_KEYS[bondId]) {
  const rec = S.bondRecord(bondId);
  if (!rec) return null;
  const hit = key ? S.buffParams(rec, key) : null;
  if (hit) return hit;
  const own = rec.bbStr && typeof rec.bbStr.key === 'string' && rec.bbStr.key ? rec.bbStr.key : null;
  return own && own !== key ? S.buffParams(rec, own) : hit;
}

/** Has player `pid` reached the tier of `bondId` that needs `cnt` members? (active + count / tier index) */
export function reached(battle, pid, bondId, cnt) {
  const st = S.bondState(battle, pid, bondId);
  if (!st || !st.active) return false;
  const need = num(cnt, 0);
  if (!(need > 0)) return true;
  if (num(st.count, 0) >= need) return true;
  const th = S.bondRecord(bondId)?.thresholds;
  const idx = Array.isArray(th) ? th.indexOf(need) : -1;
  return idx >= 0 && S.bondTier(battle, pid, bondId) >= idx + 1;
}

/** "总和的30%" → 0.3 (炎佑 stat share, text only). A percent, not a count: finite, not forced to 64. */
export function yanyouShare() {
  const text = String(S.bondRecord('yanShip')?.effectDesc ?? S.bondRecord('yanShip')?.desc ?? '');
  const raw = textFinite(text, /总和的\s*(\d+(?:\.\d+)?)\s*%/, NaN);
  const v = Number(raw) / 100;
  return v > 0 && v <= 10 ? v : 0.3;
}

const PRD = new Map();
/**
 * Pseudo-random-distribution constant C for a nominal probability p: attempt n since the last proc succeeds with
 * min(1, C·n), and the long-run proc rate equals p (3 % → C ≈ 0.00139, research 02 §3.7).
 */
export function prdConstant(p) {
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  if (PRD.has(p)) return PRD.get(p);
  const rate = (c) => {
    let exp = 0, notYet = 1;
    const nMax = Math.ceil(1 / c) + 1;
    for (let n = 1; n <= nMax && notYet > 0; n++) {
      const pn = Math.min(1, n * c);
      exp += n * notYet * pn;
      notYet *= 1 - pn;
    }
    return exp > 0 ? 1 / exp : 1;
  };
  let lo = 0, hi = p;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (rate(mid) < p) lo = mid; else hi = mid;
  }
  const c = (lo + hi) / 2;
  PRD.set(p, c);
  return c;
}

// =====================================================================================================================
// per-battle plumbing

/** Shared per-battle state: layer refreshers, one hit / damaged / skillStart dispatch per battle. */
function core(battle) {
  return S.battleStore(battle, 'bonds:core', () => ({
    refreshers: new Map(), // `${pid}|${bondId}` → [fn]
    pending: new Set(),
    hitFns: new Map(),     // source unit → [fn(ctx)]
    dmgFns: new Map(),     // source unit → [fn(ctx)]
    hooked: new Set(),
  }));
}

export function onLayers(battle, pid, bondId, fn) {
  const st = core(battle);
  const k = `${pid}|${bondId}`;
  if (!st.refreshers.has(k)) st.refreshers.set(k, []);
  st.refreshers.get(k).push(fn);
  if (st.hooked.has('layerGain')) return;
  st.hooked.add('layerGain');
  battle.on('layerGain', (c) => {
    const key = `${c.playerId}|${c.bondId}`;
    const list = st.refreshers.get(key);
    if (!list || st.pending.has(key)) return;
    st.pending.add(key);
    // the gain is recorded after the hook: re-read the live layers next tick
    battle.after(0, () => { st.pending.delete(key); for (const f of list) f(); });
  }, { priority: -100 });
}

function onUnitHit(battle, unit, fn) {
  const st = core(battle);
  if (!st.hitFns.has(unit)) st.hitFns.set(unit, []);
  st.hitFns.get(unit).push(fn);
  if (st.hooked.has('hit')) return;
  st.hooked.add('hit');
  battle.on('hit', (c) => {
    const list = c.source ? st.hitFns.get(c.source) : undefined;
    if (list) for (let i = 0; i < list.length; i++) list[i](c);
  });
}

export function onUnitDamaged(battle, unit, fn) {
  const st = core(battle);
  if (!st.dmgFns.has(unit)) st.dmgFns.set(unit, []);
  st.dmgFns.get(unit).push(fn);
  if (st.hooked.has('damaged')) return;
  st.hooked.add('damaged');
  battle.on('damaged', (c) => {
    const list = c.source ? st.dmgFns.get(c.source) : undefined;
    if (list) for (let i = 0; i < list.length; i++) list[i](c);
  });
}

export const isEnemyTarget = (t) => !!t && t.side === 'enemy' && t.alive;
export const ownTag = (dmg, tag) => !!dmg && Array.isArray(dmg.tags) && dmg.tags.includes(tag);

// =====================================================================================================================
// 炎

function installYan(battle, pid, bb, members) {
  if (bb.recon) return installYanRecon(battle, pid, bb, members, bb.recon);
  const L = () => S.bondLayers(battle, pid, 'yanShip');
  const apply = () => {
    const mods = S.directMods({ atk: num(bb.base_atk) + num(bb.atk_per_stack) * L() });
    for (const u of members) S.passiveBuff(battle, u, 'bond:yan', mods);
  };
  apply();
  onLayers(battle, pid, 'yanShip', apply);
  if (!reached(battle, pid, 'yanShip', bb.power_bond_char_cnt)) return;
  const ex = reached(battle, pid, 'yanShip', bb.ex_bond_char_cnt);
  battle.on('battleStart', () => {
    // PRTS: the sums count real 炎 operators only (调和 operators' stats are not collected unless they are 炎 too)
    let atk = 0, hp = 0;
    for (const u of S.playerOps(battle, pid, { fieldOnly: true })) {
      if (!S.unitBonds(u).includes('yanShip')) continue;
      atk += num(u.s.atk, 0);
      hp += num(u.s.maxHp, 0);
    }
    if (!(hp > 0)) return;
    const share = yanyouShare();
    const out = spawnYanyou(battle, pid, {
      atk: atk * share, hp: hp * share, count: ex ? 2 : 1,
      atkMul: ex ? num(bb.atk, 1) : 1,
      dmgTakenMul: ex ? Math.max(0, 1 - num(bb.damage_resistance, 0)) : 1,
    });
    for (const y of out) y.mem.bondYan = true;
  }, { once: true });
}

// =====================================================================================================================
// 萨尔贡

function installSargon(battle, pid, bb, members) {
  if (bb.recon) return installSargonRecon(battle, pid, bb, members, bb.recon);
  const memberSet = new Set(members);
  const ps = S.player(battle, pid);
  const share = S.buffParams(S.bondRecord('sargonShip'), SARGON_SHARE_KEY);
  const band = ps?.bandId ?? null;
  const narant = !!(share && band && share.valid_in_band === band);
  const main = narant ? share : bb;
  const six = reached(battle, pid, 'sargonShip', num(main.power_bond_char_cnt, 6));
  const atkStacks = six && !narant && !(bb.invalid_in_band && bb.invalid_in_band === band);
  const maxStacks = Math.max(1, Math.floor(num(main.max_buff_stack_cnt, 25)));
  const perAtk = num(bb.base_atk, 0);
  const syncAtk = (u) => {
    if (!atkStacks) return;
    let n = 0;
    for (const b of u.buffs) if (b.key === 'bond:sargon') n++;
    if (n > 0 && u.alive) battle.addBuff(u, { key: 'bond:sargon:atk', mods: S.directMods({ atk: perAtk * n }) });
    else battle.removeBuff(u, 'bond:sargon:atk');
  };
  battle.on('skillStart', ({ unit }) => {
    if (!memberSet.has(unit)) return;
    const L = S.bondLayers(battle, pid, 'sargonShip');
    const dur = num(main.base_time, 0) + num(main.time_per_stack, 0) * L;
    if (dur > 0) {
      for (const m of members) {
        if (!S.onField(m)) continue;
        battle.addBuff(m, {
          key: 'bond:sargon', duration: dur, refresh: 'independent', maxStacks,
          mods: { aspd: num(main.base_attack_speed, 0) },
          onExpire: ({ unit: u }) => syncAtk(u), onRemove: ({ unit: u }) => syncAtk(u),
        });
        syncAtk(m);
      }
    }
    if (narant && six) lendAround(battle, unit, share, S.bondLayers(battle, pid, 'sargonShip'));
  });
}

function lendAround(battle, from, share, L) {
  if (!S.itemsOf(from).length) return;
  const lend = typeof deps.lendItemEffects === 'function' ? deps.lendItemEffects
    : typeof items.lendItemEffects === 'function' ? items.lendItemEffects : null;
  if (!lend) return;
  const duration = num(share.base_power_time, 0) + num(share.power_time_per_stack, 0) * L;
  if (!(duration > 0)) return;
  const maxTier = num(share.filter_item_level, 5);
  let n = 0;
  for (const a of S.alliesAround(battle, from, S.N8)) {
    if (!S.isOp(a)) continue;
    lend(battle, from, a, { maxTier, duration });
    n++;
  }
  if (n) S.fxOn(battle, 'bondShare', from, 'bond:sargonShip', 'narant', { n, duration });
}

// =====================================================================================================================
// 维多利亚

function installVictoria(battle, pid, bb, members) {
  const apply = () => {
    const mul = num(bb.base_damage_scale, 1) + num(bb.damage_scale_per_stack, 0) * S.bondLayers(battle, pid, 'victoriaShip');
    for (const u of members) {
      if (S.itemsOf(u).length >= 1) S.passiveBuff(battle, u, 'bond:victoria', { dmgDealtMul: mul });
    }
  };
  apply();
  onLayers(battle, pid, 'victoriaShip', apply);
  if (!reached(battle, pid, 'victoriaShip', bb.power_bond_char_cnt)) return;
  const normal = num(bb.atk_normal_equip, 0), golden = normal + num(bb.atk_golden_equip, 0);
  for (const u of members) {
    const ids = S.itemsOf(u);
    if (!ids.length) continue;
    let add = 0;
    for (const id of ids) add += S.isGoldenId(id) ? golden : normal;
    if (add > 0) S.passiveBuff(battle, u, 'bond:victoria:atk', S.directMods({ atk: add }));
  }
}

// =====================================================================================================================
// 谢拉格

function installKjerag(battle, pid, bb, members) {
  const base = num(bb.base_damage_scale, 1);
  for (const u of members) S.passiveBuff(battle, u, 'bond:kjerag', { dmgDealtMul: base });
  const ex = num(bb.base_ex_damage_scale, base), per = num(bb.ex_damage_scale_per_stack, 0);
  const onHit = (c) => {
    const t = c.target;
    if (!isEnemyTarget(t) || !c.dmg) return;
    const f = t.s.flags;
    if (!f.cold && !f.freeze) return;
    const target = ex + per * S.bondLayers(battle, pid, 'kjeragShip');
    if (base > 0 && target > 0) c.dmg.mul *= target / base;
  };
  for (const u of members) onUnitHit(battle, u, onHit);
  if (reached(battle, pid, 'kjeragShip', bb.power_bond_char_cnt)) kjeragColdWind(battle, pid, bb);
  // ---- 重构模拟（`bb.recon`）：3 名寒风 / 6 名寒冷·冻结的物理与法术脆弱 / 9 名攻击寒冷·冻结的敌人叠自身攻速
  const rk = bb.recon;
  if (!rk) return;
  const rt = Math.max(1, S.bondTier(battle, pid, 'kjeragShip'));
  if (rt >= num(rk.brittleAt, 2)) {
    const val = num(rk.brittle, 0.15);
    battle.every(0.5, () => {
      for (const e of battle.enemies) {
        if (!e || !e.alive || !(e.s.flags.cold || e.s.flags.freeze)) continue;
        if (val > 0) battle.applyStatus(e, 'physFragile', { duration: 0.6, value: val, source: null });
        if (val > 0) battle.applyStatus(e, 'artsFragile', { duration: 0.6, value: val, source: null });
      }
    });
  }
  if (rt >= num(rk.hasteAt, 3)) {
    const add = num(rk.hasteAspd, 2);
    const maxStacks = Math.max(1, Math.floor(num(rk.hasteMax, 50)));
    const dur = num(rk.hasteTime, 5);
    if (add > 0 && dur > 0) {
      for (const u of members) {
        onUnitHit(battle, u, (c) => {
          const t = c.target, dmg = c.dmg;
          if (!dmg || !dmg.isAttack || !isEnemyTarget(t)) return;
          if (!(t.s.flags.cold || t.s.flags.freeze)) return;
          // 攻速 +N（可叠加，最多 maxStacks 层），每层 5 秒；`refresh:'stack'` 同时把持续时间刷回满
          battle.addBuff(u, { key: 'bond:kjerag:haste', duration: dur, refresh: 'stack', stacks: 1, maxStacks, mods: { aspd: add }, source: u });
        });
      }
    }
  }
}

// =====================================================================================================================
// 拉特兰

function installLaterano(battle, pid, bb, members) {
  const memberSet = new Set(members);
  battle.on('skillStart', ({ unit, skill }) => {
    if (!memberSet.has(unit) || !skill || skill.kind !== 'ammo' || !(skill.ammoLeft > 0)) return;
    const mul = 1 + num(bb.base_ammo_percent, 0) + num(bb.ammo_percent_per_stack, 0) * S.bondLayers(battle, pid, 'lateranoShip');
    const n = Math.floor(skill.ammoLeft * mul + 1e-9);
    if (Number.isFinite(n) && n > skill.ammoLeft) skill.ammoLeft = n;
  }, { priority: -10 });
  if (!reached(battle, pid, 'lateranoShip', bb.power_bond_char_cnt)) return;
  const per = num(bb.atk_per_consume, 0), cap = num(bb.max_atk_for_consume, Infinity);
  if (!(per > 0)) return;
  const st = { used: 0, bonus: 0 };
  battle.on('ammoUsed', ({ unit }) => {
    if (!memberSet.has(unit) || st.bonus >= cap) return;
    st.used++;
    st.bonus = Math.min(cap, st.used * per);
    for (const m of members) S.passiveBuff(battle, m, 'bond:laterano:ammo', S.directMods({ atk: st.bonus }));
  });
  // ---- 重构模拟（`bb.recon`）：6 名消耗弹药 25% 补相邻 1 发 / 9 名每发弹药附带 2% 生命上限真伤（≤20000）
  const rl = bb.recon;
  if (!rl) return;
  const lt = Math.max(1, S.bondTier(battle, pid, 'lateranoShip'));
  if (lt >= num(rl.refillAt, 2)) {
    const chanceP = num(rl.refillChance, 0.25);
    battle.on('ammoUsed', ({ unit }) => {
      if (!memberSet.has(unit) || !(chanceP > 0) || !battle.rng.chance(chanceP)) return;
      const cands = S.alliesAround(battle, unit, S.N8)
        .filter((a) => a && a !== unit && a.kind === 'op' && a.skill && a.skill.kind === 'ammo' && a.skill.active && a.skill.ammoLeft < a.skill.ammoMax);
      if (!cands.length) return;
      const t = battle.rng.pick(cands);
      if (t && t.skill.gainAmmo(1)) S.fxOn(battle, 'ammoGain', t, 'bond:lateranoShip', 'refill', { from: unit.id, n: 1 });
    });
  }
  if (lt >= num(rl.hpAt, 3)) {
    const pct = num(rl.hpPct, 0.02), hpCap = num(rl.hpCap, 20000);
    for (const u of members) {
      onUnitDamaged(battle, u, (c) => {
        const t = c.target, dmg = c.dmg;
        if (!dmg || !dmg.isAttack || !isEnemyTarget(t) || ownTag(dmg, 'bond:laterano')) return;
        if (!(u.skill && u.skill.kind === 'ammo' && u.skill.active)) return;
        const amount = Math.min(num(t.s.maxHp, 0) * pct, hpCap);
        if (amount > 0) battle.dealDamage(u, t, { amount, type: 'true', canDodge: false, tags: ['bond:laterano'] });
      });
    }
  }
}

// =====================================================================================================================
// 阿戈尔

// "更靠左和靠上": left first (on the player's own board: mirrored players count from the field's right), then top first —
// row 0 is the BOTTOM row (DESIGN §3), so the top of the board is the highest row index. The order is a board position,
// independent of the members' directions (only "身前" follows each member's `dir`). The devour marks in this order (PRTS
// "从最先部署（更靠左和靠上的）的【阿戈尔】干员开始"; the battle's initial deployment order, Battle.start).
const boardCol = (u) => (u.player && u.player.mirror ? -u.tileC : u.tileC);
const egirOrder = (a, b) => boardCol(a) - boardCol(b) || b.tileR - a.tileR || a.id - b.id;

// 5-tier revives of the battle-start devour's knock-outs: the player's scan 「检测左下到右上哪些鱼睡着了给他复活」 (a
// community report the owner relayed on 2026-10-07, DESIGN §25.22.5) — on the player's own board as the player sees it:
// row 0 is the bottom of the screen (render/projection.js: nearest the camera), col 0 its left; a mirrored player from its
// own left, the field's right, as egirOrder. [ASSUMED] the columns from the left, bottom first inside a column (the
// act-2 positional orders — the deployment and egirOrder — go column by column from the left). The other reading, the
// rows from the bottom with left first inside a row (act 1's deployment order), is
// `a.tileR - b.tileR || boardCol(a) - boardCol(b) || a.id - b.id`; test/content/bonds_core.test.js '阿戈尔 5 (community
// report, 2026-10-07) step 3: …' pins this one (its layout leaves a different member down under each reading).
const egirReviveScan = (a, b) => boardCol(a) - boardCol(b) || a.tileR - b.tileR || a.id - b.id;

/**
 * The battle-start devour window, shared by every player's 阿戈尔 on the field: `passes` = devour passes still to run
 * (one per player with the bond active, counted at install), `depth` > 0 while one resolves, `flush` = the 5-tier
 * players' revive batches, run once the last pass is over.
 */
function egirStart(battle) {
  return S.battleStore(battle, 'bonds:egir:start', () => ({ passes: 0, depth: 0, flush: [] }));
}

/**
 * 联防: an operator forced out at the deployment (carry.down, Battle.start, before battleStart) still stands on its
 * deploy position for the devour (PRTS 盟约记录 最先部署). The forced exit is not a knock-out, so it takes no 5-tier slot.
 */
function egirDownAtStart(battle, u) {
  return S.isOp(u) && !u.alive && u.removeReason === FORCED_EXIT && !!u.carry && u.carry.down === true
    && battle.isDown(u);
}

/**
 * Battle-start devour (research 02 §3.6 algorithm): members in order (further left on the player's own board — the
 * Final Assault right side is mirrored, so its board-left is the field's right — then higher on the board first) mark
 * the operator on the tile in front of them (one step along each member's own direction `dir`), and through marked
 * members the tiles in front of
 * those (chain); never themselves, a unit already marked by them or a unit that marked them. The marker gains the base
 * ATK and block count of everything it marked — the ATK as a 最终加算 (`atkFinal`, PRTS 盟约记录 "该付与来源获得所有标记单位
 * 的基础攻击力（最终加算）和阻挡数"): added after its percentages, so its skill's ATK +% does not scale it (it was `atkFlat`
 * until 0.1.3: 1000 base ATK, +100 %, +2000 devoured gave 6000 instead of 4000; GitHub #165 point 2, PR #176, the owner's
 * decision of 2026-10-06, DESIGN §24.7). Then each mark makes its target lose damage_value HP as a
 * 物理流失 (PRTS 盟约记录: "造成5000点物理流失", 修正 "【吞噬】的物理流失来源为被付与目标自身；单位被【吞噬】击杀时，击杀来源始终为
 * 对应标记的付与来源"; PRTS 作战机制: a 物理流失 "会受到目标当前防御力…影响而相应衰减") — less the target's DEF as a physical hit
 * (its own source: no DEF ignore), then battle.loseHp: no shields, dodge or damage multipliers (DEF-free until 0.1.1); the
 * kill is credited to the marker — in marking order. One 物理流失 per mark ("每个标记令目标受到一次5000点物理流失"): a member
 * in a chain loses one to every 阿戈尔 behind it (DESIGN §25.22.5: an elite 斯卡蒂 behind two of them, 7513 HP at 60
 * layers, loses 2 × 4751). A target knocked out during the pass has its remaining marks cancelled, also when it is back at
 * once (不屈's 立刻重新部署, 埃芒加德 / M3茧甲; the 5-tier revive waits for the last pass, installEgir): PRTS 盟约记录 "目标首次被
 * 击倒后解除自身被付与但还未触发的【吞噬】效果". Only the target's state cancels a mark: a marker knocked out by an earlier
 * mark still resolves its own, credited to it (PRTS names only the target; "击杀来源始终为对应标记的付与来源") — GitHub #165
 * point 3, PR #176, the owner's decision of 2026-10-06; until 0.1.3 a marker off the field gave no further mark.
 * Not modelled: the 流失's own source (PRTS: the target itself) — the hooks see the marker as the source, as for the
 * credit (an open question, DESIGN §24.7).
 * 联防: the operators down since the end of their own combat (forced out by Battle.start) mark, are marked and resolve
 * their marks like standing ones, but nothing resolves on them (below; per players' reports, owner's decision 2026-10-04).
 * Whose operator stands in front does not matter (PRTS "依次吞噬身前一格干员", no own-side limit; the owner's decision of
 * 2026-10-05 after GitHub #140 comment 4): on a shared field (联防, boss) a teammate's operator — standing, or entering
 * 联防 down — is marked like an own one, gives the same base ATK / block count, and the chain goes on through it when it
 * is an 阿戈尔 (S.isMember: its own bonds). Its knock-out is its owner's (their bonds' revives, 不屈 …), credited to the
 * marker as usual. Each devoured operator adds its tier to 阿戈尔 once (IN_BATTLE gain, disabled in 联防 / boss fields).
 * Tokens / devices / empty tiles are never devoured.
 */
function devour(battle, pid, bb, members) {
  // 联防: an operator down at the end of its own combat (carryState.down — Battle.start forced it out right before
  // battleStart, FORCED_EXIT) takes part in the devour as if it stood on its tile, then stays out: it marks in its turn,
  // it is "the unit in front" of another (the chain goes on through it when it is a member), its base ATK / block count
  // for its marker and its own marks resolve (their 物理流失 lands, credited to it as usual); only the marks ON it resolve
  // nothing — it is forced out, so it is never knocked out again, revived or devoured. Per players' reports (community
  // report #3, GitHub #33 item 3), owner's decision 2026-10-04; until 0.1.2 the forced exit came first and the chain broke.
  const downAtStart = (u) => egirDownAtStart(battle, u);
  const order = members.filter((u) => S.onField(u) || downAtStart(u)).sort(egirOrder);
  // the operator in front, whoever owns it (until 0.1.3 only the player's own): a living one, else one lying there since
  // the 联防 start (carry.down, forced out) — a teammate's included
  const opAt = (u) => {
    const [r, c] = S.frontTile(u);
    const a = S.allyAt(battle, r, c);
    if (a) return S.isOp(a) && a.alive ? a : null;
    const d = battle.downOn(r, c);
    return d && downAtStart(d) ? d : null;
  };
  const markedBy = new Map(); // marker → [targets]
  const marks = [];
  for (const m of order) {
    const mine = [];
    const seen = new Set([m]);
    const queue = [m];
    for (let guard = 0; queue.length && guard < 64; guard++) {
      const x = queue.shift();
      const t = opAt(x);
      if (!t || seen.has(t)) continue;
      if ((markedBy.get(t) ?? []).includes(m)) continue;
      seen.add(t);
      mine.push(t);
      // through a marked 阿戈尔 (for the player's own operators: exactly its members; a teammate's by its own bonds)
      if (S.isMember(battle, t, 'egirShip')) queue.push(t);
    }
    markedBy.set(m, mine);
    if (!mine.length) continue;
    let atk = 0, block = 0;
    for (const t of mine) { atk += num(t.base.atk, 0); block += num(t.base.blockCnt, 0); marks.push([m, t]); }
    // 重构模拟（6 名）：吞噬到的阻挡数在战斗侧换算成「同时可攻击的敌人数量」（见 installEgir 的 recon 段）
    if (bb.recon && block > 0) m.mem.egirBlock = num(m.mem.egirBlock, 0) + block;
    const mods = {};
    if (atk > 0) mods.atkFinal = atk; // 最终加算 (units.js _recalc)
    if (block > 0) mods.blockCnt = block;
    if (Object.keys(mods).length) S.passiveBuff(battle, m, 'bond:egir:devour', mods);
  }
  const amount = num(bb.damage_value, 0);
  const layered = new Set();
  // a target knocked out during the pass = off the field, or in another deployment than when the marks were placed (items
  // deploymentOf: 不屈 and the 复活 of 埃芒加德 / M3茧甲 redeploy it at once; the 5-tier revive did until 0.2.0) — a
  // revived member was standing again when its pending marks used to knock it out a second time and spend every revive
  // at t = 0 (GitHub #33)
  const dep = new Map();
  for (const [, t] of marks) if (!dep.has(t)) dep.set(t, items.deploymentOf(t));
  const knocked = (t) => !t.alive || items.deploymentOf(t) !== dep.get(t);
  for (const [m, t] of marks) {
    // every mark resolves whatever became of its marker — knocked out by an earlier mark (and revived or not), or down
    // since its own combat (downAtStart); a mark on a unit knocked out during the pass, or lying down since the 联防
    // start, resolves nothing (`knocked`: it is off the field)
    if (knocked(t)) continue;
    S.fxOn(battle, 'devour', t, 'bond:egirShip', 'devour', { from: m.id });
    // The maintainer's 2026-10-11 联防 carry decision: reconstruct marks/attributes, but do not apply a second
    // opening HP loss (or trigger deaths/revives) to an operator restored from the previous field. Battle.start
    // applies its exact HP ratio and SP after the opening hooks. Fresh units and all other battle kinds still pay.
    const restored = battle.kind === 'unite' && Number.isFinite(t.carry?.hpPct) && t.carry.hpPct > 0;
    if (amount > 0 && !restored) battle.loseHp(t, mitigate(amount, 'phys', t.s), { source: m, tags: ['bond:egir:devour'] });
    if (!layered.has(t)) {
      layered.add(t);
      S.gainLayers(battle, { playerId: pid, bonds: 'egirShip', n: S.tierOf(t), source: m, reason: 'bond' });
    }
  }
}

function installEgir(battle, pid, bb, members) {
  // HP (every tier): a match-long buff put on the members when the battle is built, so each one is deployed with it
  // (Battle._deploy: full HP of the raised max HP) and the battle-start devour finds it — the community report's step 1,
  // 「第一步给所有鱼加盟约的血量」 (DESIGN §25.22.5: an elite 深巡, 2904 HP and DEF 655, loses 5000 − 655 = 4345 to a mark and
  // stands from 15 layers on, 2904 × 1.50 = 4356). The layers the devour adds raise it one tick later (onLayers; the HP
  // ratio is kept).
  const apply = () => {
    const mods = S.directMods({ hp: num(bb.base_max_hp, 0) + num(bb.max_hp_per_stack, 0) * S.bondLayers(battle, pid, 'egirShip') });
    for (const u of members) S.passiveBuff(battle, u, 'bond:egir', mods);
  };
  apply();
  onLayers(battle, pid, 'egirShip', apply);
  // 5: "前3名【阿戈尔】干员首次被击倒时立刻复活" — 3 slots (bonds.json max_free_respawn_cnt), one per member at most, on its first
  // knock-out ('killed') of the battle; a member never knocked out takes none (GitHub #105, #140 "没被吃的阿戈尔干员也会占用
  // 复活名额"; the owner's decision of 2026-10-05). Which knock-outs take them — a community report the owner relayed on
  // 2026-10-07 (DESIGN §25.22.5): 「第一步给所有鱼加盟约的血量，第二步是开始一个个大鱼吃小鱼，第三步是检测左下到右上哪些鱼睡着了
  // 给他复活」. The members the battle-start devour knocks out wait until every player's devour pass on the field is over
  // (`egirStart`); then those still down are revived by board position (egirReviveScan) while slots last, and the others
  // stay down, their first knock-out spent. A knock-out later in the fight takes a slot left, at once, in time order.
  // Until 0.2.0 the devour's knock-outs took the slots in knock-out order (DESIGN §24.3), so the food knocked out first
  // — often the end of a chain, marked by every 阿戈尔 behind it — took them while a member further left stayed down.
  // Within the window a knock-out is otherwise like any other: 被击倒 triggers fire (克莱门莎, 幽灵鲨 …) and 不屈 rolls
  // (priority 10); a member it redeploys is awake at the scan and takes no slot [ASSUMED: the scan takes the members
  // still down, 「哪些鱼睡着了」]. However many members mark one, its pending marks are cancelled once it is knocked out
  // (devour), so a multi-devoured member spends one slot at most. Its own saver acts first: a kit or item saver that
  // prevents the knock-out is a `fatal` hook (斯卡蒂's DRE-Y −50, kit savers 10 … −60, 坚固维式重锤 PRIO_REVIVE −100), so the
  // unit is never knocked out and no slot is used; a 复活 (M3茧甲 13, 埃芒加德 12 — items reviveNow, a knock-out and a free
  // redeploy since 0.2.0) answers the knock-out before this hook and marks it `revivedBy`: that knock-out is not the
  // member's first either — the slot waits for its first unanswered knock-out (the owner's decision of 2026-10-05: an
  // operator's own revive uses no slot; [ASSUMED] for 埃芒加德, a band, as for M3茧甲, the item revive the owner named).
  // An operator entering 联防 down (FORCED_EXIT) is not knocked out either; a 调和 member counts like any other. Each
  // battle (normal, 联防, boss) counts its own. PRTS: the knocked-out unit's next deployment has 0 redeploy time and 0
  // cost, i.e. it IS knocked out (被击倒 triggers fire) and redeploys where it lies (the engine's rest tile,
  // Battle._layBody: the tile it was knocked out on — a raid-relocated member comes back where it fell —, or its own home
  // when it fell on another board piece's home; PRTS 卫戍协议/帮助 §作战阶段 单位部署) with full HP, SP reset and `deploy`
  // effects (卡西米尔 / 叙拉古). Death priority 11: before 不屈 (10), whose redeploy "also consumes a 复活 charge" — for a
  // knock-out in the fight the slot is always the one used. Until 0.1.3 the slots were fixed at battle start for the
  // first 3 members by position (§23.20); until 0.1.2 the first 3 knocked out took them but a revived member's pending
  // marks could knock it out again (GitHub #33, fixed in devour since).
  const max = reached(battle, pid, 'egirShip', bb.power_bond_char_cnt) ? Math.max(0, Math.floor(num(bb.max_free_respawn_cnt, 0))) : 0;
  const start = egirStart(battle);
  start.passes++;
  battle.on('battleStart', () => {
    start.depth++;
    try {
      devour(battle, pid, bb, members);
    } finally {
      start.depth--;
      if (--start.passes <= 0) for (const flush of start.flush.splice(0)) flush();
    }
  }, { once: true });
  // ---- 重构模拟（`bb.recon`）：6 名同时可攻击的敌人数量 + 吞噬到的阻挡数；9 名攻击范围 = 场上所有【阿戈尔】的并集
  const re = bb.recon;
  if (re) {
    const et = Math.max(1, S.bondTier(battle, pid, 'egirShip'));
    if (et >= num(re.targetsAt, 2)) {
      battle.every(1, () => {
        for (const m of members) {
          if (!S.onField(m)) continue;
          if (m.mem.egirBaseTargets == null) m.mem.egirBaseTargets = Math.max(1, num(m.profile?.maxTargets, 1));
          m.profile.maxTargets = m.mem.egirBaseTargets + Math.max(0, num(m.mem.egirBlock, 0));
        }
      });
    }
    if (et >= num(re.rangeAt, 3)) {
      battle.every(0.5, () => {
        const on = members.filter((m) => S.onField(m));
        if (on.length < 2) return;
        const union = new Set();
        for (const m of on) for (const k of (m.baseRangeKeys || m.rangeKeys || [])) union.add(k);
        const keys = [...union];
        for (const m of on) { m.rangeKeys = keys; m.rangeKeySet = union; }
      });
    }
  }
  if (!(max > 0)) return;
  const memberOps = new Set(members.filter(S.isOp));
  const knockedOut = new Set(); // members whose first knock-out of this battle has happened
  const batch = []; // members knocked out by a battle-start devour, revived (or not) once every pass is over
  let revives = 0;
  const revive = (u) => {
    if (!battle.redeploy(u, { free: true })) return;
    revives++;
    S.fxOn(battle, 'revive', u, 'bond:egirShip', 'respawn', { n: revives });
  };
  start.flush.push(() => {
    for (const u of batch.splice(0).filter((x) => !x.alive && !x.removed).sort(egirReviveScan)) {
      if (revives >= max) break;
      revive(u);
    }
  });
  battle.on('death', (c) => {
    const u = c.unit;
    if (c.reason !== 'killed' || c.revivedBy || !memberOps.has(u) || knockedOut.has(u)) return;
    knockedOut.add(u);
    if (start.depth > 0) { batch.push(u); return; }
    if (revives >= max || u.alive || u.removed) return;
    revive(u);
  }, { priority: 11 });
}

// =====================================================================================================================
// 叙拉古

/**
 * Does a member's damage instance try the tier-6 proc? PRTS 盟约记录 叙拉古: "※仅在造成普通伤害时尝试造成来源为干员自身的
 * 真实附加伤害和恐惧", "每次造成普通伤害时尝试触发" — 普通伤害 is the attack type NORMAL (PRTS 伤害分类: the default type,
 * group damage included unless it is 溅射), not "a normal attack" (community report 「叙拉古盟约真伤概率数值没有正确递增
 * 成长」, GitHub #79: it rolled on normal attacks only). So skill hits roll — 德克萨斯 剑雨, 缄默德克萨斯's bursts and
 * sword rain, 阿罗玛 S1 / S2, 忍冬 S1 / S2, 伺夜 S3 — and so do 荒芜拉普兰德's S3 drone attacks (PRTS 备注 "不属于普通攻击/
 * 技能直接伤害": neither an attack nor skill damage, still 普通伤害). Not: 溅射 (`isSplash`); 持续伤害 (tags dot / periodic:
 * 荒芜拉普兰德's S3 pulse, PRTS 备注 "持续法术伤害"; 缄默德克萨斯 S1, "伤害分类为法术持续伤害"); 附加伤害 (tag `addition`:
 * 拉普兰德's module, 忍冬's 追凶 — PRTS "法术附加伤害"; item procs and the bonds' riders, own proc included [ASSUMED: 附加,
 * PRTS gives no class]); element damage; 无来源 damage (坚守's thorns); 流失.
 */
function siracusaRolls(dmg) {
  if (!dmg || dmg.isSplash || dmg.sourceless || dmg.type === 'element' || dmg.type === 'elemental') return false;
  const tags = dmg.tags;
  if (!Array.isArray(tags)) return true;
  for (let i = 0; i < tags.length; i++) {
    const t = tags[i];
    if (t === 'dot' || t === 'periodic' || t === 'addition' || t === 'item' || t === 'hpLoss') return false;
    if (typeof t === 'string' && t.startsWith('bond:')) return false;
  }
  return true;
}

function installSiracusa(battle, pid, bb, members) {
  if (bb.recon) return installSiracusaRecon(battle, pid, bb, members, bb.recon);
  const memberSet = new Set(members);
  const six = reached(battle, pid, 'siracusaShip', bb.power_bond_char_cnt);
  const end = num(bb.end_duration, 0);
  battle.on('deploy', ({ unit }) => {
    if (!memberSet.has(unit)) return;
    const L = S.bondLayers(battle, pid, 'siracusaShip');
    const dur = num(bb.base_duration, 0) + num(bb.duration_per_stack, 0) * L;
    if (!(dur > 0)) return;
    battle.addBuff(unit, { key: 'bond:siracusa', duration: dur, mods: { aspd: num(bb.base_attack_speed, 0) + num(bb.attack_speed_per_stack, 0) * L } });
    if (!six) return;
    unit.mem.siraStealthEnd = Infinity;
    const off = ({ unit: u }) => { u.mem.siraStealthEnd = battle.time; };
    battle.addBuff(unit, { key: 'bond:siracusa:stealth', duration: dur, flags: { stealth: true }, status: 'stealth', onExpire: off, onRemove: off });
  });
  if (!six) return;
  const c = prdConstant(num(bb.prob, 0));
  if (!(c > 0)) return;
  const st = { n: 0 };
  const onDmg = (ctx) => {
    const u = ctx.source, t = ctx.target, dmg = ctx.dmg;
    if (!isEnemyTarget(t) || !siracusaRolls(dmg)) return;
    const hidden = u.s.flags.stealth || battle.time <= num(u.mem.siraStealthEnd, -Infinity) + end + 1e-9;
    if (!hidden) return;
    st.n++;
    if (!(battle.rng() < Math.min(1, c * st.n))) return;
    st.n = 0;
    const amount = num(bb.base_damage, 0) + num(bb.damage_per_stack, 0) * S.bondLayers(battle, pid, 'siracusaShip');
    S.fxOn(battle, 'bondProc', t, 'bond:siracusaShip', 'assassin', { from: u.id, amount });
    if (amount > 0) battle.dealDamage(u, t, { amount, type: 'true', canDodge: false, tags: ['bond:siracusa'] });
    if (t.alive && num(bb.fear, 0) > 0) battle.applyStatus(t, 'fear', { duration: num(bb.fear, 0), source: u });
  };
  for (const u of members) onUnitDamaged(battle, u, onDmg);
}

// =====================================================================================================================
// 卡西米尔

function installKazimierz(battle, pid, bb, members) {
  if (bb.recon) return installKazimierzRecon(battle, pid, bb, members, bb.recon);
  const st = { deploys: 0 };
  const apply = () => {
    const cap = num(bb.base_max_atk_when_born, 0) + num(bb.max_atk_when_born_per_stack, 0) * S.bondLayers(battle, pid, 'kazimierzShip');
    const bonus = Math.max(0, Math.min(cap, st.deploys * num(bb.atk_when_born, 0)));
    if (!(bonus > 0)) return;
    for (const u of members) S.passiveBuff(battle, u, 'bond:kazimierz', S.directMods({ atk: bonus }));
  };
  battle.on('deploy', ({ unit }) => {
    if (!S.isOp(unit) || unit.ownerId !== pid) return;
    st.deploys++;
    apply();
  });
  onLayers(battle, pid, 'kazimierzShip', apply);
  if (!reached(battle, pid, 'kazimierzShip', bb.power_bond_char_cnt)) return;
  const iv = num(bb.damage_interval, 0), radius = num(bb.range_radius, 0), scale = num(bb.damage_atk_scale, 0), stun = num(bb.stun, 0);
  if (iv > 0 && scale > 0) {
    battle.every(iv, () => {
      for (const m of members) {
        if (!S.onField(m) || !m.blocking || !m.blocking.length) continue;
        const hits = battle.foesInRadius(m.x, m.y, radius);
        if (!hits.length) continue;
        const amount = scale * m.s.atk;
        for (const e of hits) {
          if (!e.alive) continue;
          battle.dealDamage(m, e, { amount, type: 'true', canDodge: false, isSplash: true, tags: ['bond:kazimierz'] });
          if (e.alive && stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: m });
        }
        S.fxOn(battle, 'aoe', m, 'bond:kazimierzShip', 'pulse', { radius, dmgType: 'true', n: hits.length });
      }
    });
  }
  const pure = num(bb.pure_atk_scale, 0);
  if (!(pure > 0)) return;
  const onDmg = (ctx) => {
    const u = ctx.source, t = ctx.target, dmg = ctx.dmg;
    if (!dmg || !dmg.isAttack || !isEnemyTarget(t) || ownTag(dmg, 'bond:kazimierz')) return;
    if (u.blocking && u.blocking.length) return;
    battle.dealDamage(u, t, { amount: pure * u.s.atk, type: 'true', canDodge: false, tags: ['bond:kazimierz'] });
  };
  for (const u of members) onUnitDamaged(battle, u, onDmg);
}

// =====================================================================================================================
// 重构模拟（`bb.recon`）：八条核心盟约的重构变体
//
// 数据在 `workshop/mode-recon/bonds.json`（`overrides: bonds:<id>`），所有数值写在效果 buff 的 `bb.recon` 里；本段
// **只在 `bb.recon` 存在时**接管官方实现，所以没有那个键的房间（含全部官方模式）逐字节不变。
// 三层档位一律按 `bondTier`（1/2/3 = 3/6/9 名）读；下面每个函数头写清哪一档做什么。

/** 一档（3/6/9）下的数组取值：越界取最后一档。 */
const tierValue = (arr, tier, fallback) => {
  if (!Array.isArray(arr) || !arr.length) return fallback;
  return arr[Math.min(arr.length - 1, Math.max(0, tier))] ?? fallback;
};

/** 炎·重构：3 名即召唤炎佑（25% / 2 目标 / 20% 灼燃 / 20% 元素脆弱），6 名 40% / 3 目标 / 30% / 30%，9 名 80% 且成员攻击附带 25% 攻击力元素伤害。 */
function installYanRecon(battle, pid, bb, members, rc) {
  const L = () => S.bondLayers(battle, pid, 'yanShip');
  const apply = () => {
    const mods = S.directMods({ atk: num(bb.base_atk) + num(bb.atk_per_stack) * L() });
    for (const u of members) S.passiveBuff(battle, u, 'bond:yan', mods);
  };
  apply();
  onLayers(battle, pid, 'yanShip', apply);
  const tier = Math.max(1, S.bondTier(battle, pid, 'yanShip'));
  const share = tierValue(rc.shares, tier, 0.25);
  const targets = tierValue(rc.targets, tier, 2);
  const burn = tierValue(rc.burn, tier, 0.2);
  const frag = tierValue(rc.frag, tier, 0.2);
  battle.on('battleStart', () => {
    let atk = 0, hp = 0;
    for (const u of S.playerOps(battle, pid, { fieldOnly: true })) {
      if (!S.unitBonds(u).includes('yanShip')) continue;
      atk += num(u.s.atk, 0);
      hp += num(u.s.maxHp, 0);
    }
    if (!(hp > 0)) return;
    spawnYanyou(battle, pid, { atk: atk * share, hp: hp * share, count: 1, maxTargets: targets, burn, frag });
  }, { once: true });
  // 9 名：成员每次攻击额外造成自身 25% 攻击力的元素伤害（灼燃；自己这条伤害不再触发）
  if (tier >= num(rc.elemAt, 3)) {
    const scale = num(rc.elemScale, 0.25);
    const onHit = (c) => {
      const t = c.target, dmg = c.dmg;
      if (!isEnemyTarget(t) || !dmg || !dmg.isAttack || ownTag(dmg, 'bond:yan')) return;
      if (dmg.type === 'element' || dmg.type === 'elemental') return;
      if (scale > 0) battle.dealDamage(c.source, t, { type: 'element', element: 'burn', amount: num(c.source?.s?.atk, 0) * scale, canDodge: false, tags: ['bond:yan'] });
    };
    for (const u of members) onUnitDamaged(battle, u, onHit);
  }
}

/** 萨尔贡·重构：攻速 +15 / 最多 50 层 / 5 + 0.25×层数 秒；3 名每层 +15% 攻击；6 名自身层数无限；9 名开技能给相邻【萨尔贡】25% 技力。 */
function installSargonRecon(battle, pid, bb, members, rc) {
  const memberSet = new Set(members);
  const tier = Math.max(1, S.bondTier(battle, pid, 'sargonShip'));
  const maxStacks = Math.max(1, Math.floor(num(rc.maxStacks, 50)));
  const atkStacks = tier >= num(rc.atkAt, 1);
  const infiniteSelf = tier >= num(rc.infiniteAt, 2);
  const spAt = tier >= num(rc.spAt, 3);
  const perAtk = num(rc.atkPerStack, 0.15);
  const syncAtk = (u) => {
    if (!atkStacks) return;
    let n = 0;
    for (const b of u.buffs) if (b.key === 'bond:sargon') n++;
    if (n > 0 && u.alive) battle.addBuff(u, { key: 'bond:sargon:atk', mods: S.directMods({ atk: perAtk * n }) });
    else battle.removeBuff(u, 'bond:sargon:atk');
  };
  battle.on('skillStart', ({ unit }) => {
    if (!memberSet.has(unit)) return;
    const L = S.bondLayers(battle, pid, 'sargonShip');
    const dur = num(rc.baseTime, 5) + num(rc.timePerLayer, 0.25) * L;
    if (dur > 0) {
      for (const m of members) {
        if (!S.onField(m)) continue;
        // 6 名：「对自身的持续时间无限」——只有施放者自己那一份用 Infinity
        const lifetime = infiniteSelf && m === unit ? Infinity : dur;
        battle.addBuff(m, {
          key: 'bond:sargon', duration: lifetime, refresh: 'independent', maxStacks,
          mods: { aspd: num(rc.aspd, 15) },
          onExpire: ({ unit: u }) => syncAtk(u), onRemove: ({ unit: u }) => syncAtk(u),
        });
        syncAtk(m);
      }
    }
    // 9 名：相邻【萨尔贡】立即获得 25% 技力
    if (spAt) {
      const pct = num(rc.spPct, 0.25);
      for (const a of S.alliesAround(battle, unit, S.N8)) {
        if (a === unit || !memberSet.has(a) || !a.skill || a.skill.noSkill) continue;
        const gain = Math.max(0, Math.round(num(a.skill.spCost, 0) * pct));
        if (!(gain > 0)) continue;
        a.skill.gainSp(gain, 'bond:sargon');
        S.fxOn(battle, 'spGain', a, 'bond:sargonShip', 'skill', { n: gain, from: unit.id });
      }
    }
  });
}

/** 叙拉古·重构：攻速 +25 + 层数、持续 40 + 0.5×层数；3 名隐匿；6 名 3% 真伤（5000 + 50×层数）+ 恐惧；9 名召唤狼之主。 */
function installSiracusaRecon(battle, pid, bb, members, rc) {
  const memberSet = new Set(members);
  const tier = Math.max(1, S.bondTier(battle, pid, 'siracusaShip'));
  const stealth = tier >= num(rc.stealthAt, 1);
  const proc = tier >= num(rc.procAt, 2);
  const wolf = tier >= num(rc.wolfAt, 3);
  const end = num(bb.end_duration, 10);
  battle.on('deploy', ({ unit }) => {
    if (!memberSet.has(unit)) return;
    const L = S.bondLayers(battle, pid, 'siracusaShip');
    const dur = num(rc.durBase, 40) + num(rc.durPerLayer, 0.5) * L;
    if (!(dur > 0)) return;
    battle.addBuff(unit, { key: 'bond:siracusa', duration: dur, mods: { aspd: num(rc.aspdBase, 25) + num(rc.aspdPerLayer, 1) * L } });
    if (!stealth) return;
    unit.mem.siraStealthEnd = Infinity;
    const off = ({ unit: u }) => { u.mem.siraStealthEnd = battle.time; };
    battle.addBuff(unit, { key: 'bond:siracusa:stealth', duration: dur, flags: { stealth: true }, status: 'stealth', onExpire: off, onRemove: off });
  });
  if (proc) {
    const c = prdConstant(num(rc.prob, 0.03));
    if (c > 0) {
      const st = { n: 0 };
      const onDmg = (ctx) => {
        const u = ctx.source, t = ctx.target, dmg = ctx.dmg;
        if (!isEnemyTarget(t) || !siracusaRolls(dmg)) return;
        const hidden = u.s.flags.stealth || battle.time <= num(u.mem.siraStealthEnd, -Infinity) + end + 1e-9;
        if (!hidden) return;
        st.n++;
        if (!(battle.rng() < Math.min(1, c * st.n))) return;
        st.n = 0;
        const amount = num(rc.dmgBase, 5000) + num(rc.dmgPerLayer, 50) * S.bondLayers(battle, pid, 'siracusaShip');
        S.fxOn(battle, 'bondProc', t, 'bond:siracusaShip', 'assassin', { from: u.id, amount });
        if (amount > 0) battle.dealDamage(u, t, { amount, type: 'true', canDodge: false, tags: ['bond:siracusa'] });
        if (t.alive && num(rc.fear, 3) > 0) battle.applyStatus(t, 'fear', { duration: num(rc.fear, 3), source: u });
      };
      for (const u of members) onUnitDamaged(battle, u, onDmg);
    }
  }
  if (!wolf) return;
  // 9 名：狼之主（[ASSUMED] 用狼群召唤物承接；属性 = 开战时【叙拉古】攻 / 血总和的 30%，并挂同款攻速加成）
  const share = num(rc.wolfShare, 0.3);
  let lord = null;
  const wolfBuff = () => {
    if (!lord || !lord.alive) return;
    const L = S.bondLayers(battle, pid, 'siracusaShip');
    S.passiveBuff(battle, lord, 'bond:siracusa:wolf', { aspd: num(rc.aspdBase, 25) + num(rc.aspdPerLayer, 1) * L });
  };
  battle.on('battleStart', () => {
    let atk = 0, hp = 0;
    for (const u of S.playerOps(battle, pid, { fieldOnly: true })) {
      if (!S.unitBonds(u).includes('siracusaShip')) continue;
      atk += num(u.s.atk, 0);
      hp += num(u.s.maxHp, 0);
    }
    if (!(hp > 0) || !members.length) return;
    lord = spawnWolfLord(battle, members[0], { atk: atk * share, hp: hp * share });
    wolfBuff();
  }, { once: true });
  onLayers(battle, pid, 'siracusaShip', wolfBuff);
}

/** 卡西米尔·重构：每次部署 +20% + 1%×层数（无上限，按文本）；3 名再部署 −25%；6 名脉冲 / 未阻挡真伤；9 名半血替换（[ASSUMED] 近似为暂退 10 秒后原干员回场）。 */
function installKazimierzRecon(battle, pid, bb, members, rc) {
  const st = { deploys: 0 };
  const apply = () => {
    const L = S.bondLayers(battle, pid, 'kazimierzShip');
    const step = num(rc.atkPerDeploy, 0.2) + num(rc.atkPerLayer, 0.01) * L;
    const bonus = st.deploys * step;
    if (!(bonus > 0)) return;
    for (const u of members) S.passiveBuff(battle, u, 'bond:kazimierz', S.directMods({ atk: bonus }));
  };
  battle.on('deploy', ({ unit }) => {
    if (!S.isOp(unit) || unit.ownerId !== pid) return;
    st.deploys++;
    apply();
  });
  onLayers(battle, pid, 'kazimierzShip', apply);
  const tier = Math.max(1, S.bondTier(battle, pid, 'kazimierzShip'));
  if (tier >= num(rc.redeployAt, 1)) {
    for (const u of members) S.passiveBuff(battle, u, 'bond:kazimierz:redeploy', { redeployMul: num(rc.redeployMul, 0.75) });
  }
  if (tier >= num(rc.pulseAt, 2)) {
    const iv = num(rc.interval, 2), radius = num(bb.range_radius, 0.8), scale = num(rc.scale, 1.2), stun = num(rc.stun, 0.1);
    if (iv > 0 && scale > 0) {
      battle.every(iv, () => {
        for (const m of members) {
          if (!S.onField(m) || !m.blocking || !m.blocking.length) continue;
          const hits = battle.foesInRadius(m.x, m.y, radius);
          if (!hits.length) continue;
          for (const e of hits) {
            if (!e.alive) continue;
            battle.dealDamage(m, e, { amount: scale * m.s.atk, type: 'true', canDodge: false, isSplash: true, tags: ['bond:kazimierz'] });
            if (e.alive && stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: m });
          }
          S.fxOn(battle, 'aoe', m, 'bond:kazimierzShip', 'pulse', { radius, dmgType: 'true', n: hits.length });
        }
      });
    }
    const pure = num(rc.pure, 0.3);
    if (pure > 0) {
      const onDmg = (ctx) => {
        const u = ctx.source, t = ctx.target, dmg = ctx.dmg;
        if (!dmg || !dmg.isAttack || !isEnemyTarget(t) || ownTag(dmg, 'bond:kazimierz')) return;
        if (u.blocking && u.blocking.length) return;
        battle.dealDamage(u, t, { amount: pure * u.s.atk, type: 'true', canDodge: false, tags: ['bond:kazimierz'] });
      };
      for (const u of members) onUnitDamaged(battle, u, onDmg);
    }
  }
  if (tier < num(rc.swapAt, 3)) return;
  // 9 名：场上阶级最高的成员生命值低于 50% → 暂退，10 秒后回场（引擎没有「整备区干员中途上场」的通道，[ASSUMED]）
  const hpLine = num(rc.swapHp, 0.5), back = num(rc.swapBack, 10);
  battle.every(1, () => {
    const onField = members.filter((m) => S.onField(m) && !m.mem.kazSwap);
    if (!onField.length) return;
    let top = null;
    for (const m of onField) {
      const t = num(m.def?.tier, 0);
      if (!top || t > num(top.def?.tier, 0)) top = m;
    }
    if (!top || !(top.hpRatio < hpLine)) return;
    top.mem.kazSwap = true;
    S.fxOn(battle, 'swap', top, 'bond:kazimierzShip', 'swap', { back });
    battle.retreat(top, { reason: 'swap' });
    battle.after(back, () => {
      if (!top.alive && !top.removed) battle.redeploy(top, { free: true });
      top.mem.kazSwap = false;
    });
  });
}

// =====================================================================================================================
// entry points

const INSTALLERS = Object.freeze({
  yanShip: installYan,
  sargonShip: installSargon,
  victoriaShip: installVictoria,
  kjeragShip: installKjerag,
  lateranoShip: installLaterano,
  egirShip: installEgir,
  siracusaShip: installSiracusa,
  kazimierzShip: installKazimierz,
});

/** Extra bond installers of content packs / mods (registerBondInstaller) — a mod bond adds its own installer here
 * without touching the official installers. Keys are bond ids (a pack's own bond id). */
const EXTRA_INSTALLERS = new Map();

/** Register a bond's battle installer `fn(battle, pid, bb, members)` (a content-pack / mod bond; the official
 * installers are never replaced — a duplicate key is ignored). */
export function registerBondInstaller(bondId, fn) {
  if (typeof fn === 'function' && !EXTRA_INSTALLERS.has(bondId) && !Object.hasOwn(INSTALLERS, bondId)) EXTRA_INSTALLERS.set(bondId, fn);
}

export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  const all = [...Object.entries(INSTALLERS), ...EXTRA_INSTALLERS];
  for (const p of battle.players) {
    const pid = p.playerId;
    if (!p.bonds || typeof p.bonds !== 'object') continue;
    for (const [bondId, fn] of all) {
      if (!S.bondActive(battle, pid, bondId)) continue;
      const bb = bondBb(bondId);
      if (!bb) continue;
      const members = S.bondMembers(battle, pid, bondId);
      if (!members.length) continue;
      fn(battle, pid, bb, members);
    }
  }
}

/**
 * 维多利亚 hammer milestones: every `layer` layers pay `count` item(s) of `pool` once (counter = milestones paid).
 * A bond effect, so it pays only while 维多利亚 is active (official tip "叠加的盟约…只有在盟约被激活时才会发挥作用");
 * milestones crossed while it was inactive ("无需激活" sources such as 烛煌) are paid as soon as it lights up — the
 * onActiveBonds hook of the recompute that activated it, e.g. placing the third member in prep (the maintainer's report
 * of the official game, 2026-10-15; research 02 §3.3 / §8 Q7: the payout counts layers added while inactive) — and
 * the hooks below catch up anything a capped nested dispatch skipped; same rule as 远见 / 奇迹 (addon/meta.js).
 */
export function payHammers(ctx) {
  if (!ctx.bondActive('victoriaShip')) return 0;
  const p = S.buffParams(ctx.data?.bonds?.victoriaShip ?? S.bondRecord('victoriaShip'), VICTORIA_REWARD_KEY);
  const step = Math.floor(num(p?.layer, 0));
  if (!p || !(step > 0)) return 0;
  // 重构模拟：每回合最多 `rewardPerRound` 次（写在同一个 buff 的 `bb.rewardPerRound`，官方记录没有这个键）
  const perRound = Math.max(0, Math.floor(num(p.rewardPerRound, 0)));
  const roundKey = 'bond:victoria:hammers:round';
  const countKey = 'bond:victoria:hammers:round.n';
  if (perRound > 0) {
    if (num(ctx.counter(roundKey), -1) !== num(ctx.round, -2)) {
      ctx.setCounter(roundKey, num(ctx.round, 0));
      ctx.setCounter(countKey, 0);
    }
    if (num(ctx.counter(countKey), 0) >= perRound) return 0;
  }
  const due = Math.floor(ctx.layers('victoriaShip') / step);
  // [ASSUMED] DESIGN §34.5: each milestone pays at most the official `count` cap. Official count is 1.
  const count = Math.min(bbCap('count'), Math.max(0, Math.floor(num(p.count, 1))));
  let granted = 0;
  // re-read the counter every milestone: grantItem dispatches onGain, which re-enters this function (nested payments
  // must not be paid twice by the outer loop)
  for (let guard = 0; guard < 100; guard++) {
    const paid = ctx.counter(VICTORIA_COUNTER);
    if (paid >= due) break;
    if (perRound > 0 && num(ctx.counter(countKey), 0) >= perRound) break;
    ctx.setCounter(VICTORIA_COUNTER, paid + 1);
    for (let i = 0; i < count; i++) {
      const id = ctx.rollItem({ pool: p.pool });
      // onPrepEnd: grantItem stows this and does not merge until the next prep start, so a second copy does not
      // take an equipped hammer off for the fight (effectsMeta _deferItemMerge). [ASSUMED] every item that hook grants.
      if (id && ctx.grantItem(id, { source: 'bond:victoriaShip' })) {
        granted++;
        if (perRound > 0) ctx.setCounter(countKey, num(ctx.counter(countKey), 0) + 1);
      }
    }
  }
  if (granted && typeof ctx.toast === 'function') ctx.toast(msg('【维多利亚】获得{n}件维式重锤', { n: granted }), 'info');
  return granted;
}

/**
 * Hooks on which owed hammers are (caught up and) paid; onLayers only for 维多利亚's own gains; onActiveBonds when the
 * active set changes (the bond lighting up — payHammers reads the counter, so the hammer of a milestone comes once
 * however often the bond goes off and on again).
 */
const HAMMER_HOOKS = Object.freeze(['onLayers', 'onActiveBonds', 'onRoundStart', 'onPrepStart', 'onPrepEnd', 'onBuy', 'onGain', 'onSold', 'onMerge']);

export function registerMeta(registry) {
  const prev = typeof registry.get === 'function' ? registry.get('bond:victoriaShip') : null;
  const handler = { ...(prev || {}) };
  for (const hook of HAMMER_HOOKS) {
    const before = prev && typeof prev[hook] === 'function' ? prev[hook] : null;
    handler[hook] = function hammers(ctx, ev) {
      if (before) before.call(this, ctx, ev);
      if (hook === 'onLayers' && !(ev && ev.bondId === 'victoriaShip')) return;
      payHammers(ctx);
    };
  }
  registry.bond('victoriaShip', handler);
}
