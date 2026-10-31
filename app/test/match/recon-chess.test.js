// test/match/recon-chess.test.js — 重构模拟的**棋子别名**（业主 2026-10-30：炎·新增与重构）。
//
// 数据：`workshop/mode-recon/chess.json` 里是 `recon_<id>` 记录（`recon_官方 id` = 覆盖，`recon_新 id` = 新增干员）。
// 与盟约同一条纪律：只有 `mode_recon_*` 的对局把这些记录别名到正式 id，官方模式读不到它们。
//
// 跑法：node --test test/match/recon-chess.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reconChessAlias, reconData } from '../../shared/reconModes.js';
import { DATA, makeMatch, give, giveItem } from './harness.js';
import { makeBattle } from '../helpers/battleHarness.js';
import { PHASE } from '../../shared/constants.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** 包的对局元载荷（`pack.json.server.meta`）：休整期那一半的处理器要在测试里显式注册（服务器启动时才自动装）。 */
async function reconRegistry() {
  const reg = createRegistry();
  const mod = await import(pathToFileURL(path.join(ROOT, 'workshop/mode-recon/meta/main.mjs')).href);
  mod.registerMeta(reg);
  return reg;
}

const handItems = (ps) => [...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'item').map((p) => p.id);

test('reconChessAlias：覆盖官方 id / 新增干员 / 去掉前缀 / 原表不动', () => {
  const raw = {
    a: { chessId: 'a', baseId: 'a', goldenId: 'a_g', tier: 5 },
    a_g: { chessId: 'a_g', baseId: 'a', goldenId: 'a_g', isGolden: true },
    recon_a: { chessId: 'recon_a', baseId: 'recon_a', goldenId: 'recon_a_g', upgradeChessId: 'recon_a_g', tier: 4 },
    recon_new: { chessId: 'recon_new', baseId: 'recon_new', goldenId: 'recon_new_g', tier: 6 },
  };
  const out = reconChessAlias(raw);
  assert.ok(out);
  assert.equal(Object.keys(out.chess).filter((id) => id.startsWith('recon_')).length, 0, '别名后的表里没有 recon_*');
  assert.equal(out.chess.a.tier, 4, '官方 id 被重构记录覆盖');
  assert.equal(out.chess.a.chessId, 'a');
  assert.equal(out.chess.a.goldenId, 'a_g', 'goldenId 的 recon_ 前缀也去掉');
  assert.equal(out.chess.a.upgradeChessId, 'a_g');
  assert.equal(out.chess.new.tier, 6, '官方没有的 id ⇒ 新增干员');
  assert.equal(out.chess.new.chessId, 'new');
  assert.deepEqual(out.alias, { a: 'recon_a', new: 'recon_new' });
  assert.equal(raw.recon_a.tier, 4, '原表一个字节不动');
  assert.equal(Object.keys(raw).length, 4);
});

test('reconData：只在 mode_recon_* 叠别名，并按数据对象缓存', () => {
  const plain = { chess: { a: { chessId: 'a', tier: 5 } }, bonds: {} };
  assert.equal(reconData(plain, 'mode_multi_normal'), null, '官方模式不别名');
  assert.equal(reconData(plain, 'mode_recon_abyss'), null, '没有别名记录 ⇒ null');

  const data = { chess: { a: { chessId: 'a', tier: 5 }, recon_a: { chessId: 'recon_a', tier: 4 } }, bonds: {} };
  const aliased = reconData(data, 'mode_recon_abyss');
  assert.ok(aliased);
  assert.equal(aliased.chess.a.tier, 4);
  assert.equal(reconData(data, 'mode_recon_abyss'), aliased, '同一份数据只建一次');
});

test('真实数据：5 名重构干员的阶级 / 特质，2 名新增干员', () => {
  const c = DATA.chess;
  const g = DATA.garrisons;
  assert.equal(c['recon_chess_char_5_23_a'].tier, 4, '录武官 → 4 阶');
  assert.equal(c['recon_chess_char_5_23_a'].garrisonIds[0], 'recon_garrison_156_a');
  assert.equal(g['recon_garrison_156_a'].bbStr.count, '4,2', '录武官：炎 4 / 奇迹 2');
  assert.equal(g['recon_garrison_156_b'].bbStr.count, '8,4', '精锐：炎 8 / 奇迹 4');

  assert.equal(c['recon_chess_char_4_17_a'].tier, 3, '星熊 → 3 阶');
  assert.equal(g['recon_garrison_65_a'].bb.count, 6, '星熊：自身盟约 +6');
  assert.equal(g['recon_garrison_65_b'].bb.count, 12, '精锐 +12');

  assert.equal(c['recon_chess_char_3_03_a'].tier, 2, '诗怀雅 → 2 阶');
  assert.deepEqual(c['recon_chess_char_3_03_a'].garrisonIds, ['garrison_133_a'], '诗怀雅「其余不变」⇒ 沿用官方特质');

  assert.equal(c['recon_chess_char_5_03_a'].tier, 4, '烛煌 → 4 阶');
  assert.equal(g['recon_garrison_35_a'].bb.count, 4, '烛煌：炎/维 +4');
  assert.equal(g['recon_garrison_35_b'].bb.count, 8, '精锐 +8');

  assert.equal(c['recon_chess_char_6_15_a'].tier, 5, '仇白 → 5 阶');
  assert.equal(g['recon_garrison_101_a'].bb.damage_scale_per_stack, 0.005, '仇白：0.5%');
  assert.equal(g['recon_garrison_101_b'].bb.damage_scale_per_stack, 0.01, '精锐 1%');

  const z = c['recon_chess_ws_recon_zuole_a'];
  assert.ok(z, '左乐是新增干员（不占用其它包的 id）');
  assert.equal(z.tier, 6);
  assert.deepEqual(z.bonds, ['yanShip', 'swiftShip'], '盟约：炎、迅捷');
  assert.deepEqual(c['recon_chess_ws_recon_zuole_b'].bonds, ['yanShip', 'swiftShip']);

  const ch = c['recon_chess_ws_recon_chen3_a'];
  assert.ok(ch, '赤刃明霄陈是新增干员');
  assert.equal(ch.tier, 7, '7 阶');
  assert.deepEqual(ch.bonds, ['yanShip']);
  assert.equal(g['recon_garrison_chen3_a'].bb.hp_pct, 0.00001, '0.001% 当前生命');
  assert.equal(g['recon_garrison_chen3_b'].bb.hp_pct, 0.00002, '精锐 0.002%');
});

test('真实数据：萨尔贡三名新增干员（娜仁图亚 / 森蚺 / 狮蝎）与三名重构干员', () => {
  const c = DATA.chess;
  const g = DATA.garrisons;

  const n = c['recon_chess_ws_recon_narant_a'];
  assert.ok(n, '娜仁图亚是新增干员');
  assert.equal(n.tier, 6);
  assert.equal(n.price, 4);
  assert.deepEqual(n.bonds, ['sargonShip', 'preciShip', 'visiShip'], '盟约：萨尔贡、精准、远见');
  assert.equal(g['recon_garrison_narant_a'].bb.tiles, 4, '普通：相邻四格');
  assert.equal(g['recon_garrison_narant_b'].bb.tiles, 8, '精锐：周围八格');
  assert.equal(g['recon_garrison_narant_a'].bb.duration, 60);
  assert.equal(g['recon_garrison_narant_a'].bbStr.bond, 'sargonShip');

  const z = c['recon_chess_ws_recon_zumama_a'];
  assert.ok(z, '森蚺是新增干员');
  assert.equal(z.tier, 7, '7 阶');
  assert.equal(z.price, 5);
  assert.deepEqual(z.bonds, ['sargonShip', 'steadShip'], '盟约：萨尔贡、坚守');
  assert.equal(g['recon_garrison_zumama_a'].bb.layers, 6, '每开启 1 次技能 +6 层');
  assert.equal(g['recon_garrison_zumama_a'].bb.casts, 20, '≥20 次给黄沙罗盘');
  assert.equal(g['recon_garrison_zumama_a'].bb.count, 1);
  assert.equal(g['recon_garrison_zumama_b'].bb.count, 2, '精锐 2 件');

  const m = c['recon_chess_ws_recon_mantic_a'];
  assert.ok(m, '狮蝎是新增干员');
  assert.equal(m.tier, 3);
  assert.equal(m.price, 3);
  assert.deepEqual(m.bonds, ['sargonShip', 'soloShip'], '盟约：萨尔贡、独行');
  assert.equal(g['recon_garrison_mantic_a'].bb.tiles, 4);
  assert.equal(g['recon_garrison_mantic_b'].bb.tiles, 8, '精锐：周围8格');
  assert.equal(g['recon_garrison_mantic_a'].bb.duration, 999);
  assert.equal(g['recon_garrison_mantic_a'].bb.max, 2, '最多 2 件盟约之币');
  assert.equal(g['recon_garrison_mantic_b'].bb.max, 4, '精锐最多 4 件');

  assert.equal(c['recon_chess_char_6_06_a'].tier, 5, '佩佩 → 5 阶');
  assert.deepEqual(c['recon_chess_char_6_06_a'].garrisonIds, ['garrison_94_a'], '佩佩「其余不变」');
  assert.equal(c['recon_chess_char_2_06_a'].tier, 1, '莎草 → 1 阶');
  assert.equal(c['recon_chess_char_2_06_a'].price, 2, '莎草购买资金 2');
  assert.equal(c['recon_chess_char_3_13_a'].tier, 2, '至简 → 2 阶');
  assert.deepEqual(c['recon_chess_char_3_13_a'].garrisonIds, ['garrison_13_a'], '至简「其余不变」');
});

test('真实数据：维多利亚三名新增干员（澄闪 / 死芒 / 傀影）与风笛重构', () => {
  const c = DATA.chess;
  const g = DATA.garrisons;
  const t = DATA.tokens;

  const gd = c['recon_chess_ws_recon_gdglow_a'];
  assert.ok(gd, '澄闪是新增干员');
  assert.equal(gd.tier, 5);
  assert.equal(gd.price, 4);
  assert.deepEqual(gd.bonds, ['victoriaShip', 'skillfulShip', 'arcaneShip'], '盟约：维多利亚、灵巧、奥术');
  assert.equal(gd.kitRef, 'char_377_gdglow', '技能本体借官方自选 kit');
  assert.equal(g['recon_garrison_gdglow_a'].bb.layers, 200, '普通：每 200 层 +1');
  assert.equal(g['recon_garrison_gdglow_b'].bb.layers, 100, '精锐：每 100 层 +1');

  const nc = c['recon_chess_ws_recon_necras_a'];
  assert.ok(nc, '死芒是新增干员');
  assert.equal(nc.tier, 7, '7 阶');
  assert.equal(nc.price, 5);
  assert.deepEqual(nc.bonds, ['victoriaShip', 'swiftShip', 'soloShip'], '盟约：维多利亚、迅捷、独行');
  assert.equal(nc.kitRef, 'char_450_necras');
  assert.ok(nc.tokens.includes('token_10043_necras_skeltn'), '召唤物跟着棋子');
  assert.equal(g['recon_garrison_necras_a'].bb.pct, 0.005, '普通：×0.5%');
  assert.equal(g['recon_garrison_necras_b'].bb.pct, 0.01, '精锐：×1%');
  assert.equal(g['recon_garrison_necras_a'].bbStr.bond, 'victoriaShip', '按【维多利亚】层数');
  assert.ok(t['token_10043_necras_skeltn'], '召唤物记录随包提供（官方 data/tokens.json 里没有）');
  assert.ok(t['token_10043_necras_skeltn'].variants['chess_ws_recon_necras_b'], '精锐形态的召唤物变体');

  const ph = c['recon_chess_ws_recon_phatom_a'];
  assert.ok(ph, '傀影是新增干员');
  assert.equal(ph.tier, 4);
  assert.equal(ph.price, 3);
  assert.deepEqual(ph.bonds, ['victoriaShip', 'raidShip'], '盟约：维多利亚、突袭');
  assert.equal(ph.kitRef, 'char_250_phatom');
  assert.ok(ph.tokens.includes('token_10007_phatom_twin'));
  assert.ok(ph.skills.filter((s) => s.isDefault).length === 1, '载入界面恰好一个默认技能');
  assert.equal(g['recon_garrison_phatom_a'].bb.layers, 4, '普通：+4 层');
  assert.equal(g['recon_garrison_phatom_b'].bb.layers, 8, '精锐：+8 层');
  for (const k of ['a', 'b']) {
    assert.equal(g[`recon_garrison_phatom_${k}`].bb.max_times, 5, '最多 5 次');
    assert.equal(g[`recon_garrison_phatom_${k}`].bb.deploys, 3, '部署 ≥3 次给重锤');
  }
  assert.equal(g['recon_garrison_phatom_a'].bb.count, 1);
  assert.equal(g['recon_garrison_phatom_b'].bb.count, 2, '精锐 2 件');
  assert.ok(t['token_10007_phatom_twin'], '镜中虚影随包提供');
  assert.ok(t['token_10007_phatom_twin'].variants['chess_ws_recon_phatom_b'], '精锐形态的虚影变体');

  assert.equal(c['recon_chess_char_4_07_a'].tier, 3, '风笛 → 3 阶');
  assert.deepEqual(c['recon_chess_char_4_07_a'].garrisonIds, ['garrison_50_a'], '风笛「其余不变」');
  assert.equal(c['recon_chess_char_4_07_b'].tier, 3);
});

test('真实数据：谢拉格两名新增干员（极光 / 讯使）与雪猎 / 圣聆初雪重构', () => {
  const c = DATA.chess;
  const g = DATA.garrisons;

  const au = c['recon_chess_ws_recon_aurora_a'];
  assert.ok(au, '极光是新增干员');
  assert.equal(au.tier, 3);
  assert.equal(au.price, 3);
  assert.deepEqual(au.bonds, ['kjeragShip', 'indomShip'], '盟约：谢拉格、不屈');
  assert.equal(au.chessType, 'NORMAL');
  assert.equal(g['recon_garrison_aurora_a'].bb.sp, 1, '普通：每秒 1 技力');
  assert.equal(g['recon_garrison_aurora_b'].bb.sp, 2, '精锐：每秒 2 技力');
  for (const k of ['a', 'b']) {
    assert.equal(g[`recon_garrison_aurora_${k}`].bb.cold, 3, '每 3 次寒冷');
    assert.equal(g[`recon_garrison_aurora_${k}`].bbStr.bond, 'kjeragShip');
  }
  assert.equal(g['recon_garrison_aurora_a'].bb.layers, 2, '普通：+2 层');
  assert.equal(g['recon_garrison_aurora_b'].bb.layers, 4, '精锐：+4 层');

  const co = c['recon_chess_ws_recon_courier_a'];
  assert.ok(co, '讯使是新增干员');
  assert.equal(co.tier, 1);
  assert.equal(co.price, 2);
  assert.deepEqual(co.bonds, ['kjeragShip'], '盟约：谢拉格');
  assert.equal(co.chessType, 'PRESET');
  assert.equal(g['recon_garrison_courier_a'].eventType, 'SERVER_PREP_START', '进入休整期时');
  assert.equal(g['recon_garrison_courier_a'].bb.count, 1, '普通 1 件');
  assert.equal(g['recon_garrison_courier_b'].bb.count, 2, '精锐 2 件');

  assert.equal(c['recon_chess_char_3_11_a'].tier, 2, '雪猎 → 2 阶');
  assert.deepEqual(c['recon_chess_char_3_11_a'].garrisonIds, ['recon_garrison_snhunt_a']);
  assert.equal(g['recon_garrison_snhunt_a'].bb.count, 3, '普通特质：所属盟约 +3');
  assert.equal(g['recon_garrison_snhunt_b'].bb.count, 6, '精锐化特质：所属盟约 +6');
  assert.equal(g['recon_garrison_snhunt_a'].effectKey, 'SERVER_ADD_BOND_CHESS_ALL', '沿用官方的「获得时」处理器');

  assert.equal(c['recon_chess_char_6_02_a'].tier, 7, '圣聆初雪 → 7 阶');
  assert.deepEqual(c['recon_chess_char_6_02_a'].garrisonIds, ['garrison_05_a', 'recon_garrison_sbell_a'], '保留原本特质');
  assert.equal(g['recon_garrison_sbell_a'].bb.res, 1, '普通：无视 1 点法抗');
  assert.equal(g['recon_garrison_sbell_b'].bb.res, 2, '精锐：无视 2 点法抗');
  assert.equal(g['recon_garrison_sbell_a'].bb.max, 25, '最多 25 层');
});

test('真实数据：拉特兰两名新增干员（菲亚梅塔 / 空构）与塑心 / 蕾缪安重构', () => {
  const c = DATA.chess;
  const g = DATA.garrisons;

  const ph = c['recon_chess_ws_recon_phenxi_a'];
  assert.ok(ph, '菲亚梅塔是新增干员');
  assert.equal(ph.tier, 6);
  assert.equal(ph.price, 4);
  assert.deepEqual(ph.bonds, ['lateranoShip', 'soloShip'], '盟约：拉特兰、独行');
  assert.equal(ph.chessType, 'PRESET');
  assert.equal(ph.kitRef, 'char_300_phenxi', '技能本体借官方自选 kit');
  assert.deepEqual(ph.garrisonIds, ['recon_garrison_phenxi_gain_a', 'recon_garrison_phenxi_ammo_a']);
  assert.equal(g['recon_garrison_phenxi_gain_a'].eventType, 'SERVER_GAIN', '<获得时>');
  assert.equal(g['recon_garrison_phenxi_gain_a'].effectType, 'SERVER_GAIN_EQUIP');
  assert.equal(g['recon_garrison_phenxi_gain_a'].bb.count, 1, '普通：1 件铳骑之威');
  assert.equal(g['recon_garrison_phenxi_gain_b'].bb.count, 2, '精锐：2 件铳骑之威');
  assert.equal(g['recon_garrison_phenxi_gain_a'].bbStr.chess, 'chess_item_6_02_e_a');
  assert.equal(g['recon_garrison_phenxi_ammo_a'].bb.ammo, 200, '普通：消耗弹药 ≥200');
  assert.equal(g['recon_garrison_phenxi_ammo_b'].bb.ammo, 100, '精锐：消耗弹药 ≥100');
  assert.equal(g['recon_garrison_phenxi_ammo_a'].effectKey, 'RECON_PHENXI_AMMO');

  const sp = c['recon_chess_ws_recon_spuria_a'];
  assert.ok(sp, '空构是新增干员');
  assert.equal(sp.name, '空构');
  assert.equal(sp.tier, 2);
  assert.equal(sp.price, 3);
  assert.deepEqual(sp.bonds, ['lateranoShip', 'visiShip'], '盟约：拉特兰、远见');
  assert.equal(sp.chessType, 'PRESET');
  assert.deepEqual(sp.garrisonIds, ['recon_garrison_konggou_a']);
  assert.equal(g['recon_garrison_konggou_a'].eventType, 'SERVER_PREP_FIN', '<休整期结束时>');
  assert.equal(g['recon_garrison_konggou_a'].bb.layers, 2, '普通：+2 层');
  assert.equal(g['recon_garrison_konggou_b'].bb.layers, 4, '精锐：+4 层');

  assert.equal(c['recon_chess_char_6_09_a'].tier, 5, '塑心 → 5 阶');
  assert.equal(c['recon_chess_char_6_09_b'].tier, 5);

  assert.equal(c['recon_chess_char_6_01_a'].tier, 7, '蕾缪安 → 7 阶');
  assert.deepEqual(c['recon_chess_char_6_01_a'].garrisonIds, ['garrison_24_a', 'recon_garrison_lemuen_a'], '保留原本特质并加一条');
  assert.equal(g['recon_garrison_lemuen_a'].bb.slow, 0.9, '速度 -90%');
  assert.equal(g['recon_garrison_lemuen_a'].bb.pct, 0.02, '普通：每层 2%');
  assert.equal(g['recon_garrison_lemuen_b'].bb.pct, 0.04, '精锐：每层 4%');
});

test('真实数据：卡西米尔两名新增干员（薇薇安娜 / 白金）与四名重构干员', () => {
  const c = DATA.chess;
  const g = DATA.garrisons;

  const vv = c['recon_chess_ws_recon_vvana_a'];
  assert.ok(vv, '薇薇安娜是新增干员');
  assert.equal(vv.tier, 5);
  assert.equal(vv.price, 4);
  assert.deepEqual(vv.bonds, ['kazimierzShip', 'skillfulShip'], '盟约：卡西米尔、灵巧');
  assert.equal(vv.kitRef, 'char_4098_vvana', '技能本体借官方 kit');
  assert.deepEqual(vv.garrisonIds, ['recon_garrison_vvana_a']);
  assert.equal(g['recon_garrison_vvana_a'].eventType, 'SERVER_PREP_START', '<进入休整期时>');
  assert.equal(g['recon_garrison_vvana_a'].bb.count, 1, '普通：1 件骑士储蓄罐');
  assert.equal(g['recon_garrison_vvana_b'].bb.count, 2, '精锐：2 件');
  assert.equal(g['recon_garrison_vvana_a'].bb.prob, 0.0325, '普通：极小概率 3.25%');
  assert.equal(g['recon_garrison_vvana_b'].bb.prob, 0.0799, '精锐：小概率 7.99%');
  assert.equal(g['recon_garrison_vvana_a'].bbStr.chess, 'chess_item_3_12_e_a', '获得骑士储蓄罐');

  const pl = c['recon_chess_ws_recon_platnm_a'];
  assert.ok(pl, '白金是新增干员');
  assert.equal(pl.tier, 3);
  assert.equal(pl.price, 3);
  assert.deepEqual(pl.bonds, ['kazimierzShip', 'preciShip', 'soloShip'], '盟约：卡西米尔、精准、独行');
  assert.deepEqual(pl.garrisonIds, ['recon_garrison_platnm_a']);
  assert.equal(g['recon_garrison_platnm_a'].eventType, 'IN_BATTLE');
  assert.equal(g['recon_garrison_platnm_a'].effectKey, 'RECON_PLATNM_ASPD');
  assert.equal(g['recon_garrison_platnm_a'].bb.aspd, 5, '每 0.5 秒 +5 攻速');
  assert.equal(g['recon_garrison_platnm_a'].bb.max, 20, '最多 20 层');
  assert.equal(g['recon_garrison_platnm_a'].bb.decay, 10, '攻击后 10 秒降到 0');
  assert.equal(g['recon_garrison_platnm_a'].bb.layers_interval, 5, '到顶后每 5 秒盟约 +1');
  assert.equal(g['recon_garrison_platnm_a'].bbStr.bond, 'kazimierzShip');

  assert.equal(c['recon_chess_char_3_17_a'].tier, 2, '流星 → 2 阶');
  assert.deepEqual(c['recon_chess_char_3_17_a'].bonds, ['kazimierzShip'], '流星移除独行盟约');
  assert.deepEqual(c['recon_chess_char_3_17_a'].garrisonIds, ['garrison_137_a', 'garrison_01_a'], '其余不变');

  assert.equal(c['recon_chess_char_5_19_a'].tier, 7, '玛恩纳 → 7 阶');
  assert.deepEqual(c['recon_chess_char_5_19_a'].garrisonIds, ['garrison_115_a', 'recon_garrison_mlynar_a'], '保留原本特质并追加一条');
  assert.equal(g['recon_garrison_mlynar_a'].bb.attacks, 3, '每 3 次攻击');
  assert.equal(g['recon_garrison_mlynar_a'].bb.ticks, 5, '2 秒 5 次');
  assert.equal(g['recon_garrison_mlynar_a'].bb.interval, 0.4);
  assert.equal(g['recon_garrison_mlynar_a'].bb.damage, 799);
  assert.equal(g['recon_garrison_mlynar_b'].bb.damage, 1124, '精锐：1124');
  assert.equal(g['recon_garrison_mlynar_a'].bbStr.bond, 'kazimierzShip');

  assert.equal(c['recon_chess_char_4_20_a'].tier, 3, '远牙 → 3 阶');
  assert.deepEqual(c['recon_chess_char_4_20_a'].garrisonIds, ['recon_garrison_fartth_a']);
  assert.equal(g['recon_garrison_fartth_a'].effectKey, 'ADD_BOND');
  assert.equal(g['recon_garrison_fartth_a'].bbStr.give_garrison_id, 'recon_garrison_fartth_gift_a', '授予改写数值的自身特质');
  assert.equal(g['recon_garrison_fartth_gift_a'].bb.bond_add_count, 3, '普通：+3 层');
  assert.equal(g['recon_garrison_fartth_gift_b'].bb.bond_add_count, 6, '精锐：+6 层');
  assert.equal(g['recon_garrison_fartth_gift_a'].bb.max_add_count_per_battle, 18, '普通上限 18');
  assert.equal(g['recon_garrison_fartth_gift_b'].bb.max_add_count_per_battle, 36, '精锐上限 36');
  assert.equal(g['recon_garrison_fartth_gift_a'].bbStr.bond_id, 'kazimierzShip,preciShip', '卡西米尔 / 精准');

  assert.equal(c['recon_chess_char_2_18_a'].tier, 1, '灰毫 → 1 阶');
  assert.equal(c['recon_chess_char_2_18_a'].price, 2, '购买资金 2');
  assert.equal(c['recon_chess_char_2_18_b'].price, 2);
  assert.deepEqual(c['recon_chess_char_2_18_a'].garrisonIds, ['recon_garrison_ashlok_a']);
  assert.equal(g['recon_garrison_ashlok_a'].effectKey, 'SERVER_ADD_BOND_ACTIVATED_MOST_LAYER', '沿用官方「获得时」处理器');
  assert.equal(g['recon_garrison_ashlok_a'].bb.count, 2, '普通：+2 层');
  assert.equal(g['recon_garrison_ashlok_b'].bb.count, 4, '精锐：+4 层');
});

test('真实数据：叙拉古两名新增干员（贝洛内 / 斥罪）与四名重构干员', () => {
  const c = DATA.chess;
  const g = DATA.garrisons;
  const t = DATA.tokens;

  const dm = c['recon_chess_ws_recon_demetr_a'];
  assert.ok(dm, '贝洛内是新增干员');
  assert.equal(dm.tier, 7);
  assert.equal(dm.price, 5);
  assert.deepEqual(dm.bonds, ['siracusaShip', 'raidShip'], '盟约：叙拉古、突袭');
  assert.equal(dm.kitRef, 'char_4037_demetr', '技能本体借官方自选 kit');
  assert.deepEqual(dm.garrisonIds, ['recon_garrison_bellone_deploy_a', 'recon_garrison_bellone_prep_a']);
  assert.ok(dm.tokens.includes('token_10065_demetr_dmtpos'), '牵绊随棋子');
  assert.ok(t['token_10065_demetr_dmtpos'], '牵绊记录随包提供');
  assert.ok(t['token_10065_demetr_dmtpos'].variants['chess_ws_recon_demetr_b'], '精锐形态的牵绊变体');
  assert.equal(g['recon_garrison_bellone_deploy_a'].effectKey, 'act2autochess_gar_event_onstart', '<部署时>');
  assert.equal(g['recon_garrison_bellone_deploy_a'].bb.bond_add_count, 10, '普通 +10');
  assert.equal(g['recon_garrison_bellone_deploy_b'].bb.bond_add_count, 20, '精锐 +20');
  assert.equal(g['recon_garrison_bellone_deploy_a'].bb.max_add_count_per_battle, 40, '最多 4 次');
  assert.equal(g['recon_garrison_bellone_deploy_b'].bb.max_add_count_per_battle, 80, '精锐最多 4 次');
  assert.equal(g['recon_garrison_bellone_deploy_a'].bbStr.bond_id, 'siracusaShip,raidShip', '叙拉古 / 突袭');
  assert.equal(g['recon_garrison_bellone_prep_a'].eventType, 'SERVER_PREP_START', '<进入休整期时>');
  assert.equal(g['recon_garrison_bellone_prep_a'].bb.count, 1, '普通 1 件叙拉古正装');
  assert.equal(g['recon_garrison_bellone_prep_b'].bb.count, 2, '精锐 2 件');

  const jd = c['recon_chess_ws_recon_judge_a'];
  assert.ok(jd, '斥罪是新增干员');
  assert.equal(jd.tier, 5);
  assert.equal(jd.price, 4);
  assert.deepEqual(jd.bonds, ['siracusaShip', 'indomShip'], '盟约：叙拉古、不屈');
  assert.equal(jd.kitRef, 'char_4065_judge');
  assert.deepEqual(jd.garrisonIds, ['recon_garrison_judge_a']);
  assert.equal(g['recon_garrison_judge_a'].eventType, 'IN_BATTLE');
  assert.equal(g['recon_garrison_judge_a'].effectKey, 'RECON_ZEIZ_GUARD');
  assert.equal(g['recon_garrison_judge_a'].bb.layers, 4, '普通：每次 +4');
  assert.equal(g['recon_garrison_judge_b'].bb.layers, 8, '精锐：每次 +8');
  assert.equal(g['recon_garrison_judge_a'].bb.max_times, 6, '最多 6 次');

  assert.equal(c['recon_chess_char_4_10_a'].tier, 3, '阿罗玛 → 3 阶');
  assert.deepEqual(c['recon_chess_char_4_10_a'].garrisonIds, ['recon_garrison_aroma_a']);
  assert.equal(g['recon_garrison_aroma_a'].bb.max_layer, 4, '普通上限 4');
  assert.equal(g['recon_garrison_aroma_b'].bb.max_layer, 8, '精锐上限 8');
  assert.equal(g['recon_garrison_aroma_a'].bb.multiplier, 2, '每刷 1 次 +2（不变）');

  assert.equal(c['recon_chess_char_3_18_a'].tier, 2, '忍冬 → 2 阶');
  assert.deepEqual(c['recon_chess_char_3_18_a'].garrisonIds, ['recon_garrison_vulpis_a']);
  assert.equal(g['recon_garrison_vulpis_a'].bb.count, 4, '普通 +4');
  assert.equal(g['recon_garrison_vulpis_b'].bb.count, 8, '精锐 +8');

  assert.equal(c['recon_chess_char_5_20_a'].tier, 4, '安洁莉娜 → 4 阶');
  assert.deepEqual(c['recon_chess_char_5_20_a'].garrisonIds, ['recon_garrison_aglina_a']);
  assert.equal(g['recon_garrison_aglina_a'].bb.multiplier, 3, '普通每刷 +3');
  assert.equal(g['recon_garrison_aglina_b'].bb.multiplier, 6, '精锐每刷 +6');
  assert.equal(g['recon_garrison_aglina_a'].bb.max_layer, 9, '普通上限 9');
  assert.equal(g['recon_garrison_aglina_b'].bb.max_layer, 18, '精锐上限 18');

  assert.equal(c['recon_chess_char_3_19_a'].tier, 3, '伺夜阶级不变');
  assert.deepEqual(c['recon_chess_char_3_19_a'].garrisonIds, ['garrison_152_a', 'garrison_153_a', 'garrison_01_a', 'recon_garrison_vigil_prep_a'], '保留原本特质并追加一条');
  assert.equal(g['recon_garrison_vigil_prep_a'].eventType, 'SERVER_PREP_START');
  assert.equal(g['recon_garrison_vigil_prep_a'].bb.count, 1, '普通 1 件家族徽章');
  assert.equal(g['recon_garrison_vigil_prep_b'].bb.count, 2, '精锐 2 件');
});

test('真实数据：阿戈尔四名新增干员（克莱门莎 / 海沫 / 深海色 / 安哲拉）', () => {
  const c = DATA.chess;
  const g = DATA.garrisons;
  const t = DATA.tokens;

  const cm = c['recon_chess_ws_recon_clemnt_a'];
  assert.ok(cm, '克莱门莎是新增干员');
  assert.equal(cm.tier, 7);
  assert.equal(cm.price, 5);
  assert.deepEqual(cm.bonds, ['egirShip'], '盟约：阿戈尔');
  assert.equal(cm.kitRef, 'char_4231_clemnt', '技能本体借官方自选 kit');
  assert.deepEqual(cm.garrisonIds, ['recon_garrison_clemnt_a']);
  assert.equal(g['recon_garrison_clemnt_a'].effectKey, 'RECON_CLEMNT_AEGIR');
  assert.equal(g['recon_garrison_clemnt_a'].bb.hp_pct, 0.01, '普通 1% 生命上限');
  assert.equal(g['recon_garrison_clemnt_b'].bb.hp_pct, 0.02, '精锐 2%');
  assert.equal(g['recon_garrison_clemnt_a'].bb.cooldown_cut, 0.25, '冷却 -25%');
  assert.equal(g['recon_garrison_clemnt_b'].bb.cooldown_cut, 0.5, '精锐 -50%');
  assert.equal(g['recon_garrison_clemnt_a'].bbStr.bond, 'egirShip');

  const hm = c['recon_chess_ws_recon_highmo_a'];
  assert.ok(hm, '海沫是新增干员');
  assert.equal(hm.tier, 4);
  assert.equal(hm.price, 3);
  assert.deepEqual(hm.bonds, ['egirShip', 'skillfulShip'], '盟约：阿戈尔、灵巧');
  assert.deepEqual(hm.garrisonIds, ['recon_garrison_highmo_a']);
  assert.equal(g['recon_garrison_highmo_a'].eventType, 'IN_BATTLE');
  assert.equal(g['recon_garrison_highmo_a'].effectKey, 'RECON_HIGHMO_COPY');
  assert.equal(g['recon_garrison_highmo_a'].bb.tiles, 1, '普通：身后一格');
  assert.equal(g['recon_garrison_highmo_b'].bb.tiles, 2, '精锐：身后两格');

  const dc = c['recon_chess_ws_recon_deepcl_a'];
  assert.ok(dc, '深海色是新增干员');
  assert.equal(dc.tier, 1);
  assert.equal(dc.price, 2);
  assert.deepEqual(dc.bonds, ['egirShip', 'soloShip'], '盟约：阿戈尔、独行');
  assert.deepEqual(dc.garrisonIds, ['recon_garrison_deepcl_a']);
  assert.equal(g['recon_garrison_deepcl_a'].eventType, 'SERVER_CHESS_SOLD', '<售出时>');
  assert.equal(g['recon_garrison_deepcl_a'].effectKey, 'RECON_DEEPCL_SOLD');
  assert.equal(g['recon_garrison_deepcl_a'].bb.count, 1, '普通 1 件');
  assert.equal(g['recon_garrison_deepcl_b'].bb.count, 2, '精锐 2 件');
  assert.equal(g['recon_garrison_deepcl_a'].bb.tier, 2, '随机 2 阶装备');
  assert.ok(dc.tokens.includes('token_10001_deepcl_tentac'), '触手随棋子');
  assert.ok(t['token_10001_deepcl_tentac'], '触手记录随包提供');
  assert.ok(t['token_10001_deepcl_tentac'].variants['chess_ws_recon_deepcl_b'], '精锐形态的触手变体');

  const ct = c['recon_chess_ws_recon_cuttle_a'];
  assert.ok(ct, '安哲拉是新增干员');
  assert.equal(ct.tier, 2);
  assert.equal(ct.price, 3);
  assert.deepEqual(ct.bonds, ['egirShip', 'preciShip'], '盟约：阿戈尔、精准');
  assert.deepEqual(ct.garrisonIds, ['recon_garrison_cuttle_a']);
  assert.equal(g['recon_garrison_cuttle_a'].eventType, 'SERVER_PREP_START');
  assert.equal(g['recon_garrison_cuttle_a'].effectKey, 'RECON_CUTTLE_REPLACE');
  assert.equal(g['recon_garrison_cuttle_a'].bb.min_items, 2, '普通：装备 ≥2');
  assert.equal(g['recon_garrison_cuttle_b'].bb.min_items, 1, '精锐：装备 ≥1');
  assert.equal(g['recon_garrison_cuttle_a'].bb.pick, 2, '普通：替换 2 件');
  assert.equal(g['recon_garrison_cuttle_b'].bb.pick, 1, '精锐：替换 1 件');
});

test('Match：重构对局读到别名后的棋子，官方模式仍是原记录', () => {
  const recon = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seed: 7, fake: true, data: DATA });
  const m = recon.m;
  assert.ok(m.reconChessAlias, '重构对局有一份别名表');
  assert.equal(m.reconChessAlias['chess_char_5_23_a'], 'recon_chess_char_5_23_a');
  assert.equal(m.gd.chess('chess_char_5_23_a').tier, 4, '录武官 → 4 阶');
  assert.equal(m.gd.chess('chess_char_6_15_a').tier, 5, '仇白 → 5 阶');
  assert.ok(m.gd.chess('chess_ws_recon_zuole_a'), '左乐进入重构对局的棋子表');
  assert.equal(m.gd.chess('chess_ws_recon_chen3_a').tier, 7, '赤刃明霄陈 7 阶');
  assert.ok(m.gd.visibleChess.includes('chess_ws_recon_zuole_a'), '新增干员可进池');
  assert.equal(m.gd.visibleChess.some((id) => id.startsWith('recon_')), false, 'recon_* 永不直接进池');
  assert.equal(m.gd.chess('chess_char_6_06_a').tier, 5, '佩佩 → 5 阶');
  assert.equal(m.gd.chess('chess_char_2_06_a').price, 2, '莎草 → 2 资金');
  assert.ok(m.gd.chess('chess_ws_recon_narant_a'), '娜仁图亚进入重构对局的棋子表');
  assert.equal(m.gd.chess('chess_ws_recon_zumama_a').tier, 7, '森蚺 7 阶');
  assert.ok(m.gd.visibleChess.includes('chess_ws_recon_mantic_a'), '狮蝎可进池');
  assert.ok(m.gd.chess('chess_ws_recon_gdglow_a'), '澄闪进入重构对局的棋子表');
  assert.equal(m.gd.chess('chess_ws_recon_necras_a').tier, 7, '死芒 7 阶');
  assert.ok(m.gd.visibleChess.includes('chess_ws_recon_phatom_a'), '傀影可进池');
  assert.equal(m.gd.chess('chess_char_4_07_a').tier, 3, '风笛 → 3 阶');
  assert.ok(m.gd.token('token_10007_phatom_twin'), '镜中虚影在对局数据里');
  assert.ok(m.gd.token('token_10043_necras_skeltn'), '悲叹的仆役在对局数据里');
  assert.ok(m.gd.chess('chess_ws_recon_aurora_a'), '极光进入重构对局的棋子表');
  assert.equal(m.gd.chess('chess_ws_recon_courier_a').tier, 1, '讯使 1 阶');
  assert.equal(m.gd.chess('chess_char_3_11_a').tier, 2, '雪猎 → 2 阶');
  assert.equal(m.gd.chess('chess_char_6_02_a').tier, 7, '圣聆初雪 → 7 阶');
  assert.ok(m.gd.visibleChess.includes('chess_ws_recon_courier_a'), '讯使可进池');
  assert.ok(m.gd.chess('chess_ws_recon_phenxi_a'), '菲亚梅塔进入重构对局的棋子表');
  assert.ok(m.gd.visibleChess.includes('chess_ws_recon_spuria_a'), '空构可进池');
  assert.equal(m.gd.chess('chess_char_6_09_a').tier, 5, '塑心 → 5 阶');
  assert.equal(m.gd.chess('chess_char_6_01_a').tier, 7, '蕾缪安 → 7 阶');
  assert.ok(m.gd.chess('chess_ws_recon_vvana_a'), '薇薇安娜进入重构对局的棋子表');
  assert.equal(m.gd.chess('chess_ws_recon_platnm_a').tier, 3, '白金 3 阶');
  assert.ok(m.gd.visibleChess.includes('chess_ws_recon_platnm_a'), '白金可进池');
  assert.equal(m.gd.chess('chess_char_3_17_a').tier, 2, '流星 → 2 阶');
  assert.deepEqual(m.gd.chess('chess_char_3_17_a').bonds, ['kazimierzShip'], '流星移除独行');
  assert.equal(m.gd.chess('chess_char_5_19_a').tier, 7, '玛恩纳 → 7 阶');
  assert.equal(m.gd.chess('chess_char_4_20_a').tier, 3, '远牙 → 3 阶');
  assert.equal(m.gd.chess('chess_char_2_18_a').tier, 1, '灰毫 → 1 阶');
  assert.equal(m.gd.chess('chess_char_2_18_a').price, 2, '灰毫 → 2 资金');
  assert.ok(m.gd.chess('chess_ws_recon_demetr_a'), '贝洛内进入重构对局的棋子表');
  assert.ok(m.gd.visibleChess.includes('chess_ws_recon_judge_a'), '斥罪可进池');
  assert.equal(m.gd.chess('chess_ws_recon_judge_a').tier, 5, '斥罪 5 阶');
  assert.equal(m.gd.chess('chess_char_4_10_a').tier, 3, '阿罗玛 → 3 阶');
  assert.equal(m.gd.chess('chess_char_3_18_a').tier, 2, '忍冬 → 2 阶');
  assert.equal(m.gd.chess('chess_char_5_20_a').tier, 4, '安洁莉娜 → 4 阶');
  assert.equal(m.gd.chess('chess_char_3_19_a').tier, 3, '伺夜阶级不变');
  assert.ok(m.gd.token('token_10065_demetr_dmtpos'), '牵绊在对局数据里');
  assert.ok(m.gd.chess('chess_ws_recon_clemnt_a'), '克莱门莎进入重构对局的棋子表');
  assert.equal(m.gd.chess('chess_ws_recon_highmo_a').tier, 4, '海沫 4 阶');
  assert.ok(m.gd.visibleChess.includes('chess_ws_recon_deepcl_a'), '深海色可进池');
  assert.equal(m.gd.chess('chess_ws_recon_cuttle_a').tier, 2, '安哲拉 2 阶');
  assert.ok(m.gd.token('token_10001_deepcl_tentac'), '触手在对局数据里');

  const plain = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 7, fake: true, data: DATA });
  assert.equal(plain.m.reconChessAlias, null, '官方模式没有别名表');
  assert.equal(plain.m.gd.chess('chess_char_5_23_a').tier, 5, '官方模式仍是官方记录');
  assert.equal(plain.m.gd.chess('chess_char_6_06_a').tier, 6, '官方模式佩佩仍是 6 阶');
  assert.equal(plain.m.gd.chess('chess_ws_recon_zuole_a'), null, '官方模式读不到新增干员');
  assert.equal(plain.m.gd.chess('chess_ws_recon_narant_a'), null, '官方模式读不到娜仁图亚');
  assert.equal(plain.m.gd.chess('chess_ws_recon_platnm_a'), null, '官方模式读不到白金');
  assert.deepEqual(plain.m.gd.chess('chess_char_3_17_a').bonds, ['kazimierzShip', 'soloShip'], '官方流星仍有独行');
  assert.equal(plain.m.gd.chess('chess_char_2_18_a').tier, 2, '官方灰毫仍是 2 阶');
  assert.equal(plain.m.gd.chess('chess_ws_recon_demetr_a'), null, '官方模式读不到贝洛内');
  assert.equal(plain.m.gd.chess('chess_char_4_10_a').tier, 4, '官方阿罗玛仍是 4 阶');
  assert.equal(plain.m.gd.chess('chess_char_5_20_a').tier, 5, '官方安洁莉娜仍是 5 阶');
  assert.equal(plain.m.gd.chess('chess_ws_recon_clemnt_a'), null, '官方模式读不到克莱门莎');
  assert.equal(plain.m.gd.chess('chess_ws_recon_highmo_a'), null, '官方模式读不到海沫');
  assert.equal(plain.m.gd.chess('chess_ws_recon_cuttle_a'), null, '官方模式读不到安哲拉');
});

test('重构对局的战斗读别名后的棋子：新增干员能出场，覆盖干员用重构记录', () => {
  // 业主 2026-10-31「新增的干员战斗开始后模型消失」：`withGameData` 的别名只到内容作用域，单位自己的
  // `Battle.data.getChess` 仍读未别名的表 ⇒ `chess_ws_recon_*`（官方没有的 id）查不到，整名干员不出场；
  // 覆盖记录（星熊 …）则仍用官方数值。Battle 现在把棋盘表也换成同一份别名对象（shared/reconModes.js）。
  const added = ['chess_ws_recon_clemnt_a', 'chess_ws_recon_highmo_a', 'chess_ws_recon_deepcl_a', 'chess_ws_recon_cuttle_a'];
  const units = added.map((id, i) => ({ chessId: id, row: 10, col: 3 + i }));
  units.push({ chessId: 'chess_char_4_17_a', row: 11, col: 3 });
  const h = makeBattle({ modeId: 'mode_recon_abyss', data: DATA, autoFinish: false, units });
  h.runUntil(() => h.allies().length >= units.length, 30);
  for (const id of added) {
    const u = h.unit(id);
    assert.ok(u, `${id} 出场`);
    assert.equal(u.def.spine, DATA.chess[`recon_${id}`].assets.spine, `${id} 用包里的模型`);
  }
  assert.equal(h.unit('chess_char_4_17_a').def.tier, 3, '星熊·重构 3 阶（官方记录是 4 阶）');
});

test('官方模式（modeId 不是 mode_recon_*）一场都不别名：新增干员照旧不在场', () => {
  const h = makeBattle({ modeId: 'mode_multi_normal', data: DATA, autoFinish: false, units: [{ chessId: 'chess_ws_recon_clemnt_a', row: 10, col: 3 }] });
  h.runUntil(() => h.allies().length >= 1, 30);
  assert.equal(h.allies().length, 0, '官方对局读不到包里的新增干员');
});

test('深海色·重构：售出时获得 1 件（精锐 2 件）随机 2 阶装备', async () => {
  const registry = await reconRegistry();
  const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seed: 12, fake: true, data: DATA, registry });
  const m = h.m;
  m.phase = PHASE.PREP;
  m.round = 1;
  const ps = m.players.get('p_0');

  ps.hand.fill(null);
  ps.temp.fill(null);
  const sold = give(m, ps, 'chess_ws_recon_deepcl_a', 'hand');
  assert.ok(ps.sell(sold.uid).ok, '售出成功');
  const items = handItems(ps);
  assert.equal(items.length, 1, '普通：1 件');
  assert.equal(DATA.items[items[0]].tier, 2, '随机 2 阶装备');

  ps.hand.fill(null);
  ps.temp.fill(null);
  const sold2 = give(m, ps, 'chess_ws_recon_deepcl_b', 'hand');
  assert.ok(ps.sell(sold2.uid).ok, '售出成功（精锐）');
  const items2 = handItems(ps);
  // 两件同一件装备在手里会自动合并为进阶（引擎的装备合并规则）：进阶件算 2 份
  const copies = items2.reduce((n, id) => n + (id.endsWith('_b') ? 2 : 1), 0);
  assert.equal(copies, 2, '精锐：2 件');
  assert.ok(items2.every((id) => DATA.items[id].tier === 2), '两件都是 2 阶装备');
  m.dispose();
});

test('安哲拉·重构：进入休整期把阶级最低的装备替换成三选一（精锐只换 1 件）', async () => {
  const registry = await reconRegistry();
  const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seed: 13, fake: true, data: DATA, registry });
  const m = h.m;
  m.phase = PHASE.PREP;
  m.round = 1;
  const ps = m.players.get('p_0');
  const DROPS = ['chess_item_3_07_e_a', 'chess_item_5_08_e_a', 'chess_item_6_04_e_a'];
  const isDrop = (id) => DROPS.includes(id) || DROPS.includes(id.replace(/_b$/, '_a'));
  const clear = () => {
    ps.hand.fill(null);
    ps.temp.fill(null);
    for (const p of ps.board.values()) if (p && p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear();
  };
  const equipTwo = (chessId) => {
    clear();
    const piece = give(m, ps, chessId, 'board', [10, 3]);
    const low = giveItem(m, ps, 'chess_item_1_01_e_a'); // 1 阶
    const high = giveItem(m, ps, 'chess_item_2_01_e_a'); // 2 阶
    assert.ok(ps.equip(low.uid, piece.uid).ok);
    assert.ok(ps.equip(high.uid, piece.uid).ok);
    return piece;
  };

  const normal = equipTwo('chess_ws_recon_cuttle_a');
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  const ids = normal.items.map((it) => it.id);
  assert.ok(ids.every(isDrop), '两件都替换成三件之一');
  assert.equal(ids.includes('chess_item_1_01_e_a'), false, '最低阶那件被替换');
  assert.equal(ids.includes('chess_item_2_01_e_a'), false, '普通：两件都被替换');

  const elite = equipTwo('chess_ws_recon_cuttle_b');
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  const ids2 = elite.items.map((it) => it.id);
  assert.ok(ids2.includes('chess_item_2_01_e_a'), '精锐：高阶那件保留');
  assert.equal(ids2.includes('chess_item_1_01_e_a'), false, '最低阶那件被替换');
  assert.equal(elite.items.length, 2, '仍然两件（新件已装上）');
  assert.equal(ids2.filter(isDrop).length, 1, '只替换 1 件');
  m.dispose();
});

test('左乐·重构：进入休整期给 1 件天师古鼎（精锐再加 1 件炎国短刀）', () => {
  const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seed: 8, fake: true, data: DATA });
  const m = h.m;
  m.phase = PHASE.PREP;
  m.round = 1;
  const ps = m.players.get('p_0');
  ps.hand.fill(null);
  ps.temp.fill(null);
  for (const p of ps.board.values()) if (p && p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();

  give(m, ps, 'chess_ws_recon_zuole_a', 'board', [10, 3]);
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.deepEqual(handItems(ps), ['chess_item_6_03_e_a'], '普通：1 件天师古鼎');

  ps.hand.fill(null);
  ps.temp.fill(null);
  for (const p of ps.board.values()) if (p && p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  give(m, ps, 'chess_ws_recon_zuole_b', 'board', [10, 3]);
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.deepEqual(handItems(ps).sort(), ['chess_item_3_04_e_a', 'chess_item_6_03_e_a'], '精锐：天师古鼎 + 炎国短刀');
  m.dispose();
});

test('森蚺 / 狮蝎·重构：进入休整期按战斗侧标记发黄沙罗盘 / 盟约之币', async () => {
  const registry = await reconRegistry();
  const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seed: 9, fake: true, data: DATA, registry });
  const m = h.m;
  m.phase = PHASE.PREP;
  m.round = 1;
  const ps = m.players.get('p_0');
  const clear = () => {
    ps.hand.fill(null);
    ps.temp.fill(null);
    for (const p of ps.board.values()) if (p && p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear();
  };

  clear();
  give(m, ps, 'chess_ws_recon_zumama_a', 'board', [10, 3]);
  ps.marks = { reconSargonCasts: 20 };
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.deepEqual(handItems(ps), ['chess_item_6_07_e_a'], '≥20 次：1 件黄沙罗盘');

  clear();
  give(m, ps, 'chess_ws_recon_zumama_b', 'board', [10, 3]);
  ps.marks = { reconSargonCasts: 19 };
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.deepEqual(handItems(ps), [], '不到 20 次：没有');

  clear();
  give(m, ps, 'chess_ws_recon_mantic_a', 'board', [10, 3]);
  ps.marks = { reconStealthHolders: 3 };
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  // 两件同一件装备在手里会自动合并为进阶品质（引擎的装备合并规则）：2 件普通 ⇒ 1 件进阶
  assert.deepEqual(handItems(ps), ['chess_item_1_03_e_b'], '普通：最多 2 件盟约之币（合并为进阶）');

  clear();
  give(m, ps, 'chess_ws_recon_mantic_b', 'board', [10, 3]);
  ps.marks = { reconStealthHolders: 9 };
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.deepEqual(handItems(ps).sort(), ['chess_item_1_03_e_b', 'chess_item_1_03_e_b'], '精锐：最多 4 件（两件进阶）');
  m.dispose();
});

test('贝洛内 / 伺夜·重构：对方在场且携带叙拉古正装 ⇒ 各自发 1 件（精锐 2 件）', async () => {
  const registry = await reconRegistry();
  const h = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seed: 11, fake: true, data: DATA, registry });
  const m = h.m;
  m.phase = PHASE.PREP;
  m.round = 1;
  const ps = m.players.get('p_0');
  const clear = () => {
    ps.hand.fill(null);
    ps.temp.fill(null);
    for (const p of ps.board.values()) if (p && p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear();
  };
  const suitOn = (piece) => { piece.items.push(ps.newPiece('item', 'chess_item_3_01_e_a')); };

  clear();
  const dm = give(m, ps, 'chess_ws_recon_demetr_a', 'board', [10, 3]);
  const vg = give(m, ps, 'chess_char_3_19_a', 'board', [11, 3]);
  suitOn(dm);
  suitOn(vg);
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  // 发到手里的正装会和「已穿在身上」的同种普通件合并成进阶（引擎的装备合并：手里与身上的同种件都算），
  // 所以这一件显示成 `_b`，另一侧（伺夜）身上那件被这次合并吃掉。
  assert.deepEqual(handItems(ps).sort(), ['chess_item_3_01_e_b', 'chess_item_6_11_e_a'], '双方各 1 件');

  clear();
  const dm2 = give(m, ps, 'chess_ws_recon_demetr_b', 'board', [10, 3]);
  const vg2 = give(m, ps, 'chess_char_3_19_b', 'board', [11, 3]);
  suitOn(dm2);
  suitOn(vg2);
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  // 精锐各发 2 件：两件都与身上那件普通件合并 → 两份进阶；徽章两件在手里合并为 1 件进阶
  assert.deepEqual(handItems(ps).sort(), ['chess_item_3_01_e_b', 'chess_item_3_01_e_b', 'chess_item_6_11_e_b'], '精锐各 2 件（合并为进阶）');

  clear();
  const dm3 = give(m, ps, 'chess_ws_recon_demetr_a', 'board', [10, 3]);
  give(m, ps, 'chess_char_3_19_a', 'board', [11, 3]);
  suitOn(dm3); // 贝洛内带正装、伺夜不带 ⇒ 只有伺夜那条满足
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.deepEqual(handItems(ps).sort(), ['chess_item_6_11_e_a'], '只满足一侧 ⇒ 只发一件');

  clear();
  const dm4 = give(m, ps, 'chess_ws_recon_demetr_a', 'hand');
  give(m, ps, 'chess_char_3_19_a', 'board', [11, 3]);
  suitOn(dm4); // 贝洛内不在场（在手里）⇒ 伺夜那条不满足；伺夜没带正装 ⇒ 贝洛内那条也不满足
  m.dispatch(ps, 'onRoundStart', { round: m.round });
  assert.deepEqual(handItems(ps), [], '对方不在场 ⇒ 不发');
  m.dispose();
});

test('干员调配：recon_* 的条目在重构对局里落到正式棋子 id，官方模式不做别名', () => {
  const loadout = {
    recon_chess_char_5_23_a: { skill: 0 },
    recon_chess_ws_recon_zuole_a: { skill: 0 },
  };
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, loadout }];

  const recon = makeMatch({ mode: 'recon', modeId: 'mode_recon_abyss', seed: 3, fake: true, data: DATA, seats });
  const ps = recon.m.players.get('p_0');
  assert.equal(ps.loadout['chess_char_5_23_a']?.skill, 0, '录武官的条目落到官方 id');
  assert.equal(ps.loadout['chess_ws_recon_zuole_a']?.skill, 0, '新增干员的条目落到去掉前缀的 id');
  assert.equal(Object.hasOwn(ps.loadout, 'recon_chess_char_5_23_a'), false, '原名不留在调配里');

  const plain = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seed: 3, fake: true, data: DATA, seats });
  const ps2 = plain.m.players.get('p_0');
  assert.equal(Object.hasOwn(ps2.loadout, 'recon_chess_char_5_23_a'), true, '官方模式原样保留（这些记录在合并数据里也合法）');
});
