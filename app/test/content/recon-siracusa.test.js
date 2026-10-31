// test/content/recon-siracusa.test.js — 叙拉古两名新增干员（业主 2026-10-31）在重构模拟里的战斗行为：
//   斥罪 `RECON_ZEIZ_GUARD`：处于隐匿的【叙拉古】干员受到的攻击由斥罪承担，每次 +4 / +8 层（最多 6 次）；
//   贝洛内的两条特质一半在数据（`act2autochess_gar_event_onstart` 部署加层）一半在 `meta/main.mjs`
//   （`siracusaPrepRewards`，与伺夜互惠）—— 数据与休整期那一半在 `test/match/recon-chess.test.js` 断言。
//
// 跑法：node --test test/content/recon-siracusa.test.js
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

function rec(id, { bonds = ['siracusaShip'], garrison = null } = {}) {
  const r = chessRec({
    id, bonds, rangeGrid: [[0, 0], [0, 1]],
    stats: { atk: 100, maxHp: 5000, def: 500, res: 0, bat: 1, blockCnt: 1, spRecovery: 0 },
  });
  if (garrison) r.garrisonIds = [garrison];
  return r;
}

after(() => setGameData(null));

test('斥罪·重构：隐匿的【叙拉古】干员受到的攻击由自身承担，每次 +4 层（最多 6 次）', async () => {
  await loadPack();
  withPackGarrisons();
  const JUDGE = 'recon_chess_ws_recon_judge_a';
  const HIDDEN = 't_hidden_sira';
  const PLAIN = 't_plain_sira';
  try {
    const h = makeBattle({
      defs: {
        chess: {
          [JUDGE]: rec(JUDGE, { garrison: 'recon_garrison_judge_a' }),
          [HIDDEN]: rec(HIDDEN),
          [PLAIN]: rec(PLAIN),
        },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0 }) },
      },
      units: [
        { chessId: JUDGE, row: 10, col: 5 },
        { chessId: HIDDEN, row: 11, col: 5 },
        { chessId: PLAIN, row: 12, col: 5 },
      ],
      bonds: {
        siracusaShip: { count: 3, active: true, tier: 1, layers: 0 },
        indomShip: { count: 3, active: true, tier: 1, layers: 0 },
      },
      modeId: 'mode_recon_abyss', timeLimit: 40, autoFinish: false,
    });
    h.run(0.2);
    const judge = h.unit(JUDGE);
    const hidden = h.unit(HIDDEN);
    const plain = h.unit(PLAIN);
    const enemy = h.spawn('e_dummy', { pos: [9, 5] });
    h.b.addBuff(hidden, { key: 'test:stealth', flags: { stealth: true }, duration: Infinity });
    const ps = h.b.getPlayer('p1');
    const hit = (t, amount = 400) => h.b.dealDamage(enemy, t, { amount, type: 'true', canDodge: false, isAttack: true });

    // 1) 隐匿的叙拉古干员挨打 ⇒ 伤害改由斥罪承担，两条盟约各 +4
    const hpHidden = hidden.hp;
    const hpJudge = judge.hp;
    hit(hidden);
    assert.equal(hidden.hp, hpHidden, '隐匿干员没有受到伤害');
    assert.equal(judge.hp, hpJudge - 400, '改由斥罪承担（真实伤害，不被她的防御削减）');
    assert.equal(ps.bonds.siracusaShip.layers, 4);
    assert.equal(ps.bonds.indomShip.layers, 4);

    // 2) 不隐匿的同盟约干员 ⇒ 照常受伤，斥罪不管
    const hpPlain = plain.hp;
    const hpJudge2 = judge.hp;
    hit(plain);
    assert.equal(plain.hp, hpPlain - 400);
    assert.equal(judge.hp, hpJudge2);
    assert.equal(ps.bonds.siracusaShip.layers, 4, '不隐匿 ⇒ 不加层');

    // 3) 每场最多 6 次（第 7 次不再加层，但攻击仍由斥罪承担）
    for (let i = 0; i < 5; i++) hit(hidden);
    assert.equal(ps.bonds.siracusaShip.layers, 24, '6 次 ×4 = 24');
    assert.equal(ps.bonds.indomShip.layers, 24);
    const hpJudge3 = judge.hp;
    hit(hidden);
    assert.equal(judge.hp, hpJudge3 - 400, '第七次仍然承担');
    assert.equal(ps.bonds.siracusaShip.layers, 24, '最多 6 次');
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});

test('斥罪·重构（精锐）：每次 +8 层；不隐匿的干员不受保护', async () => {
  await loadPack();
  withPackGarrisons();
  const JUDGE = 'recon_chess_ws_recon_judge_b';
  const HIDDEN = 't_hidden_sira_b';
  try {
    const h = makeBattle({
      defs: {
        chess: {
          [JUDGE]: rec(JUDGE, { garrison: 'recon_garrison_judge_b' }),
          [HIDDEN]: rec(HIDDEN),
        },
        enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e7, atk: 0, speed: 0 }) },
      },
      units: [{ chessId: JUDGE, row: 10, col: 5 }, { chessId: HIDDEN, row: 11, col: 5 }],
      bonds: {
        siracusaShip: { count: 3, active: true, tier: 1, layers: 0 },
        indomShip: { count: 3, active: true, tier: 1, layers: 0 },
      },
      modeId: 'mode_recon_abyss', timeLimit: 40, autoFinish: false,
    });
    h.run(0.2);
    const hidden = h.unit(HIDDEN);
    const enemy = h.spawn('e_dummy', { pos: [9, 5] });
    h.b.addBuff(hidden, { key: 'test:stealth', flags: { stealth: true }, duration: Infinity });
    const ps = h.b.getPlayer('p1');
    const hit = (t, amount = 200) => h.b.dealDamage(enemy, t, { amount, type: 'true', canDodge: false, isAttack: true });
    hit(hidden);
    hit(hidden);
    assert.equal(ps.bonds.siracusaShip.layers, 16, '精锐 2 次 ×8');
    assert.equal(ps.bonds.indomShip.layers, 16);
    assert.equal(h.invariants(), true);
  } finally {
    setGameData(null);
  }
});
