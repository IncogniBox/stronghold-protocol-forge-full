// tools/large-assets.mjs — 「大型资源」的完整性清单、核对与补齐（服务器启动时由 server/largeAssets.js 当子进程调用，
// 也可以单独跑给运维用）。
//
// 为什么需要它：`MANIFEST.json` 校验的是**代码**（`server/update.js` 的 `isSetupArt` 把 `public/assets/` 明确排除在外），
// 而 `data/assets.json` / `data/local-assets.json` 只录「引擎会去查表的那部分素材」—— 3D 棋盘直接读盘的那批文件
// （`local/scene/**` 的 35 个光照图、`local/map/**` 的 13 个 tiles/materials/贴图）**任何清单都不管**。所以本工具用
// `--snapshot` 从**当前安装**生成一份自己的清单 `data/large-assets.json`（path → size + sha256），核对以它为判据；
// 缺的/短的从 CDN 基址（`SP_CDN_BASE`，默认本项目的 `speedcdn.jiangjiangze.icu`，它按引擎的 `/assets/...` 形状发字节、
// 支持 Range）取回。
//
// 用法：
//   node tools/large-assets.mjs --snapshot     按 scope 把当前安装的大资源写进 data/large-assets.json
//   node tools/large-assets.mjs --check        只核对（默认动作），不下载；有缺失/短小时退出码 1
//   node tools/large-assets.mjs --list         给「资源查看」面板的一份快照（总量 + 分组 + 每个文件），不下载
//   node tools/large-assets.mjs --repair       核对 + 把缺失/短小的文件从 CDN 补齐
//   node tools/large-assets.mjs --repair --force [--only <组|rel>]
//                                              强制重新下载（不看核对结论；`--only` 不带就是全部）
//   node tools/large-assets.mjs --check --json 机器可读：每行一个 JSON（服务器就是读它显示进度的）
// 环境：SP_CDN_BASE（源基址）、SP_LARGE_ASSETS_SCOPE（默认 `assets/local/`）、SP_LARGE_ASSETS_MIN（默认 1048576）。
//
// **备用来源（第二手）**：CDN 那条路（逐文件）先照旧跑完；仍「缺 / 短 / 哈希不符」的那些，改从
// `data/asset-pack.json` 声明的 **Release 组包**补（`repairFromPacks`）—— 只按 `groups[].file` 白名单取、
// 源顺序 `<releaseBase>/<tag>/<file>` → `mirrors[]`、只收 https；用 `shared/zip.js zipRead` 解包，条目
// **逐条**与 `data/large-assets.json` 比 size + sha256，只写通过的，不符/没有的逐条点名。某一组取不到只
// 点名、不阻断别的组（这一整手也只在 `--repair` / `--force` 这条路上跑，`--check` / `--list` 不下载）。
//
// 两条判据纪律（docs/ASSETS.md 同步写）：
//   * **只补不含糊**：只动「缺」与「比清单短」的文件；尺寸更大或尺寸相同但哈希不符只**报告**，不覆盖 —— 清单陈旧
//     或 CDN 是另一平台编码时，绝不拿它们换掉盘上那份好的。
//   * **哈希按需算**：先比 size；size 一致且状态文件里记着同 size + 同 mtime 就跳过，只有 size 变了或从没见过才算
//     sha256（否则每次开机全量哈希几百 MB）。
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Downloader } from './assets/downloader.mjs';
import { kindOf } from './assets/formats.mjs';
import { zipRead, ZIP_LIMITS } from '../shared/zip.js';
// 备用来源读的是**同一份**声明（白名单 / 源顺序都复用这一格，免得两边漂）——`data/asset-pack.json`。
import { ASSET_PACK_REL, ASSET_PACK_MAX_FACTOR, readPackConfig, upstreamCandidates } from '../server/assetPack.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_REL = 'data/large-assets.json';
export const STATE_REL = '.cache/large-assets-state.json';
/** 默认 CDN 基址：本项目的素材 CDN（按引擎 URL 形状发字节）。 */
export const DEFAULT_CDN_BASE = 'https://speedcdn.jiangjiangze.icu';
/** scope 前缀之外只收这么大的文件（「大型资源」的默认口径）。 */
export const DEFAULT_MIN_BYTES = 1048576;
export const DEFAULT_SCOPE = 'assets/local/';
/**
 * 排除前缀：`assets/local/fx/**` 是 fx 提取器（tools/local-extract）的**本机自产物**——每台安装机自己跑
 * `extract.py --only fx` 生成（或由工坊包的 fx.manifest 通道携带），不在素材镜像 / Release 组包里。
 * 收进清单只会让启动核对去远端拉一批永远 404 的条目（2026-10-22 实测：270 项 half 贴图 404、5.2 MB）。
 */
export const SKIP_PREFIXES = Object.freeze(['assets/local/fx/']);

export const MB = (n) => (n / 1048576).toFixed(1);
export const absOf = (root, rel) => path.join(root, 'public', ...rel.split('/'));
const readJson = (abs) => { try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return null; } };
const statOf = (abs) => { try { const s = fs.statSync(abs); return s.isFile() ? s : null; } catch { return null; } };
const sha256File = (abs) => { try { return createHash('sha256').update(fs.readFileSync(abs)).digest('hex'); } catch { return null; } };

/** 清单文件本身的指纹：清单换了（发布新版素材）⇒ 状态文件作废，重新哈希一遍。 */
export const manifestHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

/**
 * 按 scope 从当前安装生成清单：`assets/<scope>**` 全收，其余只收 ≥ `minBytes` 的（默认 1 MiB）。
 * @param {{ root?: string, scope?: string, minBytes?: number }} [opts]
 */
export function snapshot({ root = ROOT, scope = DEFAULT_SCOPE, minBytes = DEFAULT_MIN_BYTES } = {}) {
  const from = path.join(root, 'public', 'assets');
  const files = {};
  (function walk(dir, relDir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      const key = `assets/${rel}`;
      if (e.isDirectory()) { walk(path.join(dir, e.name), rel); continue; }
      if (!e.isFile()) continue;
      const st = statOf(path.join(dir, e.name));
      if (!st) continue;
      if (SKIP_PREFIXES.some((p) => key.startsWith(p))) continue;
      if (!(key.startsWith(scope) || st.size >= minBytes)) continue;
      files[key] = { size: st.size, sha256: sha256File(path.join(dir, e.name)) };
    }
  })(from, '');
  return {
    v: 1, scope, minBytes,
    files: Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]])),
  };
}

/**
 * 核对：清单里每一项与盘上文件比。返回的 `rows` 只含**有问题**的那些（`need` 的可补，其余只报告）。
 * @param {{ root?: string, manifest: any, state?: any, stateText?: string|null, all?: boolean }} o `all` 为真时 `rows`
 *   里连「没有问题」的条目一起给（资源查看面板要全表，默认只给有问题的那些）。
 * @returns {{ rows: any[], totals: any, nextState: any }}
 */
export function verify({ root = ROOT, manifest, state = null, stateText = null, all = false }) {
  const mHash = manifestHash(stateText ?? JSON.stringify(manifest));
  const prev = state && state.manifestHash === mHash ? state.files || {} : {};
  const rows = [];
  const files = {};
  const totals = { checked: 0, ok: 0, missing: 0, short: 0, longer: 0, sha: 0, needBytes: 0, totalBytes: 0 };
  for (const [rel, want] of Object.entries(manifest.files || {})) {
    totals.checked++;
    totals.totalBytes += want.size;
    const abs = absOf(root, rel);
    const st = statOf(abs);
    const row = { rel, size: want.size, sha256: want.sha256, kind: kindOf(rel), got: st ? st.size : null, need: false, status: 'ok' };
    if (!st) { row.status = 'missing'; row.need = true; totals.missing++; }
    else if (st.size < want.size) { row.status = 'short'; row.need = true; totals.short++; }
    else if (st.size > want.size) { row.status = 'longer'; totals.longer++; }
    else {
      const memo = prev[rel];
      const good = memo && memo.size === st.size && memo.mtimeMs === st.mtimeMs
        ? memo.sha256 === want.sha256
        : sha256File(abs) === want.sha256;
      if (good) totals.ok++;
      else { row.status = 'sha'; totals.sha++; }
    }
    if (row.need) totals.needBytes += want.size;
    if (all || row.status !== 'ok') rows.push(row);
    if (st) files[rel] = { size: st.size, mtimeMs: st.mtimeMs, sha256: want.sha256 };
  }
  return { rows, totals, nextState: { v: 1, manifestHash: mHash, files } };
}

/** 缺/短的那些做成 `Downloader` 的 job（rel 相对 `public/`，kind 决定格式校验，bytes 是期望尺寸）。 */
export const jobsOf = (rows, base) => rows.filter((r) => r.need).map((r) => ({
  rel: r.rel,
  urls: [`${String(base).replace(/\/+$/, '')}/${r.rel.split('/').map(encodeURIComponent).join('/')}`],
  kind: r.kind, bytes: r.size,
}));

/** 一个 rel 归到哪一组（`assets/local/scene/x.bin` → `local/scene`）：`assets/` 之后的前两段，不足两段就一段。 */
export const groupOf = (rel) => { const p = String(rel).split('/').slice(1); return p.length > 1 ? `${p[0]}/${p[1]}` : p[0]; };

/** 按组统计：文件数、总字节、各类问题的条数（组状态 = 这些条数之和是否为零）。 */
export function groupsOf(manifest, rows = []) {
  const status = new Map(rows.map((r) => [r.rel, r.status]));
  const groups = new Map();
  for (const [rel, want] of Object.entries(manifest.files || {})) {
    const id = groupOf(rel);
    if (!groups.has(id)) groups.set(id, { id, files: 0, bytes: 0, missing: 0, short: 0, longer: 0, sha: 0 });
    const g = groups.get(id);
    g.files++;
    g.bytes += want.size;
    const st = status.get(rel);
    if (st && st !== 'ok') g[st]++;
  }
  return [...groups.values()].sort((a, b) => b.bytes - a.bytes || a.id.localeCompare(b.id));
}

/** 「资源查看」面板要的一份完整快照：总量 + 分组 + 每个文件的尺寸与状态（没问题的条目标 `ok`）。 */
export function listPayload({ manifest, rows = [], totals }) {
  const status = new Map(rows.map((r) => [r.rel, r.status]));
  return {
    totals,
    groups: groupsOf(manifest, rows),
    files: Object.entries(manifest.files || {}).map(([rel, want]) => ({ rel, size: want.size, status: status.get(rel) || 'ok' })),
  };
}

/**
 * `--only` / 面板给的那个目标归一成**不带 `assets/` 前缀**的形状（`local/scene`、`assets/local/scene/x.bin`
 * 都收；空/斜杠就當 `all`）。归一化必须在这一层做：清单里的 `rel` 都带 `assets/`，而面板给的是组名 ——
 * 拿组名去 `startsWith` 一个带前缀的路径会**一条都匹配不到**（表现为「重下了 0 项」而没有任何报错）。
 */
export const normalizeTarget = (target) => String(target ?? 'all').replace(/^\/+/, '').replace(/^assets\//, '').replace(/\/+$/, '') || 'all';

/** 强制重下的那一批行（不看核对结论 —— 「重新下载」就是重新下载）：`all` 或「组前缀 / 精确 rel」。 */
export const forceRows = (manifest, target) => {
  const t = normalizeTarget(target);
  const match = (rel) => t === 'all' || rel === `assets/${t}` || rel.startsWith(`assets/${t}/`);
  return Object.entries(manifest.files || {})
    .filter(([rel]) => match(rel))
    .map(([rel, want]) => ({ rel, size: want.size, sha256: want.sha256, kind: kindOf(rel), need: true }));
};

/** 只补缺的/短的那一批（`--only` 同样的归一化）。 */
export const needRows = (rows, target) => {
  const t = normalizeTarget(target);
  return rows.filter((r) => r.need && (t === 'all' || r.rel === `assets/${t}` || r.rel.startsWith(`assets/${t}/`)));
};

/**
 * 补齐：用引擎既有的 `Downloader`（`.part` 断点续传、Range、格式校验都在它里面）做有界并发；每个文件一发事件，
 * 下完按**尺寸**核对（哈希对不上只记一句「另一平台编码」，不当失败 —— 见文件头第二条纪律）。
 * @param {{ root?: string, rows: any[], base: string, onEvent?: (e: any) => void, fetchImpl?: any, concurrency?: number, log?: (s: string) => void }} o
 */
export async function repair({ root = ROOT, rows, base, onEvent = () => {}, fetchImpl, concurrency = 4, log = () => {}, force = false }) {
  const jobs = jobsOf(rows, base);
  const expected = jobs.reduce((s, j) => s + (j.bytes || 0), 0);
  const dl = new Downloader({
    root: path.join(root, 'public'),
    ledgerPath: path.join(root, '.cache', 'large-assets-ledger.json'),
    concurrency: Math.max(1, Math.min(8, concurrency)), retries: 3, backoffMs: 600, timeoutMs: 120000, source: 'direct',
    // `force`：不看盘上有没有、对不对，一律重下（`Downloader.existingSize` 见到它就返回 -1）。落盘仍是「临时文件 +
    // 原子改名」，所以重下失败时盘上那份**好的**不会被毁掉。
    force,
    log: () => {},
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const t0 = Date.now();
  let done = 0, received = 0, failed = 0;
  onEvent({ type: 'start', total: jobs.length, expectedBytes: expected, base });
  log(`[大资源] 开始补齐 ${jobs.length} 项 / ${MB(expected)} MB（源 ${base}）`);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const want = rows.find((x) => x.rel === job.rel) || {};
      let r;
      try { r = await dl.runJob(job); } catch (e) { r = { status: 'error', bytes: 0, error: e?.message || String(e) }; }
      done++;
      if (r.status === 'ok' || r.status === 'skip') {
        const abs = path.join(root, 'public', ...job.rel.split('/'));
        const st = statOf(abs);
        if (st && st.size === job.bytes) {
          received += job.bytes;
          const shaOk = sha256File(abs) === want.sha256;
          onEvent({ type: 'file', rel: job.rel, size: job.bytes, status: 'ok', sha: shaOk });
          if (!shaOk) log(`[大资源] ${job.rel} 已补（尺寸一致；哈希与清单不同，按另一平台编码记）`);
        } else {
          failed++;
          onEvent({ type: 'file', rel: job.rel, size: job.bytes, status: 'error', error: 'size-differs' });
          log(`[大资源] ${job.rel} 下完尺寸仍不符：${st ? st.size : '缺'} ≠ ${job.bytes}`);
        }
      } else {
        failed++;
        onEvent({ type: 'file', rel: job.rel, size: job.bytes, status: r.status, error: r.error || '' });
        log(`[大资源] ${job.rel} 没取到（${r.error || r.status}）`);
      }
      const secs = Math.max(0.05, (Date.now() - t0) / 1000);
      onEvent({ type: 'progress', done, total: jobs.length, receivedBytes: received, expectedBytes: expected, bytesPerSec: received / secs });
      log(`[大资源] 下载 ${MB(received)} / ${MB(expected)} MB（${expected ? Math.round((received / expected) * 100) : 100}%）· ${MB(received / secs)} MB/s · ${done}/${jobs.length} 项`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, jobs.length)) }, worker));
  onEvent({ type: 'done', repaired: jobs.length - failed, failed, receivedBytes: received, expectedBytes: expected });
  return { repaired: jobs.length - failed, failed, receivedBytes: received, expectedBytes: expected };
}

// ── 备用来源：Release 的组包（CDN 逐文件那条路之后的第二手） ────────────────────────────

/** sha256(hex) of an in-memory payload. */
const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex');

/** 盘上那一份是不是已经与清单一致（size + sha256）？一致就别再覆盖它（好文件不换）。 */
const isIntactOnDisk = (abs, want) => {
  const st = statOf(abs);
  return !!(st && st.size === want.size && sha256File(abs) === want.sha256);
};

/** 原子落盘：先在 `public/assets/` 之下写临时文件再改名（失败不留半份）。 */
function writeAtomic(abs, data) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.pktmp`;
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, abs); }
  catch (e) { try { fs.unlinkSync(tmp); } catch { /* 没有就没有 */ } throw e; }
}

/**
 * 只允许落在 `public/assets/` 之下：`assets/` 前缀、无空段、无 `.` / `..`、无反斜杠、无 NUL。
 * `zipRead` 已经拒过绝对路径 / `..`（它拒整份归档），这里是**第二道**（条目名要用来拼落盘路径）。
 */
export const packSafeRel = (rel) => {
  const r = String(rel ?? '');
  if (!r.startsWith('assets/') || r.includes('\\') || r.includes('\0')) return false;
  return !r.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
};

/** 备用来源该接手的那些行：仍「缺 / 短」（`need`）或「同尺寸哈希不符」（`status==='sha'`）；`--only` 同一套归一化。 */
export const packRows = (rows, target) => {
  const t = normalizeTarget(target);
  return (rows || []).filter((r) => (r.need || r.status === 'sha')
    && (t === 'all' || r.rel === `assets/${t}` || r.rel.startsWith(`assets/${t}/`)));
};

/** zipRead 的帽子：按清单里这一组的字节和 / 最大单条调高到恰好够（默认 64 MB / 32 MB 对 local/scene 那组不够）。 */
function limitsFor(manifest, gid) {
  let total = 0, maxFile = 0;
  for (const [rel, want] of Object.entries((manifest && manifest.files) || {})) {
    if (groupOf(rel) !== gid) continue;
    const size = Number(want && want.size) || 0;
    total += size;
    if (size > maxFile) maxFile = size;
  }
  return {
    maxEntries: ZIP_LIMITS.maxEntries,
    maxTotalBytes: Math.max(ZIP_LIMITS.maxTotalBytes, total),
    maxFileBytes: Math.max(ZIP_LIMITS.maxFileBytes, maxFile),
  };
}

const brief = (rels, n = 3) => rels.slice(0, n).join('、') + (rels.length > n ? ' …' : '');

/** 取一个组包：带超时与体积上限；失败只回一个理由（绝不抛）。 */
async function fetchArchive(url, { fetchImpl, timeoutMs, cap }) {
  let res;
  try {
    res = await fetchImpl(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'stronghold-protocol-large-assets/1.0' },
    });
  } catch (e) { return { ok: false, reason: e?.message || String(e) }; }
  if (!res || !res.ok) {
    try { await res?.body?.cancel?.(); } catch { /* 忽略 */ }
    return { ok: false, reason: `HTTP ${res && res.status ? res.status : '?'}` };
  }
  const declared = Number(res.headers.get('content-length')) || 0;
  if (cap > 0 && declared > cap) {
    try { await res.body?.cancel?.(); } catch { /* 忽略 */ }
    return { ok: false, reason: `${declared} bytes declared, over the ${cap} byte cap` };
  }
  try {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, reason: 'empty body' };
    if (cap > 0 && buf.length > cap) return { ok: false, reason: `${buf.length} bytes, over the ${cap} byte cap` };
    return { ok: true, buf };
  } catch (e) { return { ok: false, reason: e?.message || String(e) }; }
}

/**
 * 备用来源：把 CDN 跑完仍「缺 / 短 / 哈希不符」的那些，从 Release 的**组包**补。
 *
 * 纪律（与 `server/assetPack.js` 的同源代理同源，且更严）：
 *   * 只按 `data/asset-pack.json` **声明过的** `groups[].file` 取（白名单；绝不自由拼 URL），源顺序照既有
 *     `<releaseBase>/<tag>/<file>` → `mirrors[]`，且**只收 https**（其余带理由拒绝、不尝试）；
 *   * 请求带超时；响应体按该组声明的 `bytes × 1.2` 封顶（与代理同一系数）；
 *   * `zipRead` 解出的条目**逐条**与 `data/large-assets.json` 比 size + sha256，**只写通过的**到
 *     `public/assets/…`；盘上已经好的不覆盖；不符 / 没有这一条的**逐条点名**；
 *   * **永不阻断**：某一组取不到、坏、或某一条不符，只点名，别的组照跑；整个函数不抛。
 * @param {{ root?: string, manifest: any, rows: any[], config: any, onEvent?: (e: any) => void,
 *   log?: (s: string) => void, fetchImpl?: any, timeoutMs?: number }} o
 */
export async function repairFromPacks({ root = ROOT, manifest, rows, config, onEvent = () => {}, log = () => {}, fetchImpl, timeoutMs = 120000 } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  const targets = (rows || []).filter((r) => (r.need || r.status === 'sha') && packSafeRel(r.rel));
  if (!targets.length || !config || !Array.isArray(config.groups)) return { repaired: 0, failed: 0, groups: 0 };

  // 白名单：只认配置里 `groups[]` 声明过的 `id` → `file`；别的一律不去猜。
  const declared = new Map();
  for (const g of config.groups) if (g && typeof g.id === 'string' && typeof g.file === 'string') declared.set(g.id, g);

  const byGroup = new Map();
  for (const r of targets) {
    const id = groupOf(r.rel);
    if (!byGroup.has(id)) byGroup.set(id, []);
    byGroup.get(id).push(r.rel);
  }
  const wantSize = (rel) => Number(manifest?.files?.[rel]?.size) || 0;
  let repaired = 0, failed = 0, groups = 0;

  for (const [id, rels] of byGroup) {
    const group = declared.get(id);
    if (!group) {
      for (const rel of rels) { failed++; onEvent({ type: 'file', rel, size: wantSize(rel), status: 'error', error: 'no-declared-pack' }); }
      log(`[大资源] 组 ${id} 没有被声明的组包 —— ${rels.length} 项仍缺/不符：${brief(rels)}`);
      continue;
    }
    groups++;
    const cap = Number(group.bytes) > 0 ? Math.ceil(Number(group.bytes) * ASSET_PACK_MAX_FACTOR) : 0;
    const limits = limitsFor(manifest, id);
    const tried = [];
    let archive = null;
    try {
      for (const c of upstreamCandidates(config, group.file)) {
        if (c.reason) { tried.push(c); continue; }
        let proto = null;
        try { proto = new URL(c.url).protocol; } catch { proto = null; }
        if (proto !== 'https:') { tried.push({ ...c, reason: `scheme ${proto || '?'} is not https` }); continue; }
        const f = await fetchArchive(c.url, { fetchImpl: doFetch, timeoutMs, cap });
        if (!f.ok) { tried.push({ ...c, reason: f.reason }); continue; }
        const z = zipRead(f.buf, limits);
        if (!z.ok) { tried.push({ ...c, reason: `${z.error}: ${z.detail}` }); continue; }
        archive = z.entries; break;
      }
    } catch (e) {
      tried.push({ url: group.file, reason: e?.message || String(e) });
    }

    if (!archive) {
      for (const rel of rels) { failed++; onEvent({ type: 'file', rel, size: wantSize(rel), status: 'error', error: 'pack-unavailable' }); }
      const why = tried.map((x) => `${x.url} → ${x.reason}`).join('；') || '没有可用的源';
      log(`[大资源] 组包 ${group.file} 没取到 —— ${rels.length} 项仍缺/不符（${why}）`);
      continue;
    }

    const need = new Set(rels);
    const handled = new Set();   // 已写好的 + 已点名不符的：下面不再重复点名
    for (const entry of archive) {
      const rel = entry.name;
      if (!need.has(rel) || !packSafeRel(rel)) continue;   // 已经好的、或不是我们这组的条目：不碰
      const want = manifest?.files?.[rel];
      if (!want) continue;
      const abs = absOf(root, rel);
      if (isIntactOnDisk(abs, want)) { handled.add(rel); continue; }   // 盘上已经好的：别覆盖
      if (entry.data.length === want.size && sha256Of(entry.data) === want.sha256) {
        try { writeAtomic(abs, entry.data); }
        catch (e) {
          handled.add(rel); failed++;
          onEvent({ type: 'file', rel, size: want.size, status: 'error', error: 'write-failed' });
          log(`[大资源] ${rel} 组包条目写盘失败：${e?.message || e}`);
          continue;
        }
        handled.add(rel); repaired++;
        onEvent({ type: 'file', rel, size: want.size, status: 'ok', sha: true });
        log(`[大资源] ${rel} 已从组包 ${group.file} 补齐（${MB(want.size)} MB）`);
      } else {
        handled.add(rel); failed++;
        onEvent({ type: 'file', rel, size: want.size, status: 'error', error: 'pack-mismatch' });
        log(`[大资源] ${rel} 组包 ${group.file} 里这一条与清单不符（${entry.data.length} ≠ ${want.size} 字节，或哈希不同）—— 丢弃`);
      }
    }
    for (const rel of rels) {
      if (handled.has(rel)) continue;
      failed++;
      onEvent({ type: 'file', rel, size: wantSize(rel), status: 'error', error: 'pack-missing' });
      log(`[大资源] ${rel} 不在组包 ${group.file} 里 —— 仍缺/不符`);
    }
  }
  return { repaired, failed, groups };
}

/** 一条人话总结（服务器与 CLI 共用同一句，免得两处文案漂）。 */
export function summaryLine(totals) {
  const parts = [`清单 ${totals.checked} 项 / ${MB(totals.totalBytes)} MB`];
  if (totals.missing) parts.push(`缺失 ${totals.missing}`);
  if (totals.short) parts.push(`短小 ${totals.short}`);
  if (totals.sha) parts.push(`哈希不符 ${totals.sha}`);
  if (totals.longer) parts.push(`比清单大 ${totals.longer}（只报告）`);
  if (totals.needBytes) parts.push(`待补 ${MB(totals.needBytes)} MB`);
  return `[大资源] ${parts.join(' · ')}`;
}

// ── CLI ────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const val = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const json = has('--json');
  const emit = json ? (e) => console.log(JSON.stringify(e)) : () => {};
  const root = path.resolve(val('--root', ROOT));
  const scope = val('--scope', process.env.SP_LARGE_ASSETS_SCOPE || DEFAULT_SCOPE);
  const minBytes = Number(val('--min', process.env.SP_LARGE_ASSETS_MIN || DEFAULT_MIN_BYTES)) || DEFAULT_MIN_BYTES;
  const base = val('--base', process.env.SP_CDN_BASE || DEFAULT_CDN_BASE);
  const manifestAbs = path.join(root, MANIFEST_REL);
  const stateAbs = path.join(root, STATE_REL);
  // --json：机器可读走 stdout，人话走 stderr（服务器就是这么接的：stdout 解析事件、stderr 直接进控制台）。
  const say = json ? (...a) => console.error(...a) : (...a) => console.log(...a);

  if (has('--snapshot')) {
    const snap = snapshot({ root, scope, minBytes });
    const bytes = Object.values(snap.files).reduce((s, f) => s + f.size, 0);
    fs.mkdirSync(path.dirname(manifestAbs), { recursive: true });
    fs.writeFileSync(manifestAbs, JSON.stringify(snap, null, 1) + '\n');
    emit({ type: 'snapshot', files: Object.keys(snap.files).length, bytes, manifest: MANIFEST_REL });
    say(`[大资源] 清单已写 ${MANIFEST_REL}：${Object.keys(snap.files).length} 项 / ${MB(bytes)} MB（scope ${scope} + ≥ ${MB(minBytes)} MB）`);
    return 0;
  }

  if (!fs.existsSync(manifestAbs)) {
    emit({ type: 'error', code: 'MANIFEST_MISSING', detail: `${MANIFEST_REL} 不在（先跑 --snapshot）` });
    say(`[大资源] 没有清单 ${MANIFEST_REL} —— 先跑一次 --snapshot`);
    return 1;
  }
  const manifestText = fs.readFileSync(manifestAbs, 'utf8');
  const manifest = JSON.parse(manifestText);
  const { rows, totals, nextState } = verify({ root, manifest, state: readJson(stateAbs), stateText: manifestText });

  // --list：「资源查看」面板要的一份快照（总量 + 分组 + 每个文件的尺寸/状态），**不下载**。
  if (has('--list')) {
    fs.mkdirSync(path.dirname(stateAbs), { recursive: true });
    fs.writeFileSync(stateAbs, JSON.stringify(nextState));
    emit({ type: 'list', ...listPayload({ manifest, rows, totals }), generatedAt: Date.now() });
    emit({ type: 'done', state: totals.needBytes ? 'repairable' : 'ok', repaired: 0, failed: 0 });
    say(summaryLine(totals));
    return 0;
  }

  const only = val('--only', null);
  const force = has('--force');
  emit({ type: 'plan', state: totals.needBytes ? 'repairable' : 'ok', totals });
  say(summaryLine(totals));

  // 「没有可补的（缺/短）也没有可修的（哈希不符）」才收工；哈希不符只由组包修（CDN 那条判据不变），
  // 所以它也得把这条路走下去（`needBytes` 为 0 时下面那段会跳过 CDN 直接组包）。
  if (!force && !totals.needBytes && !totals.sha) {
    fs.mkdirSync(path.dirname(stateAbs), { recursive: true });
    fs.writeFileSync(stateAbs, JSON.stringify(nextState));
    emit({ type: 'done', state: 'ok', repaired: 0, failed: 0 });
    return totals.longer ? 1 : 0;   // 「比清单大」只报告的那一类也算「要人看一眼」
  }
  if (!force && !has('--repair')) {
    say(needRows(rows, only).map((r) => `[大资源]   待补 ${r.rel}（${MB(r.size)} MB，${r.status}）`).join('\n'));
    emit({ type: 'done', state: 'repairable', repaired: 0, failed: 0 });
    return 1;
  }
  // 第一手（CDN，逐文件）：`--force` 一律重下（不看核对结论，`--only` 收窄到一组或一个文件），否则只补缺的/短的。
  const target = force ? forceRows(manifest, only || 'all') : needRows(rows, only);
  let cdn = { repaired: 0, failed: 0 };
  if (target.length) {
    say(`[大资源] ${force ? '重新下载' : '补齐'} ${target.length} 项 / ${MB(target.reduce((s, x) => s + x.size, 0))} MB（源 ${base}${only ? ` · 范围 ${only}` : ''}）`);
    cdn = await repair({ root, rows: target, base, onEvent: emit, log: say, force });
  } else {
    say(`[大资源] 这一批（${only || '全部'}）没有要从 CDN 下的项`);
  }
  // 第二手（备用来源）：CDN 跑完仍「缺 / 短 / 哈希不符」的那些，从 Release 的组包补。
  // 复核时拿上面那份 state 当备忘：**只有刚下回来的那几个** mtime 变了 ⇒ 只有它们要重新哈希（不是全量 192 MB）。
  const leftover = packRows(verify({ root, manifest, state: nextState, stateText: manifestText }).rows, only);
  let pack = { repaired: 0, failed: 0 };
  if (leftover.length) {
    const config = readPackConfig(root);
    if (!config) {
      pack.failed = leftover.length;
      say(`[大资源] 备用来源未配置（${ASSET_PACK_REL} 不在或 groups 为空）—— ${leftover.length} 项仍缺/不符：${brief(leftover.map((r) => r.rel))}`);
    } else {
      say(`[大资源] 备用来源：${leftover.length} 项改从 Release 的组包补（${config.repo || '(无 repo)'}${config.tag ? `@${config.tag}` : ''}）`);
      pack = await repairFromPacks({ root, manifest, rows: leftover, config, onEvent: emit, log: say });
    }
  }
  // 收工：拿上面那份 state 当备忘再核一遍（**只有刚写回来的那几个** mtime 变了 ⇒ 只有它们要重新哈希，
  // 不是全量 192 MB）。`failed` 是**两手里都没修好**的那些（不是两手失败数相加）—— 唯它决定退出码。
  const after = verify({ root, manifest, state: nextState, stateText: manifestText });
  const failed = packRows(after.rows, only).length;
  fs.mkdirSync(path.dirname(stateAbs), { recursive: true });
  fs.writeFileSync(stateAbs, JSON.stringify(after.nextState));
  emit({ type: 'summary', succeeded: failed === 0, repaired: cdn.repaired + pack.repaired, failed, totals: after.totals });
  say(`${summaryLine(after.totals)}${failed ? ` · 失败 ${failed}` : force ? ' · 已重下' : ' · 已补齐'}`);
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code ?? 0; }, (e) => {
    console.log(`[大资源] 出错：${e?.stack || e}`);
    process.exitCode = 1;
  });
}
