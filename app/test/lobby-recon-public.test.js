// test/lobby-recon-public.test.js — 重构模拟对公网开放（业主 2026-10-29「把重构模拟在云服务器开放，可以实际游玩」）。
//
// 缺省（`reconPublic` 为 false）沿用本地闸：非本地端会话的 `room.create { mode:'recon' }` 被点名拒绝，`welcome`
// 里也没有 `reconAllowed`。部署方把 `SP_RECON_PUBLIC=1`（或 startServer 直接传 `reconPublic: true`）打开之后，
// 任何会话都能开重构房，`welcome.reconAllowed === true` 让客户端画出大厅入口。
//
// 「全量模拟」不受这一格影响：`devAllowed` 仍按 `session.local`。
//
// 怎么装成「公网会话」：`startServer({ trustProxy: true })` + 连接时带 `x-forwarded-for: <公网地址>`，
// 这正是 server/net.js `clientAddress` 给 Caddy 后面那台服务器的口径（本机回环会话拿到的只会是 local）。
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, reconPublicFrom } from '../shared/constants.js';

const REMOTE_IP = '203.0.113.9';   // TEST-NET-3：永远不是回环 / 私网

describe('reconPublicFrom', () => {
  test('缺省 / 空 / 写错都是 false，只有明确的真值才打开', () => {
    assert.equal(reconPublicFrom(undefined), false);
    assert.equal(reconPublicFrom({}), false);
    assert.equal(reconPublicFrom({ SP_RECON_PUBLIC: '' }), false);
    assert.equal(reconPublicFrom({ SP_RECON_PUBLIC: '0' }), false);
    assert.equal(reconPublicFrom({ SP_RECON_PUBLIC: 'nope' }), false);
    assert.equal(reconPublicFrom({ SP_RECON_PUBLIC: '1' }), true);
    assert.equal(reconPublicFrom({ SP_RECON_PUBLIC: ' TRUE ' }), true);
    assert.equal(reconPublicFrom({ SP_RECON_PUBLIC: 'on' }), true);
  });
});

/** 一台测试服务器：空工坊根（不加载本机装的那十几个包，判据只看这一格）。 */
function emptyWorkshopDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sp-recon-public-'));
}

/** 从「公网地址」连进来的客户端（trustProxy 读 `x-forwarded-for`）。 */
async function remoteClient(srv) {
  const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`, {
    wsOptions: { headers: { 'x-forwarded-for': REMOTE_IP } },
  });
  const welcome = await c.hello('ReconPlayer');
  c.id = welcome.playerId;
  c.token = welcome.token;
  return { c, welcome };
}

describe('recon simulation on a public server', () => {
  let closed = [];
  const open = async (opts) => {
    const srv = await startServer({
      port: 0, host: '127.0.0.1', quiet: true, trustProxy: true,
      workshopDir: emptyWorkshopDir(), ...opts,
    });
    closed.push(srv);
    return srv;
  };
  after(async () => {
    for (const s of closed) await s.close();
    closed = [];
  });

  test('没开 SP_RECON_PUBLIC：公网会话拿不到 reconAllowed，建房被点名拒绝', async () => {
    const srv = await open({ reconPublic: false });
    const { c, welcome } = await remoteClient(srv);
    try {
      assert.notEqual(welcome.devAllowed, true, '公网会话不该有 devAllowed');
      assert.equal('reconAllowed' in welcome, false, `welcome 不该带 reconAllowed：${JSON.stringify(Object.keys(welcome))}`);
      const reply = await c.request({ t: 'room.create', mode: 'recon', difficulty: 'ABYSS' });
      assert.equal(reply.t, 'error', JSON.stringify(reply));
      assert.equal(reply.code, ERR.BAD_MSG, JSON.stringify(reply));
      assert.match(String(reply.detail || ''), /local/, JSON.stringify(reply));
    } finally {
      await c.close().catch(() => {});
    }
  });

  test('开了 reconPublic：Welcome 带 reconAllowed，公网会话能开重构房（全量模拟仍被拒）', async () => {
    const srv = await open({ reconPublic: true });
    const { c, welcome } = await remoteClient(srv);
    try {
      assert.equal(welcome.reconAllowed, true, JSON.stringify(Object.keys(welcome)));
      assert.notEqual(welcome.devAllowed, true, '「全量模拟」仍只归本地端');
      const reply = await c.request({ t: 'room.create', mode: 'recon', difficulty: 'ABYSS', teamCount: 1 });
      assert.equal(reply.t, 'ok', JSON.stringify(reply));
      const state = await c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === 'recon');
      assert.equal(state.mode, 'recon');
      assert.equal(state.difficulty, 'ABYSS');
      // 本地闸之外的那一格没被顺带打开：同一个公网会话发 room.create.dev 仍是拒绝
      const dev = await c.request({ t: 'room.create', mode: 'solo', difficulty: 'NORMAL', dev: true });
      assert.equal(dev.t, 'error', JSON.stringify(dev));
      assert.equal(dev.code, ERR.BAD_MSG, JSON.stringify(dev));
    } finally {
      await c.close().catch(() => {});
    }
  });

  test('本地端会话照旧能开重构房（有没有 reconPublic 都一样）', async () => {
    const srv = await open({ reconPublic: false });
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    try {
      const welcome = await c.hello('LocalPlayer');
      c.id = welcome.playerId;
      assert.equal(welcome.devAllowed, true, '本地端会话仍有 devAllowed');
      const reply = await c.request({ t: 'room.create', mode: 'recon', difficulty: 'ABYSS' });
      assert.equal(reply.t, 'ok', JSON.stringify(reply));
    } finally {
      await c.close().catch(() => {});
    }
  });
});
