// test/recon-curve.test.js — 重构模拟的难度曲线与「只保留终极难度」（业主 2026-10-27）。
//
// 曲线只服务本模式：`mode_recon_abyss` 的敌 hp/atk、战斗时限、休整、SP 全部来自 `shared/reconModes.js` 的
// `RECON_CURVE`；官方四档 `mode_multi_*` 一个字节都不动；其它三档重构模式不再合成。
//
// 跑法：node --test test/recon-curve.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RECON_CURVE, RECON_DIFFICULTY, reconModeFor, modeWithRecon, ensureReconModes } from '../shared/reconModes.js';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const MODES = CONFIG.modes ?? CONFIG.config?.modes ?? CONFIG;

test('只保留终极难度：其它三档不再合成', () => {
  assert.equal(RECON_DIFFICULTY, 'abyss');
  for (const d of ['funny', 'normal', 'hard', 'abyss']) {
    const mode = reconModeFor(d, MODES);
    if (d === 'abyss') assert.ok(mode && mode.modeId === 'mode_recon_abyss', 'abyss 合成');
    else assert.equal(mode, null, `${d} 已移除`);
  }
  assert.equal(modeWithRecon('mode_recon_abyss', MODES)?.modeId, 'mode_recon_abyss');
  for (const id of ['mode_recon_funny', 'mode_recon_normal', 'mode_recon_hard']) {
    assert.equal(modeWithRecon(id, MODES), null, `${id} 查无此模式`);
  }
  const cfg = { modes: { ...MODES } };
  ensureReconModes(cfg);
  assert.deepEqual(Object.keys(cfg.modes).filter((k) => k.startsWith('mode_recon_')).sort(), ['mode_recon_abyss']);
});

test('曲线逐回合生效：hp / atk / 战斗时限 / 休整 / SP', () => {
  const mode = reconModeFor('abyss', MODES);
  assert.ok(mode);
  for (let r = 1; r <= 21; r++) {
    const cur = RECON_CURVE[r];
    assert.ok(cur, `R${r} 有曲线`);
    assert.deepEqual(mode.enemyScale[r], { hp: cur.hp, atk: cur.atk, speed: 1 }, `R${r} 数值倍率`);
    assert.equal(mode.rounds[r].prepTime, cur.prep, `R${r} 休整`);
    assert.equal(mode.rounds[r].isSpPrepare, cur.sp, `R${r} SP`);
    assert.equal(mode.rounds[r].levelMaxPlayTime, cur.time, `R${r} 关卡时限`);
    if (r === 20 || r === 21) {
      assert.equal(mode.rounds[r].combatTimeLimit, null, `R${r}（首领 / 隐秘）没有战斗时限`);
      assert.equal(mode.combatTimeLimit[r], null);
    } else {
      assert.equal(mode.rounds[r].combatTimeLimit, cur.time, `R${r} 战斗时限`);
      assert.equal(mode.combatTimeLimit[r], cur.time);
    }
  }
  // 业主 2026-10-28：先把所有回合的 SP 选择移除（机变机制保留，等「重构决策」的效果）
  assert.deepEqual(mode.spRounds, []);
  assert.equal(mode.lastRound, 20);
  assert.equal(mode.bossRound, 20);
  assert.equal(mode.hiddenRound, 21);
  assert.equal(mode.rounds[20].isHidden, false, 'R20 是明首领');
  assert.equal(mode.rounds[21].isHidden, true, 'R21 是隐秘核心');
  // 关键点抽查（业主原文）
  assert.deepEqual([mode.enemyScale[1].hp, mode.enemyScale[1].atk, mode.combatTimeLimit[1], mode.rounds[1].prepTime], [1.2, 1.2, 60, 80]);
  assert.deepEqual([mode.enemyScale[13].hp, mode.enemyScale[13].atk, mode.combatTimeLimit[13], mode.rounds[13].prepTime], [9.1, 2.6, 150, 180]);
  assert.deepEqual([mode.enemyScale[19].hp, mode.enemyScale[19].atk, mode.combatTimeLimit[19], mode.rounds[19].prepTime], [16.8, 4.3, 180, 200]);
  assert.deepEqual([mode.enemyScale[20].hp, mode.enemyScale[20].atk, mode.rounds[20].levelMaxPlayTime], [18.4, 4.6, 210]);
  assert.deepEqual([mode.enemyScale[21].hp, mode.enemyScale[21].atk, mode.rounds[21].levelMaxPlayTime], [20, 5, 240]);
});

test('官方四档一个字节都不动（曲线只活在重构模式里）', () => {
  const before = JSON.stringify(['mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss'].map((k) => MODES[k]));
  reconModeFor('abyss', MODES);
  ensureReconModes({ modes: { ...MODES } });
  const after = JSON.stringify(['mode_multi_funny', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss'].map((k) => MODES[k]));
  assert.equal(after, before);
  // 官方 abyss 自己的数值仍是原表的那一份（重构的 R1 是 1.2/1.2，官方 abyss 是 1.2/1.1）
  assert.notDeepEqual(
    { hp: MODES.mode_multi_abyss.enemyScale['1'].hp, atk: MODES.mode_multi_abyss.enemyScale['1'].atk },
    { hp: RECON_CURVE[1].hp, atk: RECON_CURVE[1].atk },
  );
});
