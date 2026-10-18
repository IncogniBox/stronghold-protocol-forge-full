// test/packLobbyScope.test.js — 包通道的**大厅作用域**（`client.panels[].scope: 'lobby'`，docs/WORKSHOP.md §1.9.6）。
//
// 一条通道默认是**房间作用域**：不在房间里发 ⇒ `NOT_IN_ROOM`。面板写了 `scope: 'lobby'` 时，它 `messages` 里声明的
// 那些通道成为**大厅作用域**：`pack.msg` 广播给**不在任何房间**的已连接会话 —— **不看发送者在不在房间里**
// （房间里点「同盟邀约」要送到大厅那些还没进房的博士）。四条断言，全部用真服务器 + 真会话：
//   ① 大厅会话发大厅通道 ⇒ 另一个大厅会话收到；
//   ② **房间里**发大厅通道 ⇒ 大厅会话仍收到（后加的那一半：大厅频道排在 `roomOf` 之前）；
//   ③ 没声明大厅作用域的通道在大厅发 ⇒ 照旧 `NOT_IN_ROOM`；
//   ④ 房间作用域的通道在房里发 ⇒ 只送本房（大厅会话收不到）。
//
// Run: node --test test/packLobbyScope.test.js
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { normalizePackManifest } from '../shared/workshop.js';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';

const PACK = 'lobby-scope-pack';
const PANEL_JS = 'export function mount(ctx) { return {}; }\n';

describe('包通道的大厅作用域（`client.panels[].scope: "lobby"`）', () => {
  let tmp;
  let srv;
  let digest;
  const clients = [];

  before(async () => {
    tmp = fs.mkdtempSync(path.join(tmpdir(), 'sp-lobbyscope-'));
    const dir = path.join(tmp, PACK);
    fs.mkdirSync(path.join(dir, 'ui'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({
      id: PACK, name: 'Lobby scope', version: '1.0.0', license: 'CC0-1.0', description: 'x', gameVersion: '0.2.2',
      client: { panels: [
        // 大厅作用域的面板：它声明的通道广播给**大厅**（发送者在不在房间都一样）。
        { id: 'invite', slot: 'screen.room.chat', module: 'ui/invite.js', messages: ['lobby', 'invite'], scope: 'lobby' },
        // 普通面板（不写 scope）：它的通道照旧是**房间作用域**。
        { id: 'room', slot: 'root.overlays', module: 'ui/room.js', messages: ['roomchan'] },
      ] },
    }));
    fs.writeFileSync(path.join(dir, 'ui', 'invite.js'), PANEL_JS);
    fs.writeFileSync(path.join(dir, 'ui', 'room.js'), PANEL_JS);
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workshopDir: tmp });
    digest = srv.lobby.welcomeInfo().mods.digest;
  });
  after(async () => {
    for (const c of clients) { try { await c.close(); } catch { /* already closed */ } }
    if (srv) await srv.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  /** 一个新会话（只握手，不进房）—— 也就是「大厅里」的会话。 */
  const connect = async (name) => {
    const c = await TestClient.connect(`${srv.url.replace('http', 'ws')}/ws`);
    clients.push(c);
    await c.hello(`${name}${clients.length}`);
    return c;
  };
  /** 开一间 coop 房（创建者 + 一个加入者）—— 两个真人都在房间里。 */
  async function aCoopRoom() {
    const r1 = await connect('R');
    const created = await r1.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: digest });
    assert.equal(created.t, 'ok', JSON.stringify(created));
    const state = await r1.waitFor('room.state');
    const r2 = await connect('R');
    const joined = await r2.request({ t: 'room.join', code: state.code, mods: digest });
    assert.equal(joined.t, 'ok', JSON.stringify(joined));
    r1.clearInbox();
    r2.clearInbox();
    return { r1, r2, code: state.code };
  }

  test('声明层：`scope` 只在 "lobby" 时进归一化清单，"room" / 不写不长这个键，写别的整包被拒', () => {
    const base = (panel) => ({ id: 'p', name: 'p', version: '1.0.0', license: 'CC0-1.0', description: 'x', gameVersion: '0.2.x', client: { panels: [panel] } });
    const P = { id: 'chat', slot: 'root.overlays', module: 'ui/chat.js', messages: ['chat'] };
    const norm = (panel) => normalizePackManifest(base(panel), 'p', { hasAssets: false });
    assert.equal(norm({ ...P, scope: 'lobby' }).pack.client.panels[0].scope, 'lobby');
    assert.equal('scope' in norm({ ...P, scope: 'room' }).pack.client.panels[0], false, '写 "room" 与不写得到同一份字节');
    assert.equal('scope' in norm({ ...P }).pack.client.panels[0], false);
    const bad = norm({ ...P, scope: 'LOBBY' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'CLIENT_BAD_PANEL_SCOPE');
  });

  test('服务端：大厅集合只从声明了 `scope: "lobby"` 的那个面板推出来（同一批面板清单的另一半）', () => {
    const m = [...srv.lobby.packLobbyChannels].map(([k, v]) => [k, [...v].sort()]);
    assert.deepEqual(m, [[PACK, ['invite', 'lobby']]], '`roomchan` 不在大厅集合里（它那个面板没写 scope）');
    assert.deepEqual([...srv.lobby.packChannels.get(PACK)].sort(), ['invite', 'lobby', 'roomchan'], '通道白名单三条都在（声明层不变）');
  });

  test('① 大厅会话发大厅通道 ⇒ 另一个大厅会话收到', async () => {
    const a = await connect('A');
    const b = await connect('B');
    a.send({ t: 'pack.msg', pack: PACK, channel: 'lobby', data: { hi: 1 } });
    const got = await b.waitFor('pack.msg');
    assert.equal(got.channel, 'lobby');
    assert.deepEqual(got.data, { hi: 1 }, '载荷原样');
    assert.equal(typeof got.from, 'string');
  });

  test('② 房间里发大厅通道 ⇒ 大厅会话仍收到（不看发送者在不在房间）', async () => {
    const lobby = await connect('L');
    const { r1, r2 } = await aCoopRoom();
    r1.send({ t: 'pack.msg', pack: PACK, channel: 'invite', data: { code: 'ABCD' } });
    const got = await lobby.waitFor('pack.msg');
    assert.equal(got.channel, 'invite', '房间里的发送者把大厅通道送到了大厅');
    assert.deepEqual(got.data, { code: 'ABCD' });
    // 大厅广播**不进房间**：房里的另一个人收不到（大厅作用域只发给不在房间的会话）
    await r2.expectNone('pack.msg', () => true, 300);
  });

  test('③ 没声明大厅作用域的通道在大厅发 ⇒ 照旧 NOT_IN_ROOM', async () => {
    const solo = await connect('S');
    const r = await solo.request({ t: 'pack.msg', pack: PACK, channel: 'roomchan', data: {} });
    assert.equal(r.t, 'error');
    assert.equal(r.code, 'NOT_IN_ROOM', '`roomchan` 是房间作用域，不在房间里发不出');
    // 顺序未变：不在房间这条排在「声明过这个通道」之前 ⇒ 连没声明的名字也是 NOT_IN_ROOM（不是 BAD_MSG）
    const r2 = await solo.request({ t: 'pack.msg', pack: PACK, channel: 'nope', data: {} });
    assert.equal(r2.code, 'NOT_IN_ROOM');
  });

  test('④ 房间作用域的通道在房里发 ⇒ 只送本房（大厅会话收不到）', async () => {
    const lobby = await connect('L');
    const { r1, r2 } = await aCoopRoom();
    r1.send({ t: 'pack.msg', pack: PACK, channel: 'roomchan', data: { secret: 1 } });
    const got = await r2.waitFor('pack.msg');
    assert.equal(got.channel, 'roomchan');
    assert.deepEqual(got.data, { secret: 1 });
    await lobby.expectNone('pack.msg', () => true, 300);
  });
});
