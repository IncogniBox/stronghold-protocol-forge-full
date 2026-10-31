// test/content/recon-added-talents.test.js — 重构模拟里**本机没有官方 kit** 的八名新增干员的天赋（业主 2026-10-31
// 「新增干员的特质和天赋都没有生效」）。这八名干员的技能走 generic kit，天赋却只写在官方 kit 的 `talents[].install`
// 里 —— generic kit 只装无条件属性行（`generic.js genericTalents`，且只对 stand-in / 自选生效），所以此前一条都没落地。
// 包侧在 `workshop/mode-recon/battle/main.mjs` 的 `install(battle)` 里补了 `installAddedTalents`（按 `def.charId` 认人）。
//
//   狮蝎「隐匿的杀手·中级」  平时隐匿；攻击当次 +29% / +33%，停手 6 秒后重新隐匿
//   极光「低温休憩」          技能未开启且 SP ≤ 一半时停止攻击、每秒回复 3.5% / 4% 最大生命
//   讯使「雪境巡逻员」        阻挡 ≥2 名敌人时防御力 +11% / +13%
//   空构「装弹对比实验」      每次攻击 50% 概率三选一：二连击 / 晕眩 1 秒 / 无视 60% 防御
//   白金「蓄力攻击」          距上次攻击 1 秒 → 100%，2.5 秒 → 190% / 200%，线性
//   海沫「收割，给养」        每命中一名敌人回复 35 点元素损伤，最多按阻挡数
//   深海色「召唤触手」        三个触手召唤物（`token_10001_deepcl_tentac`）
//   安哲拉「深海直觉」        编入队伍时所有【深海猎人】干员攻速 +8 / +10
//
// 跑法：node --test test/content/recon-added-talents.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { rewriteKitImports } from '../../shared/kitImports.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK = path.join(ROOT, 'workshop/mode-recon');
const TOKENS = JSON.parse(fs.readFileSync(path.join(PACK, 'tokens.json'), 'utf8'));
const CHESS = JSON.parse(fs.readFileSync(path.join(PACK, 'chess.json'), 'utf8'));
const TOKEN = 'token_10001_deepcl_tentac';

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

/** 一名新增干员的记录（charId 决定包侧哪条天赋认领它）。 */
function rec(id, { charId, talents = [], bonds = [], profession = 'WARRIOR', stats = {}, skill = null, rangeGrid = [[0, 0], [0, 1]] }) {
  return chessRec({ id, charId, talents, bonds, profession, skill, rangeGrid, stats });
}

/** 一个战场：包侧 `install` 显式递给它（天赋挂在 install 上，不是 garrison 特质）。 */
async function battle(opts) {
  const pack = await loadPack();
  return makeBattle({
    modeId: 'mode_recon_abyss', timeLimit: 30, autoFinish: false,
    battleInstallers: [{ id: 'mode-recon', install: pack.install }],
    ...opts,
  });
}

test('狮蝎「隐匿的杀手·中级」：平时隐匿，攻击当次 +29%，停手 6 秒后重新隐匿', async () => {
  const ID = 'recon_chess_ws_recon_mantic_a';
  const h = await battle({
    defs: {
      chess: { [ID]: rec(ID, { charId: 'char_215_mantic', profession: 'SPECIAL', talents: [{ name: 't', bb: { delay: 6, atk: 0.29 } }], stats: { atk: 100, maxHp: 5000, def: 0, blockCnt: 0 } }) },
      enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e9, atk: 0, speed: 0, def: 0 }) },
    },
    units: [{ chessId: ID, row: 10, col: 6 }],
    enemies: [{ key: 'e_dummy', time: 100 }],
  });
  h.run(0.3);
  const u = h.unit(ID);
  const key = `recon:mantic:talent:${u.id}`;
  assert.ok(u.findBuff(key), '战斗开始时隐匿');
  assert.ok(u.s.flags.stealth);
  const e = h.spawn('e_dummy', { pos: [1, 1] });
  const hp0 = e.hp;
  h.b.dealDamage(u, e, { amount: 1000, type: 'phys', isAttack: true, canDodge: false, attackId: 1 });
  assert.equal(hp0 - e.hp, 1290, '隐匿状态下这一击 +29%（敌方 DEF 0）');
  h.b.emit('attack', { attacker: u, targets: [e], isSkill: false });
  assert.equal(u.findBuff(key), null, '攻击后解除隐匿');
  assert.notEqual(u.s.flags.stealth, true);
  h.run(6.5);
  assert.ok(u.findBuff(key), '停止攻击 6 秒后重新隐匿');
  assert.equal(h.invariants(), true);
});

test('极光「低温休憩」：技能未开启且 SP ≤ 一半 → 停止攻击、每秒回复 3.5% 最大生命', async () => {
  const ID = 'recon_chess_ws_recon_aurora_a';
  const SK = { skillId: 'sk_test', spCost: 100, initSp: 0, duration: 10, spType: 'INCREASE_WITH_TIME', trigger: { rule: 'DEFAULT' } };
  const h = await battle({
    defs: { chess: { [ID]: rec(ID, { charId: 'char_422_aurora', profession: 'TANK', skill: SK, talents: [{ name: 't', bb: { hp_recovery_per_sec_by_max_hp_ratio: 0.035, sp_ratio: 0.5 } }], stats: { atk: 100, maxHp: 5000, def: 500, blockCnt: 1, spRecovery: 0 } }) }, enemies: {} },
    units: [{ chessId: ID, row: 10, col: 6 }],
  });
  h.run(0.6); // `every(0.5)` 的第一跳在 t=0.5 之后
  const u = h.unit(ID);
  const key = `recon:aurora:talent:${u.id}`;
  assert.ok(u.findBuff(key), 'SP 未过半 ⇒ 休息');
  assert.ok(u.s.flags.disarm, '停止普通攻击');
  h.b.dealDamage(null, u, { amount: 1000, type: 'true', sourceless: true, canDodge: false });
  const hp0 = u.hp;
  h.run(2.6);
  assert.equal(u.hp - hp0, 525, '3 跳 × 3.5% × 5000 = 525');
  assert.equal(h.invariants(), true);
});

test('讯使「雪境巡逻员」：阻挡 ≥2 名敌人时防御力 +11%，不足两名时摘掉', async () => {
  const ID = 'recon_chess_ws_recon_courier_a';
  const h = await battle({
    defs: {
      chess: { [ID]: rec(ID, { charId: 'char_198_blackd', profession: 'VANGUARD', talents: [{ name: 't', bb: { cnt: 2, def: 0.11 } }], stats: { atk: 100, maxHp: 5000, def: 500, blockCnt: 2 } }) },
      enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e9, atk: 0, speed: 0 }) },
    },
    units: [{ chessId: ID, row: 10, col: 6 }],
    enemies: [{ key: 'e_dummy', time: 100 }],
  });
  h.run(0.3);
  const u = h.unit(ID);
  const key = `recon:courier:talent:${u.id}`;
  const e1 = h.spawn('e_dummy', { pos: [10, 6] });
  const e2 = h.spawn('e_dummy', { pos: [10, 6] });
  e1.blockedBy = u; e2.blockedBy = u; u.blocking.push(e1, e2);
  h.run(0.6);
  assert.ok(u.findBuff(key));
  assert.ok(Math.abs(u.s.def - 555) < 1e-6, '500 × 1.11');
  u.blocking.pop(); e2.blockedBy = null; e2.x = 5; e2.y = 5; // 挪远，免得下一 tick 又被接触判定挡回来
  h.run(0.6);
  assert.equal(u.findBuff(key), null, '只剩 1 名 ⇒ 摘掉');
  assert.ok(Math.abs(u.s.def - 500) < 1e-6);
  assert.equal(h.invariants(), true);
});

test('空构「装弹对比实验」：每次攻击 50% 概率三选一（二连击 / 晕眩 1 秒 / 无视 60% 防御）', async () => {
  const ID = 'recon_chess_ws_recon_spuria_a';
  const h = await battle({
    seed: 1,
    defs: {
      chess: { [ID]: rec(ID, { charId: 'char_4015_spuria', profession: 'SPECIAL', talents: [{ name: 't', bb: { prob: 0.5, stun: 1, def_penetrate: 0.6 } }], stats: { atk: 100, maxHp: 5000, def: 0, blockCnt: 1 } }) },
      enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e9, atk: 0, speed: 0, def: 100 }) },
    },
    units: [{ chessId: ID, row: 10, col: 6 }],
    enemies: [{ key: 'e_dummy', time: 100 }],
    captureNoisy: true,
  });
  h.run(0.3);
  const u = h.unit(ID);
  const e = h.spawn('e_dummy', { pos: [1, 1] });
  let stunned = false;
  for (let i = 1; i <= 40; i++) {
    h.b.dealDamage(u, e, { amount: 100, type: 'phys', isAttack: true, canDodge: false, attackId: i });
    if (e.s.flags.stun) stunned = true;
  }
  h.run(0.2);
  const hits = h.hooksOf('hit');
  assert.ok(hits.some((c) => c?.dmg && c.dmg.defIgnorePct >= 0.6), '穿甲：无视 60% 防御');
  assert.ok(hits.some((c) => Array.isArray(c?.dmg?.tags) && c.dmg.tags.includes('recon:spuria:double')), '二连击：追加的第二次命中');
  assert.ok(stunned, '晕眩 1 秒');
  assert.equal(h.invariants(), true);
});

test('白金「蓄力攻击」：1 秒 100% / 2.5 秒 190%（精锐 200%），间隔越长这一击越高', async () => {
  const ID = 'recon_chess_ws_recon_platnm_a';
  const h = await battle({
    defs: {
      chess: { [ID]: rec(ID, { charId: 'char_204_platnm', profession: 'SNIPER', talents: [{ name: 't', bb: { 'attack@min_delta': 1, 'attack@max_delta': 2.5, 'attack@min_atk_scale': 1, 'attack@max_atk_scale': 1.9 } }], stats: { atk: 100, maxHp: 5000, def: 0, blockCnt: 1 } }) },
      enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e9, atk: 0, speed: 0, def: 0 }) },
    },
    units: [{ chessId: ID, row: 10, col: 6 }],
    enemies: [{ key: 'e_dummy', time: 100 }],
  });
  h.run(3);
  const u = h.unit(ID);
  const e = h.spawn('e_dummy', { pos: [1, 1] });
  const hp0 = e.hp;
  h.b.dealDamage(u, e, { amount: 100, type: 'phys', isAttack: true, canDodge: false, attackId: 1 });
  assert.equal(hp0 - e.hp, 190, '部署后蓄满 2.5 秒 ⇒ 190%');
  const hp1 = e.hp;
  h.b.dealDamage(u, e, { amount: 100, type: 'phys', isAttack: true, canDodge: false, attackId: 2 });
  assert.equal(hp1 - e.hp, 100, '紧接着的下一击 ⇒ 100%');
  assert.equal(h.invariants(), true);
});

test('海沫「收割，给养」：每命中一名敌人回复 35 点元素损伤，最多按阻挡数', async () => {
  const ID = 'recon_chess_ws_recon_highmo_a';
  const h = await battle({
    defs: {
      chess: { [ID]: rec(ID, { charId: 'char_4066_highmo', profession: 'WARRIOR', talents: [{ name: 't', bb: { value: 35 } }], stats: { atk: 100, maxHp: 5000, def: 500, blockCnt: 2 } }) },
      enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e9, atk: 0, speed: 0 }) },
    },
    units: [{ chessId: ID, row: 10, col: 6 }],
    enemies: [{ key: 'e_dummy', time: 100 }],
  });
  h.run(0.3);
  const u = h.unit(ID);
  const e = h.spawn('e_dummy', { pos: [1, 1] });
  h.b.dealDamage(null, u, { type: 'element', element: 'erosion', amount: 200, canDodge: false });
  assert.equal(u.elem.erosion, 200, '先垫 200 元素损伤');
  for (let i = 0; i < 3; i++) h.b.dealDamage(u, e, { amount: 100, type: 'phys', isAttack: true, canDodge: false, attackId: 1 });
  assert.equal(u.elem.erosion, 130, '同一次攻击最多按阻挡数 2 名结算：200 − 35×2');
  assert.equal(h.invariants(), true);
});

test('深海色「召唤触手」：战斗开始最多放出三个触手（重复触发不再追加）', async () => {
  const ID = 'recon_chess_ws_recon_deepcl_a';
  const h = await battle({
    defs: {
      chess: { [ID]: rec(ID, { charId: 'char_110_deepcl', profession: 'SUPPORT', talents: [{ name: 't', bb: { cnt: 3 }, tokenKey: TOKEN }], stats: { atk: 100, maxHp: 5000, def: 0, blockCnt: 1 } }) },
      enemies: {},
      tokens: { [TOKEN]: TOKENS[TOKEN] },
    },
    units: [{ chessId: ID, row: 10, col: 6 }],
  });
  h.run(0.5);
  const toks = h.b.allyUnits.filter((u) => u.kind === 'token' && u.defId === TOKEN);
  assert.equal(toks.length, 3, '正好三个（deploy 与 battleStart 不重复放）');
  for (const t of toks) assert.equal(t.ownerUnit, h.unit(ID), '触手归深海色');
  assert.equal(h.invariants(), true);
});

test('有官方 kit 的四名新增干员：记录上的 kitRef 让天赋在真实战斗里装上', async () => {
  const ZUOLE = 'recon_chess_ws_recon_zuole_a';
  const CHEN3 = 'recon_chess_ws_recon_chen3_a';
  const NARANT = 'recon_chess_ws_recon_narant_a';
  const ZUMAMA = 'recon_chess_ws_recon_zumama_a';
  const h = await battle({
    defs: { chess: { [ZUOLE]: CHESS[ZUOLE], [CHEN3]: CHESS[CHEN3], [NARANT]: CHESS[NARANT], [ZUMAMA]: CHESS[ZUMAMA] }, enemies: {} },
    units: [
      { chessId: ZUOLE, row: 10, col: 5 },
      { chessId: CHEN3, row: 11, col: 5 },
      { chessId: NARANT, row: 10, col: 7 },
      { chessId: ZUMAMA, row: 11, col: 7 },
    ],
  });
  h.run(0.3);
  assert.ok(h.unit(CHEN3).findBuff('talent:chen3:insight'), '赤刃明霄陈：形意洞照（攻击力 / 攻速）');
  assert.ok(h.unit(NARANT).findBuff('talent:narant:dodge'), '娜仁图亚：婀娜虚影（闪避）');
  assert.ok(h.unit(ZUMAMA).findBuff('talent:zumama:valor'), '森蚺：勇冠三军（生命 > 一半时的伤害）');
  assert.equal(h.invariants(), true);
});

test('安哲拉「深海直觉」：编入队伍时所有【深海猎人】干员攻速 +8', async () => {
  const ID = 'recon_chess_ws_recon_cuttle_a';
  const EGIR = 'test_egir_a';
  const OTHER = 'test_other_a';
  const h = await battle({
    defs: {
      chess: {
        [ID]: rec(ID, { charId: 'char_218_cuttle', profession: 'SNIPER', bonds: ['egirShip'], talents: [{ name: 't', bb: { attack_speed: 8 } }], stats: { atk: 100, maxHp: 5000, def: 0, blockCnt: 1 } }),
        [EGIR]: rec(EGIR, { bonds: ['egirShip'], stats: { atk: 100, maxHp: 5000, def: 0, blockCnt: 1 } }),
        [OTHER]: rec(OTHER, { stats: { atk: 100, maxHp: 5000, def: 0, blockCnt: 1 } }),
      },
      enemies: {},
    },
    units: [{ chessId: ID, row: 10, col: 6 }, { chessId: EGIR, row: 11, col: 6 }, { chessId: OTHER, row: 12, col: 6 }],
  });
  h.run(0.3);
  assert.ok(Math.abs(h.unit(EGIR).s.aspd - 108) < 1e-6, '【深海猎人】+8');
  assert.ok(Math.abs(h.unit(ID).s.aspd - 108) < 1e-6, '安哲拉自己也是【深海猎人】');
  assert.ok(Math.abs(h.unit(OTHER).s.aspd - 100) < 1e-6, '非【深海猎人】不吃');
  assert.equal(h.invariants(), true);
});
