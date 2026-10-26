// test/match/recon-pools.test.js — 重构模拟的两个新机制（业主 2026-10-26）：
//
//   1. **同场共享卡池**：不再全房间共用一个棋子池，而是普通带同场的一对（存活座位两两配对）共用一个 `SharedPool`。
//      配对在开局定下、整局不变；官方对局一个 `reconPools` 都不建（`mainPool()` 仍回 `m.pool`）。
//   2. **自主禁用盟约**：每名玩家禁 1 个盟约，判据与官方禁用同一条（全身盟约都被禁才从**这名玩家的抽卡**里消失）；
//      队友的抽卡、共享池里的拷贝、盟约本身都不受影响。
//
// 另有「队伍预重构总览」的两段收尾：全员提交 ⇒ 阶段停在 PRE_RECON 等 `g.reconContinue`；全齐才进下一阶段。
//
// 跑法：node --test test/match/recon-pools.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';

/** 一局重构模拟（room mode 'recon' ⇒ mode_recon_normal）。 */
function reconMatch(o = {}) {
  return makeMatch({ mode: 'recon', modeId: 'mode_recon_normal', seed: 7, fake: true, data: DATA, ...o });
}

/** 从 INFO_CHECK 推进到 PRE_RECON（策略默认选 band_bldsk）。 */
function toPreRecon(h, band = 'band_bldsk') {
  h.start();
  h.drive(() => h.m.phase === PHASE.PRE_RECON, { band, ready: false });
  assert.equal(h.m.phase, PHASE.PRE_RECON, '应到达 PRE_RECON');
  return h;
}

/** 数据里「只有这一个盟约」的一枚棋子（验证「全身盟约都被禁」的判据）。 */
function monoBondChess(gd, bondId) {
  for (const id of gd.visibleChess) {
    const c = gd.chess(id);
    const bonds = Array.isArray(c && c.bonds) ? c.bonds : [];
    if (bonds.length === 1 && bonds[0] === bondId) return id;
  }
  return null;
}

test('同场共享池：2 人一对共用一个池；4 人两对各自一个；都不是全房间那一份', () => {
  const h2 = reconMatch({ humans: 2 }).start();
  const m2 = h2.m;
  assert.ok(m2.reconPools, '重构对局应建配对池');
  const a = m2.players.get('p_0');
  const b = m2.players.get('p_1');
  assert.equal(a.mainPool(), b.mainPool(), '同一对的两个人读同一个池对象');
  assert.notEqual(a.mainPool(), m2.pool, '不再是全房间那一个池');
  assert.equal(m2.reconPools.byKey.size, 1, '2 人 = 1 对');

  const h4 = reconMatch({ humans: 4 }).start();
  const m4 = h4.m;
  const ps = ['p_0', 'p_1', 'p_2', 'p_3'].map((id) => m4.players.get(id));
  assert.equal(ps[0].mainPool(), ps[1].mainPool(), 'p0/p1 一对');
  assert.equal(ps[2].mainPool(), ps[3].mainPool(), 'p2/p3 一对');
  assert.notEqual(ps[1].mainPool(), ps[2].mainPool(), '相邻两对不共用');
  assert.equal(m4.reconPools.byKey.size, 2);

  // 到第 1 回合休整期：配对池被真实使用后，不变量（按对守恒）仍成立
  h2.toPrep(1);
  h2.invariants();
  m2.dispose(); m4.dispose();
});

test('非重构对局：不建配对池（mainPool 仍是 m.pool，行为逐字节不变）', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, fake: true, data: DATA }).start();
  const m = h.m;
  assert.equal(m.reconPools, null, 'reconPools 一个对象都不建');
  assert.equal(m.players.get('p_0').mainPool(), m.pool);
  assert.equal(m.players.get('p_1').mainPool(), m.pool);
  m.dispose();
});

test('自主禁用盟约：与官方同一判据 —— 只排除「全身盟约都被禁」的棋子，且只影响自己的抽卡', () => {
  const h = toPreRecon(reconMatch({ humans: 2 }));
  const m = h.m;
  const a = m.players.get('p_0');
  const bondId = 'yanShip';
  const mono = monoBondChess(m.gd, bondId);
  assert.ok(mono, `数据里应有一枚只有【${bondId}】盟约的棋子`);

  assert.equal(m.reconSelfBannedChess(a), null, '没交禁用 ⇒ 没有限制');
  const pair = m.reconPoolFor(a);
  assert.ok(pair && pair.has(mono), '这枚棋子本来在配对池里');

  m.reconChoices.p_0 = { ban: bondId };
  const banned = m.reconSelfBannedChess(a);
  assert.ok(banned instanceof Set);
  assert.equal(banned.has(mono), true, '全身都是被禁盟约 ⇒ 从自己的抽卡里消失');
  assert.equal(m.reconSelfBannedChess(m.players.get('p_1')), null, '队友不受影响（没交禁用）');

  // 过滤发生在 roll 上：换掉底层 pool.roll，看它收到的 filter
  let seenFilter = null;
  const orig = pair.roll;
  pair.roll = (rng, opts) => { seenFilter = opts && opts.filter; return null; };
  a.mainPool().roll(() => 0, {});
  pair.roll = orig;
  assert.equal(typeof seenFilter, 'function', 'mainPool().roll 叠上了自主禁用的 filter');
  assert.equal(seenFilter(mono, { left: 1, tier: 1 }), false, '被禁的棋子被滤掉');
  const other = [...m.gd.visibleChess].find((id) => !banned.has(id) && pair.has(id));
  assert.ok(other, '数据里还有不受这条禁用影响的棋子');
  assert.equal(seenFilter(other, { left: 1, tier: 1 }), true, '别的棋子照常可选');
  // 队友读同一个池对象 —— 但队友的 roll 不带这条 filter
  let mateFilter = null;
  const orig2 = pair.roll;
  pair.roll = (rng, opts) => { mateFilter = opts && opts.filter; return null; };
  m.players.get('p_1').mainPool().roll(() => 0, {});
  pair.roll = orig2;
  assert.equal(mateFilter, undefined, '队友的抽卡没有这条 filter');
  m.dispose();
});

test('自主禁用盟约：多盟约棋子只要还有别的盟约就不排除', () => {
  const h = toPreRecon(reconMatch({ humans: 1 }));
  const m = h.m;
  const a = m.players.get('p_0');
  m.reconChoices.p_0 = { ban: 'yanShip' };
  const banned = m.reconSelfBannedChess(a);
  let multi = null;
  for (const id of m.gd.visibleChess) {
    const c = m.gd.chess(id);
    const bonds = Array.isArray(c && c.bonds) ? c.bonds : [];
    if (bonds.includes('yanShip') && bonds.length > 1) { multi = id; break; }
  }
  assert.ok(multi, '数据里应有一枚同时带【炎】与别的盟约的棋子');
  assert.equal(banned.has(multi), false, '还有其他盟约 ⇒ 不清出卡池');
  m.dispose();
});

test('队伍预重构总览：全员交齐 ⇒ 停在 PRE_RECON，全真人点继续才进下一阶段', () => {
  const h = toPreRecon(reconMatch({ humans: 2 }));
  const m = h.m;
  const submit = (pid) => m.handle(pid, { t: 'g.reconChoice', major: [], minor: [], story: null, bosses: {}, assist: null, load: null });
  assert.deepEqual(submit('p_0'), { ok: true });
  assert.deepEqual(submit('p_1'), { ok: true });
  h.run(() => m.reconSummary === true);

  assert.equal(m.reconSummary, true, '应进入总览');
  assert.equal(m.phase, PHASE.PRE_RECON, '总览期间仍在 PRE_RECON');
  const pub = h.publicState();
  assert.equal(pub.recon.summary, true);
  assert.deepEqual([...pub.recon.continued].sort(), [], '还没有真人点继续');

  assert.deepEqual(m.handle('p_0', { t: 'g.reconContinue' }), { ok: true });
  assert.equal(m.phase, PHASE.PRE_RECON, '还有一位没点');
  assert.deepEqual(m.handle('p_0', { t: 'g.reconContinue' }), { ok: true }, '重复点继续是幂等的');

  assert.deepEqual(m.handle('p_1', { t: 'g.reconContinue' }), { ok: true });
  assert.notEqual(m.phase, PHASE.PRE_RECON, '全齐 ⇒ 离开 PRE_RECON');
  m.dispose();
});

test('队伍预重构总览：总览上不再接受改选（选择已锁死）', () => {
  const h = toPreRecon(reconMatch({ humans: 1 }));
  const m = h.m;
  assert.deepEqual(m.handle('p_0', { t: 'g.reconChoice', major: [] }), { ok: true });
  h.run(() => m.reconSummary === true);
  assert.equal(m.reconSummary, true);
  const res = m.handle('p_0', { t: 'g.reconChoice', major: ['yanShip'] });
  assert.equal(res.error, 'WRONG_PHASE', '总览期间改选被拒');
  m.dispose();
});

test('公开视图：玩家带 team；总览期间 recon.summary / continued 可见', () => {
  const h = toPreRecon(reconMatch({ humans: 2, seats: [
    { seat: 0, playerId: 'p_0', name: 'A', isBot: false, connected: true, team: 2 },
    { seat: 1, playerId: 'p_1', name: 'B', isBot: false, connected: true, team: 2 },
  ] }));
  const m = h.m;
  assert.equal(h.publicState().players.find((p) => p.playerId === 'p_0').team, 2, '座位上的队伍号进了公开视图');
  m.enterReconSummary();
  const pub = h.publicState();
  assert.equal(pub.recon.summary, true);
  assert.deepEqual(pub.recon.continued, []);
  m.dispose();
});
