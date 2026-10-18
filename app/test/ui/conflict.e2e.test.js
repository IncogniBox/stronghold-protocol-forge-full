// Browser E2E of 干员冲突兼容 (operator conflict, 2026-10-16): the 数据来源 switch of the 干员调配 detail card, against a
// real server whose workshop holds **two packs each overriding the SAME official chess id** — the PACK_ID_COLLISION case
// the whole layer exists for. Opt-in: SP_E2E=1 node --test test/ui/conflict.e2e.test.js
//
// The probe packs patch `appellation` of 隐现 (chess_char_1_01_a): a field-level override that exists on the record
// (`shared/workshop.js` mergeRecord) and changes nothing about the roster — name, search and shop order stay. The pack
// with the smaller id (cf-a) wins the merge, so the merged record (what the client shows) is cf-a's, and the switch
// offers both.
//
// ⚠️ What this file does NOT check: that the choice really changes the record a player fields. That is a per-player
// server-side swap (`server/match/player/conflict.js`) — the running match keeps the pick its seat had at its start, and
// the client never re-renders the merged record (it is the same for everyone). That half is pinned by
// test/operatorConflict.test.js (③ the view, ④ the read-only route), so here we only verify the switch renders, writes
// `sp.pref.conflict`, and syncs as `room.conflict`.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ENABLED = process.env.SP_E2E === '1' && existsSync(CHROME);
const CHESS = 'chess_char_1_01_a'; // 隐现

describe('干员冲突兼容：干员详情里的「数据来源」开关 (real server, headless Chrome)', { skip: !ENABLED && 'set SP_E2E=1 (and have Chrome) to run' }, () => {
  let srv;
  let browser;
  let base;
  let tmp;

  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    tmp = path.join(tmpdir(), `sp-conflict-e2e-${process.pid}`);
    const ws = path.join(tmp, 'workshop');
    const put = (id, appellation) => {
      const dir = path.join(ws, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({
        id, name: id, version: '1.0.0', author: 'e2e probe', description: 'e2e probe pack (same official chess id)',
        content: ['chess'], overrides: [`chess:${CHESS}`],
      }, null, 2));
      writeFileSync(path.join(dir, 'chess.json'), JSON.stringify({ [CHESS]: { appellation } }, null, 2));
    };
    put('cf-a', 'CF-A');
    put('cf-b', 'CF-B');
    mkdirSync(OUT, { recursive: true });
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workshopDir: ws });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  test('两个来源：赢家在先并标「默认」；选中即写入 sp.pref.conflict 并被服务端收下；点回默认即清除', async () => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`requestfailed: ${r.url()}`); });
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('sp.name', '冲突测试');
      sessionStorage.setItem('sp.entered', '1');
    });
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!document.querySelector('.lobby-screen'), { timeout: 30000 });
    await page.click('.lobby-screen [data-testid="loadout-open"]');
    await page.waitForSelector('.lo-popbtn', { visible: true, timeout: 15000 });
    // 卡片视图（缺省）→ 筛选 → 列表（`.lo-card` 只有列表视图里才有）
    await page.evaluate(() => [...document.querySelectorAll('.lo-popbtn')].find((b) => b.textContent.includes('筛选'))?.click());
    await page.waitForSelector('.lo-pop .lo-seg button', { visible: true, timeout: 5000 });
    await page.evaluate(() => [...document.querySelectorAll('.lo-seg button')].find((b) => b.textContent.trim() === '列表')?.click());
    await page.waitForSelector('.lo .lo-card', { visible: true, timeout: 10000 });
    await page.type('.lo-search input', '隐现');
    await page.waitForFunction(() => document.querySelectorAll('.lo-card').length === 1, { timeout: 5000 });
    await page.click('.lo-card__pick');
    await page.waitForSelector('.lo-cf [data-pack]', { visible: true, timeout: 8000 });

    /** The conflict sync state of the loadout store (`installConflictSync`'s receiver). */
    const conflictSync = () => page.evaluate(() => import('/js/ui/loadoutSync.js').then((m) => m.loadoutStore.get().conflictSync));
    const storedPicks = () => page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.conflict') || '{}').picks || null);
    /**
     * Wait for the pick to really go out and come back accepted: the state is already 'synced' once after the initial
     * `welcome` flush, so first see it leave (pending / sending), then see it settle on 'synced' — the state a refused
     * message would NOT leave behind (a bad one goes to 'error', a locked one to 'locked').
     */
    const settled = async () => {
      await page.waitForFunction(async () => ['pending', 'sending'].includes((await import('/js/ui/loadoutSync.js')).loadoutStore.get().conflictSync), { timeout: 5000 });
      await page.waitForFunction(async () => (await import('/js/ui/loadoutSync.js')).loadoutStore.get().conflictSync === 'synced', { timeout: 8000 });
    };

    // the switch: winner first, tagged 默认, and it is what the merged record already is
    const buttons = await page.$$eval('.lo-cf__pick', (els) => els.map((e) => ({
      pack: e.dataset.pack, on: e.classList.contains('is-on'), tag: e.querySelector('.lo-cf__tag')?.textContent ?? null,
    })));
    assert.deepEqual(buttons.map((b) => b.pack), ['cf-a', 'cf-b'], '两个来源，赢家（字典序小的包 id）在最前');
    assert.deepEqual(buttons.map((b) => b.on), [true, false], '缺省就是赢家');
    assert.equal(buttons[0].tag, '默认');
    assert.equal(buttons[1].tag, null, '只有赢家那一格带「默认」签');
    assert.equal(await storedPicks(), null, '一进来什么都没挑');
    assert.equal(await page.$eval('.lo-dhead__en', (el) => el.textContent.trim()), 'CF-A', '客户端看到的仍是合并后的那一份（赢家）');

    // pick the loser → written at once, then accepted by the server as room.conflict
    await page.click('.lo-cf [data-pack="cf-b"]');
    await page.waitForFunction(() => document.querySelector('.lo-cf [data-pack="cf-b"]')?.classList.contains('is-on'));
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sp.pref.conflict'))),
      { v: 1, picks: { [CHESS]: 'cf-b' } }, '选择落成「和默认不一样」的那一格');
    await settled();
    assert.equal(await conflictSync(), 'synced', '服务端收下了（不是 locked / error）');
    await page.screenshot({ path: path.join(OUT, 'conflict-switch.png') });

    // pick the winner back = clear (the setting only keeps the deviations)
    await page.click('.lo-cf [data-pack="cf-a"]');
    await page.waitForFunction(() => document.querySelector('.lo-cf [data-pack="cf-a"]')?.classList.contains('is-on'));
    assert.deepEqual(await storedPicks(), {}, '挑赢家 = 取消');
    await settled();

    // Optional asset packs (voice lines / fonts) may be absent in a checkout; a missing one is not a page failure.
    assert.deepEqual(problems.filter((p) => p.startsWith('pageerror:') || p.startsWith('console:')), []);
    await ctx.close();
  });
});
