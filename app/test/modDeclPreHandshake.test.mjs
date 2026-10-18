// test/modDeclPreHandshake.test.mjs — 包声明在**握手之前**也到得了页面（DESIGN §28.60，docs/MOD-SURFACE.md 的
// `mods.panels` 那一行）。
//
// 要解决的现实问题：包的 C 层声明（`client.panels[]` / `client.theme.vars`）**只在 `welcome` 里下发**，而全新访客
// 按下「开始」之前根本不会 `hello`（`public/js/main.js boot` 里那句 `entered` 判据），于是收不到 `welcome`，于是
// 起名页上一块包界面都没有（业主现象：「第一次进入也没有显示出账号注册，要先进去再退出来才有」）。补的是一条只读
// 端点 `GET /mods/panels.json`：**同一个函数**（`server/workshop.js modDeclarationsFor`）造出的那份清单，在
// 握手之前送一次。本文件就是那条捷径的契约：
//
//   1. 同一次装载下，端点的 JSON 与 `welcome.modPanels` / `welcome.modTheme` **逐键相等**（一个来源，不可能漂移）；
//   2. 这台服务器**没有包声明**时该端点 **404**（「服务端没有包声明就没有这个字段」的同一条不变量）；
//   3. 客户端 `apply()` **同一份清单两次**是**幂等**的：不重复 `import`、不重复挂载、不重建 DOM
//      （注入式跑法，与 `test/modClientPanels.test.js` 同一条路）；
//   4. `fetch` 失败 / 404 / 空清单一律**静默**：不抛、不留副作用（没有包、离线、被代理挡掉都该安静）。
//
// 浏览器里真的 import + 真的渲染在本机跑不了（没有 Chrome）：那是 `SP_E2E=1` 的路径（docs/WORKSHOP.md §4.4）。
//
// Run: node --test test/modDeclPreHandshake.test.mjs
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { startServer } from '../server/index.js';
import { loadWorkshop, modDeclarationsFor } from '../server/workshop.js';
import { createStore, initialState } from '../public/js/store.js';
import { createPanelRegistry, MOD_PANEL_SLOTS } from '../public/js/ui/extensions.js';
import { TestClient } from './helpers/wsClient.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
/** 与 `server/http/mods.js` 的 `MODS_PANELS_URL` 同一个字面量（客户端那半是 `main.js` 的 `MOD_DECL_URL`）。 */
const PANELS_URL = '/mods/panels.json';

const PANEL_JS = 'export function mount(ctx) { return { unmount() {} }; }\n';

/**
 * 一个只声明 `client` 的包（`client` 本身即贡献项 ⇒ 不是 EMPTY_PACK）：
 *   * `signin` 挂在**起名页**那条入场位（`screen.title.entry`，业主现象里那块「注册 / 登录」住的地方）；
 *   * `overlays` 挂在四个**浮层**之一（这类宿主由注册点按需创建，注入式用例不必自己渲染容器）；
 *   * `client.theme.vars` 是「两条路一起给」的第一条（§28.8）：主题变量随同一份清单走。
 */
const CLIENT_PACK = {
  license: 'CC0-1.0',
  client: {
    panels: [
      { id: 'signin', slot: 'screen.title.entry', module: 'signin.js', order: 0 },
      { id: 'overlays', slot: 'root.overlays', module: 'overlays.js', order: 5 },
    ],
    theme: { vars: { '--sp-signin-accent': '#4ed8af' } },
  },
};

let tmp;
let wsRoot;
let emptyRoot;

before(() => {
  tmp = fs.mkdtempSync(path.join(tmpdir(), 'sp-moddecl-'));
  wsRoot = path.join(tmp, 'ws');
  const dir = path.join(wsRoot, 'signin-pack');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id: 'signin-pack', version: '0.1.0', ...CLIENT_PACK }));
  fs.writeFileSync(path.join(dir, 'signin.js'), PANEL_JS);
  fs.writeFileSync(path.join(dir, 'overlays.js'), PANEL_JS);
  // 干净安装：一个**空**工坊根（加载器「没有包」的正常形态）。
  emptyRoot = path.join(tmp, 'empty-ws');
  fs.mkdirSync(emptyRoot, { recursive: true });
});
after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

/** 一个够用的假 DOM（与 `test/modClientPanels.test.js` 同形）：`slotHost` 查不到就造一个。 */
function fakeDom() {
  const slots = new Map();
  const created = [];
  const makeEl = (tag) => ({
    tag, className: '', attributes: {}, children: [], removed: false,
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(child) { this.children.push(child); return child; },
    remove() { this.removed = true; },
  });
  return {
    created,
    render(slot) {
      const el = makeEl('div');
      el.className = 'mod-slot';
      el.setAttribute('data-mod-slot', slot);
      slots.set(slot, el);
      return el;
    },
    resolve: (slot) => slots.get(slot) || null,
    create: (tag) => { const el = makeEl(tag); created.push(el); return el; },
    slotEl: (slot) => slots.get(slot),
  };
}

const settle = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

describe('§28.60：同一个函数造的清单，两个读者（welcome 那一帧 + 握手前那次 HTTP）', () => {
  test('端点的 JSON 与 live 握手的 welcome.modPanels / modTheme 逐键相等', async () => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workshopDir: wsRoot });
    const clients = [];
    try {
      const res = await fetch(srv.url + PANELS_URL);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /application\/json/);
      const body = await res.json();
      // 形状 = welcome 那两格（字段名照既有代码：`server/lobby.js welcomeInfo`）
      assert.deepEqual(Object.keys(body).sort(), ['modPanels', 'modTheme']);
      // 面板按 order → 包 id → 面板 id 排过序（服务端那两份读者拿到的是同一份数组）
      assert.deepEqual(body.modPanels.map((p) => p.id), ['signin', 'overlays']);

      // live 握手：这一帧才是权威那一份（`entered` 之后的那次 `hello`）
      const c = await TestClient.connect(`${srv.url.replace('http', 'ws')}/ws`);
      clients.push(c);
      const w = await c.hello('握手博士');
      assert.deepEqual(body.modPanels, w.modPanels, '端点的清单与 welcome.modPanels 必须逐键相等');
      assert.deepEqual(body.modTheme, w.modTheme, '主题那一格同理');
      assert.equal(body.modPanels.length, w.modPanels.length);

      // 同一个函数（`modDeclarationsFor`）的同一份输出：两份读者读的是同一个来源，不是各造一份
      const decl = modDeclarationsFor(loadWorkshop(wsRoot, { log: quiet }), { log: quiet });
      assert.deepEqual(decl.panels, w.modPanels);
      assert.deepEqual(decl.theme, w.modTheme);
      // 声明真的落在「起名页的入场位」上 —— 业主现象里那块界面正长在这里
      assert.equal(body.modPanels.find((p) => p.id === 'signin').slot, 'screen.title.entry');
      assert.ok(MOD_PANEL_SLOTS.includes('screen.title.entry'));
    } finally {
      for (const c of clients) { try { await c.close(); } catch { /* already closed */ } }
      await srv.close();
    }
  });

  test('没有包声明的干净安装 ⇒ 这个端点 404（与「没有包就没有这个字段」同一条不变量）', async () => {
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workshopDir: emptyRoot });
    try {
      const res = await fetch(srv.url + PANELS_URL);
      assert.equal(res.status, 404);
      // 404 的体**不是 JSON**（B 面那条错误页）：所以客户端那半边必须**先看 `res.ok`** 再解析 —— 这一条与下面的
      // 「静默」是同一件事的两半。
      assert.match(res.headers.get('content-type') || '', /text\/html/);
      let parsed = true;
      try { JSON.parse(await res.text()); } catch { parsed = false; }
      assert.equal(parsed, false, '404 的体不是 JSON（客户端不许无条件解析）');
      // 其余行为逐字节不变：catalogue 照旧是空的那一份，welcome 里一个字段都不多
      assert.deepEqual(await (await fetch(`${srv.url}/mods/catalog.json`)).json(), { packs: [] });
      assert.equal('modPanels' in srv.lobby.welcomeInfo(), false);
      assert.equal('modTheme' in srv.lobby.welcomeInfo(), false);
    } finally {
      await srv.close();
    }
  });
});

describe('§28.60：同一份清单 apply 两次是幂等的（客户端那半边，注入式跑法）', () => {
  test('两条路喂同一份清单 ⇒ 不重复 import、不重复挂载、不重建 DOM', async () => {
    // 先拿**服务端真的会送的那份线表**（上面那条端点在同一装载下的输出），客户端 apply 的就是它。
    const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workshopDir: wsRoot });
    let wire;
    try {
      wire = (await (await fetch(srv.url + PANELS_URL)).json()).modPanels;
    } finally {
      await srv.close();
    }
    assert.equal(wire.length, 2);

    const dom = fakeDom();
    // 组件自己渲染的宿主（`screen.title.entry` 由 `screens/title.js` 画）—— 注入一个预渲染好的容器。
    const titleEntry = dom.render('screen.title.entry');
    const imported = [];
    const store = createStore(initialState);
    const registry = createPanelRegistry({
      store,
      net: { on: () => () => {}, sendResourceMessage: () => true },
      log: quiet,
      importModule: async (url) => { imported.push(url); return { mount: () => ({ unmount() {} }) }; },
      // 浮层那一类宿主由注册点按需创建；组件那一类必须**已经渲染**，否则照规矩「还没到时候」。
      slotHost: (slot) => dom.resolve(slot) || dom.render(slot),
      createElement: (tag) => dom.create(tag),
      env: { serviceWorker: true, cacheStorage: true, webCrypto: true },
      slotHosts: (slot) => (slot === 'screen.title.entry' ? [titleEntry] : []),
    });

    // 第一条路（HTTP，先）：eager apply
    const first = registry.apply(wire);
    await settle();
    assert.equal(first.accepted, 2);
    assert.deepEqual(registry.mounted(), ['signin-pack/overlays', 'signin-pack/signin']);
    const importsAfterFirst = imported.length;
    const createdAfterFirst = dom.created.slice();
    assert.equal(importsAfterFirst, 2, '两个面板模块各 import 一次');
    assert.equal(createdAfterFirst.length, 2, '两个面板各一个宿主 div');
    assert.equal(titleEntry.children.length, 1, '起名页那个入场位里挂上了一个 div');

    // 第二条路（welcome，后，权威）：**同一份清单**再来一次 —— 幂等。
    const second = registry.apply(wire);
    await settle();
    assert.equal(second.accepted, 2);
    assert.deepEqual(registry.mounted(), ['signin-pack/overlays', 'signin-pack/signin'], '挂载集合一个不多一个不少');
    assert.equal(imported.length, importsAfterFirst, '没有第二次 import');
    assert.deepEqual(dom.created, createdAfterFirst, '没有新建任何元素（DOM 没被重建）');
    for (let i = 0; i < createdAfterFirst.length; i++) {
      assert.equal(dom.created[i], createdAfterFirst[i], `第 ${i} 个宿主还是原来那一个对象`);
    }
    assert.equal(titleEntry.children.length, 1, '起名页那块位里仍然只有一份面板');
  });
});

describe('§28.60：失败 / 空清单一律静默', () => {
  test('空清单（apply([]) / null）什么都不做：不 import、不建元素、不订阅 store', () => {
    let subscribed = 0;
    const store = createStore(initialState);
    const originalSubscribe = store.subscribe;
    store.subscribe = (fn) => { subscribed++; return originalSubscribe(fn); };
    const dom = fakeDom();
    const imported = [];
    const registry = createPanelRegistry({
      store,
      importModule: async (url) => { imported.push(url); return {}; },
      slotHost: (slot) => dom.resolve(slot) || dom.render(slot),
      createElement: (tag) => dom.create(tag),
    });
    for (const list of [[], null, undefined]) {
      assert.equal(registry.apply(list).accepted, 0);
    }
    assert.deepEqual(imported, []);
    assert.deepEqual(dom.created, []);
    assert.equal(subscribed, 0, '一个面板都没有时连 store 都不订阅');
    assert.deepEqual(registry.mounted(), []);
  });

  test('main.js 那条 fetch 自己就是静默的：先看 `res.ok`、整体 try/catch、那条路径不 toast / 不 recordError', () => {
    const src = fs.readFileSync(path.join(ROOT, 'public/js/main.js'), 'utf8');
    const start = src.indexOf('async function fetchModDeclarations');
    assert.ok(start > 0, 'main.js 里得有这个名字的取数函数');
    const body = src.slice(start, src.indexOf('\n}', start));
    assert.match(body, /if \(!res\.ok\) return;/, '404 / 非 2xx 直接返回（不许无条件解析）');
    assert.match(body, /\} catch \{/, '网络层 / JSON 层失败整体吞掉，不抛');
    assert.ok(!/toast\(/.test(body), '可选捷径失败不许弹提示');
    assert.ok(!/recordError\(/.test(body), '可选捷径失败不许进诊断记录');
    assert.ok(!/console\.\w+\(/.test(body), '可选捷径失败不许在控制台留噪音');
    // 它是**并行**的一条路（`Promise.race` 把上限钉住），不挡首屏；welcome 那一次回调一个字都没改。
    assert.match(src, /Promise\.race\(\[fetchModDeclarations\(\)/, '与 socket 并行，不挡首屏');
    assert.match(src, /net\.on\('welcome'[^\n]*\n?[\s\S]*?modPanels\.apply\(msg\.modPanels\)/, 'welcome 那条路照旧');
  });
});
