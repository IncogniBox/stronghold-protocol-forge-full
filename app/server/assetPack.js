// server/assetPack.js — 「大型资源」备用源的**同源代理**（客户端的路径永远是 `/asset-pack/<file>`）。
//
// 为什么要有它（实测结论，docs/ASSETS.md 那一节）：页面的 CSP 是 `connect-src 'self'`（server/http/csp.js），
// **跨域请求根本发不出去** —— 浏览器连一条网络请求都不会发（上一轮的真机 Chrome 实测：控制台
// `violates the following Content Security Policy directive: "connect-src 'self'"`，临时静态服务器收到 0 个请求）。
// 而 GitHub Release 的下载天生跨域（`github.com` → 302 → `objects.githubusercontent.com`）。所以客户端**只跟自己
// 同源说话**，跨域那一跳由**服务端**去走：这里按 `data/asset-pack.json` 声明的源**按序回退**取字节，再流式转发。
// CSP 一个字都不用动。
//
// 三条 SSRF 约束（这是这条端点能存在的前提）：
//   1. **文件名白名单**：`<file>` 必须逐字等于某个 `groups[].file`；不匹配 ⇒ 404（不泄漏配置细节，日志里记一行）。
//   2. **前缀锚定**：候选源一律由 `releaseBase` / `mirrors[]` 里声明的前缀**拼出来**，且拼出来的 URL 必须仍以那个
//      前缀开头（规范化后比较）；前缀本身必须是干净的 http(s) URL —— 禁 `..`、禁 userinfo（`user@host`）、
//      禁反斜杠/空白/控制字符。任何一条不满足 ⇒ 该源被拒并记下理由（不尝试）。
//   3. **超时 + 体积上限 + 限流**：上游 15 s 无数据即断；响应体按**该组声明的 `bytes` × 1.2** 封顶（超了断流并记一行）；
//      端点按**客户端地址**限流（`TokenBucket` 的既有做法，见 server/http/routes.js 的战绩路由那一格）。
//
// 其余形状：
//   * **未配置就不存在**：`data/asset-pack.json` 缺失 / `groups` 为空 ⇒ 404，与引擎「没有声明就没有这格」同一条不变量；
//   * **流式**：绝不把整包读进内存（`for await` 读上游 body，边读边 `res.write`，满则等 `drain`）；
//   * **只读**：没有令牌、没有写面（GET / HEAD 之外的动词在 server/http/routes.js 就 405 了，这里再判一次）；
//   * **全失败 ⇒ 502**，body 里逐点名每个源与它失败的理由（客户端把那句话直接显示给玩家）。
import path from 'node:path';
import { readFileSync as fsReadFileSync } from 'node:fs';
import { once } from 'node:events';
import { TokenBucket } from './net.js';

/** 端点前缀（同源；同时进 routeMount 的保留命名空间，包声明不可能顶掉它）。 */
export const ASSET_PACK_PREFIX = '/asset-pack/';
/** 每机配置（`tools/asset-pack.mjs --apply` 写；gitignore）。 */
export const ASSET_PACK_REL = 'data/asset-pack.json';
/** 上游无数据多久就断。 */
export const ASSET_PACK_IDLE_TIMEOUT_MS = 15000;
/** 体积上限 = 该组声明的 `bytes` × 这个系数。 */
export const ASSET_PACK_MAX_FACTOR = 1.2;
/** 端点限流：每客户端地址一只桶（与战绩路由同一套 `TokenBucket`）。 */
export const ASSET_PACK_RATE_PER_SEC = 1;
export const ASSET_PACK_RATE_BURST = 2;

/** 读配置：文件不在 / 不是对象 / `groups` 为空都算「未配置」⇒ null（端点因此 404）。 */
export function readPackConfig(root, { readFileSync: readFile = fsReadFileSync, join = path.join } = {}) {
  let doc;
  try { doc = JSON.parse(readFile(join(root, ...ASSET_PACK_REL.split('/')), 'utf8')); } catch { return null; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  if (!Array.isArray(doc.groups) || doc.groups.length === 0) return null;
  return doc;
}

/** 该文件名是不是某个组声明的 `file`（**逐字**相等）？是就给那个组，否则 null。 */
export function fileGroup(config, file) {
  if (!config || typeof file !== 'string' || !file) return null;
  return (config.groups || []).find((g) => g && typeof g.file === 'string' && g.file === file) || null;
}

/**
 * 一个声明前缀能不能用：返回值是问题描述，null 是没问题。规范化后的前缀还要能被 `new URL` 解析。
 * 禁 userinfo（`https://user@host`）、禁 `..` 段、禁反斜杠与空白/控制字符、禁非 http(s)。
 */
export function prefixProblem(prefix) {
  if (typeof prefix !== 'string' || !prefix) return 'empty';
  if (/[\\\s\x00-\x1f]/.test(prefix)) return 'contains a backslash, whitespace or a control character';
  // `..` 必须在**解析之前**判：`new URL('https://h/a/../b').pathname` 已经是 `/b`（解析器自己规范化掉了）。
  const afterAuthority = prefix.replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/, '');
  if (/(?:^|\/)\.\.?(?:\/|$)/.test(afterAuthority)) return 'has a "." or ".." segment';
  let u;
  try { u = new URL(prefix); } catch { return 'not an absolute URL'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `scheme ${u.protocol} is not http(s)`;
  if (u.username || u.password) return 'carries userinfo (user@host)';
  if (!u.host) return 'has no host';
  return null;
}

/**
 * 按序候选源：`<releaseBase>/<tag>/<file>` → 每个 `mirrors[i]` 前缀 + `/<file>`。
 * 每个候选都带上「它从哪个声明来」，被拒的带上理由（不尝试）。
 * @returns {{ url: string, source: string, reason: null | string }[]}
 */
export function upstreamCandidates(config, file) {
  const out = [];
  const add = (prefix, source) => {
    if (!prefix) return;
    const problem = prefixProblem(prefix);
    if (problem) { out.push({ url: prefix, source, reason: problem }); return; }
    const base = prefix.replace(/\/+$/, '');
    const url = `${base}/${file}`;
    // 前缀锚定：拼出来的 URL 必须仍以那个前缀开头（两边都规范化：去掉尾斜杠 + `new URL` 一次）。
    // 注意**不能**拿 `new URL(prefix).href` 直接比 —— 裸域名前缀（`http://h:8099`）的 href 带尾斜杠，
    // 再补一个 `/` 就成了 `//`，任何候选都会被误判。
    let anchored;
    try { anchored = new URL(url).href.startsWith(`${new URL(base).href.replace(/\/+$/, '')}/`); } catch { anchored = false; }
    if (!anchored) { out.push({ url, source, reason: 'the built URL does not start with the declared prefix' }); return; }
    out.push({ url, source, reason: null });
  };
  const base = String(config.releaseBase || '').replace(/\/+$/, '');
  const tag = typeof config.tag === 'string' ? config.tag.trim() : '';
  // Release 附件的形状是 `<releaseBase>/<tag>/<file>`（tag 是路径的一段，所以整段前缀一起过判据）。
  if (base && tag) add(`${base}/${tag}`, 'releaseBase');
  for (const m of Array.isArray(config.mirrors) ? config.mirrors : []) add(String(m || ''), 'mirror');
  return out;
}

/** 该文件名是不是这一条路径（前缀之后的部分）能有的形状：单个路径段、无斜杠、无 `..`。 */
const nameProblem = (file) => {
  if (!file) return 'missing';
  if (file.includes('/') || file.includes('\\')) return 'a path separator';
  if (file === '.' || file === '..' || file.startsWith('.')) return 'a dot name';
  return null;
};

/**
 * 建一个代理实例：`{ prefix, serve(req, res, file) }`。
 * @param {{ root: string, log?: any, fetchImpl?: Function, readFileSync?: Function, now?: () => number }} o
 */
export function createAssetPackProxy({ root, log = console, fetchImpl, readFileSync, now = Date.now }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const readFile = readFileSync || fsReadFileSync;
  const buckets = new Map();

  const admit = (req, res) => {
    const key = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
    const at = now();
    let bucket = buckets.get(key);
    if (!bucket) { bucket = new TokenBucket(ASSET_PACK_RATE_PER_SEC, ASSET_PACK_RATE_BURST, at); buckets.set(key, bucket); }
    if (!bucket.take(at)) {
      res.setHeader('Retry-After', '1');
      sendJson(req, res, 429, { error: 'RATE' });
      return false;
    }
    if (buckets.size > 64) { for (const [k, b] of buckets) if (at - b.at > 60000) buckets.delete(k); }
    return true;
  };

  /** 从上游取一个源：先只做「能不能开始」的判断（状态码 / 声明体积），再流式转发。 */
  const pull = async (req, res, candidate, cap) => {
    const ctl = new AbortController();
    let timer = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => ctl.abort(new Error(`idle for ${ASSET_PACK_IDLE_TIMEOUT_MS} ms`)), ASSET_PACK_IDLE_TIMEOUT_MS);
    };
    bump();
    try {
      const up = await doFetch(candidate.url, { method: req.method, redirect: 'follow', signal: ctl.signal });
      if (!up.ok) {
        await up.body?.cancel?.();
        return { ok: false, reason: `HTTP ${up.status}` };
      }
      const declared = Number(up.headers.get('content-length')) || 0;
      if (declared > cap) {
        await up.body?.cancel?.();
        return { ok: false, reason: `${declared} bytes declared, over the ${cap} byte cap` };
      }
      const headers = { 'Content-Type': 'application/zip', 'Cache-Control': 'no-store' };
      if (declared) headers['Content-Length'] = String(declared);
      res.writeHead(200, headers);
      if (req.method === 'HEAD' || !up.body) { res.end(); return { ok: true }; }
      let received = 0;
      for await (const chunk of up.body) {
        bump();
        received += chunk.length;
        if (received > cap) {
          log.warn?.(`[素材包] 上游 ${candidate.url} 超过声明的体积上限 ${cap} 字节，已断流`);
          res.destroy();
          return { ok: false, reason: `streamed past the ${cap} byte cap` };
        }
        if (!res.write(chunk)) await once(res, 'drain');
      }
      res.end();
      return { ok: true, bytes: received };
    } catch (e) {
      return { ok: false, reason: e && e.message ? e.message : String(e) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  /**
   * 认领一条 `/asset-pack/<file>`：true = 这条请求由这里回答。
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @param {string} file 前缀之后的部分（由 routes.js 切好）
   */
  const serve = async (req, res, file) => {
    if (!admit(req, res)) return;
    const bad = nameProblem(file);
    if (bad) { log.warn?.(`[素材包] 拒绝的请求（文件名 ${bad}）：${String(file).slice(0, 80)}`); sendJson(req, res, 404, { error: 'NOT_FOUND' }); return; }
    const config = readPackConfig(root, { readFileSync: readFile });
    if (!config) { sendJson(req, res, 404, { error: 'NOT_CONFIGURED' }); return; }
    const group = fileGroup(config, file);
    if (!group) {
      // 200 多条白名单里的一次未命中：不告诉调用方「配置里有什么」，只在服务器控制台记一行。
      log.warn?.(`[素材包] 未声明的包名：${file}`);
      sendJson(req, res, 404, { error: 'NOT_FOUND' });
      return;
    }
    const cap = Math.ceil((Number(group.bytes) || 0) * ASSET_PACK_MAX_FACTOR);
    const candidates = upstreamCandidates(config, file);
    const tried = [];
    for (const candidate of candidates) {
      if (candidate.reason) { tried.push({ source: candidate.source, url: candidate.url, reason: candidate.reason }); continue; }
      const r = await pull(req, res, candidate, cap);
      if (r.ok) return;
      if (res.headersSent) { if (!res.writableEnded) res.destroy(); return; }   // 已经开始回了：只能断流，不能换源
      tried.push({ source: candidate.source, url: candidate.url, reason: r.reason });
    }
    if (res.headersSent) { if (!res.writableEnded) res.destroy(); return; }
    log.warn?.(`[素材包] ${file} 的每个源都失败：${tried.map((x) => `${x.url} → ${x.reason}`).join('；')}`);
    sendJson(req, res, 502, {
      error: 'UPSTREAM_FAILED',
      file,
      tried: tried.length ? tried : [{ source: 'none', url: '', reason: 'no source is declared' }],
    });
  };

  return { prefix: ASSET_PACK_PREFIX, serve };
}

// 与 server/http/common.js 的 sendJson 同一形状（这里不 import 它：那是 HTTP 层，这一格只回 JSON 体）。
function sendJson(req, res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : body);
}
