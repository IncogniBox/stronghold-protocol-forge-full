// 账号（真实模块）：接在工坊包 `server-ext` 已有的账号服务上 ——
// 那条 lane 是 `/mod-ws/server-ext/accounts`（workshop/server-ext/server/accounts.mjs），本模块只读它的
// `lookup`（game playerId → 昵称#编号 / 头像 / 名片）与 `me`，不另建一套账号库，也不迁移那份 accounts.json。
//
// ## 没有账号服务时
// lane 连不上 ⇒ `lookup` 一律空、`useAccount` 恒 `null`：顶栏退回博士名，席位不显示 #编号（与旧的兼容垫片同一条
// 「读不到就不编造」）。登录 / 注册界面仍然在包的 `ui/panel.js` 里（起名页与统计页），这里不重复做。
//
// ## 为什么自己带一条小客户端
// 引擎只服务声明过的面板模块，`public/js/ui/*` 不能 import `workshop/server-ext/ui/panel.js`；两个界面又都只读同一
// 条 lane，所以这里复制的是**协议信封**，不是业务逻辑。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, AvatarFrame, MicroLabel } from './components.js';
import { net } from '../net.js';
import { NAMECARD_IDS } from '../../../shared/namecards.js';
import { t } from '../../../shared/i18n.js';

const LANE_PATH = '/mod-ws/server-ext/accounts';
/** 与包内 `ui/panel.js` 的 `TOKEN_KEY` 同一份字面量：登录状态是同一台机器上的同一份。 */
const TOKEN_KEY = 'sp.pref.panel.server-ext.token';
const LOOKUP_DEBOUNCE_MS = 120;
const LOOKUP_TIMEOUT_MS = 6000;
/** 服务端一次最多收 64 个 id（accounts.mjs 的 lookup 分支）。 */
const LOOKUP_MAX = 64;

export function readToken() {
  try {
    const v = globalThis.localStorage?.getItem(TOKEN_KEY);
    return typeof v === 'string' ? v : '';
  } catch { return ''; }
}

const laneUrl = () => `${globalThis.location && globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${globalThis.location ? globalThis.location.host : 'localhost'}${LANE_PATH}`;

/** 一条 lane 连接 + 按自增 id 对上的请求/应答。连不上就返回 `null`，绝不留下永远等不到的 Promise。 */
class Lane {
  constructor() {
    this.ws = null;
    this.opening = null;
    this.seq = 1;
    /** @type {Map<number, { resolve: Function, timer: any }>} */
    this.pending = new Map();
  }

  open() {
    if (this.ws && this.ws.readyState === 1) return Promise.resolve(this.ws);
    if (this.opening) return this.opening;
    this.opening = new Promise((resolve) => {
      let socket;
      try { socket = new globalThis.WebSocket(laneUrl()); }
      catch { this.opening = null; resolve(null); return; }
      this.ws = socket;
      socket.onopen = () => { this.opening = null; resolve(socket); };
      socket.onerror = () => { /* onclose 接着说 */ };
      socket.onclose = () => { this.ws = null; this.opening = null; this.failAll(); };
      socket.onmessage = (ev) => this.onFrame(ev && ev.data);
      globalThis.setTimeout(() => {
        if (this.opening) { this.opening = null; try { socket.close(); } catch { /* 已经没了 */ } resolve(null); }
      }, 6000);
    });
    return this.opening;
  }

  onFrame(raw) {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg.id !== 'number') return;
    const slot = this.pending.get(msg.id);
    if (!slot) return;
    this.pending.delete(msg.id);
    try { clearTimeout(slot.timer); } catch { /* 已经触发 */ }
    slot.resolve(msg.ok === false ? null : msg);
  }

  failAll() {
    for (const [, slot] of this.pending) { try { clearTimeout(slot.timer); } catch { /* 已经触发 */ } slot.resolve(null); }
    this.pending.clear();
  }

  /** @param {string} op @param {Record<string, any>} fields @returns {Promise<any|null>} */
  async request(op, fields = {}) {
    const socket = await this.open();
    if (!socket || socket.readyState !== 1) return null;
    const id = this.seq++;
    const token = readToken();
    return new Promise((resolve) => {
      const timer = globalThis.setTimeout(() => { this.pending.delete(id); resolve(null); }, LOOKUP_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      try { socket.send(JSON.stringify({ id, op, ...(token ? { token } : {}), ...fields })); }
      catch { this.pending.delete(id); clearTimeout(timer); resolve(null); }
    });
  }
}

const lane = new Lane();

/** 把服务端的展示面换成界面形状（`card` = 名片背景 id；老账号没设过就按编号给一张）。 */
const viewOf = (row) => (row && typeof row === 'object' && typeof row.name === 'string'
  ? {
    id: typeof row.accountId === 'string' ? row.accountId : null,
    name: row.name,
    tag: Number.isFinite(row.tag) ? row.tag : null,
    avatar: typeof row.avatar === 'string' && row.avatar ? row.avatar : null,
    card: typeof row.namecard === 'string' && NAMECARD_IDS.includes(row.namecard)
      ? row.namecard
      : (Number.isFinite(row.tag) ? `nc${String(row.tag % NAMECARD_IDS.length).padStart(2, '0')}` : null),
  }
  : null);

/** playerId → 展示面（`null` = 查过、但没有绑定账号）。 */
const cache = new Map();
/** playerId → 订阅者。 */
const subscribers = new Map();
const queued = new Set();
let timer = null;

function notify(playerId) {
  const set = subscribers.get(playerId);
  if (!set) return;
  for (const fn of [...set]) { try { fn(); } catch { /* 观察者自己的异常不外溢 */ } }
}

function storeRows(ids, rows) {
  const found = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.playerId, viewOf(r)]));
  for (const id of ids) {
    const next = found.get(id) || null;
    const prev = cache.get(id);
    cache.set(id, next);
    if (JSON.stringify(prev) !== JSON.stringify(next)) notify(id);
  }
}

function flushLookups() {
  timer = null;
  const batch = [...queued].slice(0, LOOKUP_MAX);
  for (const id of batch) queued.delete(id);
  if (!batch.length) return;
  lane.request('lookup', { ids: batch }).then((msg) => {
    // 失败（`null`）→ 保留「未查过」，下一次订阅会再问；不能把一次断线记成「没有账号」。
    if (msg && Array.isArray(msg.players)) storeRows(batch, msg.players);
  });
}

function queueLookup(playerId) {
  if (!playerId || cache.has(playerId)) return;
  queued.add(playerId);
  if (!timer) timer = globalThis.setTimeout(flushLookups, LOOKUP_DEBOUNCE_MS);
}

/**
 * 把这条游戏会话绑到账号上（`bind`）：服务端的 `lookup` 只认绑定表，没绑定就查不到自己。
 * 包的账号面板也会绑同一条票据（一票一用）——这里再绑一次只是多一次失败，不会让已绑的会话掉线。
 * 票据来自最近一条 `welcome`；登录发生在 welcome 之后时，等界面下一次调用 `useAccount` 再补绑。
 */
let lastWelcome = null;
let bindTried = false;
function ensureBind(playerId) {
  if (!playerId || bindTried || !readToken() || !lastWelcome) return;
  if (lastWelcome.playerId !== playerId || typeof lastWelcome.bindTicket !== 'string' || !lastWelcome.bindTicket) return;
  bindTried = true;
  lane.request('bind', { ticket: lastWelcome.bindTicket }).then(() => {
    cache.delete(playerId);
    queueLookup(playerId);
  });
}
if (net && typeof net.on === 'function') {
  net.on('welcome', (welcome) => {
    if (!welcome || typeof welcome !== 'object') return;
    lastWelcome = welcome;
    bindTried = false;
    ensureBind(welcome.playerId);
  });
}

/**
 * The account display of one game seat (`null` = not bound / no account service).
 * @param {string|null|undefined} playerId game playerId (room.state seats[].playerId)
 * @returns {{ id: string|null, name: string, tag: number|null, avatar: string|null, card: string|null }|null}
 */
export function useAccount(playerId) {
  const [account, setAccount] = useState(() => (playerId ? cache.get(playerId) ?? null : null));
  useEffect(() => {
    if (!playerId) { setAccount(null); return undefined; }
    let alive = true;
    const fn = () => { if (alive) setAccount(cache.get(playerId) ?? null); };
    let set = subscribers.get(playerId);
    if (!set) subscribers.set(playerId, set = new Set());
    set.add(fn);
    queueLookup(playerId);
    ensureBind(playerId);
    fn();
    return () => {
      alive = false;
      set.delete(fn);
      if (!set.size) subscribers.delete(playerId);
    };
  }, [playerId]);
  return account;
}

/** For modules that need the lane directly (`ui/friends.js`, `ui/achievements.js`, `ui/namecards.js`). */
export const accountLane = {
  request: (op, fields) => lane.request(op, fields),
  lookup: (ids) => lane.request('lookup', { ids: Array.isArray(ids) ? ids.slice(0, LOOKUP_MAX) : [] }),
  token: readToken,
};

/** The hub's top-right chip: avatar + name (+ #tag when known); a click opens 统计数据. */
export function AccountMeChip({ player, onStats }) {
  const account = useAccount(player?.playerId);
  const name = account?.name || player?.name || t('博士');
  const tag = account && Number.isFinite(account.tag) ? account.tag : null;
  return html`<button type="button" class="me-chip me-chip--btn stats-entry" onClick=${onStats} title=${t('统计数据')} aria-label=${t('统计数据')}>
    <${AvatarFrame} size="sm" name=${name} src=${account?.avatar || player?.avatar || undefined} seat=${0} self=${true} />
    <span class="me-chip__text"><span class="me-chip__name">${name}${tag === null ? null : html`<span class="num"> #${tag}</span>`}</span><${MicroLabel}>STATS<//></span>
  </button>`;
}

/** `#编号` (nothing when the seat is not bound to an account). */
export function AccountTag({ playerId }) {
  const account = useAccount(playerId);
  if (!account || !Number.isFinite(account.tag)) return null;
  return html`<span class="num acct-tag">#${account.tag}</span>`;
}
