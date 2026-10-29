// test/recon-wave-templates.test.js — 重构模拟的 19 张出怪模板与涤墨固定表（业主 2026-10-27 / 2026-10-29）。
//
// 口径：
//   * R1–R19 的模板 id 是 `recon_rNN`（工坊包 mode-recon 的 waves.json），计划数 `totalCount` = RECON_CURVE[r].count；
//   * 涤墨每局必选，6 个固定回合 [2,5,7,10,13,17]；
//   * 这 6 张模板**直接写涤墨键与数量**（业主 2026-10-29 的固定出怪表，不走占位符替换、也不走 `replacedCount`）；
//   * 其它 13 张仍是官方占位符模板（按本局抽到的类型替换）。
//
// 跑法：node --test test/recon-wave-templates.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameData } from '../server/match/gamedata.js';
import { setupMatchWaves, buildNormalWave } from '../server/match/waves.js';
import { createRng } from '../server/sim/rng.js';
import { deriveCounts, validateWave, waveErrors } from '../shared/waveAuthoring.js';
import { RECON_CURVE, RECON_FACTION_SETUP, reconModeFor, reconTemplateId } from '../shared/reconModes.js';
import { DATA } from './match/harness.js';

const WAVES = JSON.parse(fs.readFileSync(new URL('../workshop/mode-recon/waves.json', import.meta.url), 'utf8'));
const OFFICIAL = JSON.parse(fs.readFileSync(new URL('../data/waves.json', import.meta.url), 'utf8'));
const CONFIG = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const MODES = CONFIG.modes ?? CONFIG.config?.modes ?? CONFIG;

const DIMO_ROUNDS = RECON_FACTION_SETUP.fixedRounds.DIMO;
const reconGd = () => new GameData(DATA, 'mode_recon_abyss');

/**
 * 业主 2026-10-29 给的固定出怪表（回合 → { 键: 数量 }）。模板里写的就是这张表，所以这里逐条对照。
 * 名字 → 键：操戈 `enemy_10164_tjgxb` / 操戈·凌 `…_2`、挽弓 `enemy_10165_tjggb` / ·鸣 `…_2`、
 * 霜劫 `enemy_10170_wangz`、拔山 `enemy_10166_tjgdlb` / ·盖 `…_2`、挟潮·来 `enemy_10167_tjgsfj_2`、
 * 浪里玄条 `enemy_10168_tjgly` / ·锈 `…_2`、云中墨贼 `enemy_10169_tjgtsz` / ·蚀 `…_2`、
 * 旺财 `enemy_10058_cjfrog` / 招财 `…_2`、“果腹” `enemy_10052_cjshld` / “饱食” `…_2`、飘香 `enemy_10054_cjhot_2`。
 */
const DIMO_TABLE = {
  2: { enemy_10164_tjgxb: 5, enemy_10165_tjggb: 2, enemy_10170_wangz: 1 },
  5: { enemy_10164_tjgxb: 6, enemy_10167_tjgsfj_2: 2, enemy_10169_tjgtsz: 4, enemy_10166_tjgdlb: 2 },
  7: {
    enemy_10164_tjgxb_2: 4, enemy_10165_tjggb_2: 4, enemy_10167_tjgsfj_2: 4,
    enemy_10168_tjgly: 2, enemy_10052_cjshld: 1,
  },
  10: {
    enemy_10052_cjshld: 2, enemy_10168_tjgly: 2, enemy_10169_tjgtsz_2: 4,
    enemy_10167_tjgsfj_2: 8, enemy_10058_cjfrog: 2,
  },
  13: {
    enemy_10164_tjgxb_2: 10, enemy_10165_tjggb_2: 8, enemy_10167_tjgsfj_2: 6, enemy_10166_tjgdlb_2: 6,
    enemy_10052_cjshld_2: 8, enemy_10169_tjgtsz_2: 6, enemy_10168_tjgly_2: 4, enemy_10058_cjfrog_2: 4,
  },
  17: {
    enemy_10054_cjhot_2: 4, enemy_10167_tjgsfj_2: 10, enemy_10166_tjgdlb_2: 6,
    enemy_10168_tjgly_2: 12, enemy_10058_cjfrog_2: 8, enemy_10052_cjshld_2: 4,
  },
};

/** 本局数据里真正可用的涤墨键（包缺记录的不算）。 */
function dimoUsable(gd) {
  const pool = gd.factions.types?.DIMO?.pool ?? [];
  return pool.filter((k) => typeof k === 'string' && gd.enemy(k)).sort();
}

test('19 张模板：id/templateId 一致，推导量自洽，计划数命中曲线', () => {
  assert.equal(Object.keys(WAVES).length, 19);
  const officialIds = Object.keys(OFFICIAL);
  const knownEnemyKeys = Object.keys(DATA.enemies);
  for (let r = 1; r <= 19; r++) {
    const id = reconTemplateId(r);
    const rec = WAVES[id];
    assert.ok(rec, `${id} 存在`);
    assert.equal(rec.id, id, `${id}.id`);
    assert.equal(rec.templateId, id, `${id}.templateId`);
    assert.equal(rec.kind, 'normal');
    const got = deriveCounts(rec.spawns);
    assert.equal(rec.totalCount, got.totalCount, `${id} totalCount`);
    assert.deepEqual(rec.slotCounts, got.slotCounts, `${id} slotCounts`);
    assert.equal(rec.totalCount, RECON_CURVE[r].count, `${id} 计划出场数 = 曲线`);
    assert.deepEqual(waveErrors(validateWave(rec, { id, officialIds, knownEnemyKeys })), [], `${id} 校验`);
  }
});

test('模式接线：R1–R19 指向 recon_rNN，首领 / 隐秘仍用官方模板族', () => {
  const mode = reconModeFor('abyss', MODES);
  assert.ok(mode);
  for (let r = 1; r <= 19; r++) {
    assert.equal(mode.rounds[r].template, reconTemplateId(r), `R${r}`);
    assert.equal(typeof mode.rounds[r].templateFallback, 'string', `R${r} 有官方回退`);
    assert.match(mode.rounds[r].templateFallback, /^act1autochess_/, `R${r} 回退指向官方模板`);
  }
  assert.match(JSON.stringify(mode.rounds[20].bossTemplates), /act1autochess_h07_/);
  assert.match(JSON.stringify(mode.rounds[21].bossTemplates), /act1autochess_h08_/);
  assert.deepEqual(mode.factionSetup, RECON_FACTION_SETUP);
});

test('21 回合排程：涤墨必选且固定在 [2,5,7,10,13,17]，另两类型各 3、其余 SPECIAL', () => {
  const gd = reconGd();
  for (let seed = 1; seed <= 20; seed++) {
    const s = setupMatchWaves(gd, createRng(seed));
    assert.equal(s.typeSlots.length, 21, `seed ${seed}`);
    assert.ok(s.factions.includes('DIMO'), `seed ${seed}: 涤墨必选`);
    assert.deepEqual(s.typeSlots.map((t, i) => (t === 'DIMO' ? i + 1 : 0)).filter(Boolean), DIMO_ROUNDS, `seed ${seed}: 涤墨回合`);
    for (const t of s.factions) if (t !== 'DIMO') assert.equal(s.typeSlots.filter((x) => x === t).length, 3, `seed ${seed}: ${t}`);
    assert.equal(s.typeSlots.filter((x) => x === 'SPECIAL').length, 21 - 6 - 6, `seed ${seed}: SPECIAL`);
    for (let r = 1; r <= 21; r++) assert.ok(s.picks[r], `seed ${seed}: R${r} 有 pick`);
  }
});

test('涤墨 6 回合：出怪就是业主的固定表（键 + 数量逐条对得上，且只出涤墨）', () => {
  const gd = reconGd();
  const usable = new Set(dimoUsable(gd));
  assert.equal(usable.size, 18, `可用涤墨记录 ${usable.size}`);
  const s = setupMatchWaves(gd, createRng(1));
  const byKey = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  let matchUnits = 0;
  for (const r of DIMO_ROUNDS) {
    assert.equal(s.picks[r].type, 'DIMO', `R${r} 的 pick 是本回合的涤墨`);
    const w = buildNormalWave(gd, createRng(1), s.factions, r);
    assert.equal(w.templateId, reconTemplateId(r), `R${r} 模板`);
    const got = new Map();
    for (const sp of w.spawns) {
      assert.ok(usable.has(sp.enemyKey), `R${r} 的 ${sp.enemyKey} 是可用涤墨`);
      got.set(sp.enemyKey, (got.get(sp.enemyKey) ?? 0) + sp.count);
    }
    const want = new Map(Object.entries(DIMO_TABLE[r]));
    assert.deepEqual([...got].sort(byKey), [...want].sort(byKey), `R${r} 出怪表`);
    const total = [...want.values()].reduce((a, n) => a + n, 0);
    assert.equal(WAVES[reconTemplateId(r)].totalCount, total, `R${r} 模板 totalCount`);
    assert.equal(RECON_CURVE[r].count, total, `R${r} 曲线计划数`);
    matchUnits += total;
  }
  // 业主的表一局合计 151 个涤墨单位（8 + 14 + 15 + 18 + 52 + 44）
  assert.equal(matchUnits, 151, '一局涤墨单位合计');
});

test('降级：涤墨敌人记录缺席时不崩、不刷未定义键', () => {
  const enemies = { ...DATA.enemies };
  for (const key of DATA.factions.types.DIMO.pool) delete enemies[key];
  const gd = new GameData({ ...DATA, enemies }, 'mode_recon_abyss');
  const s = setupMatchWaves(gd, createRng(1));
  for (const r of [1, 2, 5, 7, 10, 13, 17, 19]) {
    const w = buildNormalWave(gd, createRng(1), s.factions, r);
    for (const sp of w.spawns) assert.ok(gd.enemy(sp.enemyKey), `R${r} 的 ${sp.enemyKey} 存在`);
  }
});
