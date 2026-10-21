// test/render/fxwater.test.js — 多索雷斯「特殊水地形」与假日威龙陈粘液的**绘制口径**：
// 两者都是常驻地块底色（`overlay`）：同一 `key` 原地替换（不叠加、不闪），水地形比原先暗一档。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxSystem, FX_KINDS } from '../../public/js/render/fx.js';
import { presetCamera } from '../../public/js/render/projection.js';

test('dosWater 走 overlay：不闪、同 key 原地替换、水地形更暗', () => {
  assert.equal(FX_KINDS.dosWater.a, 'overlay', '不再是会脉动的 telegraph');
  assert.ok(FX_KINDS.dosWater.alpha <= 0.12, `水地形要暗：${FX_KINDS.dosWater.alpha}`);

  const calls = [];
  const cam = presetCamera('normal', { width: 1280, height: 720 });
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, {
    ctx: { cam: () => cam, heightAt: () => 0, fieldRect: () => null, timeScale: () => 2 },
    _p: { x: 0, y: 0, s: 0, depth: 0 }, _q: { x: 0, y: 0, s: 0, depth: 0 },
    tileFlash: (...args) => calls.push(args),
    zone() {},
  });
  fx.simFx('dosWater', 0, 0, { r: 1, tiles: [[10, 4], [10, 5]], n: 2, dur: 1.2, key: 'dosWater' });
  assert.deepEqual(calls[0][0], [[10, 4], [10, 5]], '显式地块表原样送进 tileFlash');
  assert.equal(calls[0][1], FX_KINDS.dosWater.c);
  assert.equal(calls[0][5], 'dosWater', '带 key');
  assert.equal(calls[0][6], true, 'steady');
  assert.equal(calls[0][7], FX_KINDS.dosWater.alpha, '透明度固定');

  const sys = Object.create(FxSystem.prototype);
  sys.tileFlashes = [];
  sys.tileFlash([[1, 1]], 0x123456, 1.2, false, null, 'dosWater', true, 0.1);
  sys.tileFlash([[2, 2]], 0x123456, 1.2, false, null, 'dosWater', true, 0.1);
  assert.equal(sys.tileFlashes.length, 1, '同一个 key 只剩一份（不叠加 ⇒ 不会越铺越亮）');
  assert.deepEqual(sys.tileFlashes[0].tiles, [[2, 2]], '后一次原地替换');
});
