// test/content/recon-kazimierz.test.js — 卡西米尔两名新增干员与四名重构（业主 2026-10-30）在重构模拟里的行为：
//   白金   `RECON_PLATNM_ASPD` 未攻击时每 0.5 秒攻速 +5（20 层），到顶后每 5 秒自身已激活盟约 +1，攻击后 10 秒降回 0
//   玛恩纳 `RECON_MLYNAR_FIELD` 【卡西米尔】干员每 3 次攻击 → 全场敌人 2 秒 5 次 799 / 1124 固定伤害
//   薇薇安娜（meta 覆盖 `item:chess_item_3_12_e`）：骑士储蓄罐销毁时极小概率改发天马之盔 / 之枪
//   流星 → 2 阶且去掉独行、远牙 → 3 阶（3/6 层，上限 18/36）、灰毫 → 1 阶 2 资金（2/4 层）：数据侧，
//   `test/match/recon-chess.test.js` 断言。
//
// 跑法：node --test test/content/recon-kazimierz.test.js
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
const KAZ = 'kazimierzShip';

let packLoad = null;
function loadPack() {
  packLoad ??= (async () => {
    const src = fs.readFileSync(path.join(PACK, 'battle/main.mjs'), 'utf8');
    const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
    return import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  })();
  return packLoad;
}

function rec(id, { bonds = [KAZ], garrison = null, skill = undefined, rangeGrid = [[0, 0], [0, 1]] } = {}) {
  const r = chessRec({
    id, bonds, rangeGrid,
    ...(skill === undefined ? {} : { skill }),
    stats: { atk: 100, maxHp: 5000, def: 500, res: 0, bat: 1, blockCnt: 1, spRecovery: 0 },
  });
  if (garrison) r.garrisonIds = [garrison];
  return r;
}

const withPackGarrisons = () => {
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
};

const SP_ONLY = { skillId: 'sk_test', spCost: 100, initSp: 0, duration: 10, spType: 'INCREASE_WITH_TIME', trigger: { rule: 'DEFAULT' } };

after(() => setGameData(null));

test('白金·重构：未攻击时攻速每 0.5 秒 +5（20 层），到顶后每 5 秒盟约 +1，攻击后逐渐降回 0', async () => {
  await loadPack();
  withPackGarrisons();
  const PLATNM = 'recon_chess_ws_recon_platnm_a';
  try {
    const h = makeBattle({
      defs: { chess: { [PLATNM]: rec(PLATNM, { garrison: 'recon_garrison_platnm_a', skill: SP_ONLY }) }, enemies: {} },
      units: [{ chessId: PLATNM, row: 12, col: 6 }],
      bonds: { [KAZ]: { count: 3, active: true, tier: 1, layers: 0 } },
      modeId: 'mode_recon_abyss', timeLimit: 30, autoFinish: false,
    });
    h.run(0.2);
    const u = h.unit(PLATNM);
    const key = `recon:platnm:aspd:${u.id}`;
    h.run(11);
    assert.equal(u.findBuff(key)?.mods.aspd, 100, '20 层 ×5 = 攻速 +100');
    const ps = h.b.getPlayer('p1');
    h.run(5.2);
    assert.equal(ps.bonds[KAZ].layers, 1, '到顶后在场每 5 秒盟约 +1 层');
    // 攻击一次：10 秒内逐层降回 0（窗口结束后仍未攻击 ⇒ 重新按「未攻击」累积）
    h.b.emit('attack', { attacker: u, targets: [], isSkill: false });
    h.run(5);
    const half = u.findBuff(key)?.mods.aspd ?? 0;
    assert.ok(half > 0 && half <= 60, `攻击 5 秒后只剩一半左右（实际 ${half}）`);
    h.run(4.7);
    assert.equal(u.findBuff(key), null, '10 秒内降回 0');
    h.run(0.8);
    assert.ok(u.findBuff(key)?.mods.aspd > 0, '窗口结束后仍未攻击 ⇒ 重新累积');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('玛恩纳·重构：【卡西米尔】干员每攻击 3 次 → 全场敌人 2 秒受到 5 次 799（精锐 1124）点固定伤害', async () => {
  await loadPack();
  withPackGarrisons();
  const MLYNAR = 'recon_chess_char_5_19_a';
  const MLYNAR_E = 'recon_chess_char_5_19_b';
  const run = (id, gid) => {
    const h = makeBattle({
      defs: {
        chess: { [id]: rec(id, { garrison: gid, skill: SP_ONLY, rangeGrid: [[0, 0], [0, 1]] }) },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0 }) },
      },
      units: [{ chessId: id, row: 12, col: 6 }],
      enemies: [],
      bonds: { [KAZ]: { count: 3, active: true, tier: 1, layers: 0 } },
      modeId: 'mode_recon_abyss', timeLimit: 10, autoFinish: false,
    });
    h.run(0.2);
    return h;
  };
  try {
    const h = run(MLYNAR, 'recon_garrison_mlynar_a');
    const u = h.unit(MLYNAR);
    const e = h.spawn('e_dummy', { pos: [9, 8] });
    const hp0 = e.hp;
    for (let i = 0; i < 2; i++) h.b.emit('attack', { attacker: u, targets: [], isSkill: false });
    h.run(3);
    assert.equal(hp0 - e.hp, 0, '不到 3 次不触发');
    for (let i = 0; i < 3; i++) h.b.emit('attack', { attacker: u, targets: [], isSkill: false });
    h.run(3);
    assert.ok(Math.abs((hp0 - e.hp) - 5 * 799) < 1e-6, `5 次 ×799（实际 ${hp0 - e.hp}）`);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
  try {
    const h = run(MLYNAR_E, 'recon_garrison_mlynar_b');
    const u = h.unit(MLYNAR_E);
    const e = h.spawn('e_dummy', { pos: [9, 8] });
    const hp0 = e.hp;
    for (let i = 0; i < 3; i++) h.b.emit('attack', { attacker: u, targets: [], isSkill: false });
    h.run(3);
    assert.ok(Math.abs((hp0 - e.hp) - 5 * 1124) < 1e-6, `精锐：5 次 ×1124（实际 ${hp0 - e.hp}）`);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('薇薇安娜·重构：骑士储蓄罐销毁时按特质概率改发天马之盔 / 之枪（没有她仍是官方的资金）', async () => {
  const mod = await import(pathToFileURL(path.join(PACK, 'meta/main.mjs')).href);
  let itemHandler = null;
  mod.registerMeta({ global() {}, item(key, h) { if (key === 'chess_item_3_12_e') itemHandler = h; }, garrison() {} });
  assert.ok(itemHandler, '覆盖了骑士储蓄罐的 item 处理器');
  const run = ({ recon = true, prob = null, chance = false, pick = 'helmet' } = {}) => {
    const out = { funds: [], items: [] };
    const board = prob == null ? [] : [{ kind: 'chess', uid: 1, id: 'v_a', area: 'board' }];
    const ctx = {
      gd: { isRecon: recon, item: () => ({ params: { min: 1, max: 6 } }) },
      board: () => board,
      garrisonsOf: () => (prob == null ? [] : [{ garrisonId: 'recon_garrison_vvana_a', bb: { prob } }]),
      addFunds: (n) => out.funds.push(n),
      grantItem: (id) => out.items.push(id),
      rng: { chance: () => chance, pick: () => (pick === 'helmet' ? 'chess_item_5_09_e_a' : 'chess_item_6_01_e_a'), int: (n) => n - 1 },
    };
    itemHandler.onEquip(ctx, { item: { id: 'chess_item_3_12_e_a' } });
    return out;
  };
  assert.deepEqual(run(), { funds: [6], items: [] }, '场上没有薇薇安娜 ⇒ 官方 1~6 资金（这里 int 取满值）');
  assert.deepEqual(run({ recon: false, prob: 0.0799, chance: true }), { funds: [6], items: [] }, '不是重构对局 ⇒ 官方');
  assert.deepEqual(run({ prob: 0.0325, chance: true, pick: 'helmet' }), { funds: [], items: ['chess_item_5_09_e_a'] }, '触发 ⇒ 改发天马之盔');
  assert.deepEqual(run({ prob: 0.0799, chance: true, pick: 'lance' }), { funds: [], items: ['chess_item_6_01_e_a'] }, '触发 ⇒ 改发天马之枪');
  assert.deepEqual(run({ prob: 0.0325, chance: false }), { funds: [6], items: [] }, '没触发 ⇒ 仍然发资金');
});
