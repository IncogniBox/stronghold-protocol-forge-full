// forge-flow-rimbilliton.mjs — 雷姆必拓 mod（Forge 版）流程验证（app 内运行）
//   node forge-flow-rimbilliton.mjs
// A) 开拓大地：真实摆位→endPrep 发放精锐干员
// B) rbExtra：battle → compactResult 保留（客户端回传链路）
// C) 完整一回合 client 战斗 → counters → 休整期特质
import { makeMatch, give, DATA } from './test/match/harness.js';
import { makeBattle } from './test/helpers/battleHarness.js';
import { compactResult } from './server/sim/spec.js';
import { createRegistry } from './server/match/effectsMeta.js';

const log = (...a) => console.log(...a);
const q = (s) => JSON.stringify(s);
const REG = createRegistry({ log: { warn() {}, error() {}, info() {} } });
const CH = DATA.chess;
const nameOf = (id) => (CH[id] ? CH[id].name : id);
log(`数据: chess ${Object.keys(CH).length} 条, band_kaituo=${!!(DATA.bands && DATA.bands.band_kaituo)}, rimBilliton=${!!(DATA.bonds && DATA.bonds.rimBilliton)}`);

// ---------------------------------------------------------------------------
// A) 开拓大地
// ---------------------------------------------------------------------------
log('\n=== A) 开拓大地（真实摆位→endPrep） ===');
let aOk = true;
for (const shopLevel of [1, 3, 6]) {
  let ok = null, detail = '';
  for (let seed = 1; seed <= 10 && ok === null; seed++) {
    const h = makeMatch({ mode: 'solo', seed, data: DATA, registry: REG, fake: true }).start();
    const m = h.m, ps = h.ps('p_0');
    h.toPrep(1, { band: 'band_kaituo' });
    if (ps.bandId !== 'band_kaituo') { detail = `bandId=${ps.bandId}`; continue; }
    ps.shop.level = shopLevel;
    give(m, ps, 'chess_char_3_02_a', 'board', [10, 4]);
    give(m, ps, 'chess_char_4_14_a', 'board', [10, 5]);
    give(m, ps, 'chess_char_6_21_a', 'board', [10, 6]);
    const rb = ps.bonds && ps.bonds.rimBilliton;
    if (!rb || !rb.active) { detail = `盟约未激活 count=${rb?.count}`; continue; }
    const before = new Set();
    for (const area of [ps.hand, ps.temp, ps.board.values()]) for (const p of area) if (p) before.add(p.uid);
    h.drive(() => m.phase === 'COMBAT' && m.round === 1, { ready: true, band: 'band_kaituo' });
    const gained = [];
    for (const area of [ps.hand, ps.temp, ps.board.values()]) for (const p of area) if (p && p.kind === 'chess' && !before.has(p.uid)) gained.push(p);
    if (gained.length > 0) { ok = true; detail = `获得: ${gained.map((p) => `${nameOf(p.id)}(${CH[p.id]?.tier}阶${CH[p.id]?.isGolden ? '精英' : ''})`).join(', ')}`; }
    else detail = `未获得 (counter done=${ps.counters['band:kaituo:done'] ?? 0})`;
    h.m.dispose?.();
  }
  log(`  调度中心${shopLevel}级: ${ok === true ? '发放 ✓' : '未发放 ✗'} — ${detail}`);
  if (ok !== true) aOk = false;
}

// ---------------------------------------------------------------------------
// B) rbExtra 跨客户端链路
// ---------------------------------------------------------------------------
log('\n=== B) rbExtra（compactResult 保留） ===');
let bOk = false;
{
  const h = makeMatch({ mode: 'solo', seed: 3, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1, { band: 'band_kaituo' });
  ps.shop.level = 6;
  give(m, ps, 'chess_char_3_02_a', 'board', [10, 4]);
  give(m, ps, 'chess_char_4_14_a', 'board', [10, 5]);
  give(m, ps, 'chess_char_6_21_a', 'board', [10, 6]);
  const input = ps.battleInput();
  const b = makeBattle({ data: DATA, players: [input], enemies: [{ key: 'enemy_1010_errdrg', pos: [10, 9] }], timeLimit: 30, autoFinish: false });
  b.step(1);
  b.b.emit('battleEnd', {});
  const pid = input.playerId;
  const raw = b.result();
  const comp = compactResult(raw);
  const rbExtra = comp.perPlayer?.[pid]?.rbExtra;
  log(`  battle.result rbExtra=${q(raw.perPlayer?.[pid]?.rbExtra)} → compactResult=${q(rbExtra)}`);
  bOk = !!(rbExtra && rbExtra.holder);
  log(`  → ${bOk ? '保留 ✓' : '丢失 ✗'}`);
  h.m.dispose?.();
}

// ---------------------------------------------------------------------------
// C) 完整一回合 client 战斗 → counters → 休整期特质
// ---------------------------------------------------------------------------
log('\n=== C) 完整一回合 client 战斗 → counters ===');
let cOk = false;
{
  const h = makeMatch({ mode: 'solo', seed: 3, data: DATA, registry: REG, clientCombat: true, fake: false }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1, { band: 'band_kaituo' });
  ps.shop.level = 6;
  give(m, ps, 'chess_char_3_02_a', 'board', [10, 4]);
  give(m, ps, 'chess_char_4_14_a', 'board', [10, 5]);
  give(m, ps, 'chess_char_2_20_a', 'board', [10, 6]);
  give(m, ps, 'chess_char_6_21_a', 'board', [10, 7]);
  const snap = () => { const o = []; for (const a of [ps.hand, ps.temp, ps.board.values()]) for (const p of a) if (p && p.kind === 'chess') o.push(p); return o; };
  const r1 = new Set(snap().map((p) => p.uid));
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: true, band: 'band_kaituo', maxSteps: 3e6 });
  const holder = ps.counters['rimbilliton:holder'];
  const noredeploy = ps.counters['rimbilliton:noredeploy'];
  log(`  rimbilliton:holder=${q(holder)} rimbilliton:noredeploy=${q(noredeploy)}`);
  const gained = snap().filter((p) => !r1.has(p.uid));
  log(`  安洁莉娜/开拓大地发放（R1→R2 新增）: ${gained.map((p) => nameOf(p.id)).join(', ') || '（无）'}`);
  cOk = typeof holder === 'string' && holder.length > 0 && 'rimbilliton:noredeploy' in ps.counters;
  log(`  → ${cOk ? 'counters 写入 ✓' : 'counters 缺失 ✗'}`);
  h.m.dispose?.();
}

log(`\n== Forge 流程结果: 开拓大地=${aOk ? '通过' : '失败'}  rbExtra=${bOk ? '通过' : '失败'}  counters=${cOk ? '通过' : '失败'}`);
