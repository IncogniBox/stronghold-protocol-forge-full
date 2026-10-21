// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`, unless a lane claimed that method for that path;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, sockets, sessions,
//     rooms, matches), never cached;
//   * GET /api/rooms → 公开房间数，**一个整数，不是列表**（见下「房间目录」）；
//   * GET /api/records/<CODE> → the latest finished match of that 4-letter room code;
//   * GET /api/records/account/<NAME> → that account's OWN row from its latest finished match (name → playerId → row);
//     404 when the server runs without accounts (`SP_ACCOUNTS` unset) — an absent feature, not an empty one;
//   * a path inside a host-registered request lane (DESIGN §28.45, httpLanes.js) → that lane, for a method the lane
//     claimed. No lanes (the default, and the only thing a plain `npm start` has) ⇒ every rule below is exactly as it
//     was: any method but GET / HEAD 405, everything else the static files;
//   * everything else → the static files (static.js).
// A route that throws is logged and answers 500.
//
// ## What these two routes are allowed to say (业主裁令)
// **Both are read-only and unauthenticated**, and neither reveals more than the caller already proved it knows:
//
//   * `/api/records/<CODE>` — the PUBLIC view: per player, a seat number and whether it is the caller's own seat.
//     Nicknames, bond layers and the per-round purchase ledger are **not** here. The room code is therefore *not* a
//     secret and this file does not pretend it is: anyone who knows 4 letters gets 4 seat numbers.
//   * `/api/records/account/<NAME>` — **only the named account's own row**, never a teammate's nickname and never the
//     purchase ledger (server/matchRecords.js `ownAccountSummary`). The account name is the queried key, so this
//     endpoint is deliberately **narrower than the owner's own view**: the full ledger for yourself arrives over the
//     authenticated `records.mine` message, not here.
//
// Both are rate-limited per remote address (below), and the account name is matched through the SAME key as login —
// NFC-normalised, lower-cased, **exact** — so there is no prefix or fuzzy search to walk a name space with. An unknown
// account and a known account with no finished match answer **identically** (404 + the same body): telling those two
// apart would make this endpoint an account-existence probe.
//
// ## There is deliberately no write route
// The submission that proposed this feature shipped `POST /api/account/password` guarded by a shared `SP_ADMIN_TOKEN`.
// That route is **not implemented here**: a site-wide admin secret shared with a chat bot is not a player's password,
// and "change a password knowing only the account name" would make the old password decorative. Password changes are
// an operator action on the account file until a per-account reset-ticket design exists (docs/RECORDS.md §5).

// ## 房间目录（公开面）：只报数，不枚举（业主裁令）
// 这一格来自投稿 7ca51de6f346「服务器房间目录与活跃人数」的**收窄**。原投稿要的是 C2S `room.list` + `user.activity`
// 与 S2C `room.list`：整张房间列表，含**房号、房主代号、真人与 AI 人数、在线及近期操作人数、招募状态**，以及加入 /
// 观战入口。**那个形状本批不采纳** —— 它必须先有一整套「公开 / 私有」的房间属性（`room.setInviteOnly`）、一个
// 网络心跳口径（`lastInputAt`）和一套限流，而且会把 4 字母房号变成可枚举的东西（房号进列表就等于公开）。
//
// 业主裁令把它收窄成**一个数**：「我们做成不枚举所有全服房间，我们枚举公开房间数，管理员可以查看所有房间数，
// 这样就行了」。所以公开面**只有** `publicRooms` 一个整数字段，**永远**不回答房号、房主名、人数或任何明细：
// 任何一个这样的字段都能把「数」变成对某一个房间的**侧写**。
//
// 维护口径（`Lobby.roomCounts`）：**今天** `publicRooms` 与 `/healthz` 的 `rooms` **恒等**，因为引擎今天**没有**
// 「公开 / 私有」这个属性（`inviteOnly` 不存在，本批**不预埋**）。「公开房间数」因此暂时就是「房间数」——
// 如实返回同一个计数，而不是假装有一个筛选。solo 房算数（与 `stats().rooms` 同口径）。`inviteOnly` 落地后，
// 改 `Lobby.roomCounts` 一处即可。
//
// **管理员面不在这里**：`/healthz` 的 `rooms` **就是**「全部房间数」（运维口径），无需新端点、无需任何令牌。
// 本批**不引入** `SP_ADMIN_TOKEN` 这类共享管理员秘密（见 routes.js 头部对投稿 `POST /api/account/password` 的
// 拒绝理由，那是同一个东西）。
//
// **本刀不动协议面**：`shared/protocol.js` 的 C2S / S2C 一字不改，`server/net.js` 的 `HEAVY_TYPES` 不加任何东西
// （尤其**不引入** `ACTIVITY_TYPES` / `user.activity` / `lastInputAt`），`PROTOCOL_VERSION` / `MOD_API_VERSION`
// 不抬。将来的 `room.list` 若真要做，HTTP 面与协议面互不干扰。
// —— 2026-10-15：那一刀**做了**（业主裁决 B，`shared/protocol.js` 的 `room.list` → `server/lobby.js roomDirectory()`
// → `room.listed`，见 `docs/META.md` §1.7b）。**本文这一段的 HTTP 面口径一个字都没变**：`/api/rooms` 仍然只给一个整数、
// 永远不回答房号 —— 协议面那条是另一刀（只发给**已连接的客户端**，不是匿名 HTTP 面）。

import { existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PROTOCOL_VERSION, UPSTREAM_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { MODS_CATALOG_URL, MODS_PANELS_URL } from './mods.js';
import { VIEW } from '../matchRecords.js';
import { TokenBucket } from '../net.js';
import { clientAddress, isLocalIp } from '../net.js';
import { validateHttpLanes, resolveHttpLane } from './httpLanes.js';

const MAX_URL_LENGTH = 4096;
/** 账号名按**码点**算长度（`[...s].length`），与昵称那条 `NAME_MAX_LEN` 是同一条思路；这里只防一条超长 URL。 */
const ACCOUNT_NAME_MAX = 64;
const ACCOUNT_PATH_RE = /^\/api\/records\/account\/([^/]{1,256})$/;
/**
 * 房间号：`server/lobby.js` 的 `CODE_ALPHABET`（无 I / O）**只生成大写**，所以这里大小写不敏感地**归一到大写**再查
 * —— 手打小写的人不该得到一个「没有这个房间」的空答复，而 `latestRoom` 也只认大写。
 */
const ROOM_CODE_PATH_RE = /^\/api\/records\/([A-HJ-NP-Za-hj-np-z]{4})$/;
/**
 * 这两条只读路由的限流：**每客户端地址**一只桶，照 `server/net.js` 的既有做法（`TokenBucket`）。
 *
 * 为什么 HTTP 面也要限流：`server/net.js` 的桶只保护 WebSocket 帧，而这两条路由**不需要会话**就能打 —— 没有桶
 * 的话，一个循环就能把服务端拖进「每次请求都遍历索引 + 序列化一份记录」里，而 `/account/<NAME>` 还会被拿来
 * **枚举账号名**。1/s 重填 + 10 突发对「人点按钮」绰绰有余（客户端一条 `records.mine` 走 WebSocket，根本不碰
 * 这两条），对扫名字则很紧。
 *
 * **已知边界**（明写，不假装）：键取 `req.socket.remoteAddress`。直接暴露在公网时它不可伪造；但若前面挂了反向
 * 代理且没在代理侧限流，所有人会共用一个地址、共享同一只桶（宁可漏限流也不按可伪造的 `X-Forwarded-For` 分桶
 * —— 后者会让攻击者换一个头就重置额度）。运维文档里要写「代理后面请自行限流」。
 */
const RECORDS_RATE_PER_SEC = 1;
const RECORDS_RATE_BURST = 10;
/** 空闲多久回收一只桶（与 `net.js` sweep 同一条思路：不做的话这张表本身会随着见过的地址一直长）。 */
const RECORDS_BUCKET_IDLE_MS = 10 * 60_000;

/** 公开房间数的**唯一**路径（一个数，不是列表）。见文件头「房间目录（公开面）」。 */
export const PUBLIC_ROOMS_URL = '/api/rooms';

/**
 * 服务器音乐库（颂乐人偶 Fever 音乐选择）：官方提取的 BGM（`public/assets/audio/bgm`）与已装工坊包的
 * `assets/bgm`（经 `/workshop-assets/<pack>/bgm/…` 送达）。只读、无需会话；客户端用 `id` 记选择，
 * 用 `url` 试听/播放。曲目在服务端启动后变了（换包）下次请求自然反映，缓存只挡一小段时间。
 */
export const MUSIC_LIBRARY_URL = '/api/music';
/** @type {RegExp} */
/**
 * 只收**两条路由都认**的音频扩展名：官方静态目录认识的类型比工坊 `WORKSHOP_ASSET_TYPES` 多，但后者是
 * `/workshop-assets/**` 的准入门槛（`.mp3` / `.ogg` / `.wav` / `.m4a`）—— 列一个取回来是 404 的曲目没有意义。
 */
const AUDIO_EXT_RE = /\.(mp3|ogg|wav|m4a)$/i;
const MUSIC_CACHE_MS = 15_000;
/** 协议允许的 id 上限（`shared/protocol.js` isId）。 */
const MUSIC_ID_MAX = 64;
/** id 只留协议允许的字符；文件名里的其它字符一律折成 `_`。 */
const musicIdPart = (s, max = 48) => String(s).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, max);

/**
 * 扫一个目录里的音频文件，追加到 `out`。
 * @param {string} dir @param {'official'|'workshop'} kind @param {string|null} pack
 * @param {Array<{ id: string, kind: string, pack?: string, packName?: string, name: string, url: string, bytes: number }>} out
 * @param {string|null} [packName] 工坊包的显示名（没有就显示 id）
 */
function collectMusic(dir, kind, pack, out, packName = null) {
  let names;
  try { names = readdirSync(dir); } catch { return; }
  const prefix = kind === 'official' ? 'official:' : `pack:${musicIdPart(pack, 24)}:`;
  // 文件名那段能吃下的长度：整个 id 必须 ≤ 64（`isId` 的上限），前缀之外全给文件名。
  const stemRoom = Math.max(8, MUSIC_ID_MAX - prefix.length);
  for (const file of names.sort()) {
    if (file.startsWith('.') || !AUDIO_EXT_RE.test(file)) continue;
    const abs = path.join(dir, file);
    let bytes;
    try { const st = statSync(abs); if (!st.isFile()) continue; bytes = st.size; } catch { continue; }
    const stem = file.replace(/\.[^.]+$/, '');
    // 折过字符 / 截过长的文件名再挂 6 位摘要：中文标题折出来只剩一串 `_`（`KillKiss人声` 与 `KillKiss伴奏` 都是
    // `KillKiss__`），只靠后缀编号去重会让「加一首新歌」改写已保存的选择。摘要跟着文件名走 ⇒ 同一首歌的 id 永不变。
    const plain = musicIdPart(stem, stemRoom);
    const hash = plain === stem ? '' : `-${createHash('sha1').update(stem).digest('hex').slice(0, 6)}`;
    out.push({
      id: prefix + musicIdPart(stem, stemRoom - hash.length) + hash,
      kind,
      ...(pack ? { pack } : {}),
      ...(pack && packName ? { packName } : {}),
      name: stem,
      url: kind === 'official'
        ? `/assets/audio/bgm/${encodeURIComponent(file)}`
        : `/workshop-assets/${encodeURIComponent(pack)}/bgm/${encodeURIComponent(file)}`,
      bytes,
    });
  }
}

/**
 * 本服务器的音乐库（官方 BGM + 工坊包 bgm）。
 * @param {string|undefined} publicDir @param {Map<string, string>|null|undefined} workshopAssets pack id → pack dir
 * @param {Map<string, string>|null} [packNames] pack id → 显示名（`pack.json.name`）
 */
export function musicLibrary(publicDir, workshopAssets, packNames = null) {
  const tracks = [];
  if (publicDir) collectMusic(path.join(publicDir, 'assets', 'audio', 'bgm'), 'official', null, tracks);
  if (workshopAssets && typeof workshopAssets.forEach === 'function') {
    workshopAssets.forEach((dir, pack) => {
      if (typeof dir === 'string' && dir) collectMusic(path.join(dir, 'assets', 'bgm'), 'workshop', pack, tracks, packNames?.get(pack) || null);
    });
  }
  // 不同文件名折出来的 id 可能撞车（例如 `KillKiss人声` / `KillKiss伴奏` 都折成 `KillKiss__`）：
  // 按目录里的固定顺序给后来者加 `-2` / `-3`，让每一条都仍是协议合法的唯一 id。
  const seen = new Map();
  for (const track of tracks) {
    const n = (seen.get(track.id) || 0) + 1;
    seen.set(track.id, n);
    if (n > 1) {
      const suffix = `-${n}`;
      track.id = `${track.id.slice(0, MUSIC_ID_MAX - suffix.length)}${suffix}`;
    }
  }
  tracks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'official' ? -1 : 1)
    || String(a.pack || '').localeCompare(String(b.pack || '')) || a.name.localeCompare(b.name));
  return tracks;
}

/**
 * The GET /healthz body.
 *
 * `modHealth`（可选）是包的服务端模块贡献的字段（DESIGN §28.14）：一个**函数**（每次请求现算，因为那三件要报的是
 * 内存 / 循环延迟 / 归档标签这类实时值）或一个现成的对象。返回空对象时**不加这个键** —— 干净安装的 `/healthz`
 * 与从前逐字节相同。**包的摘要**已经在 `lobby.stats()` 里（`mods` / `modPacks`，DESIGN §28.9 第 2 项），所以这里
 * 不重复放一份。
 *
 * `withTraffic`（`?traffic=1`，只对 loopback / 内网客户端）加上流量计数与内容哈希索引的状态（traffic.js /
 * assetIndex.js / assetViews.js）。
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby, modHealth?: (() => Record<string, any>)|null,
 *           traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter>,
 *           assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *           views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null }} health
 * @param {boolean} [withTraffic]
 */
/** `{ plugins: n }` when the server has n > 0 unofficial plugins (the lobby's visual sets count them), else nothing. */
function pluginCount(lobby) {
  let n;
  try { n = Number(lobby?.plugins?.unofficial?.()) || 0; } catch { n = 0; }
  // 目录元信息：只在有已加载插件发布公告时带上，从不进房间或对局
  let notices = false;
  try { notices = lobby?.plugins?.hasNotices?.() === true; } catch { /* optional catalogue hint */ }
  return { ...(n > 0 ? { plugins: n } : {}), ...(notices ? { notices: true } : {}) };
}

/** The content sets with gameplay plugins rooms hold now (DESIGN **§34.6**，上游原文 `§32.6`; 0 without any). */
function contentSets(lobby) {
  try { return Number(lobby?.plugins?.contentInUse?.()) || 0; } catch { return 0; }
}

/**
 * **D19（取并集）**：上游的 `content` / `trusted` 照加法接；**我们的 `modHealth` 保留**。
 */
export function healthReport({ startedAt, network, registry, lobby, modHealth = null, content = null, traffic, assetIndex, views, trusted }, withTraffic = false) {
  /** @type {Record<string, any>} */
  const out = {
    ok: true, version: PROTOCOL_VERSION, app: UPSTREAM_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    // what its rooms play (DESIGN **§34**，上游原文 `§32`): the vanilla content hash, and how many content sets with
    // gameplay plugins rooms hold now (P1c, §34.6 — a room's cosmetic plugins leave its cs the vanilla one); how many
    // unofficial plugins it has, when it has some (a page's title screen says so; P1a)
    ...(content ? { content: { vanilla: content.cs, sets: contentSets(lobby), ...pluginCount(lobby) } } : {}),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
  };
  let fields = null;
  try {
    fields = typeof modHealth === 'function' ? modHealth() : modHealth;
  } catch {
    fields = null; // 一个包的 healthz 回调炸了不该让运维拿不到 /healthz
  }
  if (fields && typeof fields === 'object' && Object.keys(fields).length) out.modHealth = fields;
  if (trusted && Object.keys(trusted).length) out.plugins = trusted;
  if (withTraffic && traffic) out.traffic = traffic.snapshot();
  // content-hashed asset URLs (assetIndex.js / assetViews.js): off, building, or ready with how many files and URLs
  if (withTraffic) out.assetHashes = assetIndex ? { ...assetIndex.stats(), views: views ? views.stats() : null } : null;
  return out;
}

/** Does the query ask for the traffic counters (`traffic`, `traffic=1`, `traffic=true`)? */
const wantsTraffic = (query) => /(?:^|&)traffic(?:=(?:1|true|yes))?(?:&|$)/i.test(query || '');

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object,
 *           records?: import('../matchRecords.js').MatchRecords|null,
 *           accounts?: import('../accounts.js').AccountStore|null,
 *           modsCatalog?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean,
 *           modsPanels?: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => boolean,
 *           httpLanes?: readonly import('./httpLanes.js').HttpLane[], publicDir?: string,
 *           trustProxy?: 'auto' | boolean }} deps
 *   trustProxy: whose forwarding headers name the client (net.js clientAddress; the server's TRUST_PROXY)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, records = null, accounts = null, modsCatalog, modsPanels, httpLanes, publicDir, trustProxy = 'auto', largeAssets = null, assetPack = null, workshopConflicts = null, workshopAssets = null, workshopPackNames = null, studio = null, csp = null, trustedRuntime = null }) {
  /** @type {Map<string, TokenBucket>} 客户端地址 → 只读战绩路由的桶（见文件头那条「已知边界」） */
  const recordBuckets = new Map();
  /** @type {{ at: number, tracks: any[] } | null} 音乐库的短缓存（见 MUSIC_LIBRARY_URL） */
  let musicCache = null;

  /**
   * 这两条只读路由的准入。true = 放行。超限回 429（带 `Retry-After`），而不是静默降级成空结果 —— 客户端/机器人
   * 要能分辨「限流了」与「没有这条记录」。
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  function admitRecordRead(req, res) {
    const key = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
    const now = Date.now();
    let bucket = recordBuckets.get(key);
    if (!bucket) { bucket = new TokenBucket(RECORDS_RATE_PER_SEC, RECORDS_RATE_BURST, now); recordBuckets.set(key, bucket); }
    if (bucket.take(now)) {
      // 顺手回收空闲桶（这张表本身也该有界）；只在放行路径上扫，代价摊在正常请求里。
      if (recordBuckets.size > 1) {
        for (const [other, b] of recordBuckets) if (other !== key && now - b.at > RECORDS_BUCKET_IDLE_MS) recordBuckets.delete(other);
      }
      return true;
    }
    res.setHeader('Retry-After', '1');
    sendJson(req, res, 429, { error: 'RATE' });
    return false;
  }
  // A bad table fails at boot, naming every problem — same ruling as the upgrade table (§28.44), same reason: a lane
  // that silently never answers is worse than a server that refuses to start.
  const table = validateHttpLanes(httpLanes ?? [], { publicDir, existsSync });
  if (table.problems.length) throw new Error(`bad http lane table: ${table.problems.join('; ')}`);
  if (table.lanes.length) log.info(`[http] lanes: ${table.lanes.map((l) => l.prefix + l.methods.join('|')).join(', ')}`);

  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    // 受信任插件的精确路径（server/plugins/trustedApi.js，上游 §34.13）：只接 /x/<id>/…，不传活请求/套接字
    if (trustedRuntime && parts.rawPath.startsWith('/x/') && await trustedRuntime.route(req, res, parts.rawPath)) return;
    // 插件工作台（server/studio/index.js）：只给本机与局域网；其他客户端走 404 页
    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }
    // A lane is asked before anything else, because it is the only rule here that knows about methods the game does
    // not serve (POST). It cannot reach the engine's own paths: `validateHttpLanes` refuses any prefix that overlaps
    // them, including `/healthz` and the catalogue, so the order below is untouched for every request a lane does not
    // claim — including a POST to `/healthz`, which stays the 405 it always was.
    const lane = resolveHttpLane(req.method || 'GET', parts.rawPath, table.lanes);
    if (lane) {
      try {
        await lane.onRequest(req, res, { rawPath: parts.rawPath, query: parts.query, log, lane });
      } catch (e) {
        // Named, and never a fall-through into the game's static space: a half-written lane response stays half-written.
        log.error(`[http] lane ${lane.id} failed`, e);
        if (!res.headersSent) sendError(req, res, 500, '玩法服务出错 · Mode error');
      }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    if (parts.rawPath === MODS_CATALOG_URL && modsCatalog && modsCatalog(req, res)) return;
    // 包声明的 C 层清单**在握手之前**的那一次（DESIGN §28.60）：同一个「声明先到页面」家族的另一条路 ——
    // 与 welcome 那一帧同源（`serveModPanels` 拿到的就是 welcome 那份对象），没有包声明时它回 404。
    if (parts.rawPath === MODS_PANELS_URL && modsPanels && modsPanels(req, res)) return;
    if (parts.rawPath === PUBLIC_ROOMS_URL) {
      // **只有一个整数字段**：加任何一个别的键（房号、房主名、在局中、人数、容量）都是把「数」变成侧写，
      // 那正是这一格被收窄掉的东西。`sendJson` 自带 `Cache-Control: no-store`。
      sendJson(req, res, 200, { publicRooms: health.lobby.roomCounts().publicRooms });
      return;
    }
    if (parts.rawPath === MUSIC_LIBRARY_URL) {
      // 服务器音乐库（官方 BGM + 工坊包 bgm）：只读、无会话、无令牌；客户端据此列出可选的 Fever 曲目。
      const now = Date.now();
      if (!musicCache || now - musicCache.at > MUSIC_CACHE_MS) musicCache = { at: now, tracks: musicLibrary(publicDir, workshopAssets, workshopPackNames) };
      sendJson(req, res, 200, { tracks: musicCache.tracks });
      return;
    }
    // 账号名规则**先**判：它与房间号规则共用 `/api/records/` 前缀，而账号名不一定是 4 个字母。
    // 没有账号的服务器上这里回 404 —— 「功能不存在」与「这个账号没打过」是两件事，不该用同一个码回答。
    const accountPath = ACCOUNT_PATH_RE.exec(parts.rawPath);
    if (accountPath) {
      if (!records || !accounts) { sendJson(req, res, 404, { error: 'NOT_ENABLED' }); return; }
      let name;
      try { name = decodeURIComponent(accountPath[1]); } catch { sendJson(req, res, 400, { error: 'BAD_REQUEST' }); return; }
      // 「这个名字太长」与「没有这个账号」必须同答复：分开就成了存在性/长度探针。
      if ([...name].length > ACCOUNT_NAME_MAX) { sendJson(req, res, 404, { error: 'RECORD_NOT_FOUND' }); return; }
      if (!admitRecordRead(req, res)) return;
      // 形状收窄在 `matchRecords.latestByAccount` 里：只回**被查账号本人**那一行，且不含购卡明细。
      const record = records.latestByAccount(accounts, name);
      res.setHeader('Cache-Control', 'no-store');
      sendJson(req, res, record ? 200 : 404, record || { error: 'RECORD_NOT_FOUND' });
      return;
    }
    const recordPath = ROOM_CODE_PATH_RE.exec(parts.rawPath);
    if (recordPath) {
      if (!records) { sendJson(req, res, 404, { error: 'NOT_ENABLED' }); return; }
      if (!admitRecordRead(req, res)) return;
      const record = records.latestRoom(recordPath[1].toUpperCase(), VIEW.PUBLIC);
      res.setHeader('Cache-Control', 'no-store');
      sendJson(req, res, record ? 200 : 404, record || { error: 'RECORD_NOT_FOUND' });
      return;
    }
    // 大型资源的核对/补齐状态（server/largeAssets.js，起服后台跑）：只读、no-store、没有令牌。没接线就是 404
    // —— 与「这个功能没开」区分：`phase: 'off'` 是开着的服务器主动说「我关了它」，404 是这条路根本不存在。
    if (largeAssets && parts.rawPath === largeAssets.path) {
      sendJson(req, res, 200, largeAssets.status());
      return;
    }
    // 干员冲突兼容（2026-10-16）：合并层留下的索引只读地发出去 —— 客户端靠它列出「哪些干员有多个来源、分别是谁」。
    // **只读**：选择本身走 WebSocket 的 `room.conflict`（`shared/protocol.js`），这条路只回答「有什么可挑」。
    // 没有冲突时 body 是 `null`（不是 `{}`）—— 「这台服务器上根本没有冲突」与「有冲突但列表是空的」不是同一件事。
    if (workshopConflicts && parts.rawPath === workshopConflicts.path) {
      sendJson(req, res, 200, workshopConflicts.list());
      return;
    }
    // 「资源查看」面板：清单快照（总量 + 分组 + 每个文件）与「重新下载」。
    // **一个 GET 带副作用**是刻意的：这个引擎的 HTTP 面**只开 GET/HEAD**（下面那条 405），玩法走 WebSocket、
    // 包面走 `/workshop-panels/*` —— 为了一个「重下某组素材」的运维动作新开一个 POST 通道，代价比收益大。
    // 两件事都被收窄住了：`list` 只是读清单；`redownload` 的参数只认 `all` / 组名 / `assets/...` 路径（服务器侧
    // 再判一次），而且**单飞** —— 忙的时候第二次请求只会拿到同一份状态，不会叠出第二个下载进程。
    if (largeAssets && largeAssets.listPath && parts.rawPath === largeAssets.listPath) {
      largeAssets.list().then((payload) => {
        if (payload) sendJson(req, res, 200, { ...payload, status: largeAssets.status() });
        else sendJson(req, res, 503, { error: 'LIST_UNAVAILABLE' });
      }, () => { if (!res.headersSent) sendJson(req, res, 500, { error: 'LIST_FAILED' }); });
      return;
    }
    if (largeAssets && largeAssets.redownloadPath && parts.rawPath === largeAssets.redownloadPath) {
      // `parts.query` 是**裸串**（`server/http/common.js splitUrl`），不是 URLSearchParams —— 照 `wantsTraffic` 那一处
      // 的做法用正则取一个具名参数，别去调 `.get()`（那会静默地拿到 undefined，然后一律重下全部）。
      const target = (/:?&?target=([^&]*)/i.exec(parts.query || '') || [])[1];
      let decoded = null;
      try { decoded = target ? decodeURIComponent(target.replace(/\+/g, ' ')) : null; } catch { decoded = null; }
      if (!largeAssets.enabled()) sendJson(req, res, 200, { started: false, reason: 'DISABLED', status: largeAssets.status() });
      else sendJson(req, res, 200, {
        started: largeAssets.redownload(decoded || 'all'),
        target: decoded || 'all',
        status: largeAssets.status(),
      });
      return;
    }
    // 「大型资源」的备用源：**同源**代理（server/assetPack.js）。客户端只跟自己说话 —— 页面的 CSP 是
    // `connect-src 'self'`（server/http/csp.js），跨域请求**根本发不出去**（实测：GitHub Release 那一跳因此不可达）。
    // 所以跨域由服务端走：这里按 data/asset-pack.json 声明的源按序回退、流式转发，客户端只看到一个同源 URL。
    // 未声明（文件不在 / groups 为空）⇒ 404；文件名不在白名单 ⇒ 404（理由在服务端日志里，不回给调用方）。
    if (assetPack && parts.rawPath.startsWith(assetPack.prefix)) {
      await assetPack.serve(req, res, parts.rawPath.slice(assetPack.prefix.length));
      return;
    }
    if (parts.rawPath === '/healthz') {
      const withTraffic = wantsTraffic(parts.query) && isLocalIp(clientAddress(req, trustProxy).ip);
      sendJson(req, res, 200, healthReport(health, withTraffic));
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    if (csp) res.setHeader('Content-Security-Policy', csp);
    // 每一条回答的体字节都进流量计数（traffic.js），在**写出任何东西之前**接上 —— 与上游同一条纪律。
    if (health.traffic) health.traffic.meter(res, splitUrl(req.url || '/')?.rawPath || '/');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
