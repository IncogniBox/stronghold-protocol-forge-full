// test/modClientCloud.test.mjs — DESIGN §28.58：账号面的两格（`ctx.session.setName` 与 `ctx.cloud`）。
//
// 这一批是**只加不改**的两格（不是 `pack.json` 里的声明，和 `ctx.me` 一样是引擎总是给的），所以判据分三段：
//
//   ① `ctx.session.setName(rawName)`（§28.58.1）—— 清洗规则**逐字**是 `actions.enter` 那一段（剥 C0/DEL/C1
//      控制码 → `trim()` → `slice(0, NAME_MAX_LEN)`），落地路径也只有一条（`screenIdentity.saveName` +
//      `setEntered(true)` + 摊开写 store 的 `me.name` / `session.entered` + `net.setName`）。失败一律点名 +
//      `false`、不抛：空名 ⇒ `CLIENT_SESSION_BAD_NAME`；身份边界不齐 ⇒ `CLIENT_SESSION_NAME_UNAVAILABLE`。
//   ② `ctx.cloud.read()` / `ctx.cloud.apply(patch)`（§28.58.2）—— **闭白名单**那七个 `sp.pref.` 键，
//      `read()` 一次取全且冻结（缺档 = `null`），`apply()` 校验全过才整份写入、**只安排一次**重载；
//      未知类别 / 危险键 / 越界值三个码**点名 + 整次拒绝**（不静默丢弃）。
//   ③ 「拿不到就是拿不到」：没有注入 `deps.cloud` 时面板照样挂，`read()` ⇒ `null`、`apply()` ⇒ `false`，
//      各点名 `CLIENT_CLOUD_UNAVAILABLE` 一次，**不抛**。这一格只碰偏好 —— `match` / `room` / `me` 一个字都不动。
//
// Run: node --test test/modClientCloud.test.mjs
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createStore, initialState, loadPref, savePref } from '../public/js/store.js';
import { NAME_MAX_LEN } from '../shared/constants.js';
import {
  createPanelRegistry,
  CLIENT_SESSION_BAD_NAME, CLIENT_SESSION_NAME_UNAVAILABLE, CLIENT_CLOUD_UNAVAILABLE,
  CLIENT_SESSION_BAD_AVATAR, CLIENT_SESSION_AVATAR_UNAVAILABLE,
} from '../public/js/ui/extensions.js';
import {
  CLOUD_PREF_KEYS, CLOUD_PATCH_MAX_BYTES, CLOUD_PATCH_MAX_DEPTH,
  CLIENT_CLOUD_UNKNOWN_CATEGORY, CLIENT_CLOUD_BAD_KEY, CLIENT_CLOUD_BAD_VALUE,
  readCloudPrefs, applyCloudPrefs,
} from '../public/js/ui/cloudPrefs.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const wire = (over = {}) => ({
  id: 'p1', pack: 'alpha', slot: 'root.overlays',
  url: '/workshop-panels/alpha/p1.js?v=0123456789ab', order: 0, gate: null, requires: [], ...over,
});

function mkEl(tag) {
  return {
    tag, className: '', attributes: {}, children: [], style: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    querySelector: () => null, querySelectorAll: () => [],
  };
}

/** 一个假的 `net`：订阅表 + `setName` 的记录本（§28.58.1 要数「名字有没有交到 net」）。 */
function fakeNet() {
  const names = [];
  return {
    names,
    setName: (name) => { names.push(name); },
    on: () => () => {},
    send: () => true,
  };
}

/** 一个假的身份库：`saveName` / `setEntered` 各自的记录本（缺哪个方法就用缺的那一半做「边界不齐」的用例）。 */
function fakeIdentity() {
  const saved = [];
  const entered = [];
  return {
    saved, entered,
    saveName: (name) => { saved.push(name); },
    setEntered: (on) => { entered.push(on); },
  };
}

/** 一个 localStorage 桩（`store.js` 的 `loadPref` / `savePref` 读的就是它）。 */
function memStorage(seed = {}) {
  const mem = new Map(Object.entries(seed));
  return {
    mem,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
}

/** 造一个注册点、挂一个面板，把它的 `ctx` 还给你（`deps` 可覆盖 `identity` / `net` / `cloud`）。 */
async function ctxOf({ net = fakeNet(), identity, cloud, extra = {} } = {}) {
  const seen = [];
  const store = createStore({ ...initialState });
  const registry = createPanelRegistry({
    store, net, log: quiet,
    ...(identity === undefined ? {} : { identity }),
    ...(cloud === undefined ? {} : { cloud }),
    importModule: async () => ({ mount: (ctx) => { seen.push(ctx); } }),
    slotHost: () => mkEl('div'), createElement: mkEl,
    ...extra,
  });
  registry.apply([wire()]);
  await settle();
  assert.equal(seen.length, 1, '面板挂上了');
  return { registry, ctx: seen[0], net, store };
}

// ---------------------------------------------------------------------------------------------------------------
describe('§28.58.1 ctx.session.setName：把标题屏那条入口带给面板', () => {
  test('清洗 = actions.enter 那一段（剥控制码 / trim / 按 NAME_MAX_LEN 截断），成功返回 true 并落进 store 与 net', async () => {
    const identity = fakeIdentity();
    const net = fakeNet();
    const { ctx } = await ctxOf({ identity, net });

    // 控制码（C0 / DEL / C1）剥掉、两端空白 trim —— 与 `screenActions.enter` 同一段字节
    assert.equal(ctx.session.setName('  \u0001甲\u009f\u007f  '), true);
    assert.deepEqual(identity.saved, ['甲'], '交给身份库的是清洗后的名字');
    assert.deepEqual(identity.entered, [true], '与 enter 同一条链：置「已进入」');
    assert.deepEqual(net.names, ['甲'], '名字交到 net（下一次 hello 用它）');
    assert.equal(ctx.me.name, '甲', 'store 的 me.name 跟着变（读面立刻读得到）');
    assert.equal(ctx.me.playerId, null, '只动 name 那一格');
    assert.equal(ctx.me.room, null);

    // 超长按上限截断（与 enter 一致：slice(0, NAME_MAX_LEN)）
    assert.equal(ctx.session.setName('甲'.repeat(NAME_MAX_LEN + 5)), true);
    assert.equal(identity.saved.at(-1).length, NAME_MAX_LEN);
    assert.equal(ctx.me.name.length, NAME_MAX_LEN);

    // 非字符串按 String(raw ?? '') 处理 —— 与 enter 逐字相同
    assert.equal(ctx.session.setName(42), true);
    assert.equal(ctx.me.name, '42');
    assert.deepEqual(ctx.store, undefined, '门面上仍然没有 store 句柄');
    assert.deepEqual(ctx.match, undefined);
    assert.deepEqual(ctx.engine, undefined);
  });

  test('清洗之后为空 ⇒ CLIENT_SESSION_BAD_NAME + false，一个字节都不写', async () => {
    const identity = fakeIdentity();
    const net = fakeNet();
    const { ctx, registry } = await ctxOf({ identity, net });

    for (const raw of ['', '   ', '\u0000\u001f\u007f\u009f', undefined, null]) {
      const n = registry.refusals().length;
      assert.equal(ctx.session.setName(raw), false, `拒绝：${JSON.stringify(raw)}`);
      const added = registry.refusals().slice(n);
      assert.equal(added.length, 1, '点名一次');
      assert.equal(added[0].code, CLIENT_SESSION_BAD_NAME);
      assert.match(added[0].detail, /setName/, '拒绝里点了这个调用');
    }
    assert.deepEqual(identity.saved, [], '一个名字都没落盘');
    assert.deepEqual(net.names, [], '一个名字都没上线');
    assert.equal(ctx.me.name, null, 'store 里的 name 没动');
  });

  test('身份边界不齐 ⇒ CLIENT_SESSION_NAME_UNAVAILABLE + false，**不抛**', async () => {
    const cases = [
      ['没有身份库（Node 用例 / 极小宿主）', {}],
      ['身份库没有 saveName', { setEntered: () => {} }],
      ['有身份库但 net 没有 setName', undefined],
    ];
    for (const [note, identity] of cases) {
      const net = note.startsWith('有身份库') ? { on: () => () => {}, send: () => true } : fakeNet();
      const { ctx, registry } = await ctxOf({ identity, net });
      const n = registry.refusals().length;
      assert.equal(ctx.session.setName('甲'), false, `拒绝：${note}`);
      assert.equal(registry.refusals()[n].code, CLIENT_SESSION_NAME_UNAVAILABLE, note);
      assert.equal(n + 1, registry.refusals().length, `点名一次：${note}`);
    }
  });

  test('同一个 ctx 上 setName 与其余几格并存：session 门面仍然是冻结的（写口只有那两个）', async () => {
    const { ctx } = await ctxOf({ identity: fakeIdentity(), net: fakeNet() });
    assert.ok(Object.isFrozen(ctx.session));
    assert.equal(typeof ctx.session.setPreload, 'function');
    assert.equal(typeof ctx.session.setName, 'function');
    assert.equal(typeof ctx.session.setPref, 'function');
    assert.equal(typeof ctx.session.getPref, 'function');
    assert.equal(typeof ctx.session.send, 'function');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('§28.58.3 ctx.session.setAvatar：把「已审核的头像」交给引擎那两处「我是谁」', () => {
  const AVATAR = 'data:image/png;base64,iVBORw0KGgo=';

  test('收：data URL 与根相对路径都写进 me.avatar，只动那一格；null / 空串是清除', async () => {
    const { ctx, store } = await ctxOf({ identity: fakeIdentity(), net: fakeNet() });

    assert.equal(ctx.session.setAvatar(AVATAR), true);
    assert.equal(store.get().me.avatar, AVATAR, 'store 的 me.avatar 跟着变（那两处读点读的就是它）');
    assert.equal(store.get().me.name, '', '只动 avatar 那一格');
    assert.equal(store.get().me.playerId, null);

    // 根相对路径也收（包内素材 / 引擎站点素材那条路）
    assert.equal(ctx.session.setAvatar('/workshop-assets/alpha/avatar.png'), true);
    assert.equal(store.get().me.avatar, '/workshop-assets/alpha/avatar.png');

    // null / 空串 / 全是空白 = 清除（退回引擎原本的画法：策略图标 / 首字）
    assert.equal(ctx.session.setAvatar(null), true);
    assert.equal(store.get().me.avatar, null);
    assert.equal(ctx.session.setAvatar(AVATAR), true);
    assert.equal(ctx.session.setAvatar('   '), true);
    assert.equal(store.get().me.avatar, null);

    assert.equal(ctx.store, undefined, '门面上仍然没有 store 句柄');
    assert.equal(ctx.match, undefined);
  });

  test('坏形状 ⇒ CLIENT_SESSION_BAD_AVATAR + false，那枚头像一个字节都不动', async () => {
    const { ctx, registry, store } = await ctxOf({ identity: fakeIdentity(), net: fakeNet() });
    assert.equal(ctx.session.setAvatar(AVATAR), true);   // 先写一枚，证明拒绝时它**不动**
    const bad = [
      'https://evil.example/avatar.png',            // 绝对外域：CSP 本来也不放行它，收了只会画成破图
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zy8+',         // 不在 `<img>` 画得出来的那几种图片类型里
      'avatar.png',                                  // 相对路径不是根相对路径
      123, true, {}, [],                             // 非字符串
      'a'.repeat(200 * 1024),                        // 超过长度上限（AVATAR_MAX_LEN）
    ];
    for (const raw of bad) {
      const n = registry.refusals().length;
      assert.equal(ctx.session.setAvatar(raw), false, `拒绝：${typeof raw === 'string' ? raw.slice(0, 32) : String(raw)}`);
      const added = registry.refusals().slice(n);
      assert.equal(added.length, 1, '点名一次');
      assert.equal(added[0].code, CLIENT_SESSION_BAD_AVATAR);
      assert.match(added[0].detail, /setAvatar/, '拒绝里点了这个调用');
    }
    assert.equal(store.get().me.avatar, AVATAR, '拒绝时那枚头像一个字节都没动');
  });

  test('这一页的 store 没有 set() ⇒ CLIENT_SESSION_AVATAR_UNAVAILABLE + false，**不抛**', async () => {
    // 极小宿主：只有 get / subscribe（注册点真正用得到的那两个），没有 set。
    const fakeStore = { get: () => initialState, subscribe: () => () => {} };
    const { ctx, registry } = await ctxOf({ identity: fakeIdentity(), net: fakeNet(), extra: { store: fakeStore } });
    const n = registry.refusals().length;
    assert.equal(ctx.session.setAvatar(AVATAR), false);
    assert.equal(registry.refusals()[n].code, CLIENT_SESSION_AVATAR_UNAVAILABLE);
    assert.equal(n + 1, registry.refusals().length, '点名一次');
    assert.equal(fakeStore.get().me.avatar, null, '一个字节都没写');
  });

  test('落盘 sp.pref.meAvatar：同一标签页刷新时起手就画得出来（main.js 开机读回）', async () => {
    const storage = memStorage();
    const prev = globalThis.localStorage;
    globalThis.localStorage = storage;
    try {
      const { ctx } = await ctxOf({ identity: fakeIdentity(), net: fakeNet() });
      assert.equal(ctx.session.setAvatar(AVATAR), true);
      assert.equal(JSON.parse(storage.getItem('sp.pref.meAvatar')), AVATAR, '那一枚落进了 sp.pref.meAvatar');
      assert.equal(ctx.session.setAvatar(null), true);
      assert.equal(JSON.parse(storage.getItem('sp.pref.meAvatar')), null, '清除也落盘 —— 刷新后不留旧图');
    } finally {
      if (prev === undefined) delete globalThis.localStorage; else globalThis.localStorage = prev;
    }
  });

  test('与其余几格并存：session 门面仍然冻结，setAvatar 在里面', async () => {
    const { ctx } = await ctxOf({ identity: fakeIdentity(), net: fakeNet() });
    assert.ok(Object.isFrozen(ctx.session));
    assert.equal(typeof ctx.session.setAvatar, 'function');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('§28.58.2 ctx.cloud：闭白名单的偏好读写口', () => {
  /** 把真实的 `cloudPrefs` 两个函数按 `main.js` 那样注进去（`savePref` / `reload` 用桩，其余走默认）。 */
  function injectCloud({ storage = memStorage(), reloads = [] } = {}) {
    return {
      storage,
      reloads,
      cloud: {
        read: () => readCloudPrefs({
          loadPref: (key, fallback) => {
            const raw = storage.getItem(`sp.pref.${key}`);
            return raw == null ? fallback : JSON.parse(raw);
          },
        }),
        apply: (patch, deps) => applyCloudPrefs(patch, {
          savePref: (key, value) => storage.setItem(`sp.pref.${key}`, JSON.stringify(value)),
          reload: () => reloads.push(1),
          ...(deps || {}),
        }),
      },
    };
  }

  test('`read()` 是那七个键的**一次取全**冻结快照（缺档 = null），`apply()` 整份写入后才重载**一次**', async () => {
    const { storage, reloads, cloud } = injectCloud();
    storage.setItem('sp.pref.lang', JSON.stringify('en'));
    const { ctx, registry } = await ctxOf({ cloud });

    const snap = ctx.cloud.read();
    assert.deepEqual(Object.keys(snap), [...CLOUD_PREF_KEYS], '七个键，一个不多一个不少');
    assert.equal(snap.lang, 'en');
    assert.equal(snap.settings, null, '缺档 = null（不是 undefined，也不是编造的默认值）');
    assert.equal(snap.loadout, null);
    assert.ok(Object.isFrozen(snap), '冻结');
    assert.ok(Object.isFrozen(snap.settings) === false || snap.settings === null, '缺档那一格是 null');
    // 每次读是一份新的副本，引擎之后的变化不回溯改写已经发出去的那一份
    assert.notEqual(ctx.cloud.read(), snap);
    storage.setItem('sp.pref.lang', JSON.stringify('zh'));
    assert.equal(snap.lang, 'en', '已经发出去的那一份不变');
    assert.equal(ctx.cloud.read().lang, 'zh');

    // apply：乱序给键，落盘与 `applied` 都按白名单顺序（结果字节确定）
    const out = ctx.cloud.apply({ lang: 'en', settings: { bgm: 0.5 }, loadout: { entries: {} } });
    assert.deepEqual(out, { applied: ['settings', 'loadout', 'lang'], reload: true });
    assert.deepEqual(reloads.length, 1, '**只安排一次**重载');
    assert.equal(JSON.parse(storage.getItem('sp.pref.settings')).bgm, 0.5, '就是那份 JSON');
    assert.equal(JSON.parse(storage.getItem('sp.pref.lang')), 'en');
    assert.equal(storage.getItem('sp.pref.ownership'), null, '没点名的类别一个字节都不写');
    assert.deepEqual(registry.refusals(), [], '一路都没拒绝过');

    // 再 apply 一次「只有一部分键」的 patch：只写那几个（**部分写入 = patch 的子集**）
    reloads.length = 0;
    const part = ctx.cloud.apply({ appearance: { char_a: { avatar: 'a_1' } } });
    assert.deepEqual(part, { applied: ['appearance'], reload: true });
    assert.equal(reloads.length, 1);
    assert.equal(storage.getItem('sp.pref.settings'), JSON.stringify({ bgm: 0.5 }), '上一次写的还在，这一次没被抹掉');

    // 空 patch：什么都不写、**不重载**
    reloads.length = 0;
    assert.deepEqual(ctx.cloud.apply({}), { applied: [], reload: false });
    assert.deepEqual(reloads, [], '没有任何键被写入 ⇒ 一次重载都不安排');
    assert.deepEqual(ctx.cloud.apply({}), { applied: [], reload: false });
  });

  test('拒绝一律**点名 + 整次拒绝**（一个坏键 ⇒ 一个字节都不写），四种出口逐条走', async () => {
    const { storage, reloads, cloud } = injectCloud();
    storage.setItem('sp.pref.lang', JSON.stringify('zh'));
    const { ctx, registry } = await ctxOf({ cloud });

    const cases = [
      ['数组不是 patch', ['lang'], CLIENT_CLOUD_BAD_VALUE],
      ['null 不是 patch', null, CLIENT_CLOUD_BAD_VALUE],
      ['标量不是 patch', 'lang', CLIENT_CLOUD_BAD_VALUE],
      ['未知类别', { cosmetics: { ids: [] } }, CLIENT_CLOUD_UNKNOWN_CATEGORY],
      ['未知类别与已知类别混在一起 ⇒ 整次拒绝', { lang: 'en', nope: 1 }, CLIENT_CLOUD_UNKNOWN_CATEGORY],
      ['顶层危险键', { constructor: 1, lang: 'en' }, CLIENT_CLOUD_BAD_KEY],
      ['**嵌套**危险键', { settings: { keys: { prototype: {} } } }, CLIENT_CLOUD_BAD_KEY],
      ['JSON.parse 出来的 __proto__（自有键）', JSON.parse('{"__proto__":{"polluted":1}}'), CLIENT_CLOUD_BAD_KEY],
      ['函数不可 JSON 序列化', { lang: () => {} }, CLIENT_CLOUD_BAD_VALUE],
      ['undefined 不可 JSON 序列化', { lang: undefined }, CLIENT_CLOUD_BAD_VALUE],
      ['Symbol 不可 JSON 序列化', { lang: Symbol('x') }, CLIENT_CLOUD_BAD_VALUE],
      ['非有限数', { settings: { bgm: Infinity } }, CLIENT_CLOUD_BAD_VALUE],
      ['类实例不是普通对象', { settings: { store: new (class Box { constructor() { this.x = 1; } })() } }, CLIENT_CLOUD_BAD_VALUE],
      [`超 ${CLOUD_PATCH_MAX_BYTES} 字节`, { lang: 'a'.repeat(CLOUD_PATCH_MAX_BYTES + 1) }, CLIENT_CLOUD_BAD_VALUE],
      [`嵌套超过 ${CLOUD_PATCH_MAX_DEPTH} 层`, { settings: { a: { b: { c: { d: { e: { f: { g: { h: 1 } } } } } } } } }, CLIENT_CLOUD_BAD_VALUE],
    ];
    for (const [note, patch, code] of cases) {
      const n = registry.refusals().length;
      const before = storage.mem.size;
      assert.equal(ctx.cloud.apply(patch), false, `拒绝：${note}`);
      const added = registry.refusals().slice(n);
      assert.equal(added.length, 1, `点名一次：${note}`);
      assert.equal(added[0].code, code, note);
      assert.match(added[0].detail, /cloud apply/, '拒绝里点了这个调用');
      assert.equal(storage.mem.size, before, `一个字节都没写：${note}`);
    }
    assert.deepEqual(reloads, [], '被拒 = 一次重载都不安排');
    assert.equal(JSON.parse(storage.getItem('sp.pref.lang')), 'zh', '原来那一份原样');
    assert.equal({}.polluted, undefined, 'prototype 没被污染');

    // 边界之内：那一刻的深度上限与字节数都放行（判据是「> 上限才拒」，不是「到上限就拒」）
    const deep = { settings: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } };
    assert.deepEqual(ctx.cloud.apply(deep), { applied: ['settings'], reload: true });
    reloads.length = 0;
    assert.deepEqual(ctx.cloud.apply({ lang: 'a'.repeat(CLOUD_PATCH_MAX_BYTES - 2) }), { applied: ['lang'], reload: true });
  });

  test('没有注入 `deps.cloud` ⇒ read() null / apply() false + CLIENT_CLOUD_UNAVAILABLE，面板照样挂、不抛', async () => {
    const { ctx, registry } = await ctxOf();   // 完全不注入 cloud
    assert.equal(ctx.cloud.read(), null);
    assert.equal(ctx.cloud.apply({ lang: 'en' }), false);
    assert.ok(Object.isFrozen(ctx.cloud), '这一格是冻结门面');
    assert.deepEqual(Object.keys(ctx.cloud).sort(), ['apply', 'read']);
    const codes = registry.refusals().map((r) => r.code);
    assert.deepEqual(codes, [CLIENT_CLOUD_UNAVAILABLE, CLIENT_CLOUD_UNAVAILABLE], '两格各自点名一次同一个码');
    assert.match(registry.refusals()[0].detail, /cloud\.read/, '点名说清是哪一格');
    assert.match(registry.refusals()[1].detail, /cloud\.apply/);
  });

  test('注入的那一半抛了 ⇒ 同一个码 + null / false，不把面板带崩', async () => {
    const { ctx, registry } = await ctxOf({ cloud: { read: () => { throw new Error('boom'); }, apply: () => { throw new Error('boom'); } } });
    assert.equal(ctx.cloud.read(), null);
    assert.equal(ctx.cloud.apply({}), false);
    assert.deepEqual(registry.refusals().map((r) => r.code), [CLIENT_CLOUD_UNAVAILABLE, CLIENT_CLOUD_UNAVAILABLE]);
    assert.match(registry.refusals()[0].detail, /boom/, '拒绝里带上抛了什么（不是一句空话）');
  });

  test('这一格**只碰偏好**：面板活着、读写并落地了云配置，`match` / `room` / `me` 一个字节都不变', async () => {
    const { storage, cloud } = injectCloud();
    const { ctx, store } = await ctxOf({ cloud });
    const before = JSON.stringify({ me: store.get().me, room: store.get().room, match: store.get().match });
    assert.deepEqual(ctx.cloud.apply({ settings: { bgm: 0.4 }, lang: 'en' }), { applied: ['settings', 'lang'], reload: true });
    assert.equal(JSON.parse(storage.getItem('sp.pref.settings')).bgm, 0.4, '偏好确实写进去了（不是「什么都没发生」的假通过）');
    assert.equal(JSON.stringify({ me: store.get().me, room: store.get().room, match: store.get().match }), before,
      '对局状态（me / room / match）一个字节都没动');
    assert.deepEqual(ctx.me.snapshot(), { playerId: null, name: null, room: null }, '会话态照旧');
    assert.notEqual(Object.keys(ctx).includes('store'), true, '门面上仍然没有 store 句柄');
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('§28.58 cloudPrefs 单元：判据住在它自己的模块里（Node 下整套可跑）', () => {
  test('readCloudPrefs 用的是引擎自己那条 `sp.pref.*` 路径（真 loadPref + 一个 localStorage 桩）', () => {
    const saved = globalThis.localStorage;
    globalThis.localStorage = memStorage();
    try {
      savePref('settings', { bgm: 0.3 });
      savePref('lang', 'en');
      globalThis.localStorage.setItem('sp.pref.loadout', 'not json at all');   // 坏档：那一格是 null，不是整格都没了
      const snap = readCloudPrefs();
      assert.deepEqual({ ...snap }, {
        settings: { bgm: 0.3 }, loadout: null, ownership: null, diy: null, conflict: null, appearance: null, lang: 'en',
      });
      assert.ok(Object.isFrozen(snap));
      assert.ok(Object.isFrozen(snap.settings), '深一层也冻（面板改不动）');
      assert.throws(() => { snap.settings.bgm = 1; }, TypeError);
      // 缺档读回来的是 null —— `loadPref(key, null)` 的 fallback 就是它
      assert.equal(loadPref('ownership', null), null);
    } finally { globalThis.localStorage = saved; }
  });

  test('applyCloudPrefs 的默认落盘与默认重载：真 savePref 写盘；没有 `location` 时**跳过重载**、不抛', () => {
    const saved = globalThis.localStorage;
    globalThis.localStorage = memStorage();
    try {
      const out = applyCloudPrefs({ lang: 'en' });
      assert.deepEqual(out, { applied: ['lang'], reload: true });
      assert.equal(JSON.parse(globalThis.localStorage.getItem('sp.pref.lang')), 'en');
      assert.equal(globalThis.location, undefined, 'Node 里没有 location：这一条钉住「顶层不碰它、调用时跳过」');
    } finally { globalThis.localStorage = saved; }
  });

  test('循环引用被深度上限兜住（不死循环、不打穿栈、不抛，报 BAD_VALUE）', () => {
    const cyc = { lang: {} };
    cyc.lang.self = cyc.lang;
    const seen = [];
    assert.equal(applyCloudPrefs(cyc, { refuse: (code, detail) => seen.push([code, detail]), savePref: () => {} }), false);
    assert.equal(seen[0][0], CLIENT_CLOUD_BAD_VALUE);
    assert.match(seen[0][1], /nesting/);
  });

  test('白名单是**闭**的，且它的七个成员就是引擎自己落盘的那七个键', () => {
    assert.deepEqual([...CLOUD_PREF_KEYS], ['settings', 'loadout', 'ownership', 'diy', 'conflict', 'appearance', 'lang']);
    const seen = [];
    assert.equal(applyCloudPrefs({ lang: 'en', unknownFlag: true }, { refuse: (code, d) => seen.push([code, d]), savePref: () => {} }), false);
    assert.equal(seen[0][0], CLIENT_CLOUD_UNKNOWN_CATEGORY);
    assert.match(seen[0][1], /unknownFlag/, '点名那个未知键');
    for (const key of CLOUD_PREF_KEYS) assert.match(seen[0][1], new RegExp(key), `detail 里列出白名单里的 ${key}`);
  });
});
