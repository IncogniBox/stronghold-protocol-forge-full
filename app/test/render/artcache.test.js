// test/render/artcache.test.js — assets.js `imageFromCache`：棋盘贴图常驻 Cache Storage 的那一层。
//
// 素材 CDN 给棋盘贴图的是 `Cache-Control: public, max-age=60`（gh-proxy → raw.githubusercontent，2026-10-31 实测），
// 也就是说每次重新打开页面都要把 ~2 MB 再下一次。这一层把一份拷贝留在磁盘上：第一次照常下载，之后是本地读取。
// 这里锁住：先网络后本地、失败回 null（调用方走普通加载）、旧版本缓存被清掉。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { imageFromCache, PERSISTENT_ART_CACHE } from '../../public/js/assets.js';

const URL_A = 'https://cdn.example/assets/local/map/autochess/TX_autochessi_D.webp';

/** A Cache Storage cache (match / put) over a Map. */
function makeCache() {
  const entries = new Map();
  return {
    entries,
    async match(u) { return entries.get(u); },
    async put(u, res) { entries.set(u, res); },
  };
}

/** The Cache Storage facade (open / keys / delete). */
function makeCaches(cache, names = [PERSISTENT_ART_CACHE]) {
  const set = new Set(names);
  return {
    names: set,
    async open(name) { set.add(name); return cache; },
    async keys() { return [...set]; },
    async delete(name) { set.delete(name); },
  };
}

const FAKE_IMAGE = { width: 4, naturalWidth: 4, decode: async () => {} };
const loadImage = async (u) => ({ ...FAKE_IMAGE, src: u });

const body = () => new Response(new Blob([new Uint8Array([1, 2, 3, 4])]), { status: 200 });

describe('imageFromCache (persistent board art)', () => {
  test('miss → one fetch stored → the next load reads the cache without a request', async () => {
    const cache = makeCache();
    const store = makeCaches(cache);
    const fetched = [];
    const fetch = async (u) => { fetched.push(u); return body(); };

    const first = await imageFromCache(URL_A, { caches: store, fetch, loadImage });
    assert.ok(first && first.width === 4, 'the image came back');
    assert.equal(fetched.length, 1, 'one request on a miss');
    assert.equal(cache.entries.size, 1, 'the copy is kept');

    const second = await imageFromCache(URL_A, { caches: store, fetch, loadImage });
    assert.ok(second, 'the cached copy loads');
    assert.equal(fetched.length, 1, 'no second request');
  });

  test('without Cache Storage it declines (the caller loads the image normally)', async () => {
    const saved = globalThis.caches;
    globalThis.caches = undefined;
    try {
      assert.equal(await imageFromCache(URL_A, { loadImage }), null);
    } finally {
      globalThis.caches = saved;
    }
  });

  test('a refused fetch declines and stores nothing', async () => {
    const cache = makeCache();
    const store = makeCaches(cache);
    const out = await imageFromCache(URL_A, { caches: store, fetch: async () => ({ ok: false, status: 404 }), loadImage });
    assert.equal(out, null);
    assert.equal(cache.entries.size, 0);
  });

  test('copies of an earlier cache version are dropped', async () => {
    const cache = makeCache();
    const store = makeCaches(cache, ['sp-local-art-v0', PERSISTENT_ART_CACHE]);
    const first = await imageFromCache(URL_A, { caches: store, fetch: async () => body(), loadImage });
    assert.ok(first);
    // the prune runs untracked (best effort): one turn of the microtask/macrotask queue settles it
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual([...store.names], [PERSISTENT_ART_CACHE]);
  });
});
