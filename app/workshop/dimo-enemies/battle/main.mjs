// workshop/dimo-enemies/battle/main.mjs — 「特训敌人·涤墨」18 个敌人的机制层。
//
// 走 `server.battle` 通道（pack.json.server.battle）：引擎的 content/enemies 只认 data/enemies.json 里的官方键，
// 包侧敌人由这里用 `battle.on(...)` 挂行为，不碰引擎的 KITS 表。数值口径按用户 2026-10-25 的定义（见 README），
// 与 Wiki 的官方机制有意不同 —— 拓印/字格/窃字等字格系统一律不做。
//
// 用到的公开能力：`battle.on('enemySpawn'|'tick'|'kill'|'attack'|'beforeAttack')`、`battle.addBuff`、
// `battle.dealDamage`、`battle.spawnEnemy`、`battle.allies()`、`battle.alliesInRadius`、`battle.fx`。

// ---- 键 -------------------------------------------------------------------------------------------------

const CAOGE = 'enemy_10164_tjgxb';
const CAOGE2 = 'enemy_10164_tjgxb_2';
const WANGONG = 'enemy_10165_tjggb';
const WANGONG2 = 'enemy_10165_tjggb_2';
const BASHAN = 'enemy_10166_tjgdlb';
const BASHAN2 = 'enemy_10166_tjgdlb_2';
const XIECHAO = 'enemy_10167_tjgsfj_2';
const XUANTIAO = 'enemy_10168_tjgly';
const XUANTIAO2 = 'enemy_10168_tjgly_2';
const MOZEI = 'enemy_10169_tjgtsz';
const MOZEI2 = 'enemy_10169_tjgtsz_2';
const SHUANGJIE = 'enemy_10170_wangz';
const WANGCAI = 'enemy_10058_cjfrog';
const ZHAOCAI = 'enemy_10058_cjfrog_2';
const GUOFU = 'enemy_10052_cjshld';
const BAOSHI = 'enemy_10052_cjshld_2';
const DINGFEI = 'enemy_10054_cjhot';
const PIAOXIANG = 'enemy_10054_cjhot_2';

/** 本类型（涤墨）的全部键 —— 「友军」判定只认这个集合。 */
const DIMO = new Set([CAOGE, CAOGE2, WANGONG, WANGONG2, BASHAN, BASHAN2, XIECHAO, XUANTIAO, XUANTIAO2,
  MOZEI, MOZEI2, SHUANGJIE, WANGCAI, ZHAOCAI, GUOFU, BAOSHI, DINGFEI, PIAOXIANG]);

const isDimo = (u) => !!u && DIMO.has(u.defId);
const eight = (a, e) => !!a && !!e && a !== e && Math.abs(a.x - e.x) <= 1.0001 && Math.abs(a.y - e.y) <= 1.0001;
const keyOf = (u) => (u && u.defId) || '';

/** 干员是否站在高台（本作的远程位）。 */
const onHigh = (a) => {
  const pos = a && ((a.def && a.def.position) || a.position);
  return pos === 'RANGED';
};

// ---- 1. 操戈 / 操戈·凌：死亡时给周围八格的涤墨友军 1 层【操戈增益】-----------------------------------------

/** 层数按单位记：两次来源可以叠加，但共享 2 层上限；每次重新下发一条 replace 的 buff 承载累计数值。 */
function grantCaoge(battle, u, strong) {
  const st = u._dimoCaoge || (u._dimoCaoge = { layers: [] });
  if (st.layers.length >= 2) return;
  st.layers.push(strong ? { atk: 0.2, def: 0.5, res: 50 } : { atk: 0.1, def: 0.25, res: 25 });
  const sum = st.layers.reduce((s, x) => ({ atk: s.atk + x.atk, def: s.def + x.def, res: s.res + x.res }), { atk: 0, def: 0, res: 0 });
  battle.addBuff(u, {
    key: 'dimo:caoge', refresh: 'replace', persist: true, visible: true,
    mods: { atkPct: sum.atk, defPct: sum.def, resFlat: sum.res },
  });
  battle.fx('buff', { x: u.x, y: u.y, id: u.id, kind: 'caoge' });
}

function installCaoge(battle) {
  battle.on('kill', (c) => {
    const v = c && c.victim;
    if (!v || (v.defId !== CAOGE && v.defId !== CAOGE2)) return;
    for (const u of battle.enemies) {
      if (!u || !u.alive || !isDimo(u) || !eight(u, v)) continue;
      grantCaoge(battle, u, v.defId === CAOGE2);
    }
  });
}

// ---- 2. 挽弓 / 挽弓·鸣：三连击，优先攻击八格内防御最低的干员 ----------------------------------------------

const isWangong = (k) => k === WANGONG || k === WANGONG2;

function installWangong(battle) {
  // 索敌：优先防御最低（引擎默认按阻挡/仇恨，这里只重排已达成的目标集合）
  battle.on('beforeAttack', (c) => {
    if (!c || c.isSkill || !isWangong(keyOf(c.attacker))) return;
    const list = Array.isArray(c.targets) ? c.targets : null;
    if (!list || list.length < 2) return;
    list.sort((a, b) => ((a && a.s ? a.s.def : 0) - (b && b.s ? b.s.def : 0)));
  });
  // 三连击：引擎那一下 + 这里补两下（同样走 dealDamage，可闪避）
  battle.on('attack', (c) => {
    if (!c || c.isSkill || !isWangong(keyOf(c.attacker))) return;
    const e = c.attacker;
    for (const t of c.targets || []) {
      for (let i = 0; i < 2; i++) {
        if (!t || !t.alive) break;
        battle.dealDamage(e, t, { amount: e.s.atk, type: 'phys', canDodge: true, tags: ['enemyAbility', 'dimoWangong'] });
      }
    }
  });
}

// ---- 3. 拔山 / 拔山·盖：周围八格友军受到的伤害降低 -------------------------------------------------------

const isBashan = (k) => k === BASHAN || k === BASHAN2;

function installBashan(battle) {
  battle.on('tick', (c) => {
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    if (!dt) return;
    for (const e of battle.enemies) {
      if (!e || !e.alive || !isBashan(e.defId)) continue;
      e._dimoBashanT = (e._dimoBashanT || 0) + dt;
      if (e._dimoBashanT < 1) continue;
      e._dimoBashanT = 0;
      const mul = e.defId === BASHAN2 ? 0.5 : 0.75;
      for (const a of battle.enemies) {
        if (!a || !a.alive || !isDimo(a) || a === e || !eight(a, e)) continue;
        battle.addBuff(a, { key: 'dimo:bashan', duration: 1.2, refresh: 'replace', visible: true, source: e, mods: { dmgTakenMul: mul } });
      }
    }
  });
}

// ---- 4. 挟潮·来：优先高台；每 10 秒在**自身所处格**召唤 2 只操戈（业主 2026-10-29：不再找周围的空格） ---------

function installXiechao(battle) {
  battle.on('beforeAttack', (c) => {
    if (!c || c.isSkill || keyOf(c.attacker) !== XIECHAO) return;
    const list = Array.isArray(c.targets) ? c.targets : null;
    if (!list || list.length < 2) return;
    list.sort((a, b) => (onHigh(b) ? 1 : 0) - (onHigh(a) ? 1 : 0));
  });
  battle.on('tick', (c) => {
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    if (!dt) return;
    for (const e of battle.enemies) {
      if (!e || !e.alive || e.defId !== XIECHAO) continue;
      if (!e._dimoNextSummon) { e._dimoNextSummon = battle.time + 10; continue; }
      if (battle.time + 1e-9 < e._dimoNextSummon) continue;
      e._dimoNextSummon = battle.time + 10;
      const pos = { x: e.x, y: e.y };   // 自身所处格（两只都出在这里）
      for (let i = 0; i < 2; i++) {
        const u = battle.spawnEnemy(CAOGE, { pos, countInTotal: false });
        if (u) battle.fx('summon', { x: u.x, y: u.y, id: e.id, key: CAOGE, n: 1 });
      }
    }
  });
}

// ---- 5. 浪里玄条 / ·锈：常态隐匿 + 闪避（锈翻倍）--------------------------------------------------------

function installXuantiao(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || (e.defId !== XUANTIAO && e.defId !== XUANTIAO2)) return;
    const p = e.defId === XUANTIAO2 ? 0.5 : 0.25;
    battle.addBuff(e, { key: 'dimo:stealth', persist: true, allowDead: true, flags: { stealth: true } });
    battle.addBuff(e, { key: 'dimo:evade', persist: true, allowDead: true, mods: { dodgePhys: p, dodgeArts: p }, visible: true });
  });
}

// ---- 6. 云中墨贼 / ·蚀：靠近干员时偷取 15%（蚀 30%）攻击与防御，仅一次 ---------------------------------------

const isMozei = (k) => k === MOZEI || k === MOZEI2;

function installMozei(battle) {
  battle.on('tick', () => {
    for (const e of battle.enemies) {
      if (!e || !e.alive || !isMozei(e.defId) || e._dimoStolen) continue;
      const target = battle.allies().find((a) => a && a.alive && a.deployed !== false
        && Math.hypot((a.x || 0) - e.x, (a.y || 0) - e.y) <= 1.5);
      if (!target) continue;
      const k = e.defId === MOZEI2 ? 0.3 : 0.15;
      e._dimoStolen = true;
      battle.addBuff(target, { key: `dimo:steal:${e.id}`, persist: true, visible: true, source: e, mods: { atkPct: -k, defPct: -k } });
      battle.addBuff(e, { key: 'dimo:stolen', persist: true, visible: true, mods: { atkPct: k, defPct: k } });
      battle.fx('buff', { x: target.x, y: target.y, id: e.id, kind: 'steal' });
    }
  });
}

// ---- 7. 霜劫：死亡时按周围八格友军数量造成 250% 攻击力的范围爆炸（最多 3 次）---------------------------------

function installShuangjie(battle) {
  battle.on('kill', (c) => {
    const v = c && c.victim;
    if (!v || v.defId !== SHUANGJIE) return;
    let n = 0;
    for (const u of battle.enemies) if (u && u.alive && isDimo(u) && eight(u, v)) n++;
    n = Math.min(3, n);
    for (let i = 0; i < n; i++) {
      battle.fx('explode', { x: v.x, y: v.y, r: 1.5, kind: 'dimoShuangjie' });
      for (const a of battle.alliesInRadius(v.x, v.y, 1.5)) {
        if (!a || !a.alive) continue;
        battle.dealDamage(v, a, { amount: v.s.atk * 2.5, type: 'arts', canDodge: true, tags: ['enemyAbility', 'dimoShuangjie'] });
      }
    }
  });
}

// ---- 8. 旺财 / 招财：有币（远程 200%、多打 1 个）↔ 无币（仅近战），30 / 20 秒后回币 -----------------------

const COIN_WAIT = { [WANGCAI]: 30, [ZHAOCAI]: 20 };
const isCoin = (k) => k === WANGCAI || k === ZHAOCAI;

function coinOn(battle, e) {
  battle.addBuff(e, { key: 'dimo:coin', refresh: 'replace', persist: true, visible: true, mods: { maxTargets: 1 } });
}

/** 引擎不做普通攻击（noAttack），出手完全由这里按「有币 / 无币」推进。 */
function installCoin(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || !isCoin(e.defId)) return;
    e._dimoCoin = { on: true, until: 0, cd: 0 };
    e.profile = { ...(e.profile || {}), noAttack: true };
    coinOn(battle, e);
  });
  battle.on('tick', (c) => {
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    if (!dt) return;
    for (const e of battle.enemies) {
      if (!e || !e.alive || !isCoin(e.defId) || !e._dimoCoin) continue;
      const st = e._dimoCoin;
      const f = e.s.flags || {};
      if (f.stun || f.freeze || f.sleep) continue;
      if (!st.on && battle.time + 1e-9 >= st.until) { st.on = true; st.until = 0; coinOn(battle, e); }
      st.cd -= dt;
      if (st.cd > 1e-9) continue;
      if (st.on) {
        // 有币：攻击力 200% 的远程物理伤害，额外选择 1 名干员（共 2 名），打完转无币
        const inRange = battle.alliesInRadius(e.x, e.y, (e.base.rangeRadius || 2.5) + 0.25)
          .filter((a) => a && a.alive && a.deployed !== false);
        if (!inRange.length) { st.cd = 0; continue; }
        const picks = inRange.slice(0, 2);
        st.cd = e.s.interval;
        for (const t of picks) strike(battle, e, t, 2);
        st.on = false;
        st.until = battle.time + COIN_WAIT[e.defId];
        battle.removeBuff(e, 'dimo:coin');
      } else {
        // 无币：只近战攻击它阻挡的那一个，攻击力 100%
        const t = e.blockedBy;
        if (!t || !t.alive) { st.cd = 0; continue; }
        st.cd = e.s.interval;
        strike(battle, e, t, 1);
      }
    }
  });
}

/** 一次有币/无币出手：`scale` 为倍率（2 = 200%），走官方那条 `['atk', …]` 事件让客户端画攻击线。 */
function strike(battle, e, t, scale) {
  battle._ev(['atk', e.id, t.id, 'enemy']);
  battle.dealDamage(e, t, { amount: e.s.atk * scale, type: 'phys', canDodge: true, tags: ['enemyAbility', 'dimoCoin'] });
}

// ---- 9. 果腹 / 饱食：更容易受到攻击（嘲讽）---------------------------------------------------------------

function installTaunt(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || (e.defId !== GUOFU && e.defId !== BAOSHI)) return;
    battle.addBuff(e, { key: 'dimo:taunt', persist: true, allowDead: true, mods: { taunt: 3 } });
  });
}

// ---- 10. 鼎沸 / 飘香：不普攻；范围内每秒 100% 法伤 + 40% 灼燃 ---------------------------------------------

const isAura = (k) => k === DINGFEI || k === PIAOXIANG;

function installAura(battle) {
  battle.on('enemySpawn', (c) => {
    const e = c && c.enemy;
    if (!e || !isAura(e.defId)) return;
    e._dimoAuraT = 0;
  });
  battle.on('tick', (c) => {
    const dt = c && Number.isFinite(c.dt) ? c.dt : 0;
    if (!dt) return;
    for (const e of battle.enemies) {
      if (!e || !e.alive || !isAura(e.defId)) continue;
      e._dimoAuraT = (e._dimoAuraT || 0) + dt;
      if (e._dimoAuraT < 1) continue;
      e._dimoAuraT = 0;
      const r = (e.def && e.def.raw && e.def.raw.stats && e.def.raw.stats.rangeRadius) || 1.6;
      for (const a of battle.alliesInRadius(e.x, e.y, r)) {
        if (!a || !a.alive) continue;
        battle.dealDamage(e, a, { amount: e.s.atk, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'dimoAura'] });
        if (a.alive) battle.dealDamage(e, a, { amount: e.s.atk * 0.4, type: 'element', element: 'burn', ignoreSelect: true, tags: ['enemyAbility', 'dimoAura'] });
      }
    }
  });
}

// ---- install ----------------------------------------------------------------------------------------------

export function install(battle) {
  installCaoge(battle);
  installWangong(battle);
  installBashan(battle);
  installXiechao(battle);
  installXuantiao(battle);
  installMozei(battle);
  installShuangjie(battle);
  installCoin(battle);
  installTaunt(battle);
  installAura(battle);
}
