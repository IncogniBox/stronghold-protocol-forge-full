// test/assetPackProxy.test.js — 「大型资源」备用源的**同源代理**（server/assetPack.js）：三条 SSRF 约束、按序回退、
// 全失败点名 502、未声明 404、以及「流式转发不是缓冲」。用两个真 http 服务器（上游 + 代理）在临时目录里跑，
// 不碰真实安装、不联网。理由见 docs/ASSETS.md 那一节（页面的 CSP 是 `connect-src 'self'`，跨域那一跳必须服务端走）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { ASSET_PACK_PREFIX, createAssetPackProxy, fileGroup, prefixProblem, readPackConfig, upstreamCandidates } from '../server/assetPack.js';

const SILENT = { warn() {}, error() {}, log() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-assetpack-'));
const writeCfg = (root, doc) => {
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/asset-pack.json'), `${JSON.stringify(doc, null, 1)}\n`);
};
/** 起一个服务器，返回 `{ server, url, requests }`。 */
const listen = async (handler) => {
  const requests = [];
  const server = http.createServer((req, res) => { requests.push(req.method + ' ' + req.url); handler(req, res); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${server.address().port}`, requests };
};
/** 代理的宿主：`/asset-pack/*` 交给代理，其余 404。`now` 默认每问一次走一秒 —— 测试里连发多条请求也不该被限流。 */
const proxyHost = async (root, opts = {}) => {
  let t = 0;
  const proxy = createAssetPackProxy({ root, log: SILENT, now: () => (t += 1000), ...opts });
  const host = await listen((req, res) => {
    const url = req.url.split('?')[0];
    if (url.startsWith(ASSET_PACK_PREFIX)) { void proxy.serve(req, res, url.slice(ASSET_PACK_PREFIX.length)); return; }
    res.writeHead(404, { 'Content-Length': '0' }).end();
  });
  return { ...host, proxy };
};
const read = async (url, init) => {
  const r = await fetch(url, init);
  const body = new Uint8Array(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, body, json: () => JSON.parse(new TextDecoder().decode(body)) };
};
const close = async (...hosts) => { for (const h of hosts) await new Promise((r) => h.server.close(r)); };

describe('assetPack：三条 SSRF 约束（纯函数）', () => {
  test('前缀：干净的 http(s) 才放行；scheme / userinfo / .. / 空白 一律有理由', () => {
    assert.equal(prefixProblem('https://github.com/o/n/releases/download'), null);
    assert.equal(prefixProblem('http://127.0.0.1:8099'), null);
    assert.match(prefixProblem('ftp://example.com/x'), /scheme/);
    assert.match(prefixProblem('https://user:pw@github.com/x'), /userinfo/);
    assert.match(prefixProblem('https://github.com/a/../b'), /"\.\."|"."/);
    assert.match(prefixProblem('https://github.com/a b'), /whitespace/);
    assert.match(prefixProblem('/only/a/path'), /not an absolute URL/);
    assert.equal(prefixProblem(''), 'empty');
  });

  test('候选源：releaseBase 在前、mirrors 依次在后；被拒的**带上理由且不尝试**', () => {
    const config = {
      releaseBase: 'https://gh.example.com/dl', tag: 't', mirrors: ['https://m1.example.com', 'https://u@ev.example.com', ''],
    };
    const c = upstreamCandidates(config, 'local__scene.zip');
    assert.deepEqual(c.map((x) => [x.source, x.reason === null]), [['releaseBase', true], ['mirror', true], ['mirror', false]]);
    assert.equal(c[0].url, 'https://gh.example.com/dl/t/local__scene.zip');
    assert.equal(c[1].url, 'https://m1.example.com/local__scene.zip');
    assert.match(c[2].reason, /userinfo/);
  });

  test('文件名白名单：逐字等于某个 groups[].file 才算声明过', () => {
    const config = { groups: [{ file: 'local__scene.zip' }, { file: 'audio__bgm.zip' }] };
    assert.equal(fileGroup(config, 'local__scene.zip').file, 'local__scene.zip');
    assert.equal(fileGroup(config, 'audio__bgm.zip').file, 'audio__bgm.zip');
    assert.equal(fileGroup(config, 'local__scene.zip '), null, '多一个空格就不是同一个名字');
    assert.equal(fileGroup(config, 'Local__scene.zip'), null);
    assert.equal(fileGroup(config, '../data/asset-pack.json'), null);
    assert.equal(fileGroup(config, ''), null);
  });

  test('配置：文件不在 / 坏 JSON / groups 为空 ⇒ 没配置（端点因此 404）', () => {
    const root = tmp();
    try {
      assert.equal(readPackConfig(root), null);
      writeCfg(root, { v: 1, groups: [] });
      assert.equal(readPackConfig(root), null, 'groups 为空 = 没配置');
      fs.writeFileSync(path.join(root, 'data/asset-pack.json'), '{');
      assert.equal(readPackConfig(root), null);
      writeCfg(root, { v: 1, repo: 'a/b', tag: 't', groups: [{ file: 'x.zip' }] });
      assert.equal(readPackConfig(root).groups.length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe('assetPack：端点行为（真 http 上游 + 真代理）', () => {
  test('未配置 ⇒ 404 NOT_CONFIGURED；未声明的文件名 ⇒ 404 NOT_FOUND（不泄漏配置）', async () => {
    const root = tmp();
    const zip = new Uint8Array([1, 2, 3]);
    const up = await listen((req, res) => { res.writeHead(200, { 'Content-Length': String(zip.length) }).end(Buffer.from(zip)); });
    const host = await proxyHost(root);
    try {
      const a = await read(`${host.url}${ASSET_PACK_PREFIX}local__scene.zip`);
      assert.equal(a.status, 404);
      assert.equal(a.json().error, 'NOT_CONFIGURED');
      writeCfg(root, { v: 1, repo: 'a/b', tag: 't', releaseBase: up.url, mirrors: [], groups: [{ file: 'local__scene.zip', bytes: zip.length }] });
      const b = await read(`${host.url}${ASSET_PACK_PREFIX}not-declared.zip`);
      assert.equal(b.status, 404);
      assert.deepEqual(Object.keys(b.json()), ['error'], '只说 404，不列配置里有什么');
      const c = await read(`${host.url}${ASSET_PACK_PREFIX}nested/file.zip`);
      assert.equal(c.status, 404, '文件名里带路径分隔符也拒');
    } finally { await close(host, up); fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('按序回退：第一个源 404 ⇒ 第二个源 200，字节与头照抄', async () => {
    const root = tmp();
    const body = Buffer.from('zip-bytes-'.repeat(64));
    const up = await listen((req, res) => {
      if (req.url.startsWith('/bad/')) { res.writeHead(404, { 'Content-Length': '0' }).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(body.length) }).end(body);
    });
    writeCfg(root, { v: 1, repo: 'a/b', tag: 't', releaseBase: `${up.url}/bad`, mirrors: [`${up.url}/good`], groups: [{ file: 'local__scene.zip', bytes: body.length }] });
    const host = await proxyHost(root);
    try {
      const r = await read(`${host.url}${ASSET_PACK_PREFIX}local__scene.zip`);
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'application/zip');
      assert.equal(Number(r.headers.get('content-length')), body.length);
      assert.equal(Buffer.from(r.body).toString(), body.toString(), '字节原样转发');
      assert.deepEqual(up.requests, ['GET /bad/t/local__scene.zip', 'GET /good/local__scene.zip'], '按序试，且只试这两个');
    } finally { await close(host, up); fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('全失败 ⇒ 502，body 里逐点名每个源与理由；被拒的前缀**根本没被请求**', async () => {
    const root = tmp();
    const up = await listen((req, res) => { res.writeHead(500, { 'Content-Length': '0' }).end(); });
    writeCfg(root, {
      v: 1, repo: 'a/b', tag: 't', releaseBase: `${up.url}/bad`,
      mirrors: ['https://user@example.invalid'], groups: [{ file: 'local__scene.zip', bytes: 10 }],
    });
    const host = await proxyHost(root);
    try {
      const r = await read(`${host.url}${ASSET_PACK_PREFIX}local__scene.zip`);
      assert.equal(r.status, 502);
      const j = r.json();
      assert.equal(j.error, 'UPSTREAM_FAILED');
      assert.equal(j.file, 'local__scene.zip');
      assert.equal(j.tried.length, 2);
      assert.match(j.tried[0].reason, /HTTP 500/);
      assert.match(j.tried[1].reason, /userinfo/);
      assert.deepEqual(up.requests, ['GET /bad/t/local__scene.zip'], '带 userinfo 的镜像不尝试');
    } finally { await close(host, up); fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('体积上限：上游声明的字节数超过该组 bytes × 1.2 ⇒ 这一源不算数（换下一个/最终 502）', async () => {
    const root = tmp();
    const big = Buffer.alloc(1000, 7);
    const up = await listen((req, res) => { res.writeHead(200, { 'Content-Length': String(big.length) }).end(big); });
    writeCfg(root, { v: 1, repo: 'a/b', tag: 't', releaseBase: `${up.url}/x`, mirrors: [], groups: [{ file: 'local__scene.zip', bytes: 10 }] });
    const host = await proxyHost(root);
    try {
      const r = await read(`${host.url}${ASSET_PACK_PREFIX}local__scene.zip`);
      assert.equal(r.status, 502);
      assert.match(r.json().tried[0].reason, /over the 12 byte cap/);
    } finally { await close(host, up); fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('HEAD 只回头；GET 之外在路由层就是 405（这里再验 HEAD 不带体）', async () => {
    const root = tmp();
    const body = Buffer.from('x'.repeat(32));
    const up = await listen((req, res) => { res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(body.length) }).end(req.method === 'HEAD' ? undefined : body); });
    writeCfg(root, { v: 1, repo: 'a/b', tag: 't', releaseBase: up.url, mirrors: [], groups: [{ file: 'local__scene.zip', bytes: body.length }] });
    const host = await proxyHost(root);
    try {
      const r = await read(`${host.url}${ASSET_PACK_PREFIX}local__scene.zip`, { method: 'HEAD' });
      assert.equal(r.status, 200);
      assert.equal(Number(r.headers.get('content-length')), body.length);
      assert.equal(r.body.length, 0, 'HEAD 不带来 body');
      assert.deepEqual(up.requests, ['HEAD /t/local__scene.zip'], 'HEAD 一路上游也是 HEAD，且 URL 带 tag 那一段');
    } finally { await close(host, up); fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('限流：同一客户端地址连发超过桶容量 ⇒ 429 + Retry-After（桶照 server/net.js 的既有做法）', async () => {
    const root = tmp();
    const zip = Buffer.from('x');
    const up = await listen((req, res) => { res.writeHead(200, { 'Content-Length': String(zip.length) }).end(zip); });
    writeCfg(root, { v: 1, repo: 'a/b', tag: 't', releaseBase: up.url, mirrors: [], groups: [{ file: 'local__scene.zip', bytes: zip.length }] });
    const host = await proxyHost(root, { now: () => 0 });   // 时间不走：桶只会被取走
    try {
      const ok1 = await read(`${host.url}${ASSET_PACK_PREFIX}local__scene.zip`);
      const ok2 = await read(`${host.url}${ASSET_PACK_PREFIX}local__scene.zip`);
      const denied = await read(`${host.url}${ASSET_PACK_PREFIX}local__scene.zip`);
      assert.deepEqual([ok1.status, ok2.status], [200, 200], '突发容量内的两条照常');
      assert.equal(denied.status, 429);
      assert.equal(denied.headers.get('retry-after'), '1');
      assert.equal(denied.json().error, 'RATE');
    } finally { await close(host, up); fs.rmSync(root, { recursive: true, force: true }); }
  });
});
