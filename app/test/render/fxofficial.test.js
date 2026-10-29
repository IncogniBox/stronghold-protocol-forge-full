// test/render/fxofficial.test.js — `official` fx 种类：战斗逻辑**按名字点名**的一枚官方 prefab。
//
// 业主 2026-10-28：重构模拟的“不死的黑蛇”·不息恶火（官方全屏火雨 `screen_bsnake`）在实机里根本没画出来 —— 客户端
// 此前没有任何「按 key 起一枚 prefab」的 sim-fx 入口（官方的全屏效果只能由引擎自己写死 key，如 `_qiOfficial`）。
// `official` 就是这条通道：`{ key, holdS }` ⇒ 官方特效层起一枚、撑满 `holdS` 战斗秒再收；同一个 `(id, key)` 只有
// 一枚（事件再来只推窗口，重放 / 追帧不会叠出第二份）；官方特效关着 / 没有这枚 prefab 时什么都不画。
//
// 不引 PIXI：`FxSystem.prototype` 的方法容器 + 一个假 `ofx`（同 fxwater.test.js 的做法）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FxSystem, FX_KINDS, fxSpec } from '../../public/js/render/fx.js';
import { presetCamera } from '../../public/js/render/projection.js';

const cam = presetCamera('normal', { width: 1280, height: 720 });

/** 一个只有 `official` 这条路径会用到的 ctx：假 `ofx` 收集 spawn / stop。 */
function sys(over = {}) {
  const spawns = [], stops = [];
  const ofx = {
    active: true,
    lib: { has: (k) => String(k).toLowerCase() === 'screen_bsnake' },
    spawn(key, place, opts) {
      const h = { key, place, opts, alive: true, stop() { h.alive = false; stops.push(key); } };
      spawns.push(h);
      return h;
    },
    ...over,
  };
  const fx = Object.create(FxSystem.prototype);
  Object.assign(fx, {
    time: 0,
    ctx: { cam: () => cam, heightAt: () => 0, timeScale: () => 2, ofx },
    _p: { x: 0, y: 0, s: 0, depth: 0 }, _q: { x: 0, y: 0, s: 0, depth: 0 },
  });
  return { fx, spawns, stops };
}

test('official: 按 extra.key 起一枚官方 prefab，坐标走战斗帧换算（x−10, y−9, −z）', () => {
  assert.equal(FX_KINDS.official.a, 'official');
  assert.equal(fxSpec('official').pt, true, '全屏 prefab 画在事件给的点上，不吸附到 extra.id 那只单位');
  const { fx, spawns } = sys();
  fx.simFx('official', 10, 9, { key: 'screen_bsnake', holdS: 10.6, id: 7 });
  assert.equal(spawns.length, 1, '起了一枚');
  assert.equal(spawns[0].key, 'screen_bsnake');
  const pos = spawns[0].place.pos;
  assert.ok(pos[0] === 0 && pos[1] === 0 && Math.abs(pos[2]) === 0, `地块 (10,9) = 战斗帧原点（${pos}）`);
  assert.equal(spawns[0].opts.loop, true, '撑满窗口的循环实例');
  assert.equal(spawns[0].opts.important, true, '不占普通实例预算');
});

test('official: 同一个 (id, key) 只有一枚 —— 事件再来只把窗口往后推', () => {
  const { fx, spawns } = sys();
  fx.simFx('official', 10, 9, { key: 'screen_bsnake', holdS: 5, id: 7 });
  fx.time = 4;
  fx.simFx('official', 10, 9, { key: 'screen_bsnake', holdS: 5, id: 7 });
  assert.equal(spawns.length, 1, '没有叠出第二份');
  // 另一个持有者（另一只首领）是另一枚
  fx.simFx('official', 10, 9, { key: 'screen_bsnake', holdS: 5, id: 8 });
  assert.equal(spawns.length, 2);
});

test('official: 窗口（holdS）走完由 track 收掉', () => {
  const { fx, spawns, stops } = sys();
  fx.simFx('official', 10, 9, { key: 'screen_bsnake', holdS: 5, id: 7 });
  fx.time = 4.9;
  spawns[0].opts.track();
  assert.deepEqual(stops, [], '窗口内不收');
  fx.time = 5.1;
  spawns[0].opts.track();
  assert.deepEqual(stops, ['screen_bsnake'], '过长即收');
});

test('official: 官方特效关着 / 没有这枚 prefab ⇒ 什么都不画', () => {
  const off = sys({ active: false });
  off.fx.simFx('official', 10, 9, { key: 'screen_bsnake', holdS: 5 });
  assert.equal(off.spawns.length, 0, '设置关着');
  const gone = sys({ lib: { has: () => false } });
  gone.fx.simFx('official', 10, 9, { key: 'screen_bsnake', holdS: 5 });
  assert.equal(gone.spawns.length, 0, 'prefab 不在特效库里');
});
