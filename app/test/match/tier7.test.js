// 7 阶干员（业主 2026-10-30）：
//   * 阶级表从 1–6 扩到 1–7，第 7 阶没有官方精灵 ⇒ 阶级数字用红色（客户端组件 / 战场贴图同一份口径）；
//   * 7 阶记录由后续内容补，引擎这条规则先落地：只有**7 级**调度中心会抽到 7 阶，且**每一格**先摇一次
//     `gd.tier7Share`（缺省 5%）—— 与池里的拷贝数无关，补进来几名 7 阶干员都不会跑偏；
//   * 官方模式 maxShopLevel 仍是 6；池里没有 7 阶记录时这枚骰子根本不摇（现有抽卡逐字节不变）。
//
// 跑法：node --test test/match/tier7.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameData, DEFAULTS } from '../../server/match/gamedata.js';
import { deriveChessRecord, validateChessRecord, TIER7 } from '../../shared/chessAuthoring.js';
import { DATA, makeMatch } from './harness.js';

const T6 = 'chess_char_6_01_a'; // 蕾缪安：6 阶普通记录
const N7 = 'chess_char_7_test_a';
const G7 = 'chess_char_7_test_b';

/** 一份只在测试里存在的 7 阶记录对（照抄 6 阶那条的其余字段）。 */
function dataWithTier7() {
  const normal = DATA.chess[T6];
  const golden = DATA.chess[normal.goldenId];
  // 工坊包可能已经补了真实 7 阶干员（例如重构模拟的赤刃明霄陈）：这里要的是「7 阶池里只有这对测试记录」，
  // 否则每格摇到的 5% 会在多条 7 阶记录之间分摊，断言就不再是 5%。
  const chess = {};
  for (const [id, rec] of Object.entries(DATA.chess)) if (rec.tier !== 7) chess[id] = rec;
  chess[N7] = { ...normal, chessId: N7, baseId: N7, goldenId: G7, upgradeChessId: G7, isGolden: false, tier: 7, identifier: 9901 };
  chess[G7] = { ...golden, chessId: G7, baseId: N7, goldenId: G7, upgradeChessId: null, isGolden: true, tier: 7, identifier: 9902 };
  return { ...DATA, chess };
}

test('7 阶记录在数据层可用：tierOf 7、库存拷贝 4 份（与 6 阶同一倍率）', () => {
  const gd = new GameData(dataWithTier7(), 'mode_recon_abyss');
  assert.equal(gd.tierOf(N7), 7);
  assert.ok(gd.visibleChess.includes(N7), '7 阶普通记录进可见池');
  assert.ok(!gd.visibleChess.includes(G7), '精锐记录不进池（与 1–6 阶同一规则）');
  assert.equal(DEFAULTS.poolCopies[7], 4);
  assert.equal(DEFAULTS.chessPrice[7], 5);
  // 缺省拷贝数只在 economy 表缺这一行时兜底；同一倍率 ⇒ 与 6 阶的比值就是 4 : 5
  const c7 = gd.poolCopies(N7);
  const c6 = gd.poolCopies(T6);
  assert.equal(c7 / c6, DEFAULTS.poolCopies[7] / DEFAULTS.poolCopies[6], '7 阶与 6 阶拷贝数按 4 : 5');
});

test('7 级调度中心每格约 5% 出 7 阶；6 级一局都抽不到', () => {
  const gd = new GameData(dataWithTier7(), 'mode_recon_abyss');
  assert.equal(gd.maxShopLevel, 7);
  assert.equal(gd.tier7Share, 0.05);
  assert.deepEqual(gd.shopSlots(7), { chess: 6, item: 2 });
  const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seed: 1, fake: true, data: dataWithTier7() });
  h.start();
  const ps = h.ps('p_0');
  const pool = ps.mainPool();
  assert.ok(pool.has(N7), '这一局抽签没有禁掉这条 7 阶记录');
  assert.ok(pool.hasTier(7));
  const N = 4000;
  // 6 级：maxTier 6 ⇒ 一枚 7 阶都抽不到
  ps.shop.level = 6;
  for (let i = 0; i < 500; i++) assert.notEqual(ps._rollChessSlot()?.id, N7, '6 级不该出 7 阶');
  // 7 级：每格先摇 5%（摇到 7 阶后再在池里的 7 阶记录之间分摊 —— 这里只断言「这一格出了 7 阶」）
  ps.shop.level = 7;
  let hit = 0;
  for (let i = 0; i < N; i++) {
    const r = ps._rollChessSlot();
    if (r && gd.tierOf(r.id) === 7) hit++;
  }
  const p = hit / N;
  assert.ok(Math.abs(p - 0.05) < 0.015, `7 级实测 7 阶比例 ${(p * 100).toFixed(2)}% 应贴近 5%`);
});

test('官方模式不受影响：6 级上限，7 级商店不存在', () => {
  const gd = new GameData(dataWithTier7(), 'mode_multi_abyss');
  assert.equal(gd.maxShopLevel, 6);
  assert.deepEqual(gd.upgradePrices(), [5, 8, 11, 12, 13]);
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', seed: 21, fake: true, data: dataWithTier7() });
  h.start();
  const ps = h.ps('p_0');
  ps.shop.level = 7; // 越界值：maxTier 仍是 6 那条门（levelUp 会被 MAX_LEVEL 挡住）
  for (let i = 0; i < 500; i++) assert.notEqual(ps._rollChessSlot()?.id, N7, '官方对局不该出 7 阶');
});

test('7 阶的练度口径（Wiki）：普通精二 70 / 7 级技能 / 1 级模组，精锐精二 90 / 专精 3 / 3 级模组', () => {
  assert.deepEqual(TIER7.status, {
    normal: { phase: 2, level: 70, skillLevel: 7, equipLevel: 1 },
    golden: { phase: 2, level: 90, skillLevel: 10, equipLevel: 3 },
  });
  const spec = {
    id: 'tier7_probe', name: '七阶探针', tier: 7, profession: 'SNIPER', subProfessionId: 'fastshot', position: 'RANGED',
    stats: {
      normal: { maxHp: 1500, atk: 480, def: 140, res: 0, cost: 18, blockCnt: 1, bat: 1.0 },
      golden: { maxHp: 1900, atk: 620, def: 180, res: 0, cost: 18, blockCnt: 1, bat: 1.0 },
    },
    skill: { name: '探针', desc: '-', bb: {} },
  };
  const r = deriveChessRecord(spec);
  assert.equal(r.ok, true, JSON.stringify(r.errors ?? []));
  assert.deepEqual(r.base.status, TIER7.status.normal);
  assert.deepEqual(r.golden.status, TIER7.status.golden);
  assert.equal(r.base.skill.level, 7, '普通记录是 7 级技能');
  assert.equal(r.golden.skill.level, 10, '精锐记录是专精 3（skillLevel 10）');
  assert.equal(r.base.price, TIER7.price);
  assert.equal(r.base.rarity, 6, '星级封顶 6★');
  // 校验器：7 阶合法（只给「只活在重构模式的 7 级商店」这条提示），8 阶越界
  const p7 = validateChessRecord(r.base);
  assert.ok(!p7.some((x) => x.severity === 'error'), JSON.stringify(p7));
  assert.ok(p7.some((x) => x.code === 'TIER7_RECON_ONLY'), JSON.stringify(p7));
  const p8 = validateChessRecord({ ...r.base, tier: 8 });
  assert.ok(p8.some((x) => x.field === 'tier' && x.code === 'BAD_TIER'), JSON.stringify(p8));
});
