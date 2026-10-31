// test/content/recon-aegir.test.js — 阿戈尔两名新增干员（业主 2026-10-31）在重构模拟里的战斗行为：
//   克莱门莎 `RECON_CLEMNT_AEGIR`：每次攻击附带自身 1% / 2% 生命上限 ×【阿戈尔】层数的元素伤害，
//   并把敌人的侵蚀爆发冷却（`erosionBurst`）缩短 25% / 50%；
//   海沫 `RECON_HIGHMO_COPY`：<战斗开始时>把身前一格干员的特质交给身后一格（精锐身后两格）。
//   深海色（售出给 2 阶装备）与安哲拉（休整期装备替换）是休整期那一半，在 `test/match/recon-chess.test.js` 断言。
//
// 跑法：node --test test/content/recon-aegir.test.js
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

let packLoad = null;
function loadPack() {
  packLoad ??= (async () => {
    const src = fs.readFileSync(path.join(PACK, 'battle/main.mjs'), 'utf8');
    const rewritten = rewriteKitImports(src, (file) => pathToFileURL(path.join(ROOT, file)).href);
    return import(`data:text/javascript;base64,${Buffer.from(rewritten, 'utf8').toString('base64')}`);
  })();
  return packLoad;
}

const withPackGarrisons = () => {
  const d = gameData();
  setGameData({ ...d, garrisons: { ...d.garrisons, ...GARRISONS } });
};

function rec(id, { bonds = ['egirShip'], garrison = null } = {}) {
  const r = chessRec({
    id, bonds, rangeGrid: [[0, 0], [0, 1]],
    stats: { atk: 100, maxHp: 5000, def: 500, res: 0, bat: 1, blockCnt: 1, spRecovery: 0 },
  });
  if (garrison) r.garrisonIds = [garrison];
  return r;
}

after(() => setGameData(null));

test('克莱门莎·重构：每次攻击附带 1% 生命上限 ×【阿戈尔】层数的元素伤害，侵蚀爆发冷却 -25%', async () => {
  await loadPack();
  withPackGarrisons();
  const CLEMNT = 'recon_chess_ws_recon_clemnt_a';
  try {
    const h = makeBattle({
      defs: {
        chess: { [CLEMNT]: rec(CLEMNT, { garrison: 'recon_garrison_clemnt_a' }) },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0 }) },
      },
      units: [{ chessId: CLEMNT, row: 12, col: 6 }],
      bonds: { egirShip: { count: 3, active: true, tier: 1, layers: 3 } },
      modeId: 'mode_recon_abyss', timeLimit: 20, autoFinish: false,
    });
    h.run(0.2);
    const u = h.unit(CLEMNT);
    const e = h.spawn('e_dummy', { pos: [9, 8] });
    const rider = u.s.maxHp * 0.01 * 3;
    const hp0 = e.hp;
    h.b.dealDamage(u, e, { amount: 100, type: 'true', canDodge: false, isAttack: true });
    assert.ok(Math.abs((hp0 - e.hp) - (100 + rider)) < 1e-6, `攻击 100 + 元素伤害 ${rider}（实际 ${hp0 - e.hp}）`);

    // 已激活层数为 0 ⇒ 不附带元素伤害
    const ps = h.b.getPlayer('p1');
    ps.bonds.egirShip.layers = 0;
    const hp1 = e.hp;
    h.b.dealDamage(u, e, { amount: 100, type: 'true', canDodge: false, isAttack: true });
    assert.equal(hp1 - e.hp, 100, '0 层不附带');

    // 侵蚀爆发冷却：8 秒 → 6 秒（−25%）
    const lock = h.b.addBuff(e, { key: 'erosionBurst', duration: 8, flags: { burstLock: true } });
    assert.equal(lock.timeLeft, 8);
    h.b.dealDamage(u, e, { amount: 10, type: 'true', canDodge: false, isAttack: true });
    assert.ok(Math.abs(lock.timeLeft - 6) < 1e-9, `冷却剩 ${lock.timeLeft} 秒`);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('克莱门莎·重构（精锐）：2% 生命上限、侵蚀爆发冷却 -50%', async () => {
  await loadPack();
  withPackGarrisons();
  const CLEMNT = 'recon_chess_ws_recon_clemnt_b';
  try {
    const h = makeBattle({
      defs: {
        chess: { [CLEMNT]: rec(CLEMNT, { garrison: 'recon_garrison_clemnt_b' }) },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0 }) },
      },
      units: [{ chessId: CLEMNT, row: 12, col: 6 }],
      bonds: { egirShip: { count: 3, active: true, tier: 1, layers: 2 } },
      modeId: 'mode_recon_abyss', timeLimit: 20, autoFinish: false,
    });
    h.run(0.2);
    const u = h.unit(CLEMNT);
    const e = h.spawn('e_dummy', { pos: [9, 8] });
    const rider = u.s.maxHp * 0.02 * 2;
    const hp0 = e.hp;
    h.b.dealDamage(u, e, { amount: 100, type: 'true', canDodge: false, isAttack: true });
    assert.ok(Math.abs((hp0 - e.hp) - (100 + rider)) < 1e-6, `精锐：攻击 100 + 元素伤害 ${rider}`);

    const lock = h.b.addBuff(e, { key: 'erosionBurst', duration: 8, flags: { burstLock: true } });
    h.b.dealDamage(u, e, { amount: 10, type: 'true', canDodge: false, isAttack: true });
    assert.ok(Math.abs(lock.timeLeft - 4) < 1e-9, `精锐：冷却剩 ${lock.timeLeft} 秒`);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('海沫·重构：战斗开始时身后一格获得身前一格的特质（精锐身后两格）', async () => {
  await loadPack();
  withPackGarrisons();
  const HM = 'recon_chess_ws_recon_highmo_a';
  const HM_E = 'recon_chess_ws_recon_highmo_b';
  try {
    // 身前一格 = 阵营 137（攻防 +25%），复制后身后干员也应拿到这条 buff
    const h = makeBattle({
      defs: {
        chess: {
          [HM]: rec(HM, { garrison: 'recon_garrison_highmo_a' }),
          front: rec('front', { garrison: 'garrison_137_a' }),
          back: rec('back'),
          far: rec('far'),
        },
      },
      units: [
        { chessId: HM, row: 11, col: 5 },
        { chessId: 'front', row: 11, col: 6 },
        { chessId: 'back', row: 11, col: 4 },
        { chessId: 'far', row: 10, col: 4 },
      ],
      modeId: 'mode_recon_abyss', timeLimit: 20, autoFinish: false,
    });
    h.run(0.2);
    const front = h.unit('front');
    const back = h.unit('back');
    const far = h.unit('far');
    assert.ok(front.findBuff('gar:garrison_137_a'), '身前一格自己带着');
    assert.ok(back.findBuff('gar:garrison_137_a'), '身后一格继承到');
    assert.ok(Math.abs(back.s.atk - back.base.atk * 1.25) < 1e-6, '攻击力 +25%');
    assert.equal(far.findBuff('gar:garrison_137_a'), null, '不在身后那一格 ⇒ 没有');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }

  try {
    const h = makeBattle({
      defs: {
        chess: {
          [HM_E]: rec(HM_E, { garrison: 'recon_garrison_highmo_b' }),
          front2: rec('front2', { garrison: 'garrison_137_a' }),
          back1: rec('back1'),
          back2: rec('back2'),
        },
      },
      units: [
        { chessId: HM_E, row: 11, col: 5 },
        { chessId: 'front2', row: 11, col: 6 },
        { chessId: 'back1', row: 11, col: 4 },
        { chessId: 'back2', row: 11, col: 3 },
      ],
      modeId: 'mode_recon_abyss', timeLimit: 20, autoFinish: false,
    });
    h.run(0.2);
    const back1 = h.unit('back1');
    const back2 = h.unit('back2');
    assert.ok(back1.findBuff('gar:garrison_137_a'), '身后第一格继承');
    assert.ok(back2.findBuff('gar:garrison_137_a'), '精锐：身后第二格也继承');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});
