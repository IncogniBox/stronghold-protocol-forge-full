// test/modPackLaneOrigin.test.mjs — 包 lane 升级那一刻的**同源性守卫**（`workshop/server-ext/server/accounts.mjs`
// 的 `AccountService#onUpgrade`）。
//
// 它守的是「跨**站**页面拿着浏览器里那份本地存储来打这条账号通道」这件事。守卫的判据曾经是 `Origin#host ===
// Host`，在反代后面必然失配（反代把 `Host` 改写成 `127.0.0.1:3001`，浏览器发来的 `Origin` 是公网域名）
// ⇒ 线上账号面板 403，而本机 `:3000` 直连时 `Origin` 与 `Host` 相同，本地测试撞不到。于是目标主机名优先认
// `X-Forwarded-Host`、并且用 `hostname`（不带端口）来比。这五条把两个方向都钉住：放宽的那几条要放行，挡跨站
// 的那几条要照旧拒。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountService } from '../workshop/server-ext/server/accounts.mjs';

/** 起一个只够跑 `onUpgrade` 的服务实例（守卫不碰 db，构造器只读 `log`）。 */
function makeService() {
  const log = { info() {}, warn() {}, error() {} };
  return new AccountService({ host: { log }, db: { data: {} }, adminToken: '', log });
}

/**
 * 跑一次升级，返回 `ctx.reject` 收到的状态码与 socket 上写出去的字节。
 * @param {Record<string, string>} headers
 */
function upgrade(headers) {
  const service = makeService();
  const rejected = [];
  const writes = [];
  const req = { headers, socket: { remoteAddress: '127.0.0.1' } };
  const socket = {
    write: (chunk) => { writes.push(String(chunk)); return true; },
    on() {},
    destroy() {},
    end() {},
  };
  const ctx = { reject: (status, text) => rejected.push([status, text]), log: { warn() {}, error() {} } };
  service.onUpgrade(req, socket, Buffer.alloc(0), ctx, '127.0.0.1');
  return { rejected, writes };
}

const KEY = { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' };

test('有 X-Forwarded-Host 且与 Origin 主机名相同 ⇒ 放行（反代把 Host 改写成回环地址的场景）', () => {
  const { rejected, writes } = upgrade({
    origin: 'https://exastrisrestart.top',
    host: '127.0.0.1:3001',
    'x-forwarded-host': 'exastrisrestart.top',
    ...KEY,
  });
  assert.deepEqual(rejected, []);
  assert.match(writes[0], /^HTTP\/1\.1 101 Switching Protocols/);
});

test('无 X-Forwarded-Host 且 Origin 主机名 == Host ⇒ 照旧放行', () => {
  const { rejected, writes } = upgrade({ origin: 'https://localhost:3000', host: 'localhost:3000', ...KEY });
  assert.deepEqual(rejected, []);
  assert.match(writes[0], /^HTTP\/1\.1 101 Switching Protocols/);
});

test('X-Forwarded-Host 与 Origin 不匹配 ⇒ 拒 403', () => {
  const { rejected, writes } = upgrade({
    origin: 'https://exastrisrestart.top',
    host: '127.0.0.1:3001',
    'x-forwarded-host': 'evil.example',
    ...KEY,
  });
  assert.deepEqual(rejected, [[403, 'cross-origin upgrade refused']]);
  assert.deepEqual(writes, []);
});

test('无 X-Forwarded-Host 且 Host 不匹配 ⇒ 拒 403', () => {
  const { rejected, writes } = upgrade({ origin: 'https://evil.example', host: '127.0.0.1:3001', ...KEY });
  assert.deepEqual(rejected, [[403, 'cross-origin upgrade refused']]);
  assert.deepEqual(writes, []);
});

test('X-Forwarded-Host 是逗号列表 ⇒ 只认第一段（大小写与端口都不影响判定）', () => {
  const { rejected, writes } = upgrade({
    origin: 'https://exastrisrestart.top',
    host: '127.0.0.1:3001',
    'x-forwarded-host': ' ExastrisRestart.Top:443 , proxy.internal ',
    ...KEY,
  });
  assert.deepEqual(rejected, []);
  assert.match(writes[0], /^HTTP\/1\.1 101 Switching Protocols/);
});

test('没有 Origin 头 ⇒ 照旧放行（非浏览器客户端）；Origin 解析不出来 ⇒ 照旧拒', () => {
  const noOrigin = upgrade({ host: 'localhost:3000', ...KEY });
  assert.deepEqual(noOrigin.rejected, []);
  assert.match(noOrigin.writes[0], /^HTTP\/1\.1 101 Switching Protocols/);

  const garbage = upgrade({ origin: 'not a url', host: 'localhost:3000', ...KEY });
  assert.deepEqual(garbage.rejected, [[403, 'cross-origin upgrade refused']]);
});
