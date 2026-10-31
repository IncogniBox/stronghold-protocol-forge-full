// test/packMetaBuiltin.test.js — 仓库里**全部内置包**的 server.meta / server.battle 装配（DESIGN §29）。
//
// 为什么单开一份：受限注册表（server/match/metaPack.js）把 pack.json 的 `server.meta.registers` 当白名单 ——
// `registerMeta()` 里注册一个没声明的键就抛 `META_UNDECLARED_KEY`，并且**这次装配注册过的键一并回滚**。
// 这条规则是对的（不然一个包能悄悄顶掉官方的处理器），但它让「包自己声明漏了键」的表现完全静默：包照常进房，
// 只是它的**全部**休整期处理器都不在。这件事真的发生过（2026-11-01：mode-recon 新增的骑士储蓄罐与两条
// garrison 没声明 ⇒ 整包 meta 回滚 ⇒ 重构决策弹窗消失）。这一份把全部内置包按房间那条路装一遍，
// 任何一条这样的声明错误都在 CI 里被点名，而不是等玩家发现。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packLayer } from './helpers/packLayer.js';

test('every built-in pack assembles its server modules without a single error', async () => {
  const layer = await packLayer({});
  assert.ok(layer.loaded.packs.length >= 5, 'the repository ships its built-in packs');
  assert.deepEqual(layer.errors, [], 'no built-in pack may ship a server.meta / server.battle declaration the engine refuses');
  // 重构模拟的整个休整期一半都挂在这个全局钩子上（重构决策 / 重构协助 / 熔芯负载 / 新增干员的休整期规则…）
  const globals = [...layer.registry.globals()].map(([key]) => key);
  assert.ok(globals.includes('global:recon'), 'mode-recon 的 meta 模块注册上了');
});
