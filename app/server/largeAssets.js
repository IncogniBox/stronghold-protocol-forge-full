// server/largeAssets.js — 启动期「大型资源」（地图/场景等）完整性检查与补齐的**进程侧**。
//
// 判据与下载都在 `tools/large-assets.mjs`（它认 `data/large-assets.json` 这份清单，缺的从 `SP_CDN_BASE` 取回）。
// 这一层只做三件事，别的都不做：
//   * 起服之后**后台**把那个工具当子进程跑一遍（`--repair --json`），**不挡监听**：缺就补，不缺就是一个本地核对；
//   * 把它的 stdout（每行一个 JSON 事件）收成一份可读状态，给控制台与 `GET /assets-status.json` 用；
//   * 它的 stderr 是人话日志，原样转进服务器控制台（所以这一层不重复实现任何文案）。
//
// 关掉：`SP_LARGE_ASSETS=off`（服务器与工具都认）。源与范围走 `SP_CDN_BASE` / `SP_LARGE_ASSETS_SCOPE` /
// `SP_LARGE_ASSETS_MIN`，全都透传给子进程。
//
// 状态机：off（没开）→ checking（核对中）→ ok（完整，或已补齐）｜ repairing（在补）｜ needs-attention（补不上或有
// 只报告的问题）｜ unavailable（连清单都没有）｜ failed（工具跑不起来/崩了）。**永不阻塞、永不抛** —— 起服不该因为
// 一项素材而失败。
import { spawn } from 'node:child_process';
import path from 'node:path';

/** 只读状态的路径（客户端标题屏与运维都读它；`server/http/routes.js` 里回 JSON + no-store）。 */
export const LARGE_ASSETS_STATUS_PATH = '/assets-status.json';
/** 「资源查看」面板：清单快照（总量 + 分组 + 每个文件）。 */
export const LARGE_ASSETS_LIST_PATH = '/assets-list.json';
/** 「重新下载」：`?target=all|local/scene|assets/local/…`。GET 带副作用，理由写在 `server/http/routes.js` 那一处。 */
export const LARGE_ASSETS_REDOWNLOAD_PATH = '/assets-redownload.json';
/** 关掉这件事的环境变量取值。 */
const OFF = ['off', '0', 'false', 'no'];

const blank = () => ({
  enabled: false, phase: 'off', mode: null, target: null, startedAt: null, finishedAt: null, base: null,
  totals: null, progress: null, repaired: 0, failed: 0, note: '', recent: [], failures: [],
});

let status = blank();
let child = null;
/** 起服时记下根目录：HTTP 那一层（`server/http/routes.js`）不该知道项目根在哪，它只会转调这几个函数。 */
let rootDir = null;

/** 一份冻结副本：控制台之外的读者（HTTP 端点、客户端）都拿这个。 */
export function largeAssetsStatus() {
  return {
    ...status,
    running: !!child,
    // 「重新下载」这个动作能不能按下去：忙（起服核对或另一次重下在跑）就不行 —— 单飞是正确性，不只是礼貌。
    busy: !!child,
    listCached: !!cachedResourceList(),
    recent: status.recent.slice(-8),
    failures: status.failures.slice(-8),
  };
}

/** 收一条事件（`tools/large-assets.mjs --json` 的一行）。 */
function absorb(event) {
  switch (event.type) {
    case 'snapshot':
      // 这两条 `note` 是**机器面向**的 JSON 字段（`/assets-status.json`），不是玩家文案也不上线：按仓库纪律
      // （test/i18n.test.js）server/ 下一律不留中文串。人话（中文）在工具的 stderr 里，由它自己打。
      status.note = `${event.files} files`; break;
    case 'plan': {
      status.totals = event.totals || null;
      status.phase = event.totals && event.totals.needBytes ? 'repairing' : 'ok';
      if (status.phase === 'ok') status.finishedAt = Date.now();
      break;
    }
    case 'start':
      status.phase = 'repairing';
      status.progress = { done: 0, total: event.total || 0, receivedBytes: 0, expectedBytes: event.expectedBytes || 0, bytesPerSec: 0 };
      status.base = event.base || status.base;
      status.recent.push({ rel: '', size: 0, status: 'start' });
      break;
    case 'file':
      status.recent.push({ rel: event.rel, size: event.size || 0, status: event.status, sha: !!event.sha });
      if (event.status !== 'ok') status.failures.push({ rel: event.rel, status: event.status, error: event.error || '' });
      break;
    case 'progress':
      status.progress = {
        done: event.done || 0, total: event.total || 0,
        receivedBytes: event.receivedBytes || 0, expectedBytes: event.expectedBytes || 0, bytesPerSec: event.bytesPerSec || 0,
      };
      break;
    case 'done':
      status.repaired = event.repaired || 0;
      status.failed = event.failed || 0;
      status.phase = event.failed ? 'needs-attention' : 'ok';
      status.finishedAt = Date.now();
      break;
    case 'summary':
      status.repaired = event.repaired ?? status.repaired;
      status.failed = event.failed ?? status.failed;
      status.totals = event.totals || status.totals;
      status.phase = event.failed || (event.totals && !event.totals.needBytes && (event.totals.sha || event.totals.longer))
        ? 'needs-attention' : 'ok';
      status.finishedAt = Date.now();
      break;
    case 'error':
      status.phase = event.code === 'MANIFEST_MISSING' ? 'unavailable' : 'failed';
      status.note = event.detail || '';
      status.finishedAt = Date.now();
      break;
    default: break;
  }
}

/**
 * 起服之后调用一次（`server/http/boot.js`）：后台核对 + 补齐，立刻返回。
 * @param {{ root: string, log?: Console, env?: NodeJS.ProcessEnv }} o
 */
const TOOL_REL = ['tools', 'large-assets.mjs'];

/** 起一个子进程跑那个工具，把 stdout 的 NDJSON 收进状态、stderr 的人话转进控制台。 */
function spawnTool({ root, log = console, env = process.env, args, mode, target = null }) {
  const tool = path.join(root, ...TOOL_REL);
  status.mode = mode;
  status.target = target;
  let proc;
  try {
    proc = spawn(process.execPath, [tool, ...args], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    status.phase = 'failed';
    status.note = e?.message || String(e);
    status.finishedAt = Date.now();
    return null;
  }
  child = proc;
  let buffer = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { absorb(JSON.parse(line)); } catch { /* 非 JSON 的行（工具的人话）不该出现在 stdout；忽略 */ }
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) (log.log || console.log)(line);
  });
  proc.on('error', (e) => { if (child === proc) child = null; status.phase = 'failed'; status.note = e?.message || String(e); status.finishedAt = Date.now(); });
  proc.on('exit', (code) => {
    if (child === proc) child = null;
    if (status.phase === 'checking') status.phase = code ? 'needs-attention' : 'ok';
    else if (code && status.phase === 'ok') status.phase = 'needs-attention';
    status.note = status.note || (code ? `exit ${code}` : '');
    status.finishedAt = status.finishedAt || Date.now();
  });
  return proc;
}

/**
 * 起服之后调用一次（`server/http/boot.js`）：后台核对 + 补齐，立刻返回。
 * @param {{ root: string, log?: Console, env?: NodeJS.ProcessEnv }} o
 */
export function startLargeAssetsCheck({ root, log = console, env = process.env }) {
  if (child) return;
  rootDir = root;
  const off = OFF.includes(String(env.SP_LARGE_ASSETS || '').trim().toLowerCase());
  status = { ...blank(), enabled: !off, phase: off ? 'off' : 'checking', startedAt: Date.now(), base: env.SP_CDN_BASE || null };
  if (off) return;
  spawnTool({ root, log, env, args: ['--repair', '--json'], mode: 'check' });
}

// ── 「资源查看」面板要的两件事：一份清单快照，和「重新下载」 ─────────────────────────
// 两者都是**同一份状态**的消费者（面板与标题屏那一行读的是同一个 `/assets-status.json`），只是一个不下载、
// 一个强制重下。`--list` 那份快照在核对冷缓存时要读 192 MB 算哈希，所以它也在子进程里跑（不阻塞事件循环）。

let listCache = null;      // { payload, at }
const LIST_TTL_MS = 5000;  // 面板开着的时候会轮询，5 秒内复用同一份

/** 上一次清单快照（没算过 / 过期了 ⇒ null）。 */
export const cachedResourceList = () => (listCache && Date.now() - listCache.at < LIST_TTL_MS ? listCache.payload : null);

/**
 * 要一份清单快照。有 5 秒内的缓存就直接给；否则跑一次 `--list --json`（子进程，等它结束）。
 * @param {{ root: string, log?: Console, env?: NodeJS.ProcessEnv, force?: boolean }} o
 */
export async function readResourceList({ root = rootDir, log = console, env = process.env, force = false }) {
  if (!force && cachedResourceList()) return cachedResourceList();
  const tool = path.join(root, ...TOOL_REL);
  const payload = await new Promise((resolve, reject) => {
    let out = '', err = '';
    const proc = spawn(process.execPath, [tool, '--list', '--json'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (c) => { out += c; });
    proc.stderr.on('data', (c) => { err += c; });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      const lines = out.split('\n').filter((l) => l.trim());
      let list = null;
      for (const line of lines) { try { const e = JSON.parse(line); if (e.type === 'list') list = e; } catch { /* 忽略非 JSON 行 */ } }
      if (!list) { reject(new Error(err.trim() || `list exited ${code}`)); return; }
      resolve(list);
    });
  }).catch((e) => {
    (log.error || console.error)(`[大资源] 清单读取失败：${e?.message || e}`); // i18n-ignore: 写给服务器控制台的运维日志，不是客户端界面文案
    return null;
  });
  if (payload) listCache = { payload, at: Date.now() };
  return payload;
}

/** 面板问「现在在干什么」时要的那几个字（一次重下在跑 / 上一次重下是什么时候）。 */
export const isBusy = () => !!child;
/** `SP_LARGE_ASSETS=off` 时这一整套是关的：**看**还能看（只读），**重下**不该被按下去。 */
export const isEnabled = () => !!status.enabled;

/**
 * 强制重新下载：`target` 是 `all`、一个组（`local/scene`）或一个 `assets/...` 路径。
 * **单飞**：一次只跑一个（同一份状态、同一个子进程位）；已经在跑就回 false，让调用方去读状态。
 * @param {{ root: string, target?: string, log?: Console, env?: NodeJS.ProcessEnv }} o
 */
export function startRedownload({ root = rootDir, target = 'all', log = console, env = process.env }) {
  if (child || !root) return false;
  const safe = /^(all|[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*)$/.test(String(target)) ? String(target) : 'all';
  status = {
    ...blank(), enabled: true, phase: 'checking', startedAt: Date.now(), base: env.SP_CDN_BASE || status.base || null,
  };
  listCache = null;   // 重下会改盘上的东西：旧快照立刻作废
  spawnTool({ root, log, env, args: ['--repair', '--json', '--force', '--only', safe], mode: 'redownload', target: safe });
  return true;
}


/** 优雅停机时把子进程收掉（`server/http/boot.js` 的 stop 分支）；下到一半的 `.part` 下次续传。 */
export function stopLargeAssetsCheck() {
  if (!child) return;
  try { child.kill(); } catch { /* 已经没了 */ }
  child = null;
}

/** 测试用：把状态复位（`test/largeAssets.test.js` 只跑吸收逻辑，不真起子进程）。 */
export function resetLargeAssetsForTest() { status = blank(); child = null; listCache = null; }
