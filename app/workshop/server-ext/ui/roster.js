// roster.js —— 房间旁栏的**成员名单**（本包 `pack.json.client.panels[]` 的第五块界面，挂点 `screen.room.aside`）。
//
// ## 它为什么存在（票据绑定那一刀的「下半条」）
// 参考文档 `registration.md` §1 里，账号体系的一部分价值在于「头像在房间、对局、聊天与排名上可见」。本包原来做不到：
// **客户端自报的 `playerId` 不可信**，账号服务因此不敢把「座位 A 是谁」当事实。补齐的那一半是**引擎签发的票据**
// （`welcome.bindTicket` → 本包服务端用 `host.tickets.verify` 验 → 把 `playerId` 绑到账号上）。有了可信的绑定，
// 「按座位号查人」这条读路才成立（参考文档 §3 的 `/accounts/lookup?ids=`）。
//
// 这一块**只读**：它订阅引擎的 `room.state`（S2C，原样透传，不必声明 `messages`），拿到座位表里的 `playerId`，
// 再用本包 lane 的 `lookup` 逐位换出「`昵称#编号` + 头像」。没绑定的座位照旧只显示引擎给的显示名 —— 面板
// **不编造**任何东西（与 `ctx.me` 那条「读不到就是 null」同一条纪律）。
//
// ## 为什么不 import `ui/panel.js` 里的账号客户端
// 引擎只服务**声明过**的面板模块（`/workshop-panels/<包>/<module>`），兄弟文件不在那份名单里（实测 `import './acct.js'`
// 当场 404）。所以每个面板模块都得自足：这里自带一枚**只有 `lookup` 一条路**的小客户端（同一个 lane，第二条连接）。
//
// ## 边界
//   * 载荷按**不可信**读（座位表是服务器给的公开视图，但仍逐字段判类型）；
//   * 头像只在**已审核**时显示（服务端的 `lookup` 已经过滤过一次，这里再判一次类型）；
//   * 文本一律走 Preact 的**文本节点**，从不 `innerHTML`。

import { h, render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import htm from 'htm';

/** htm 的全静态子树缓存会留住旧 DOM（与 `ui/chat.js` 的 `hFresh` 同一条）。 */
const hFresh = function (type, props, ...children) {
  if (this && typeof this === 'object') this[0] = 3;
  return h(type, props, ...children);
};
const html = htm.bind(hFresh);

/** 本包 lane 的路径（与 `server/accounts.mjs` 的 `LANE_PATH` 同一份字面量）。 */
const LANE_PATH = '/mod-ws/server-ext/accounts';
/** 一次 lookup 的超时（毫秒）；超时就当作「这一批查不到」，绝不卡住界面。 */
const LOOKUP_TIMEOUT_MS = 6000;
/** 两次 lookup 之间的最短间隔（座位表会被反复推送，合并成一批再问）。 */
const LOOKUP_DEBOUNCE_MS = 250;
/** 一个座位上最多同时问几个（服务端一次收 64 个）。 */
const LOOKUP_BATCH_MAX = 64;

/** 本机地址 → lane URL。 */
const laneUrl = () => `${globalThis.location && globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${globalThis.location ? globalThis.location.host : 'localhost'}${LANE_PATH}`;

/**
 * 一枚**只有 `lookup`** 的小客户端：一条连接、请求/应答按自增 `id` 对上。
 * 失败一律回落到「空结果 + 一行日志」—— 这一块界面挂不上不该让房间屏出事。
 */
class LookupLane {
  constructor({ log = null } = {}) {
    this.log = log;
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
      // 连不上（没有 lane / 服务没开）时也要有个结束：6 秒后当作「这条连接没有」
      globalThis.setTimeout(() => { if (this.opening) { this.opening = null; try { socket.close(); } catch { /* 已经没了 */ } resolve(null); } }, 6000);
    });
    return this.opening;
  }

  onFrame(raw) {
    let msg; try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg.id !== 'number') return;
    const slot = this.pending.get(msg.id);
    if (!slot) return;
    this.pending.delete(msg.id);
    try { clearTimeout(slot.timer); } catch { /* 已触发 */ }
    slot.resolve(msg.ok === false ? [] : (Array.isArray(msg.players) ? msg.players : []));
  }

  failAll() {
    for (const [, slot] of this.pending) { try { clearTimeout(slot.timer); } catch { /* 已触发 */ } slot.resolve([]); }
    this.pending.clear();
  }

  /**
   * 按 **game playerId** 批量换出展示面。**不要求登录**（参考文档 §3：游客也能读），
   * 所以这里不带 token；服务端自带按地址的限流。
   * @param {string[]} ids
   * @returns {Promise<Array<{ playerId: string, name: string, tag: number, avatar: string|null }>>}
   */
  async lookup(ids) {
    const list = ids.filter((v) => typeof v === 'string' && v).slice(0, LOOKUP_BATCH_MAX);
    if (!list.length) return [];
    const socket = await this.open();
    if (!socket || socket.readyState !== 1) return [];
    const id = this.seq++;
    return new Promise((resolve) => {
      const timer = globalThis.setTimeout(() => { this.pending.delete(id); resolve([]); }, LOOKUP_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      try { socket.send(JSON.stringify({ id, op: 'lookup', ids: list })); }
      catch { this.pending.delete(id); clearTimeout(timer); resolve([]); }
    });
  }

  close() {
    this.failAll();
    const socket = this.ws;
    this.ws = null;
    this.opening = null;
    if (socket) { try { socket.close(1000, 'roster closed'); } catch { /* 已经没了 */ } }
  }
}

/** 座位表里一条的展示形状（每个字段都当不可信读）。 */
const seatOf = (raw, index) => ({
  playerId: raw && typeof raw.playerId === 'string' && raw.playerId ? raw.playerId : null,
  name: raw && typeof raw.name === 'string' && raw.name ? raw.name : '',
  seat: typeof (raw && raw.seat) === 'number' ? raw.seat : index,
  ready: !!(raw && raw.ready),
  banished: !!(raw && raw.banished),
});

const Avatar = ({ account, size = 26 }) => {
  const style = { width: `${size}px`, height: `${size}px` };
  if (account && typeof account.avatar === 'string' && account.avatar) {
    return html`<span class="roster-avatar" style=${style}><img class="roster-avatar__img" src=${account.avatar} alt="" /></span>`;
  }
  const first = account && account.name ? [...account.name][0] : (account ? '?' : '·');
  return html`<span class=${`roster-avatar roster-avatar--text${account ? '' : ' roster-avatar--none'}`} style=${style}>${first}</span>`;
};

/**
 * 名单本体。
 * @param {{ ctx: any }} props
 */
function Roster({ ctx }) {
  const lane = useMemo(() => new LookupLane({ log: ctx && ctx.log }), [ctx]);
  /** `playerId` → 已查到的账号展示面（`null` = 查过、但没有绑定）。 */
  const [known, setKnown] = useState(() => new Map());
  /** 最近一条 `room.state`（座位表的来源）。 */
  const [state, setState] = useState(null);
  const timerRef = useRef(null);
  const idsRef = useRef([]);

  useEffect(() => {
    if (!ctx || !ctx.net || typeof ctx.net.on !== 'function') return () => {};
    // `room.state` 是引擎的 S2C 类型，照旧原样透传（不必在 pack.json 里声明 `messages`）。
    const off = ctx.net.on('room.state', (msg) => setState(msg && typeof msg === 'object' ? msg : null));
    return () => { try { off(); } catch { /* 已经退订 */ } };
  }, [ctx]);

  const seats = useMemo(() => {
    // **只列在座的成员**：`room.state.seats` 是按房间容量补齐的（20 席时 19 个空位），把空位也画成
    // 「（未起名）· 未绑定」会让这块旁栏从一行涨到整个列表上限（2.6rem ≈ 260px），把房间屏的座位区挤矮
    // —— 座位卡是 flex 列，立绘跟着被压小（业主反馈的「加 AI 后立绘缩小」就是这个）。
    const list = Array.isArray(state && state.seats)
      ? state.seats.map(seatOf).filter((s) => s && s.playerId)
      : [];
    const watchers = Array.isArray(state && state.spectators)
      ? state.spectators.map((s, i) => ({ ...seatOf(s, i), spectator: true })) : [];
    return [...list.map((s) => ({ ...s, spectator: false })), ...watchers];
  }, [state]);

  // 座位表一变就（防抖地）把**还没查过**的 playerId 攒成一批问一次。
  useEffect(() => {
    const ids = seats.map((s) => s.playerId).filter((id) => id && !known.has(id));
    if (!ids.length) return;
    idsRef.current = ids;
    if (timerRef.current) return;
    timerRef.current = globalThis.setTimeout(async () => {
      timerRef.current = null;
      const batch = idsRef.current.slice(0, LOOKUP_BATCH_MAX);
      idsRef.current = [];
      if (!batch.length) return;
      const rows = await lane.lookup(batch);
      const found = new Map(rows.map((r) => [r.playerId, r]));
      setKnown((prev) => {
        const next = new Map(prev);
        for (const id of batch) next.set(id, found.get(id) || null);
        return next;
      });
    }, LOOKUP_DEBOUNCE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats, lane]);

  useEffect(() => () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    lane.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myId = ctx.me && ctx.me.playerId ? ctx.me.playerId : null;
  const bound = seats.filter((s) => s.playerId && known.get(s.playerId)).length;

  return html`<div class="roster">
    <div class="roster__head">
      <span class="roster__title">房间成员</span>
      <span class="roster__count">${seats.length ? `${seats.length} 人` : ''}</span>
    </div>
    <div class="roster__list">
      ${seats.length ? seats.map((s) => {
    const account = s.playerId ? known.get(s.playerId) : null;
    const me = s.playerId && myId && s.playerId === myId;
    return html`<div class="roster__row" key=${s.playerId || `seat-${s.seat}`}>
      <${Avatar} account=${account} size=${26} />
      <span class="roster__name">${account && account.name ? account.name : (s.name || '（未起名）')}
        ${account && account.tag ? html`<span class="roster__tag">#${account.tag}</span>` : null}</span>
      ${s.spectator ? html`<span class="roster__flag">旁观</span>` : null}
      ${me ? html`<span class="roster__flag roster__flag--me">你</span>` : null}
      ${account ? null : html`<span class="roster__flag roster__flag--dim">未绑定</span>`}
    </div>`;
  }) : html`<div class="roster__empty">（等房间成员进来）</div>`}
    </div>
    <div class="roster__foot">${bound ? `已绑定账号：${bound} 人` : '还没有人绑定账号'}</div>
  </div>`;
}

/**
 * 面板挂载（引擎的挂载点契约）。
 * @param {any} ctx
 * @returns {{ unmount: () => void }}
 */
export function mount(ctx) {
  const host = ctx && ctx.host;
  const root = globalThis.document.createElement('div');
  root.className = 'roster-root';
  if (host && typeof host.appendChild === 'function') host.appendChild(root);
  render(html`<${Roster} ctx=${ctx} />`, root);
  return {
    unmount() {
      try { render(null, root); } catch { /* 已经拆过 */ }
      if (typeof root.remove === 'function') root.remove();
    },
  };
}
