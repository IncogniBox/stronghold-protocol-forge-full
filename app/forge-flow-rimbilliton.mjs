// forge-flow-rimbilliton.mjs — 雷姆必拓 mod（Forge 版）流程验证（app 内运行）
//   node forge-flow-rimbilliton.mjs
// A) 开拓大地：真实摆位→endPrep 发放精锐干员
// B) marks：battle → compactResult 保留（客户端回传链路）
// C) 完整一回合 client 战斗 → ps.marks → 休整期特质
import { makeMatch, give, DATA } from './test/match/harness.js';
import { makeBattle } from './test/helpers/battleHarness.js';
import { compactResult } from './server/sim/spec.js';
import { packLayer } from './test/helpers/packLayer.js';

const log = (...a) => console.log(...a);
const q = (s) => JSON.stringify(s);
const QUIET = { warn() {}, error() {}, info() {}, debug() {}, log() {} };
// 已安装包的 Layer-B 载荷（server.battle + server.meta）：按房间装配那条路装一遍。
const LAYER = await packLayer({ log: QUIET });
const REG = LAYER.registry;
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
    // 快照必须在**摆放之前**取：开拓大地在「第 3 名成员摆上场」那一帧就立即发放，摆放之后再快照会把刚发到的算成已有
    const before = new Set();
    for (const area of [ps.hand, ps.temp, ps.board.values()]) for (const p of area) if (p) before.add(p.uid);
    give(m, ps, 'chess_char_3_02_a', 'board', [10, 4]);
    give(m, ps, 'chess_char_4_14_a', 'board', [10, 5]);
    give(m, ps, 'chess_char_6_21_a', 'board', [10, 6]);
    const rb = ps.bonds && ps.bonds.rimBilliton;
    if (!rb || !rb.active) { detail = `盟约未激活 count=${rb?.count}`; continue; }
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
// B) marks 跨客户端链路
// ---------------------------------------------------------------------------
log('\n=== B) marks（compactResult 保留） ===');
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
  const b = makeBattle({ data: DATA, players: [input], enemies: [{ key: 'enemy_1010_errdrg', pos: [10, 9] }], battleInstallers: LAYER.installers, timeLimit: 30, autoFinish: false });
  b.step(1);
  b.b.emit('battleEnd', {});
  const pid = input.playerId;
  const raw = b.result();
  const comp = compactResult(raw);
  const marks = comp.perPlayer?.[pid]?.marks;
  log(`  battle.result marks=${q(raw.perPlayer?.[pid]?.marks)} → compactResult=${q(marks)}`);
  bOk = !!(marks && marks.holder);
  log(`  → ${bOk ? '保留 ✓' : '丢失 ✗'}`);
  h.m.dispose?.();
}

// ---------------------------------------------------------------------------
// C) 完整一回合 client 战斗 → ps.marks → 休整期特质
// ---------------------------------------------------------------------------
log('\n=== C) 完整一回合 client 战斗 → ps.marks ===');
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
  const holder = ps.marks && ps.marks.holder;
  const noredeploy = ps.marks && ps.marks.noRedeploy;
  log(`  marks.holder=${q(holder)} marks.noRedeploy=${q(noredeploy)}`);
  const gained = snap().filter((p) => !r1.has(p.uid));
  log(`  安洁莉娜/开拓大地发放（R1→R2 新增）: ${gained.map((p) => nameOf(p.id)).join(', ') || '（无）'}`);
  cOk = typeof holder === 'string' && holder.length > 0 && !!ps.marks && 'noRedeploy' in ps.marks;
  log(`  → ${cOk ? 'marks 写入 ✓' : 'marks 缺失 ✗'}`);
  h.m.dispose?.();
}

log(`\n== Forge 流程结果: 开拓大地=${aOk ? '通过' : '失败'}  marks 跨客户端=${bOk ? '通过' : '失败'}  marks→休整期=${cOk ? '通过' : '失败'}`);
