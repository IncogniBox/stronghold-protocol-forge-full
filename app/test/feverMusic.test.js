// test/feverMusic.test.js — 颂乐人偶 Fever 音乐：本地偏好、房间同步的那一份、服务器音乐库（`GET /api/music`）。
//
// 三块各钉一件事：
//   ① `sanitizeFeverMusic` / `roomFeverMusic`：形状不对 ⇒ 回落默认（宁可放包内两首，也不放一段错片段）；
//      `effectiveFeverMusic`：在房间里曲目/片段取房间那份，**音量永远取本浏览器**；
//   ② `server/http/routes.js musicLibrary`：官方 `assets/audio/bgm` + 已装工坊包的 `assets/bgm`，id 必须过得了
//      `room.feverMusic` 的协议判据（否则房主选了也发不出去）；
//   ③ 真正的服务器 + `room.feverMusic`：房主在开局前设得了、客人设不了、坏片段按 `BAD_MSG` 拒。
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../server/index.js';
import { musicLibrary } from '../server/http/routes.js';
import { validateC2S } from '../shared/protocol.js';
import { ERR } from '../shared/constants.js';
import {
  sanitizeFeverMusic, roomFeverMusic, effectiveFeverMusic, saveFeverMusic,
  formatSeconds, FEVER_MIN_SEGMENT, FEVER_MAX_SEGMENT,
} from '../public/js/ui/feverMusic.js';
import { TestClient } from './helpers/wsClient.js';

const wsUrl = (srv) => `ws://127.0.0.1:${srv.port}/ws`;

// ---------------------------------------------------------------------------------------------------
// ① 偏好与解析
// ---------------------------------------------------------------------------------------------------

test('sanitizeFeverMusic: 合法值原样保留；坏 id / 坏片段整条回落默认', () => {
  assert.deepEqual(sanitizeFeverMusic({ track: 'official:bgm', start: 1.26, end: 20.04, volume: 0.4 }),
    { track: 'official:bgm', start: 1.3, end: 20, volume: 0.4 }, '一位小数、音量保留');
  assert.deepEqual(sanitizeFeverMusic({ track: 'bad id!', start: 1, end: 5, volume: 2 }),
    { track: null, start: 0, end: 0, volume: 1 }, 'id 形状不对 ⇒ 不用这条，音量夹到 1');
  assert.deepEqual(sanitizeFeverMusic({ track: 'official:x', start: 5, end: 5 }),
    { track: null, start: 0, end: 0, volume: 1 }, '空片段 ⇒ 回落');
  assert.deepEqual(sanitizeFeverMusic({ track: 'official:x', start: 0, end: FEVER_MAX_SEGMENT + 1 }),
    { track: null, start: 0, end: 0, volume: 1 }, '超过片段上限 ⇒ 回落');
  assert.deepEqual(sanitizeFeverMusic(null), { track: null, start: 0, end: 0, volume: 1 }, '没存过 ⇒ 默认');
});

test('roomFeverMusic / effectiveFeverMusic: 房间里取房间那份，音量取本浏览器', () => {
  const room = { code: 'ABCD', feverMusic: { track: 'official:m_bat_x', start: 3, end: 23 } };
  assert.deepEqual(roomFeverMusic(room), { track: 'official:m_bat_x', start: 3, end: 23 });
  assert.equal(roomFeverMusic({ feverMusic: { track: 'official:x', start: 9, end: 2 } }), null, '倒过来的片段 ⇒ 当没设');
  assert.equal(roomFeverMusic({ feverMusic: { track: 'official:x', start: 0, end: FEVER_MIN_SEGMENT / 2 } }), null,
    '比最短片段还短 ⇒ 当没设');

  saveFeverMusic({ track: 'official:own', start: 1, end: 11, volume: 0.35 });
  assert.deepEqual(effectiveFeverMusic(room),
    { track: 'official:m_bat_x', start: 3, end: 23, volume: 0.35, room: true },
    '房间里曲目/片段跟房间，音量仍是自己的');
  assert.deepEqual(effectiveFeverMusic(null),
    { track: 'official:own', start: 1, end: 11, volume: 0.35, room: false },
    '不在房间用自己的那一份');
  assert.equal(effectiveFeverMusic({ code: 'ABCD' }).track, 'official:own',
    '房间没设过 ⇒ 用本浏览器自己那份（房主进房后会把它推成房间设置）');
  saveFeverMusic({ track: null, start: 0, end: 0, volume: 1 });
});

test('formatSeconds: 面板里的时长是 m:ss', () => {
  assert.equal(formatSeconds(0), '0:00');
  assert.equal(formatSeconds(65.4), '1:05');
  assert.equal(formatSeconds(-3), '0:00');
});

// ---------------------------------------------------------------------------------------------------
// ② 服务器音乐库
// ---------------------------------------------------------------------------------------------------

let tmp;
let publicDir;
let packDir;

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-fever-music-'));
  publicDir = path.join(tmp, 'public');
  const official = path.join(publicDir, 'assets', 'audio', 'bgm');
  fs.mkdirSync(official, { recursive: true });
  fs.writeFileSync(path.join(official, 'm_bat_zeta_loop.mp3'), 'a');
  fs.writeFileSync(path.join(official, 'm_bat_alpha_loop.mp3'), 'a');
  fs.writeFileSync(path.join(official, 'notes.txt'), 'not audio');
  fs.writeFileSync(path.join(official, '.hidden.mp3'), 'hidden');
  fs.mkdirSync(path.join(official, 'nested.mp3'), { recursive: true });
  packDir = path.join(tmp, 'workshop', 'test-pack');
  const packBgm = path.join(packDir, 'assets', 'bgm');
  fs.mkdirSync(packBgm, { recursive: true });
  fs.writeFileSync(path.join(packBgm, 'killkiss inst.m4a'), 'b');
});
after(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ } });

test('musicLibrary: 官方在前、工坊按包分组；只收音频文件', () => {
  const tracks = musicLibrary(publicDir, new Map([['test-pack', packDir]]), new Map([['test-pack', '测试音乐包']]));
  assert.deepEqual(tracks.map((x) => x.id), [
    'official:m_bat_alpha_loop',
    'official:m_bat_zeta_loop',
    // 文件名折过字符（空格 → `_`）⇒ 带 6 位摘要后缀：同一首歌的 id 不随别的文件增删而变
    'pack:test-pack:killkiss_inst-55830b',
  ]);
  assert.equal(tracks[0].kind, 'official');
  assert.equal(tracks[0].url, '/assets/audio/bgm/m_bat_alpha_loop.mp3');
  assert.equal(tracks[2].kind, 'workshop');
  assert.equal(tracks[2].pack, 'test-pack');
  assert.equal(tracks[2].packName, '测试音乐包', '分组标题用包名');
  assert.equal(tracks[2].url, '/workshop-assets/test-pack/bgm/killkiss%20inst.m4a', '文件名按 URL 编码');
  assert.equal(tracks[2].bytes, 1, '大小也带上（面板用来判空文件）');
  for (const t of tracks) assert.equal(validateC2S({ t: 'room.feverMusic', track: t.id, start: 0, end: 5 }), null,
    `${t.id} 必须过得了 room.feverMusic 的协议判据`);
});

test('musicLibrary: 目录不存在 / 没有工作坊 ⇒ 空表，不抛', () => {
  assert.deepEqual(musicLibrary(path.join(tmp, 'nope'), null), []);
  assert.deepEqual(musicLibrary(undefined, undefined), []);
});

// ---------------------------------------------------------------------------------------------------
// ③ 真服务器：`room.feverMusic`
// ---------------------------------------------------------------------------------------------------

let srv;
let vanilla;
before(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  // 房间那两条判据要一台**没有工作坊包**的服务器（有包时 `room.create` 要带完整的 mod 集合）；
  // 音乐库那条用上面那台真安装（官方 BGM 一定在）。
  const empty = path.join(tmp, 'empty-workshop');
  fs.mkdirSync(empty, { recursive: true });
  vanilla = await startServer({ port: 0, host: '127.0.0.1', quiet: true, workshopDir: empty });
});
after(async () => { await vanilla?.close(); await srv?.close(); });

const player = async (name) => {
  const c = await TestClient.connect(wsUrl(vanilla));
  const welcome = await c.hello(name);
  c.id = welcome.playerId;
  return c;
};

test('GET /api/music: 官方 BGM 在表里，条目形状齐全', async () => {
  const r = await fetch(`http://127.0.0.1:${srv.port}/api/music`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(Array.isArray(body.tracks));
  const official = body.tracks.filter((t) => t.kind === 'official');
  assert.ok(official.length > 0, '这台机的官方 BGM 目录非空');
  for (const t of official) {
    assert.match(t.url, /^\/assets\/audio\/bgm\//);
    assert.equal(typeof t.name, 'string');
    assert.ok(t.bytes > 0);
  }
});

test('room.feverMusic: 房主开局前设得了，房间状态带着它', async () => {
  const host = await player('Host');
  try {
    const stateP = host.waitFor('room.state', (s) => s.code, 2000);
    assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const state = await stateP;
    assert.equal(Object.hasOwn(state, 'feverMusic'), false, '没设过 ⇒ room.state 不带这个键');

    const nextP = host.waitFor('room.state', (s) => s.feverMusic?.track, 2000);
    assert.equal((await host.request({
      t: 'room.feverMusic', track: 'official:m_bat_act1autochess_loop', start: 5, end: 25,
    })).t, 'ok');
    const next = await nextP;
    assert.deepEqual(next.feverMusic, { track: 'official:m_bat_act1autochess_loop', start: 5, end: 25 });

    // 恢复默认：再发一次 track:null，状态里这个键重新消失
    const clearedP = host.waitFor('room.state', (s) => !s.feverMusic, 2000);
    assert.equal((await host.request({ t: 'room.feverMusic', track: null })).t, 'ok');
    await clearedP;
  } finally { await host.terminate(); }
});

test('room.feverMusic: 客人改不了；坏片段按 BAD_MSG 拒', async () => {
  const host = await player('Host');
  const guest = await player('Guest');
  try {
    const stateP = host.waitFor('room.state', (s) => s.code, 2000);
    assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' })).t, 'ok');
    const state = await stateP;
    assert.equal((await guest.request({ t: 'room.join', code: state.code })).t, 'ok');

    const refused = await guest.request({ t: 'room.feverMusic', track: 'official:x', start: 0, end: 5 });
    assert.equal(refused.t, 'error');
    assert.equal(refused.code, ERR.NOT_HOST);

    for (const bad of [
      { track: 'official:x', start: 5, end: 5 },
      { track: 'official:x', start: 0, end: FEVER_MAX_SEGMENT + 5 },
      { track: 'bad id!', start: 0, end: 5 },
      { track: 'official:x', start: 0, end: -1 },
    ]) {
      const r = await host.request({ t: 'room.feverMusic', ...bad });
      assert.equal(r.t, 'error', `坏片段必须被拒：${JSON.stringify(bad)}`);
      assert.equal(r.code, ERR.BAD_MSG);
    }
  } finally { await guest.terminate(); await host.terminate(); }
});
