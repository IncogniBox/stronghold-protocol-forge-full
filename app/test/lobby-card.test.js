// test/lobby-card.test.js — 名片干员 (room.card {charId}): any chess.json charId or '' (none); kept on the session, so it
// follows the player into a room and the next one; the room's members see it in room.state seats[].card; unknown ids and
// malformed values are refused; it is cosmetic (accepted during a match, never un-readies anybody).
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

const CHESS = JSON.parse(readFileSync(new URL('../data/chess.json', import.meta.url), 'utf8'));
const CHARS = [...new Set(Object.values(CHESS).map((c) => c.charId).filter((x) => typeof x === 'string'))];
const A = CHARS[0], B = CHARS[1];

const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };
const seatOf = (state, id) => state.seats.find((s) => s && s.playerId === id) || null;

test('protocol: room.card takes a charId-shaped string or empty', () => {
  assert.equal(validateC2S({ t: 'room.card', charId: A }), null);
  assert.equal(validateC2S({ t: 'room.card', charId: '' }), null);
  for (const charId of [undefined, null, 1, 'constructor', 'char_<x>', 'x'.repeat(60), {}, []]) {
    assert.notEqual(validateC2S({ t: 'room.card', charId }), null, JSON.stringify(charId));
  }
});

describe('room.card (lobby)', () => {
  let srv;
  const open = new Set();
  const errors = [];
  const player = async (name) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    open.add(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    c.mods = w.mods && w.mods.digest;
    return c;
  };
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', MatchClass: StubMatch, lobbyGraceMs: 60_000,
      log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } });
  });
  afterEach(async () => { await Promise.all([...open].map((c) => c.terminate().catch(() => {}))); open.clear(); });
  after(async () => { await srv?.close(); assert.deepEqual(errors, [], 'no server errors logged'); });

  test('set before a room, it shows on the seat; a change reaches the others; unknown ids are refused; ready stays', async () => {
    const host = await player('Host');
    await ok(host, { t: 'room.card', charId: A });
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: host.mods });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.equal(seatOf(st, host.id).card, A, 'the session card comes along into the room');
    const guest = await player('Guest');
    await ok(guest, { t: 'room.join', code: st.code, mods: guest.mods, consent: true });
    const js = await guest.waitFor('room.state', (s) => !!seatOf(s, guest.id));
    assert.equal(seatOf(js, guest.id).card, undefined, 'none chosen: the seat shape stays as before');
    assert.equal(seatOf(js, host.id).card, A);
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.ready);
    await ok(guest, { t: 'room.card', charId: B });
    const after = await host.waitFor('room.state', (s) => seatOf(s, guest.id)?.card === B);
    assert.equal(seatOf(after, guest.id).ready, true, 'cosmetic: the guest stays ready');
    await err(guest, { t: 'room.card', charId: 'char_000_nobody' }, ERR.BAD_MSG);
    await ok(guest, { t: 'room.card', charId: '' });
    await host.waitFor('room.state', (s) => seatOf(s, guest.id) && seatOf(s, guest.id).card === undefined);
  });
});
