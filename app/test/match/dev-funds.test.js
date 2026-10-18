// 本地 dev 通道 `g.dev`（本 Forge 发行版自加，非上游协议）：仅服务端 `SP_DEV=1` 时给**发指令的玩家自己**加减资金。
// 形状在 shared/protocol.js（funds 可选），处理在 server/match/match/intents.js devFunds（默认关闭）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateC2S } from '../../shared/protocol.js';
import { ERR, PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

/** PREP R1 of a real match (solo). */
function prep(seed = 3) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed, fake: true }).start();
  h.toPrep(1);
  return h;
}

/** Run `fn` with SP_DEV set to `value` (undefined ⇒ unset), restoring the previous value. */
function withDev(value, fn) {
  const prev = process.env.SP_DEV;
  try {
    if (value === undefined) delete process.env.SP_DEV; else process.env.SP_DEV = value;
    fn();
  } finally {
    if (prev === undefined) delete process.env.SP_DEV; else process.env.SP_DEV = prev;
  }
}

test('g.dev shape: funds optional at the wire level, a non-integer refused', () => {
  assert.equal(validateC2S({ t: 'g.dev', funds: 100 }), null);
  assert.equal(validateC2S({ t: 'g.dev' }), null, 'funds optional (fuzz builds field-less messages)');
  assert.notEqual(validateC2S({ t: 'g.dev', funds: 'x' }), null);
  assert.notEqual(validateC2S({ t: 'g.dev', funds: 2e9 }), null, 'out of range');
});

test('g.dev is refused while SP_DEV is unset (the default)', () => {
  withDev(undefined, () => {
    const h = prep(5);
    const ps = h.ps('p_0');
    const before = ps.funds;
    assert.equal(h.m.handle('p_0', { t: 'g.dev', funds: 100 }).error, ERR.BAD_MSG);
    assert.equal(ps.funds, before, 'nothing changes while the channel is off');
  });
});

test('g.dev adds / subtracts the sender’s funds when SP_DEV=1', () => {
  withDev('1', () => {
    const h = prep(7);
    const { m } = h; const ps = h.ps('p_0');
    const before = ps.funds;
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', funds: 500 }), { ok: true });
    assert.equal(ps.funds, before + 500);
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', funds: -200 }), { ok: true });
    assert.equal(ps.funds, before + 300, 'a negative delta spends');
    assert.equal(m.handle('p_0', { t: 'g.dev', funds: 0 }).error, ERR.BAD_TARGET);
    assert.equal(m.handle('p_0', { t: 'g.dev' }).error, ERR.BAD_TARGET, 'absent funds');
    assert.equal(h.m.handle('p_0', { t: 'g.dev', funds: 100 }).error ?? null, null);
    h.invariants();
  });
});

// =====================================================================================================================
// 开发者面板（「全量模拟」对局，`Match.dev === true`）：action 化的 `g.dev`（见 shared/protocol.js DEV_ACTIONS）

/** PREP R1 of a **dev** match (「全量模拟」：`Match.dev === true`). */
function devPrep(seed = 11) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed, fake: true, dev: true }).start();
  h.toPrep(1);
  return h;
}

test('a dev match publishes m.public.dev; a plain match does not carry the key', () => {
  assert.equal(devPrep(11).m.publicView().dev, true);
  assert.equal('dev' in prep(12).m.publicView(), false, 'a plain match stays byte-identical');
});

test('dev actions are refused outside a dev match (SP_DEV alone only opens the legacy funds shape)', () => {
  withDev(undefined, () => {
    const h = prep(13);
    const ps = h.ps('p_0');
    const before = ps.funds;
    assert.equal(h.m.handle('p_0', { t: 'g.dev', action: 'funds', funds: 100 }).error, ERR.BAD_MSG);
    assert.equal(h.m.handle('p_0', { t: 'g.dev', action: 'lp', lp: 5 }).error, ERR.BAD_MSG);
    assert.equal(ps.funds, before, 'nothing changes while the channel is off');
  });
  withDev('1', () => {
    const h = prep(14);
    assert.deepEqual(h.m.handle('p_0', { t: 'g.dev', action: 'funds', funds: 100 }), { ok: true }, 'legacy funds still works');
    assert.equal(h.m.handle('p_0', { t: 'g.dev', action: 'lp', lp: 5 }).error, ERR.BAD_MSG, 'SP_DEV alone does not open the panel actions');
  });
});

test('dev actions: lp / band / layers / shopLevel / shopSlots / item / grantChess', () => {
  withDev(undefined, () => {
    const h = devPrep(15); const { m } = h; const ps = h.ps('p_0');
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'lp', lp: 3 }), { ok: true });
    assert.equal(ps.lp, 3);
    const band = m.gd.bandIds()[0];
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'band', bandId: band }), { ok: true });
    assert.equal(ps.bandId, band);
    const bond = Object.keys(m.gd.raw.bonds)[0];
    const before = ps.layers[bond] || 0;
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'layers', bondId: bond, layers: 10 }), { ok: true });
    assert.equal((ps.layers[bond] || 0) > before, true, 'layers grew');
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'shopLevel', shopLevel: 3 }), { ok: true });
    assert.equal(ps.shop.level, 3);
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'shopSlots', chessSlots: 6, itemSlots: 2 }), { ok: true });
    assert.deepEqual(m.gd.shopSlots(3), { chess: 6, item: 2 });
    const itemId = Object.keys(m.gd.raw.items)[0];
    const handBefore = ps.hand.filter(Boolean).length;
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'item', itemId }), { ok: true });
    assert.equal(ps.hand.filter(Boolean).length, handBefore + 1, 'the item landed in the hand');
    const chessId = m.gd.visibleChess[0];
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'grantChess', chessId, overrides: { atk: 1 } }), { ok: true });
    const all = [...ps.hand, ...ps.temp, ...ps.board.values()].filter((p) => p && p.kind === 'chess' && p.id === chessId);
    assert.equal(all.length, 1, 'the operator is on the bench / board');
    assert.deepEqual(all[0].meta.data.devExt, { atk: 1 }, 'the numeric override rides on the piece');
    // 覆盖必须**随战斗输入**进战场（sim 侧的 u.pieceData 由 battle/players.js 从输入带上单位）：放到作战区再看输入
    const uid = all[0].uid;
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid, to: { area: 'board', row: 9, col: 3 } }), { ok: true }, 'the granted operator can be deployed');
    const bu = ps.battleInput({ side: 'L', colOffset: 0 }).units.find((u) => u.uid === uid);
    assert.ok(bu, 'it is on the board in the battle input');
    assert.deepEqual(bu.pieceData, { devExt: { atk: 1 } }, 'the override rides into the battle input (→ u.pieceData)');
    assert.equal(m.handle('p_0', { t: 'g.dev', action: 'grantChess', chessId: 'nope' }).error, ERR.BAD_TARGET);
    assert.equal(m.handle('p_0', { t: 'g.dev', action: 'bogus' }).error, ERR.BAD_MSG);
    h.invariants();
  });
});

test('spawnEnemy appends to the preview and to the round’s battle spawns (with its overrides)', () => {
  withDev(undefined, () => {
    const h = devPrep(16); const { m } = h; const ps = h.ps('p_0');
    const key = Object.keys(m.gd.raw.enemies)[0];
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'spawnEnemy', enemyKey: key, count: 2, overrides: { stats: { maxHp: 9999 } } }), { ok: true });
    assert.equal(m.devExtraEnemies.length, 1, 'the panel list holds it');
    assert.equal(m.nextEnemiesFor(ps).length > 0, true, 'the preview shows it');
    const opts = m._normalOpts(ps);
    assert.equal(opts.spawns.some((s) => s.enemyKey === key && s.count === 2), true, 'the battle carries the 2-unit spawn action');
    assert.deepEqual(opts.enemyOverrides[key], { stats: { maxHp: 9999 } }, 'the overrides reach the battle');
    assert.equal(m.handle('p_0', { t: 'g.dev', action: 'spawnEnemy', enemyKey: 'nope' }).error, ERR.BAD_TARGET);
    // 再添加一只：两次添加按顺序走本回合的两条路线（`routeIndex` 0、1 轮着来），战斗带着这些路线
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'spawnEnemy', enemyKey: key, count: 1 }), { ok: true });
    assert.deepEqual(m.devExtraEnemies.map((s) => s.routeIndex), [0, 1], 'added enemies take the round’s routes in turn');
    assert.equal(m._normalOpts(ps).routes.length >= 2, true, 'the battle carries the round’s routes');
    h.invariants();
  });
});

test('scene actions: stage swaps the map at once; roundKind arms the next round’s battle type', () => {
  withDev(undefined, () => {
    const h = devPrep(17); const { m } = h;
    // 换地图：立刻生效（stage / stageId / layout 一起换，部署图重算）
    const other = Object.keys(m.gd.raw.stages).find((id) => m.gd.stage(id) && id !== m.stageId);
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'stage', stageId: other }), { ok: true });
    assert.equal(m.stageId, other);
    assert.equal(m.stage, m.gd.stage(other));
    assert.equal(m.handle('p_0', { t: 'g.dev', action: 'stage', stageId: 'nope' }).error, ERR.BAD_TARGET);
    // 下一回合的战斗类型：一次性开关（startRound 消费）
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'roundKind', kind: 'boss' }), { ok: true });
    assert.equal(m.devRoundKind, 'boss', 'the one-shot is armed for the next round');
    assert.equal(m.handle('p_0', { t: 'g.dev', action: 'roundKind', kind: 'nope' }).error, ERR.BAD_TARGET);
    h.invariants();
  });
});

test('scene actions: an armed boss round really runs as a leader round (the whole chain, not just the flag)', () => {
  withDev(undefined, () => {
    const h = devPrep(18); const { m } = h;
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'roundKind', kind: 'boss' }), { ok: true });
    assert.equal(m.publicView().devNextKind, 'boss', 'the panel sees the armed state');
    // 真的把回合推过去：首领场景的每一处判定都按**回合号**走（endPrep → FINAL_ASSAULT、客户端 pub.bossRound）
    h.toPrep(2);
    assert.equal(m.devBossRound, 2, 'this round is marked as the forced leader round');
    assert.equal(m.publicView().bossRound, 2, 'the client sees this round as the leader round');
    assert.ok(Array.isArray(m.bossWaves) && m.bossWaves.length > 0, 'boss waves were planned');
    assert.equal(m.publicView().devNextKind ?? null, null, 'the one-shot was consumed');
    // 首领场景正中的那只首领也能换：在首领回合里换，立刻按新首领重排波次
    const other = Object.keys(m.gd.raw.bosses).find((id) => m.gd.boss(id) && id !== m.bossId);
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'boss', bossId: other }), { ok: true });
    assert.equal(m.bossId, other);
    assert.equal(m.publicView().bossId, other, 'the client sees the new leader');
    assert.ok(Array.isArray(m.bossWaves) && m.bossWaves.length > 0, 'boss waves were re-planned for the new leader');
    assert.equal(m.handle('p_0', { t: 'g.dev', action: 'boss', bossId: 'nope' }).error, ERR.BAD_TARGET);
    // 替换时一并改数值：面板给的 maxHp 就是**共享血量池**的上限（领袖单位的血条跟着池走），
    // atk/def/res 并进这一场的 `enemyOverrides`（键 = 该首领的 `enemyKey`）
    const ov = { stats: { maxHp: 4321, atk: 77, def: 11, res: 22 } };
    assert.deepEqual(m.handle('p_0', { t: 'g.dev', action: 'boss', bossId: other, overrides: ov }), { ok: true });
    assert.deepEqual(m.devBossOverrides[other], ov, 'the values are kept per leader (they outlive the round)');
    assert.equal(m._bossPoolHp(other, 1), 4321, 'the panel value becomes the pool ceiling');
    const ek = m.gd.boss(other).enemyKey;
    assert.deepEqual(m._bossEnemyOverrides({ baz: 1 }, other), { baz: 1, [ek]: ov }, 'the leader unit picks the override up');
    assert.equal(m._bossPoolHp(other, 1), 4321, 'and a live pool follows it');
    h.invariants();
  });
});

test('a dev match runs endless rounds (no “last round”, waves keep the stage’s own binding)', () => {
  withDev(undefined, () => {
    const h = devPrep(19); const { m } = h;
    assert.equal(m.publicView().lastRound, 999, 'the client is never told a round is the last one');
    assert.equal(m.devWaveRound(3), 3, 'a bound round keeps its own wave');
    // 试验场把每个回合都绑到空波次表，而 `stage.rounds` 的键只到 15：更后面的回合沿用最后一个有绑定的回合
    const gd = m.gd; const orig = gd.stage;
    gd.stage = (id) => (id === m.stageId ? { rounds: { 1: 'dev_ext_empty', 15: 'dev_ext_empty' } } : orig.call(gd, id));
    try {
      assert.equal(m.devWaveRound(16), 15, 'beyond the bindings it falls back to the last bound round');
      assert.equal(m.devWaveRound(1), 1);
    } finally { gd.stage = orig; }
    assert.equal(prep(20).m.devWaveRound(16), 16, 'a plain match is untouched');
  });
});

test('a dev match never ends: a finished boss round continues into the next one', () => {
  withDev(undefined, () => {
    const h = devPrep(23); const { m } = h;
    const started = [];
    m.later = (ms, fn) => { fn(); return 0; }; // 「稍后」的回调直接跑掉
    m.startRound = (r) => { started.push(r); m.phase = PHASE.PREP; m.fields = []; };
    m.fields = [];
    m.bossPool = { hp: 0, maxHp: 100, byPlayer: new Map() };
    m._finalEnding = 'cleared';
    m.teamLp = 20;
    m.hiddenReached = true;
    m.phase = PHASE.FINAL_ASSAULT;
    m._finishFinal(false, () => ({ perPlayer: {} }));
    assert.deepEqual(started, [m.round + 1], 'the match goes on instead of settling');
    assert.equal(m.ended, false, 'nothing is finished');
    assert.equal(m.bossPool, null, 'the boss state is reset');
    assert.equal(m._finalEnding, null, 'the end flag is cleared for the next boss round');
    assert.equal(m.teamLp, null);
    assert.equal(m.hiddenReached, false);
    h.invariants();
  });
});
