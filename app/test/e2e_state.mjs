// 状态转储：__SP__ 结构、store 快照、net.send 的服务器回执（hook WS 帧）
import { fileURLToPath } from 'node:url';

const ROOT = 'D:/Ark/Stronghold-Protocol-Forge-0.19.1-0.3.0-win-x64/app';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const srv = (await import(`file://${ROOT}/server/index.js`)).startServer;
const server = await srv({ port: 0, host: '127.0.0.1', quiet: false });
const base = `http://127.0.0.1:${server.port}`;
const puppeteer = (await import('puppeteer-core')).default;
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const wsFrames = [];
page.on('websocket', (ws) => {
  ws.on('framereceived', (f) => { try { const j = JSON.parse(f.payload); if (['BAD_MSG', 'ERR', 'room.create', 'room.start', 'phase', 'm.phase'].includes(j[0]) || String(j[0]).includes('room')) wsFrames.push(JSON.stringify(j).slice(0, 160)); } catch { /* binary */ } });
});
await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
await page.evaluateOnNewDocument(() => { localStorage.setItem('sp.name', 'e2e'); sessionStorage.setItem('sp.entered', '1'); });
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise((r) => setTimeout(r, 2500));

const state = await page.evaluate(() => {
  const sp = window.__SP__ || {};
  const s = sp.store ? sp.store.get() : null;
  return {
    spKeys: Object.keys(sp),
    hasStore: !!s,
    phase: s?.phase,
    screen: s?.screen,
    me: s?.me ? { name: s.me.name, playerId: s.me.playerId } : null,
    room: s?.room ? { id: s.room.id, mode: s.room.mode, dev: s.room.dev } : null,
    lobby: !!s?.lobby,
  };
});
console.log('[state]', JSON.stringify(state));
console.log('[ws frames]', wsFrames.slice(0, 20));

// 若已连接（playerId 有）：尝试 create
if (state.me.playerId) {
  await page.evaluate(async () => {
    const mod = await import('/js/ui/mods/roomMods.js').catch(() => null);
    const mods = mod?.roomMods?.buildCreatePayload ? mod.roomMods.buildCreatePayload('solo', 'NORMAL') : undefined;
    console.log('[mods payload]', JSON.stringify(mods || {}).slice(0, 200));
    window.__SP__.net.send('room.create', { mode: 'solo', difficulty: 'NORMAL', ...(mods ? { mods } : {}), dev: true });
  });
  await new Promise((r) => setTimeout(r, 2000));
  const s2 = await page.evaluate(() => { const s = window.__SP__.store.get(); return { phase: s.phase, room: s.room ? { id: s.room.id, dev: s.room.dev, mode: s.room.mode } : null }; });
  console.log('[after create]', JSON.stringify(s2));
  console.log('[ws frames]', wsFrames.slice(-15));
}
await browser.close();
process.exit(0);
