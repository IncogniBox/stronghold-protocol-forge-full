// 联防结算的权威性（业主 2026-10-27「联防阶段结束时，有剩余的敌人也没有扣除生命值」）：
// 客户端跑的战斗已经过 validateClientResult，但它的存活漏怪仍可能在最后一步丢掉（少报 / 被替换）。终局前最后一次
// `b.progress.left` 还有剩余、结果却一个漏怪都没有时，服务端按同一份 spec 复算一次并以复算结果为结算依据 ——
// 这一回合的 LP 不能因为客户端少报就白送。正常情况两者逐字节相同，不触发复算。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, give, chessOfTier, legalTileFor } from './harness.js';
import { attachSimClients } from './simClient.js';
import { FakeBattle } from './fakeBattle.js';
import { Battle } from '../../server/sim/Battle.js';
import { uniteSurvivors } from '../../server/match/unite.js';

const prevStage = process.env.SP_STAGE;
process.env.SP_STAGE = 'my_map';
after(() => { if (prevStage === undefined) delete process.env.SP_STAGE; else process.env.SP_STAGE = prevStage; });

/** 真实 sim 只跑联防场（普通场仍用可脚本化的 FakeBattle，好让漏怪确定）。 */
class Hybrid {
  constructor(o) { return o.kind === 'unite' ? new Battle(o) : new FakeBattle(o); }
}

/** 把联防战果里的漏怪全部抹掉（形状仍合法：perfect 跟着改），模拟「场上还有敌人、结果里却没有」。 */
const dropSurvivors = (result, spec) => (spec && spec.kind === 'unite'
  ? { ...result, unspawned: [], perPlayer: Object.fromEntries(Object.entries(result.perPlayer || {}).map(([pid, p]) => [pid, { ...p, leaked: [], perfect: true }])) }
  : result);

function reconUnite(tamper) {
  const h = makeMatch({
    mode: 'recon', modeId: 'mode_recon_abyss', difficulty: 'FUNNY', humans: 3, bots: 0, seed: 1, fake: true, clientCombat: true, clients: false,
    script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 12 } } : {}),
  }).start();
  attachSimClients(h, { BattleClass: Hybrid, ...(tamper ? { perPlayer: { p_1: { tamper }, p_2: { tamper } } } : {}) });
  const m = h.m;
  h.toPrep(1);
  const ranged = chessOfTier(1, (c) => c.position === 'RANGED').filter((x) => m.pool.has(x));
  for (let i = 1; i < 3; i++) { const ps = h.ps(`p_${i}`); give(m, ps, ranged[i], 'board', legalTileFor(m, ps, ranged[i])); }
  h.drive(() => m.phase === PHASE.UNITE);
  // 结算那次复算走真实 sim（普通场仍由 FakeBattle 提供确定的漏怪）；Match 在 _specBattle 里读的就是这一格
  m.BattleClass = Battle;
  return h;
}

test('联防：客户端战果里没有漏怪、但它自己的实时计数还有剩余 ⇒ 服务端复算，按真实剩余扣 LP', () => {
  const h = reconUnite(dropSurvivors);
  const m = h.m;
  const lp0 = m.players.get('p_0').lp;
  h.drive(() => m.phase === PHASE.UNITE && m.fields[0] && m.fields[0].done);
  const f = m.fields[0];
  assert.equal(f.resultSource, 'client', '客户端战果本身是合法上报（不是被拒后被接管）');
  assert.equal(uniteSurvivors(m.unitePlan, f.result).get('p_0') || 0, 0, '上报里一个漏怪都没有');
  assert.ok(Object.values(f.progress.left || {}).some((n) => n > 0), '但它自己的 b.progress.left 还有剩余');

  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(m.phase, PHASE.SETTLE);
  const through = m.uniteResultView && m.uniteResultView.through;
  assert.ok(through > 0, `结算用的是复算出来的剩余（through=${through}）`);
  const loss = m.uniteResultView.losses.p_0;
  assert.ok(loss > 0, `漏怪者被扣 ${loss} 点`);
  assert.equal(m.players.get('p_0').lp, lp0 - loss, '生命值真的扣了');
  assert.ok(h.logs.warn.some((w) => /bills no survivor/.test(w)), '日志点名了这次复算');
  m.dispose();
});

test('联防：正常上报（有剩余）不触发复算，扣的就是上报的剩余', () => {
  const h = reconUnite(null);
  const m = h.m;
  const lp0 = m.players.get('p_0').lp;
  h.drive(() => m.phase === PHASE.UNITE && m.fields[0] && m.fields[0].done);
  const f = m.fields[0];
  const billed = uniteSurvivors(m.unitePlan, f.result).get('p_0') || 0;
  assert.ok(billed > 0, `这一局真的漏怪了（${billed}）`);
  assert.ok(!h.logs.warn.some((w) => /bills no survivor/.test(w)), '两者一致，没有复算');
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.equal(m.uniteResultView.through, billed);
  assert.equal(m.players.get('p_0').lp, lp0 - Math.min(10, billed));
  m.dispose();
});
