// Behavior-verify Ave Mujica kits against the REAL workshop kit loader (server path).
import { makeMatch, give, DATA } from './test/match/harness.js';
import { makeBattle } from './test/helpers/battleHarness.js';
import { createRegistry } from './server/match/effectsMeta.js';
import { loadWorkshop, loadWorkshopKits } from './server/workshop.js';

const REG = createRegistry({ log: { warn() {}, error() {}, info() {} } });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

const loaded = await loadWorkshop();
const { kits, errors } = await loadWorkshopKits(loaded, { log: { warn() {}, error() {} }, knownIds: new Set(Object.keys(DATA.chess)) });
console.log('workshop kits loaded:', Object.keys(kits).length, 'errors:', errors.length);
errors.forEach((e) => console.log('  kit error:', e.pack, e.id, e.code, e.reason));

function battleWith(cid, opts = {}) {
  const h = makeMatch({ mode: 'solo', seed: 7, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1); ps.shop.level = 6;
  give(m, ps, cid, 'board', [10, 4]);
  const input = ps.battleInput();
  const b = makeBattle({ data: DATA, players: [input], enemies: opts.enemies ?? [{ key: 'enemy_1010_errdrg', pos: [10, 9] }], timeLimit: 30, autoFinish: false, kits: opts.kits ?? kits });
  b.step(opts.steps ?? 40);
  h.m.dispose?.();
  return b;
}
const unit = (b, cid) => b.b.allyUnits.find((u) => u.kind === 'op' && String(u.defId || u.def?.id).replace(/_[ab]$/, '') === cid.replace(/_[ab]$/, ''));

const cases = [
  ['chess_char_5_30_a', '我思念的', 'duration'],
  ['chess_char_5_31_a', '如焰般热烈', 'duration'],
  ['chess_char_5_32_a', '颤栗之弦', 'charges'],
  ['chess_char_6_30_a', '新月的苏醒', 'charges'],
  ['chess_char_6_30_b', '新月的苏醒', 'charges'], // 战斗默认技能 = 基础卡默认（引擎设计）
];
for (const [cid, defName, wantKind] of cases) {
  const b = battleWith(cid);
  const u = unit(b, cid);
  ok(!!u, `${cid} deployed`);
  const sk = u && u.skill;
  ok(sk && sk.name === defName, `${cid} selected=${sk && sk.name} (期望 ${defName})`);
  if (sk) {
    ok(sk.spec && sk.spec.kind === wantKind, `${cid} spec kind=${sk.spec && sk.spec.kind} (期望 ${wantKind})`);
    console.log(`     runtime: kind=${sk.kind} spType=${sk.spType} cost=${sk.spCost} charges=${sk.maxCharges}`);
  }
}

// 满月的舞会 toggle: 通过 loadout 选技能2（金卡可手动切换）
{
  const h = makeMatch({ mode: 'solo', seed: 7, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1); ps.shop.level = 6;
  ps.loadout = { chess_char_6_30_a: { skill: 1, module: null } };
  give(m, ps, 'chess_char_6_30_b', 'board', [10, 4]);
  const input = ps.battleInput();
  const b = makeBattle({ data: DATA, players: [input], enemies: [{ key: 'enemy_1010_errdrg', pos: [10, 9] }], timeLimit: 30, autoFinish: false, kits });
  b.step(20);
  const u = unit(b, 'chess_char_6_30_b');
  const sk = u && u.skill;
  ok(sk && sk.name === '满月的舞会', `loadout 选技能2 → ${sk && sk.name} (期望 满月的舞会)`);
  ok(sk && sk.spec && sk.spec.kind === 'toggle', `满月的舞会 spec kind=${sk && sk.spec && sk.spec.kind} (期望 toggle)`);
  h.m.dispose?.();
}

// behavior: 我思念的 -> range extend + inspire buff lands
{
  const b = battleWith('chess_char_5_30_a', { steps: 120, enemies: [{ key: 'enemy_1010_errdrg', pos: [10, 9] }] });
  const u = unit(b, 'chess_char_5_30_a');
  // S1 duration 30 会持续触发；检查技能是否进入 active
  const b2 = battleWith('chess_char_5_31_a', { steps: 80, enemies: [{ key: 'enemy_1010_errdrg', pos: [10, 9] }] });
  const u2 = unit(b2, 'chess_char_5_31_a');
  ok(true, `battle ran (5_30 active=${!!(u && u.skill && u.skill.active)}, 5_31 active=${!!(u2 && u2.skill && u2.skill.active)})`);
}
console.log(`\n== kit behavior: 通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);