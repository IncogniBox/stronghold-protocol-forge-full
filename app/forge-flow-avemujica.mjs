// forge-flow-avemujica.mjs — 颂乐人偶/Ave Mujica mod（Forge 版）流程验证（app 内运行）
//   node forge-flow-avemujica.mjs
// A) prep：盟约激活 + 1人每6刷新发放
// B) prep：2人 onPrepEnd 层数 / 3人 onRoundStart 资金 / 4人 onPrepStart 部署位 / 5人翻倍
// C) battle：Amoris ATK buff / Doloris Fever 翻倍 / Timoris 停顿 / Mortis 凋亡损伤 / Oblivionis 25%
import { makeMatch, give, DATA } from './test/match/harness.js';
import { makeBattle } from './test/helpers/battleHarness.js';
import { createRegistry } from './server/match/effectsMeta.js';
import { battleStore } from './server/sim/content/support/index.js';

const log = (...a) => console.log(...a);
const REG = createRegistry({ log: { warn() {}, error() {}, info() {} } });
const CH = DATA.chess;
const nameOf = (id) => (CH[id] ? CH[id].name : id);
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; log(`  ✓ ${msg}`); } else { fail++; log(`  ✗ ${msg}`); } };
log(`数据: chess ${Object.keys(CH).length} 条, aveMujica=${!!(DATA.bonds && DATA.bonds.aveMujica)}, 成员=${['chess_char_5_30_a', 'chess_char_5_31_a', 'chess_char_5_32_a', 'chess_char_5_25_a', 'chess_char_6_30_a'].every((c) => !!CH[c])}`);

const newChess = (ps, beforeUids) => {
  const out = [];
  for (const area of [ps.hand, ps.board.values()]) for (const p of area) if (p && p.kind === 'chess' && !beforeUids.has(p.uid)) out.push(p);
  return out;
};

// ---------------------------------------------------------------------------
// A) 盟约激活 + 1人 tier（每刷新6次发放）
// ---------------------------------------------------------------------------
log('\n=== A) 盟约激活 + 1人（每刷新6次发放） ===');
{
  const h = makeMatch({ mode: 'solo', seed: 3, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1);
  ps.funds = 200;
  ps.shop.level = 6;
  give(m, ps, 'chess_char_5_30_a', 'board', [10, 4]); // 三角初华
  const b = ps.bonds.aveMujica;
  ok(!!b && b.active && b.tier >= 1, `1 名成员 → 盟约激活 (count=${b?.count}, tier=${b?.tier})`);
  const before = new Set();
  for (const area of [ps.hand, ps.board.values()]) for (const p of area) if (p) before.add(p.uid);
  for (let i = 0; i < 6; i++) m.handle('p_0', { t: 'g.refresh' });
  ok(ps.counters['avemujica:refresh'] === 6, `刷新计数 = 6 (${ps.counters['avemujica:refresh']})`);
  const gained = newChess(ps, before).filter((p) => (CH[p.id]?.bonds ?? []).includes('aveMujica'));
  ok(gained.length > 0, `每6次刷新发放 1 名颂乐人偶干员: ${gained.map((p) => nameOf(p.id)).join(', ') || '无'}`);
  h.m.dispose?.();
}

// ---------------------------------------------------------------------------
// B) 2/3/4/5 人 tier（prep）
// ---------------------------------------------------------------------------
log('\n=== B) 2/3/4/5 人 tier ===');
{
  const h = makeMatch({ mode: 'solo', seed: 5, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1);
  ps.funds = 200;
  ps.shop.level = 6;
  give(m, ps, 'chess_char_5_30_a', 'board', [10, 4]); // 三角初华
  give(m, ps, 'chess_char_5_31_a', 'board', [10, 5]); // 祐天寺若麦
  const layersBefore = ps.layers?.aveMujica ?? 0;
  // 2人: 休整期结束 (onPrepEnd) → 每成员使已激活盟约 +2（2 成员 × 2 = 4）
  h.drive(() => m.phase === 'COMBAT' && m.round === 1, { ready: true });
  const afterPrepEnd = ps.layers?.aveMujica ?? 0;
  ok(afterPrepEnd - layersBefore >= 4, `2人 onPrepEnd: aveMujica 层数 +4 (${layersBefore} → ${afterPrepEnd})`);
  // 3人: 下一个休整期开始时 (onRoundStart) → 每成员 +1 资金
  give(m, ps, 'chess_char_5_32_a', 'board', [10, 6]); // 八幡海铃
  const fundsBefore = ps.funds;
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: true, band: 'band_bldsk' });
  const fundsAfter = ps.funds;
  ok(fundsAfter - fundsBefore >= 3, `3人 onRoundStart: +3 资金 (${fundsBefore} → ${fundsAfter})`);
  // 4人: onPrepStart → deployCap +1（8 + 1 = 9）
  give(m, ps, 'chess_char_5_25_a', 'board', [10, 7]); // 若叶睦（双盟约成员）
  h.drive(() => ps.deployCap > 8, { ready: true });
  ok(ps.deployCap === 9, `4人 onPrepStart: deployCap = ${ps.deployCap} (期望 9)`);
  // 5人: 全部效果翻倍 → deployCap = 8 + 1×2 = 10
  give(m, ps, 'chess_char_6_30_a', 'board', [10, 8]); // 丰川祥子
  h.drive(() => ps.deployCap === 10, { ready: true });
  ok(ps.deployCap === 10, `5人翻倍: deployCap = ${ps.deployCap} (期望 10)`);
  const layersBefore5 = ps.layers?.aveMujica ?? 0;
  h.drive(() => m.phase === 'COMBAT' && m.round === 2, { ready: true });
  const layersAfter5 = ps.layers?.aveMujica ?? 0;
  ok(layersAfter5 - layersBefore5 >= 40, `5人翻倍: onPrepEnd 层数 +≥40 (实际 +${layersAfter5 - layersBefore5})`);
  h.m.dispose?.();
}

// ---------------------------------------------------------------------------
// C) battle：成员特质 + Fever
// ---------------------------------------------------------------------------
log('\n=== C) battle: Amoris / Doloris / Timoris / Mortis / Oblivionis ===');
const battleWith = (members, enemies = 3, steps = 200, preStep = null) => {
  const h = makeMatch({ mode: 'solo', seed: 7, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1);
  ps.shop.level = 6;
  members.forEach((cid, i) => give(m, ps, cid, 'board', [10, 4 + i]));
  const input = ps.battleInput();
  const b = makeBattle({
    data: DATA, players: [input],
    // 敌人放成员右侧同行（近战朝右攻击）；col ≤ 9
    enemies: Array.from({ length: enemies }, (_, i) => ({ key: 'enemy_1010_errdrg', pos: [10, Math.min(9, 4 + members.length + i)] })),
    timeLimit: 30, autoFinish: false,
  });
  if (preStep) preStep(b);
  b.step(steps);
  h.m.dispose?.();
  return b;
};
const memberUnit = (b, cid) => {
  const base = cid.replace(/_[ab]$/, '');
  return b.b.allyUnits.find((u) => u.kind === 'op' && String(u.defId || u.def?.id).replace(/_[ab]$/, '') === base);
};

// C1) Amoris: 祐天寺若麦在场 → 全体成员 ATK buff = amoris_atk (0.25)
{
  const b = battleWith(['chess_char_5_31_a', 'chess_char_5_30_a'], 2, 60);
  const am = memberUnit(b, 'chess_char_5_31_a');
  const du = memberUnit(b, 'chess_char_5_30_a');
  const amB = am && am.findBuff('bond:avemujica:atk');
  const duB = du && du.findBuff('bond:avemujica:atk');
  ok(!!amB && !!duB, `Amoris ATK buff 在成员身上 (若麦=${!!amB}, 初华=${!!duB})`);
  if (amB) ok(Math.abs(amB.mods.atkPct - 0.25) < 1e-6, `Amoris atkPct = ${amB.mods.atkPct} (期望 0.25)`);
  const b2 = battleWith(['chess_char_5_30_a', 'chess_char_5_32_a'], 2, 60);
  const du2 = memberUnit(b2, 'chess_char_5_30_a');
  ok(!(du2 && du2.findBuff('bond:avemujica:atk')), '无若麦 → 无 Amoris ATK buff');
}

// C2) Doloris: Fever 获得量 ×2（初华在场 ×fever_ratio；对照两组用相同攻击源确保分母一致 —— 5_32 海铃与 5_31 若麦都普攻，
//      5_30 初华为吟游者不普攻，故只作「在场」开关而非攻击源）
{
  const f2Attacker = ['chess_char_5_31_a', 'chess_char_5_32_a']; // 若麦 + 海铃（两支都会普攻）
  const feverOf2 = (b) => { try { return battleStore(b.b, 'avemujica:st').fever || 0; } catch { return 0; } };
  const attacksOf2 = (b) => {
    b._attacks = 0;
    b.b.on('attack', (c) => { if (c.attacker && c.attacker.kind === 'op') b._attacks++; });
  };
  const bA = battleWith(['chess_char_5_30_a', ...f2Attacker], 3, 240, attacksOf2); // 有初华 → Fever ×2
  const bB = battleWith(f2Attacker, 3, 240, attacksOf2); // 无初华
  const fa = feverOf2(bA), fb = feverOf2(bB);
  const aa = bA._attacks || 0, ab = bB._attacks || 0;
  ok(fa > 0 && aa > 0, `Fever 随攻击积累 (有初华: ${fa} / ${aa} 次攻击)`);
  ok(fb > 0 && ab > 0, `Fever 随攻击积累 (无初华: ${fb} / ${ab} 次攻击)`);
  if (fa > 0 && fb > 0 && aa > 0 && ab > 0) {
    const perA = fa / aa, perB = fb / ab;
    ok(Math.abs(perA / perB - 2) < 0.05, `Fever 每攻击翻倍 ≈2× (${perA.toFixed(2)} / ${perB.toFixed(2)} = ${(perA / perB).toFixed(2)})`);
  }
}

// C3) Timoris: 海铃在场 → 成员攻击命中概率停顿（statusApplied 计数，敌人被击杀移除不影响计数）
{
  let slows = 0;
  const b = battleWith(['chess_char_5_32_a', 'chess_char_5_31_a'], 2, 400, (bb) => {
    bb.b.on('statusApplied', (c) => { if (c.status === 'sluggish' && c.target && c.target.side === 'enemy') slows++; });
  });
  ok(slows > 0, `Timoris: 停顿累计命中 ${slows} 次`);
}

// C4) Mortis: 若叶睦在场 → 成员攻击附带凋亡损伤（元素伤害事件计数；元素槽爆发会归零，故不断言槽值）
{
  let necrosis = 0;
  const b = battleWith(['chess_char_5_25_a', 'chess_char_5_31_a'], 2, 400, (bb) => {
    bb.b.on('damaged', (c) => {
      if (c.type === 'element' && c.dmg && c.dmg.element === 'apoptosis' && Array.isArray(c.dmg.tags) && c.dmg.tags.includes('bond:avemujica')) necrosis++;
    });
  });
  ok(necrosis > 0, `Mortis: 凋亡损伤命中 ${necrosis} 次`);
}

// C5) Oblivionis: 祥子在场 → 非成员干员获得 25% Amoris 效果
{
  const h = makeMatch({ mode: 'solo', seed: 9, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1);
  ps.shop.level = 6;
  give(m, ps, 'chess_char_5_31_a', 'board', [10, 4]); // 若麦（成员）
  give(m, ps, 'chess_char_6_30_a', 'board', [10, 5]); // 祥子（成员）
  give(m, ps, 'chess_char_1_01_a', 'board', [10, 6]); // 非成员（官方 1★）
  const input = ps.battleInput();
  const b = makeBattle({ data: DATA, players: [input], enemies: [{ key: 'enemy_1010_errdrg', pos: [10, 9] }], timeLimit: 30, autoFinish: false });
  b.step(120);
  const out = b.b.allyUnits.find((u) => String(u.defId || u.def?.id) === 'chess_char_1_01_a');
  const buf = out && out.findBuff('bond:avemujica:atk');
  ok(!!buf, `Oblivionis: 非成员获得 Amoris buff (${out && out.defId})`);
  // 祥子击杀特质会给活跃盟约加层 → L≥0，Amoris 随 L 增长：期望 0.0625（L=0）到稍高
  if (buf) ok(buf.mods.atkPct >= 0.0625 && buf.mods.atkPct <= 0.08, `Oblivionis 25%: atkPct = ${buf.mods.atkPct} (期望 ≥0.0625, 随层数增长)`);
  h.m.dispose?.();
}

// ---------------------------------------------------------------------------
// D) 干员个人特质
// ---------------------------------------------------------------------------
log('\n=== D) 干员个人特质 ===');

// D1) 祥子: 战斗开始时 Fever = 层数×fever_ratio（普通 0.5 / 精锐 1）；击倒敌人 → 活跃盟约层数 +kill_layers
{
  const h = makeMatch({ mode: 'solo', seed: 11, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1); ps.shop.level = 6;
  give(m, ps, 'chess_char_6_30_a', 'board', [10, 4]); // 祥子（普通）
  give(m, ps, 'chess_char_5_31_a', 'board', [10, 5]); // 若麦（2 成员 → 层数可涨）
  h.drive(() => m.phase === 'COMBAT' && m.round === 1, { ready: true }); // onPrepEnd +4 层
  const input = ps.battleInput();
  const L0 = input.bonds.aveMujica.layers || 0;
  // 祥子(领主, 2格范围) 在 [10,4]，令敌人进入正面 1-2 格内
  const b = makeBattle({ data: DATA, players: [input], enemies: [{ key: 'enemy_1010_errdrg', pos: [10, 5] }, { key: 'enemy_1010_errdrg', pos: [10, 6] }], timeLimit: 30, autoFinish: false });
  b.step(240);
  const st = battleStore(b.b, 'avemujica:st');
  const fever = st ? st.fever : 0;
  // battleStart 注入层数一半，之后攻击也会积累 Fever（只会更高）
  ok(fever >= Math.floor(L0 * 0.5), `祥子(普通) battleStart Fever ≥ 层数一半 (${fever}, L=${L0})`);
  // 击倒敌人 → 活跃盟约层数 +kill_layers（战斗内 bond layers 实时更新）
  const bl = b.b.getPlayer('p_0').bonds.aveMujica.layers || 0;
  ok(bl > L0, `祥子击倒敌人 → aveMujica 层数 ${L0} → ${bl}`);
  h.m.dispose?.();
}

// D2) 初华: 放大器（若叶睦受击 fireGain → 额外 1 次）
{
  const withAmp = (extra) => {
    const h = makeMatch({ mode: 'solo', seed: 13, data: DATA, registry: REG, fake: true }).start();
    const m = h.m, ps = h.ps('p_0');
    h.toPrep(1); ps.shop.level = 6;
    give(m, ps, 'chess_char_5_25_a', 'board', [10, 8]); // 若叶睦（敌人出生在前 → 受击 fireGain）
    if (extra) give(m, ps, 'chess_char_5_30_a', 'board', [10, 7]); // 初华（放大器）
    give(m, ps, 'chess_char_5_32_a', 'board', [10, 6]); // 海铃（凑成员使盟约活跃）
    const input = ps.battleInput();
    const b = makeBattle({ data: DATA, players: [input], enemies: [{ key: 'enemy_1010_errdrg', pos: [10, 9] }], timeLimit: 30, autoFinish: false });
    const s = { dmg: 0, gain: 0 };
    b.b.on('damaged', (c) => { if (c.target && String(c.target.defId || c.target.def?.id) === 'chess_char_5_25_a') s.dmg++; });
    b.b.on('layerGain', (c) => { if (c.reason === 'garrison' && c.bondId === 'aveMujica') s.gain++; });
    b.step(200); // 敌人打若叶睦 → fireGain（act_gar_event_onhurt_add_bond_layer）
    h.m.dispose?.();
    return s;
  };
  const base = withAmp(false), amp = withAmp(true);
  ok(base.dmg > 0 && base.gain > 0, `对照: 若叶睦受击 ${base.dmg} 次 → layerGain ${base.gain}`);
  // 每次受击 fireGain → 1 次 layerGain；有初华 → 放大器额外 fireGainRaw → ≈2× layerGain
  const ratioBase = base.gain / Math.max(1, base.dmg), ratioAmp = amp.gain / Math.max(1, amp.dmg);
  ok(ratioAmp > ratioBase * 1.5, `初华放大器: 每受击 layerGain ${ratioBase.toFixed(2)} → ${ratioAmp.toFixed(2)} (有初华 ≥1.5×)`);
}

// D3) 海铃: <刷新时> 自身所属已激活盟约层数 +layers
{
  const h = makeMatch({ mode: 'solo', seed: 17, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1); ps.shop.level = 6; ps.funds = 100;
  give(m, ps, 'chess_char_5_32_a', 'board', [10, 4]); // 海铃（自身是成员 → aveMujica 活跃）
  const L0 = ps.layers?.aveMujica ?? 0;
  m.handle('p_0', { t: 'g.refresh' });
  const L1 = ps.layers?.aveMujica ?? 0;
  ok(L1 - L0 >= 1, `海铃 <刷新时>: aveMujica 层数 +${L1 - L0} (期望 ≥1)`);
  h.m.dispose?.();
}

// D4) 若麦: <进入休整期时> 成员<3 → 免费刷新；≥3 → 资金
{
  const h = makeMatch({ mode: 'solo', seed: 19, data: DATA, registry: REG, fake: true }).start();
  const m = h.m, ps = h.ps('p_0');
  h.toPrep(1); ps.shop.level = 6;
  give(m, ps, 'chess_char_5_31_a', 'board', [10, 4]); // 若麦（1 成员 <3）
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: true });
  ok(ps.shop.freeRefreshes >= 1, `若麦(1成员): 免费刷新 ${ps.shop.freeRefreshes} 次 (期望 ≥1)`);
  // 第 3 轮: 摆满 3 成员 → 资金
  give(m, ps, 'chess_char_5_30_a', 'board', [10, 5]);
  give(m, ps, 'chess_char_5_32_a', 'board', [10, 6]);
  const fundsBefore = ps.funds;
  h.drive(() => m.phase === 'PREP' && m.round === 3, { ready: true });
  const fundsAfter = ps.funds;
  ok(fundsAfter - fundsBefore >= 1, `若麦(3成员): +资金 ${fundsAfter - fundsBefore} (期望 ≥1)`);
  h.m.dispose?.();
}

log(`\n== Ave Mujica 流程结果: 通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
