// test/render/boardwarmup.test.js — render/boardWarmup.js：棋盘素材预热是幂等的、可失败的、纯可选的。
//
// 进对局的棋盘下载（render/app.js createFieldView）太晚，预热在房间界面（screens/room.js）就开始。
// 这里锁住它的三条契约：整页只跑一次；失败绝不让界面出错；reset 之后可以再来一次。

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { warmBoard, resetBoardWarmup } from '../../public/js/render/boardWarmup.js';

/** A store shaped like public/js/assets.js (the warm-up only uses local / localUrl / image). */
const fakeStore = (over = {}) => ({
  local: async () => ({ groups: {} }),
  localUrl: () => null,
  image: async () => null,
  ...over,
});

describe('board warm-up (render/boardWarmup.js)', () => {
  beforeEach(() => resetBoardWarmup());

  test('a host without the board art: resolves and warms only once per page', async () => {
    let localCalls = 0;
    const store = fakeStore({ local: async () => { localCalls++; return { groups: {} }; } });
    const p = warmBoard(store);
    assert.equal(warmBoard(store), p, 'one warm-up per page');
    await p;
    assert.equal(localCalls, 1);
    assert.equal(warmBoard(store), p, 'later calls join the same warm-up');
  });

  test('a failing store never rejects (the room screen must not break)', async () => {
    const store = fakeStore({ local: async () => { throw new Error('offline'); } });
    await assert.doesNotReject(warmBoard(store));
  });

  test('resetBoardWarmup lets the next warm-up run again', async () => {
    let n = 0;
    const store = fakeStore({ local: async () => { n++; return { groups: {} }; } });
    await warmBoard(store);
    resetBoardWarmup();
    await warmBoard(store);
    assert.equal(n, 2);
  });
});
