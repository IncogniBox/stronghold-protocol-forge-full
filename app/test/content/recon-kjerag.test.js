// test/content/recon-kjerag.test.js — 谢拉格两名新干员与两名重构（业主 2026-10-30）在重构模拟里的行为：
//   极光 `RECON_AURORA_TRAIT`   【谢拉格】激活后每秒 +1 / +2 技力；每 3 次寒冷给【谢拉格】【不屈】+2 / +4 层
//   讯使 `RECON_COURIER_PREP`   <进入休整期时>获得 1 / 2 件简易通讯机（需要激活【谢拉格】）
//   圣聆初雪 `RECON_SBELL2_PIERCE` 攻击寒冷 / 冻结的敌人 → 下次攻击无视 1 / 2 点法抗（最多 25 层）
//   雪猎（只有数据）：新的 SERVER_ADD_BOND_CHESS_ALL 特质记录把「获得时」的层数改成 3 / 6。
// 另有两名新干员在本机没有官方 kit，技能走 generic kit 的两处补齐（讯使 S2 的部署费用 / 防御力、极光 S2 的冻结条件倍率）。
//
// 跑法：node --test test/content/recon-kjerag.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';
import { setGameData, gameData } from '../../server/sim/content/support/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = path.join(ROOT, 'workshop/mode-recon');
const GARRISONS = JSON.parse(fs.readFileSync(path.join(PACK, 'garrisons.json'), 'utf8'));
const KJERAG = 'kjeragShip';
const INDOM = 'indomShip';

let packLoad = null;
/** 与 `server/battlePack.js` 同一条装载路径（改白名单说明符 → data: 模块；模块顶层完成注册）。 */
function loadPack() {
  packLoad ??= (async () => {
    const src = fs.readFileSync(path.join(PACK, 'battle/main.mjs'), 'utf8');
    const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
    return import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  })();
  return packLoad;
}

/** 一名干员的记录（garrisonIds 决定它挂哪条特质）。 */
function rec(id, { bonds = [KJERAG], garrison = null, skill = undefined, rangeGrid = [[0, 0], [0, 1]], stats = null } = {}) {
  const r = chessRec({
    id, bonds, rangeGrid,
    ...(skill === undefined ? {} : { skill }),
    stats: { atk: 100, maxHp: 5000, def: 500, res: 0, bat: 1, blockCnt: 1, ...(stats || {}) },
  });
  if (garrison) r.garrisonIds = [garrison];
  return r;
}

const withPackGarrisons = () => {
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
};

/** SP 只涨不掉的技能（触发规则 DEFAULT，射程内没有敌人 ⇒ 不会开）。 */
const SP_ONLY = { skillId: 'sk_test', spCost: 100, initSp: 0, duration: 10, spType: 'INCREASE_WITH_TIME', trigger: { rule: 'DEFAULT' } };

after(() => setGameData(null));

test('极光·重构：【谢拉格】激活后每秒获得技力（普通 1 / 精锐 2）', async () => {
  await loadPack();
  withPackGarrisons();
  const AURORA = 'recon_chess_ws_recon_aurora_a';
  const AURORA_E = 'recon_chess_ws_recon_aurora_b';
  const run = (id, gid, active, secs) => {
    const h = makeBattle({
      defs: { chess: { [id]: rec(id, { garrison: gid, skill: SP_ONLY, stats: { spRecovery: 0 } }) }, enemies: {} },
      units: [{ chessId: id, row: 10, col: 6 }],
      bonds: { [KJERAG]: { count: 3, active, tier: 1, layers: 0 } },
      modeId: 'mode_recon_abyss', timeLimit: 10, autoFinish: false,
    });
    h.run(secs);
    return h;
  };
  try {
    const off = run(AURORA, 'recon_garrison_aurora_a', false, 6);
    assert.equal(off.unit(AURORA).skill.sp, 0, '盟约没激活 ⇒ 没有额外技力');
    const on = run(AURORA, 'recon_garrison_aurora_a', true, 6);
    assert.ok(Math.abs(on.unit(AURORA).skill.sp - 5) < 1e-6, '普通：每秒 1 技力');
    assert.equal(on.invariants(), true);
    const elite = run(AURORA_E, 'recon_garrison_aurora_b', true, 6);
    assert.ok(Math.abs(elite.unit(AURORA_E).skill.sp - 10) < 1e-6, '精锐：每秒 2 技力');
    assert.equal(elite.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('极光·重构：每对敌人造成 3 次寒冷，已激活的【谢拉格】【不屈】+2 层（精锐 +4）', async () => {
  await loadPack();
  withPackGarrisons();
  const AURORA = 'recon_chess_ws_recon_aurora_a';
  const AURORA_E = 'recon_chess_ws_recon_aurora_b';
  const run = (id, gid) => {
    const h = makeBattle({
      defs: {
        chess: { [id]: rec(id, { garrison: gid, skill: SP_ONLY, stats: { spRecovery: 0 } }) },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0 }) },
      },
      units: [{ chessId: id, row: 10, col: 6 }],
      enemies: [{ key: 'e_dummy', time: 0 }],
      bonds: { [KJERAG]: { count: 3, active: true, tier: 1, layers: 0 }, [INDOM]: { count: 2, active: true, tier: 1, layers: 0 } },
      modeId: 'mode_recon_abyss', timeLimit: 10, autoFinish: false,
    });
    h.run(0.5);
    return h;
  };
  try {
    const h = run(AURORA, 'recon_garrison_aurora_a');
    const u = h.unit(AURORA);
    const e = h.enemies()[0];
    for (let i = 0; i < 3; i++) h.b.applyStatus(e, 'cold', { duration: 5, source: u });
    const ps = h.b.getPlayer('p1');
    assert.equal(ps.bonds[KJERAG].layers, 2, '【谢拉格】+2 层');
    assert.equal(ps.bonds[INDOM].layers, 2, '【不屈】+2 层');
    for (let i = 0; i < 3; i++) h.b.applyStatus(e, 'cold', { duration: 5, source: u });
    assert.equal(ps.bonds[KJERAG].layers, 4, '再 3 次 ⇒ 共 +4');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
  try {
    const h = run(AURORA_E, 'recon_garrison_aurora_b');
    const u = h.unit(AURORA_E);
    const e = h.enemies()[0];
    for (let i = 0; i < 3; i++) h.b.applyStatus(e, 'cold', { duration: 5, source: u });
    const ps = h.b.getPlayer('p1');
    assert.equal(ps.bonds[KJERAG].layers, 4, '精锐：+4 层');
    assert.equal(ps.bonds[INDOM].layers, 4);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('极光·重构：S2 只在目标已冻结时才是 250%（generic kit 的每次攻击倍率在未冻结时退回）', async () => {
  await loadPack();
  withPackGarrisons();
  const AURORA = 'recon_chess_ws_recon_aurora_a';
  const SKILL = {
    skillId: 'skchr_aurora_2', skillType: 'MANUAL', durationType: 'AMMO', duration: 0,
    spCost: 100, initSp: 0, spType: 'INCREASE_WITH_TIME', trigger: { rule: 'SP_FULL' },
    bb: { atk: 0.45, base_attack_time: 0.25, 'attack@cold': 2.5, atk_scale: 2.5 },
  };
  try {
    const h = makeBattle({
      defs: {
        chess: { [AURORA]: rec(AURORA, { garrison: 'recon_garrison_aurora_a', skill: SKILL }) },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0 }) },
      },
      units: [{ chessId: AURORA, row: 10, col: 6 }],
      enemies: [{ key: 'e_dummy', time: 0 }],
      // 盟约**没激活**：只看特质自己的那一笔倍率，不掺谢拉格 3 人档本身对寒冷 / 冻结目标的额外乘算
      bonds: { [KJERAG]: { count: 3, active: false, tier: 1, layers: 0 } },
      modeId: 'mode_recon_abyss', timeLimit: 10, autoFinish: false,
    });
    h.run(0.3);
    const u = h.unit(AURORA);
    const e = h.b.enemies.find((x) => x.alive);
    // 技能在安装完成**之后**才开（initSp 0 → 测试里手动灌满）：满技力即开，AMMO 技能保持生效
    u.skill.gainSp(200, 'test');
    h.run(0.2);
    assert.equal(u.skill.active, true, 'S2 正在生效');
    const hp0 = e.hp;
    h.b.dealDamage(u, e, { amount: 1000, type: 'phys', isAttack: true, canDodge: false });
    const plain = hp0 - e.hp;
    assert.equal(e.s.flags.freeze, undefined);
    assert.ok(plain > 0 && plain < 600, `目标没冻结：250% 被退回（剩 ${plain}）`);
    h.b.applyStatus(e, 'freeze', { duration: 10, source: null });
    const hp1 = e.hp;
    h.b.dealDamage(u, e, { amount: 1000, type: 'phys', isAttack: true, canDodge: false });
    const frozen = hp1 - e.hp;
    assert.ok(Math.abs(frozen / plain - 2.5) < 1e-6, '目标已冻结：正好 2.5 倍');
    h.runToEnd(10);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('圣聆初雪·重构：攻击寒冷 / 冻结的敌人 → 下一次攻击无视 1 点法抗（精锐 2，最多 25 层）', async () => {
  await loadPack();
  withPackGarrisons();
  const SBELL = 'recon_chess_char_6_02_a';
  const SBELL_E = 'recon_chess_char_6_02_b';
  const KEY = 'recon:sbell2:pierce';
  const run = (id, gid) => {
    const h = makeBattle({
      defs: {
        chess: { [id]: rec(id, { garrison: gid, skill: null }) },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0, res: 30 }) },
      },
      units: [{ chessId: id, row: 10, col: 6 }],
      enemies: [{ key: 'e_dummy', time: 0 }],
      bonds: { [KJERAG]: { count: 3, active: true, tier: 1, layers: 0 } },
      modeId: 'mode_recon_abyss', timeLimit: 10, autoFinish: false,
    });
    h.run(0.5);
    return h;
  };
  try {
    const h = run(SBELL, 'recon_garrison_sbell_a');
    const u = h.unit(SBELL);
    const e = h.enemies()[0];
    h.b.applyStatus(e, 'cold', { duration: 999, source: null });
    h.b.dealDamage(u, e, { amount: 1000, type: 'arts', isAttack: true, canDodge: false });
    assert.equal(u.findBuff(KEY)?.stacks, 1, '这一击叠 1 层');
    assert.equal(u.s.resIgnoreFlat, 1, '下一击无视 1 点法抗');
    for (let i = 0; i < 30; i++) h.b.dealDamage(u, e, { amount: 1000, type: 'arts', isAttack: true, canDodge: false });
    assert.equal(u.findBuff(KEY).stacks, 25, '最多 25 层');
    assert.equal(u.s.resIgnoreFlat, 25);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
  try {
    const h = run(SBELL_E, 'recon_garrison_sbell_b');
    const u = h.unit(SBELL_E);
    const e = h.enemies()[0];
    h.b.applyStatus(e, 'freeze', { duration: 999, source: null });
    h.b.dealDamage(u, e, { amount: 1000, type: 'arts', isAttack: true, canDodge: false });
    assert.equal(u.findBuff(KEY)?.stacks, 1, '冻结目标同样算');
    assert.equal(u.s.resIgnoreFlat, 2, '精锐：每层无视 2 点法抗');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('讯使·重构：S2 立即 +3 部署费用、之后每 1.87 秒 +1（8 次），持续期间防御力 +40%', async () => {
  const pack = await loadPack();
  withPackGarrisons();
  const COURIER = 'recon_chess_ws_recon_courier_a';
  const SKILL = {
    skillId: 'skchr_blackd_2', skillType: 'MANUAL', durationType: 'NONE', duration: 15,
    spCost: 100, initSp: 0, spType: 'INCREASE_WITH_TIME', trigger: { rule: 'SP_FULL' },
    bb: { 'blackd_s_2[once].cost': 3, 'blackd_s_2[period].cost': 1, 'blackd_s_2[period].interval': 1.87, 'blackd_s_2[period].trig_cnt': 8, 'blackd_s_2[period].def': 0.4 },
  };
  try {
    const h = makeBattle({
      defs: { chess: { [COURIER]: rec(COURIER, { garrison: 'recon_garrison_courier_a', skill: SKILL }) }, enemies: {} },
      units: [{ chessId: COURIER, row: 10, col: 6 }],
      bonds: { [KJERAG]: { count: 3, active: true, tier: 1, layers: 0 } },
      modeId: 'mode_recon_abyss', timeLimit: 20, autoFinish: false,
      // 讯使的特质记录是休整期的（不进 IN_BATTLE 表），S2 的两处补数挂在包自己的 install(battle) 上
      battleInstallers: [{ id: 'mode-recon', install: pack.install }],
    });
    h.run(0.5);
    const u = h.unit(COURIER);
    const ps = h.b.getPlayer('p1');
    const t0 = h.b.time, dp0 = ps.dp;
    // 安装完成后再灌满技力：SP_FULL 立刻开
    u.skill.gainSp(200, 'test');
    h.run(0.2);
    assert.equal(u.skill.active, true, 'S2 持续中');
    assert.ok(ps.dp - dp0 > 2.9, `开启时立即 +3 部署费用（实际 +${(ps.dp - dp0).toFixed(2)}）`);
    assert.ok(u.findBuff('recon:courier:s2def'), '防御力 buff 挂上');
    assert.ok(Math.abs(u.s.def - u.base.def * 1.4) < 1e-6, '防御力 +40%');
    h.run(15.5);
    // 每 1.87 秒 +1 ×8，另加战斗本身的每秒 1 点
    const natural = h.b.time - t0;
    assert.ok(Math.abs((ps.dp - dp0) - (11 + natural)) < 0.35, `期望 11 + ${natural.toFixed(2)}，实际 ${(ps.dp - dp0).toFixed(2)}`);
    assert.equal(u.findBuff('recon:courier:s2def'), null, '技能结束后 buff 摘掉');
    h.runToEnd(20);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('休整期：讯使给简易通讯机（需要激活【谢拉格】，精锐 2 件）', async () => {
  const mod = await import(pathToFileURL(path.join(PACK, 'meta/main.mjs')).href);
  let handler = null;
  mod.registerMeta({ global(name, h) { if (name === 'recon') handler = h; }, garrison() {}, item() {} });
  const run = (gid, active) => {
    const granted = [];
    const ctx = {
      gd: { isRecon: true, garrison: (id) => GARRISONS[id] },
      board: () => [{ kind: 'chess', uid: 1, id: 'x_a', area: 'board' }],
      hand: () => [],
      garrisonsOf: () => [{ garrisonId: gid }],
      mark: () => null,
      grantItem: (id, opts) => granted.push({ id, opts }),
      rng: { pick: (arr) => arr[0] },
      recon: () => null,
      addEffect() {},
      removeEffect() {},
      bonds: () => ({}),
      bondActive: () => active,
      layers: () => 0,
      counter: () => 0,
      setCounter: () => 0,
      incCounter: () => 0,
      shopLevel: () => 1,
    };
    handler.onRoundStart(ctx);
    return granted.map((g) => g.id);
  };
  const COMMS = 'chess_item_2_06_e_a';
  assert.deepEqual(run('recon_garrison_courier_a', true), [COMMS], '普通：1 件');
  assert.deepEqual(run('recon_garrison_courier_b', true), [COMMS, COMMS], '精锐：2 件');
  assert.deepEqual(run('recon_garrison_courier_a', false), [], '盟约没激活 ⇒ 不发');
  assert.deepEqual(run('recon_garrison_sbell_a', true), [], '别的特质不发通讯机');
});
