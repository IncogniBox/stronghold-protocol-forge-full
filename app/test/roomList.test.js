// test/roomList.test.js — 房间目录（`room.list` → `room.listed`，docs/META.md §1.7b，业主裁决 B 2026-10-15）。
//
// 走真事物：真 HTTP/WS 服务器、真 Lobby、真 `shared/protocol.js` 校验、真的 `room.create` / `room.join`。
// 只替换 `MatchClass`（`StubMatch`，与 lobby / quickmatch 两个套件同一份桩）—— 「开一局」不是这几条要测的东西。
//
// 这条消息存在的理由是**界面的一半已经在了**：大厅（第三方界面包 ui-hub-package 的版本）每 10 秒轮一次
// `room.list`、并用 `res.online` / `res.rooms` 画「N 名博士在线」与「缺人同盟」。`HAS('room.list')` 查的是
// `shared/protocol.js` 的 C2S 表，所以**这一条消息本身就是那个开关**（没有它，界面一个数都不画，只能显示兜底值）。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { C2S, S2C, validateC2S } from '../shared/protocol.js';
import { HEAVY_TYPES } from '../server/net.js';
import { TestClient } from './helpers/wsClient.js';

const log = { info() {}, warn() {}, debug() {}, error() {} };
/** Every client / server ever opened, closed by one `after` hook. */
const clients = [];
const servers = [];

async function server() {
  const srv = await startServer({
    port: 0, host: '127.0.0.1', log, MatchClass: StubMatch, seedFn: () => 7, lobbyGraceMs: 300,
  });
  servers.push(srv);
  return srv;
}

/** Connect + hello; `.id` is the playerId the server gave this socket. */
async function player(srv, name) {
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
  clients.push(c);
  const welcome = await c.hello(name);
  c.id = welcome.playerId;
  return c;
}

/**
 * Ask the directory the way the browser does it: a rid'd request whose answer is the `room.listed` frame **itself**
 * (the browser's `_pending` resolves on any inbound type carrying the rid — `test/helpers/wsClient.js` is stricter,
 * so the wait names the type).
 */
function ask(c) {
  const rid = c.nextRid++;
  c.send({ t: 'room.list', rid });
  return c.waitFor('room.listed', (m) => m.rid === rid);
}

after(async () => {
  for (const c of clients) await c.terminate().catch(() => {});
  for (const s of servers) await s.close().catch(() => {});
});

test('协议面：room.list 是 C2S 的空消息、room.listed 是 S2C，且目录走重桶', () => {
  assert.ok(Object.hasOwn(C2S, 'room.list'), "room.list 必须在 C2S 表里 —— 界面包的 HAS('room.list') 查的就是它");
  assert.equal(validateC2S({ t: 'room.list' }), null, '空消息合法');
  assert.equal(validateC2S({ t: 'room.list', rid: 3 }), null, '带 rid 也合法');
  assert.ok(S2C.includes('room.listed'), 'room.listed 在 S2C 表里');
  assert.ok(HEAVY_TYPES.has('room.list'), '一次请求换整份目录 ⇒ 走重桶');
});

test('目录：online = 已连接会话数；只有 coop 的房间进列表，字段就是大厅读的那几个', async () => {
  const srv = await server();
  const a = await player(srv, 'A');
  const b = await player(srv, 'B');

  // ① 一个 solo 房：不可被加入 ⇒ **不进**列表（列出来只会给出错误的「缺 N 人」）
  const soloState = await (async () => {
    await a.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    return a.waitFor('room.state', (m) => m.mode === 'solo');
  })();
  const onlySolo = await ask(b);
  assert.equal(onlySolo.ok, true, JSON.stringify(onlySolo));
  assert.equal(onlySolo.online, 2, '两个已连接会话');
  assert.equal(onlySolo.roomsCount, 0, 'solo 房不进目录');
  assert.deepEqual(onlySolo.rooms, []);
  assert.equal(onlySolo.matchesCount, 0);
  assert.ok(soloState.code, '那个 solo 房确实存在（只是没进目录）');

  // ② 一个 coop 房：进列表，房号 / 房主名 / 人数 / 容量 / 模式 / 难度都在
  const bState = await (async () => {
    await b.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    return b.waitFor('room.state', (m) => m.mode === 'coop');
  })();
  const listed = await ask(a);
  assert.equal(listed.roomsCount, 1, JSON.stringify(listed));
  assert.equal(listed.rooms.length, 1);
  const room = listed.rooms[0];
  assert.deepEqual(Object.keys(room).sort(), ['code', 'difficulty', 'hostName', 'humans', 'inMatch', 'maxSeats', 'mode'].sort());
  assert.equal(room.code, bState.code);
  assert.equal(room.mode, 'coop');
  assert.equal(room.difficulty, 'NORMAL');
  assert.equal(room.humans, 1, '房里 1 名真人');
  assert.ok(Number.isInteger(room.maxSeats) && room.maxSeats >= 1, `maxSeats: ${room.maxSeats}`);
  assert.equal(room.inMatch, false, '还没开局');
  assert.equal(room.hostName, 'B', '房主是 B');
  assert.equal(listed.online, 2, '在线数不随房间数变');
});

test('目录是只读的：连问两次不改房、不改在线数，也没有第二个通道', async () => {
  const srv = await server();
  const a = await player(srv, 'A');
  await a.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  await a.waitFor('room.state');
  const before = srv.lobby.rooms.size;
  const first = await ask(a);
  const second = await ask(a);
  assert.deepEqual(second.rooms, first.rooms, '两次问到的目录一致');
  assert.equal(second.online, 1);
  assert.equal(srv.lobby.rooms.size, before, '问目录不会建/改房');
  assert.equal(a.stateOf('room.state').code, first.rooms[0].code, '房没被动过');
});
