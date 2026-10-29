// test/match/reconChannel.test.js — 重构模拟的跨战斗共享状态通道（server/match/match/reconChannel.js）。
//
// 覆盖口径：
//   * 池：`damage` 扣到 0 就不再扣、见底广播 `<key>Down`；`heal` 不超过 maxHp；
//   * 分区：`areaOf` 缺省第 1 块；
//   * 事件：`emit` 广播给每块战场，`drain` 取走后清空；`area` 限定时只投给那一块。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReconChannel } from '../../server/match/match/reconChannel.js';

test('池：damage 见底广播、之后不再扣；heal 封顶', () => {
  const ch = new ReconChannel({ pools: { ama: { maxHp: 1000 }, core: { maxHp: 500 } } });
  assert.equal(ch.pool('ama').hp, 1000);
  assert.equal(ch.damage('ama', 300), 300);
  assert.equal(ch.pool('ama').hp, 700);
  assert.equal(ch.damage('ama', 900), 700, '见底只扣剩下的');
  assert.equal(ch.pool('ama').hp, 0);
  assert.equal(ch.damage('ama', 100), 0, '空池不再扣');
  assert.equal(ch.heal('ama', 400), 400);
  assert.equal(ch.heal('ama', 700), 600, '封顶到 maxHp');
  assert.equal(ch.damage('core', 100), 100);
  assert.equal(ch.pool('core').hp, 400);
});

test('池见底会广播 <key>Down（每块战场都能收到）', () => {
  const ch = new ReconChannel({ areas: { p0: 0, p1: 1 }, pools: { core: { maxHp: 100 } } });
  assert.equal(ch.damage('core', 100), 100);
  assert.deepEqual(ch.drain(0).map((e) => e.kind), ['coreDown']);
  assert.deepEqual(ch.drain(1).map((e) => e.kind), ['coreDown']);
  assert.deepEqual(ch.drain(0), [], '取走后清空');
});

test('分区与定向事件：area 限定时只投给那一块', () => {
  const ch = new ReconChannel({ areas: { p0: 0, p1: 1, p2: 2 } });
  assert.equal(ch.areaOf('p0'), 0);
  assert.equal(ch.areaOf('p2'), 2);
  assert.equal(ch.areaOf('nobody'), 0, '缺省第 1 块');
  ch.emit('endFake');
  ch.emit('coreReward', { n: 1 }, 2);
  assert.deepEqual(ch.drain(0).map((e) => e.kind), ['endFake']);
  assert.deepEqual(ch.drain(1).map((e) => e.kind), ['endFake']);
  assert.deepEqual(ch.drain(2).map((e) => e.kind), ['endFake', 'coreReward'], '第 3 块额外收到定向事件');
});
