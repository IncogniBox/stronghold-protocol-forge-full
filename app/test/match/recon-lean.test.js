// test/match/recon-lean.test.js — 重构模拟的「盟约倾向」抽卡权重（业主 2026-10-27）。
//
// 规则：核心 / 附加 / 故事集三组，组内概率总和恒为 1。选中 k 条 ⇒ 每条多拿 `bonus / k`，剩下的平分同样的降幅。
// 本局总提升：核心 10% / 附加 20% / 故事集 10%。干员权重 = 它携带的各盟约倍率的平均（多盟约只吃部分提升）。
// 作用点是 `PlayerState.mainPool().roll`：商店 / 晋升与合成奖励 / 内容 rollChess 都走那一条；没交倾向时原样。
//
// 跑法：node --test test/match/recon-lean.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { createRng } from '../../server/sim/rng.js';

const SIDE_STORY = 'SIDE_STORY';
const isCore = (b) => b.isCore === true;
const isAddon = (b) => b.isCore !== true && b.bondType !== SIDE_STORY;

function reconMatch(o = {}) {
  return makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seed: 7, fake: true, data: DATA, ...o });
}

/** 本局这一组可被倾向的盟约（与预重构屏的候选池同一条口径：去掉 mode.inactiveBondIds 与专属的 bond_recon）。 */
const groupOf = (m, pred) => m.gd.bondIds.filter((id) => id !== 'bond_recon' && !m.gd.modeInactiveBonds.has(id) && pred(m.gd.bond(id)));

/** 只带一条盟约的棋子（倍率不做平均，等于那条盟约的倍率本身）。 */
const monoChess = (m, bondId) => m.gd.visibleChess.find((id) => {
  const b = m.gd.chess(id)?.bonds;
  return Array.isArray(b) && b.length === 1 && b[0] === bondId;
});

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('核心盟约：选 1 条 ← 该盟约干员按组内份额提升（官方 8 条时 ×1.8），其余按同组条数分摊', () => {
  const h = reconMatch({ humans: 1 }).start();
  const m = h.m;
  const ps = m.players.get('p_0');
  const core = groupOf(m, isCore);
  assert.ok(core.length >= 4, `核心盟约应至少 4 条（实际 ${core.length}）`);
  const n = core.length;
  const s0 = 1 / n;
  const chosen = core[0];
  const other = core[1];
  const chosenMono = monoChess(m, chosen);
  const otherMono = monoChess(m, other);
  assert.ok(chosenMono && otherMono, '两条盟约都有一枚「只有它」的棋子可量');

  m.reconChoices = { p_0: { major: [chosen] } };
  let w = m.reconBondLeanWeights(ps);
  assert.ok(w instanceof Map);
  assert.ok(near(w.get(chosenMono), (s0 + 0.1) / s0), `所选 ×${w.get(chosenMono)}（应为 ${(s0 + 0.1) / s0}）`);
  assert.ok(near(w.get(otherMono), (s0 - 0.1 / (n - 1)) / s0), `其余 ×${w.get(otherMono)}`);

  // 选 2 条：总提升 10% 平分 ⇒ 每条 +5%（12.5% → 17.5%），其余分摊 10%
  m.reconChoices = { p_0: { major: [chosen, other] } };
  w = m.reconBondLeanWeights(ps);
  assert.ok(near(w.get(chosenMono), (s0 + 0.05) / s0), '两条各 +5%');
  const third = core[2];
  const thirdMono = monoChess(m, third);
  if (thirdMono) assert.ok(near(w.get(thirdMono), (s0 - 0.1 / (n - 2)) / s0), '其余分摊同一份 10%');

  m.dispose();
});

test('组内总提升：附加 20% / 故事集 10%（各自与核心互不影响）', () => {
  const h = reconMatch({ humans: 1 }).start();
  const m = h.m;
  const ps = m.players.get('p_0');
  const addon = groupOf(m, isAddon);
  const story = groupOf(m, (b) => b.bondType === SIDE_STORY);
  assert.ok(addon.length >= 2, `附加盟约应至少 2 条（实际 ${addon.length}）`);

  const pickAddon = addon.find((id) => monoChess(m, id));
  assert.ok(pickAddon, '有一条附加盟约的「只有它」棋子');
  m.reconChoices = { p_0: { minor: [pickAddon] } };
  const w = m.reconBondLeanWeights(ps);
  assert.ok(near(w.get(monoChess(m, pickAddon)), 1 + 0.2 * addon.length), `附加 1 条应为 ×${1 + 0.2 * addon.length}`);

  if (story.length) {
    const pickStory = story.find((id) => monoChess(m, id));
    if (pickStory) {
      m.reconChoices = { p_0: { story: pickStory } };
      const ws = m.reconBondLeanWeights(ps);
      assert.ok(near(ws.get(monoChess(m, pickStory)), 1 + 0.1 * story.length), `故事集 1 条应为 ×${1 + 0.1 * story.length}`);
    }
  }
  m.dispose();
});

test('多盟约干员取平均：被选的核心 + 未被选的附加 ⇒ (x + 1) / 2', () => {
  const h = reconMatch({ humans: 1 }).start();
  const m = h.m;
  const ps = m.players.get('p_0');
  const core = groupOf(m, isCore);
  const addonSet = new Set(groupOf(m, isAddon));
  const chosen = core.find((id) => m.gd.visibleChess.some((cid) => {
    const b = m.gd.chess(cid)?.bonds;
    return Array.isArray(b) && b.includes(id) && b.some((x) => addonSet.has(x));
  }));
  assert.ok(chosen, '找得到「核心 + 附加」的干员');
  const cid = m.gd.visibleChess.find((id) => {
    const b = m.gd.chess(id)?.bonds;
    return Array.isArray(b) && b.includes(chosen) && b.some((x) => addonSet.has(x));
  });
  m.reconChoices = { p_0: { major: [chosen] } };
  const w = m.reconBondLeanWeights(ps);
  const s0 = 1 / core.length;
  const cm = (s0 + 0.1) / s0;
  const bonds = m.gd.chess(cid).bonds.filter((b) => b === chosen || addonSet.has(b));
  const want = bonds.reduce((acc, b) => acc + (b === chosen ? cm : 1), 0) / bonds.length;
  assert.ok(near(w.get(cid), want), `多盟约平均 ${w.get(cid)} ≠ ${want}`);
  m.dispose();
});

test('分摊名单取自**合并后**的盟约表：mod 新增的核心 / 故事集盟约都算在内（不能只认官方 8 条）', () => {
  const h = reconMatch({ humans: 1 }).start();
  const m = h.m;
  const ps = m.players.get('p_0');
  const core = groupOf(m, isCore);
  const story = groupOf(m, (b) => b.bondType === SIDE_STORY);
  // 本机装了 rimbilliton / ave-mujica / columbia / dossoles：它们新增的盟约必须在组里（干净安装时这一条自然跳过）
  const modCore = core.filter((id) => ['rimBilliton', 'aveMujica', 'columbiaShip'].includes(id));
  if (!modCore.length) { m.dispose(); return; }
  assert.ok(modCore.length === 3 || modCore.length > 0, `mod 核心盟约在组里：${modCore.join(',')}`);
  assert.ok(story.length >= 1, '故事集组里有 dossoles 的 SIDE_STORY 盟约');
  // 选一条 **mod 新增**的核心盟约：它自己的干员按「mod 之后的条数」算份额，官方核心盟约按同一把 n 分摊
  const chosen = modCore[0];
  m.reconChoices = { p_0: { major: [chosen] } };
  const w = m.reconBondLeanWeights(ps);
  const s0 = 1 / core.length;
  const mono = monoChess(m, chosen);
  if (mono) assert.ok(near(w.get(mono), (s0 + 0.1) / s0), `mod 盟约的份额按合并后 ${core.length} 条算（×${w.get(mono)}）`);
  const carrier = m.gd.visibleChess.find((id) => (m.gd.chess(id)?.bonds || []).includes(chosen));
  assert.ok(carrier && w.get(carrier) > 1, '带 mod 盟约的干员被加权');
  // mod 干员也在权重表里（mod 棋子本身不能漏掉）
  const modChess = m.gd.visibleChess.filter((id) => /^chess_ws_/.test(id));
  assert.ok(modChess.length > 0, '本机有 mod 棋子');
  assert.ok(modChess.some((id) => w.has(id)), 'mod 棋子带权重');
  m.dispose();
});

test('没有倾向 / 非重构对局：不给权重（mainPool 原样返回原池，抽卡逐字节不变）', () => {
  const h = reconMatch({ humans: 1 }).start();
  const m = h.m;
  const ps = m.players.get('p_0');
  assert.equal(m.reconBondLeanWeights(ps), null, '没交选择 ⇔ null');
  const base = m.reconPools.byPlayer.get('p_0');
  assert.equal(ps.mainPool(), base, '没有倾向也没有禁用 ⇒ 原池对象本身');
  m.reconChoices = { p_0: { major: [] } };
  assert.equal(m.reconBondLeanWeights(ps), null, '只交了空选择 ⇒ null');
  assert.equal(ps.mainPool(), base);

  const coop = makeMatch({ mode: 'coop', humans: 1, fake: true, data: DATA }).start();
  const cps = coop.m.players.get('p_0');
  coop.m.reconChoices = { p_0: { major: ['yanShip'] } };
  assert.equal(coop.m.reconBondLeanWeights(cps), null, '非重构对局恒为 null');
  assert.equal(cps.mainPool(), coop.m.pool);
  coop.m.dispose();
  m.dispose();
});

test('抽卡真的按权重走：所选盟约的干员占比升到理论倍率（其余相应下降、总概率仍为 1）', () => {
  const h = reconMatch({ humans: 1 }).start();
  const m = h.m;
  const ps = m.players.get('p_0');
  const base = m.reconPools.byPlayer.get('p_0');
  // 两个候选取**池子里真的有的** id（visibleChess 里有些棋子不进商店池）
  const poolIds = [...base.entries.keys()];
  const monoOf = (bondId) => poolIds.find((id) => {
    const b = m.gd.chess(id)?.bonds;
    return Array.isArray(b) && b.length === 1 && b[0] === bondId;
  });
  const core = groupOf(m, isCore);
  const chosen = core.find((id) => monoOf(id));
  const other = core.find((id) => id !== chosen && monoOf(id));
  assert.ok(chosen && other, '两条核心盟约各有一枚单盟约棋子进池');
  const chosenMono = monoOf(chosen);
  const otherMono = monoOf(other);
  m.reconChoices = { p_0: { major: [chosen] } };
  const w = m.reconBondLeanWeights(ps);
  const view = ps.mainPool();
  assert.notEqual(view, base, '有倾向 ⇒ 加权视图');
  // `ignoreCounts`：每个 id 等权（拷贝数不掺进来），于是两者的出现比 = 权重比
  const rng = createRng(0x51a7);
  const N = 20000;
  let a = 0, b = 0;
  for (let i = 0; i < N; i++) {
    const id = view.roll(rng, { maxTier: 6, ignoreCounts: true });
    if (id === chosenMono) a++;
    else if (id === otherMono) b++;
  }
  const want = w.get(chosenMono) / w.get(otherMono);
  assert.ok(a > 0 && b > 0, `两边都抽到过（${a} / ${b}）`);
  assert.ok(Math.abs(a / b - want) < want * 0.3, `实测比 ${(a / b).toFixed(2)} 应≈ ${want.toFixed(2)}`);
  m.dispose();
});
