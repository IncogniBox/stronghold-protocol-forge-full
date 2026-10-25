// server-ext —— 工坊包 server-ext 的大厅面板（`pack.json.client.panels[]`，docs/WORKSHOP.md §1.9.3 / §1.9.6）。
//
// 挂在 `screen.lobby.aside`（大厅左栏底部，`screens/lobby.js` 的 `<aside class="hub-side">` 里那一格），两个页签：
//   * **大厅交流** —— 大厅里所有人互相可见的公共消息。走本包自己的包通道 `lobby`，它在 pack.json 里声明成
//     `scope: "lobby"`：服务器 `packMsg`（`server/lobby.js`）在会话**不在房间里**时，把帧广播给**大厅里**（同样
//     不在房间）的每一个已连接会话 —— 于是它只在大厅里说得出、也只在大厅里听得到。
//   * **同盟邀约** —— 别人发来的房间邀约（包通道 `invite`）。每一行是「房间名 + 密钥」，密钥是个**可点的芯片**：
//     点它就走引擎既有的入房链路（先不带同意发一次，被拒再带 `consent` 重发，见 `screens/lobby.js` 的
//     `joinWithConsent`）。
//
// 两条与引擎同源的纪律：
//   * **文本是数据，不是标记**：所有消息都经 Preact 的文本节点渲染（`${...}`），从不 `innerHTML` —— 一条消息不该
//     有能力改页面结构（`screens/chat.js` 同一条）。
//   * **指针默认不吃**：`ctx.host`（`.mod-panel`）由引擎置 `pointer-events: none`，所以本面板的样式里
//     `.community-chat` 打开 `pointer-events: auto`（§1.9.3）。
//   面板根的类名 `community-chat` 是**引擎约定**，不是随手取的：`public/css/screens/lobby.css` 有一条
//   `.hub-dialog-open .community-chat { visibility: hidden }` —— 大厅弹窗打开时让位。

import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { net } from '/js/net.js';
import { store } from '/js/store.js';
import * as roomMods from '/js/roomMods.js';
import { toastError } from '/js/ui/toasts.js';

/**
 * htm 会把**全静态**子树的 vnode 缓存进模板对象里，而 Preact 挂载时会把 DOM 节点与父链写进那个共享 vnode ——
 * 屏幕卸载之后模块级缓存还指着旧 DOM。`this[0] = 3` 是 htm 的 opt-out（与引擎 `components.js` 的 `hFresh` 同一条）。
 */
const hFresh = function (type, props, ...children) {
  if (this && typeof this === 'object') this[0] = 3;
  return h(type, props, ...children);
};
const html = htm.bind(hFresh);

/** 消息历史有界（与引擎 `screens/chat.js` 的 `-200` 同一口径）。 */
const HISTORY_MAX = 200;
/** 邀约列表有界（一条密钥只占一行，见下面的去重）。 */
const INVITES_MAX = 50;
/** 输入框上限（与引擎房内聊天同一个数量级）。 */
const TEXT_MAX = 120;
/** 一排表情：点一下插进草稿（`<textarea>` 那种富交互这版不做）。 */
const EMOJI = ['😀', '😂', '👍', '❤️', '🎉', '😭'];

/**
 * 按**引擎既有链路**入房：先按「没同意」发一次（`buildJoinPayload` 会把服务器摘要 `mods` 一起带上 —— 缺了它，
 * 装了包的服务器会直接拒），服务端回 `MOD_CONSENT_REQUIRED` 时才用 `consentRetryPayload` 带 `consent` 重发。
 * 这就是 `screens/lobby.js` 的 `joinWithConsent`，只少了它那一步 `confirmDialog`（邀请是**别人**发来的、玩家
 * 点芯片本身就当表态；其余拒因照旧原样 toast）。
 * @param {string} code 同盟密钥
 */
async function joinRoom(code) {
  try {
    await net.request('room.join', roomMods.buildJoinPayload(code));
  } catch (err) {
    const retry = roomMods.consentRetryPayload(err, code);
    // 不是「还没同意」那一条 ⇒ 原样报出来（`String(err)` 与大厅一致）
    if (!retry) { toastError(String(err)); return; }
    try { await net.request('room.join', retry); }
    catch (err2) { toastError(String(err2)); }
  }
}

/**
 * 一条大厅消息的展示形状。`data` 是**不透明**载荷（引擎不看、不改），所以每个字段都当**不可信**读：不是字符串
 * 就别拿它去渲染。`by`/`name` 若没带，退回帧上的 `from`（服务器只发布发送者的 `playerId`）。
 * @param {any} data `pack.msg` 的 `data`
 * @param {any} msg 整条 `pack.msg` 帧（`ctx.net.on` 的第二个参数，带 `from`）
 */
const lineOf = (data, msg) => ({
  name: data && typeof data.name === 'string' && data.name ? data.name : String(msg && msg.from != null ? msg.from : ''),
  text: data && typeof data.text === 'string' ? data.text : '',
});

/** `HH:MM`（大厅消息的时间戳，与参考页面的聊天行一致）。 */
const timeOf = (at) => {
  const d = new Date(Number.isFinite(at) ? at : Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 面板本体：两个页签 + 已接收的消息 / 邀约。 */
function LobbyChat({ net: api }) {
  const [tab, setTab] = useState('chat');
  const [lines, setLines] = useState(() => [{ system: true, text: '你已进入大厅频道', at: Date.now() }]);
  const [invites, setInvites] = useState([]);
  const [draft, setDraft] = useState('');
  const listRef = useRef(null);

  // 订阅两条包通道（`ctx.net.on` 只把「本包 + 本通道」的 `pack.msg` 交过来）；卸载时一并退订。
  useEffect(() => {
    const offLobby = api.on('lobby', (data, msg) => {
      const line = lineOf(data, msg);
      if (!line.text) return;
      setLines((prev) => [...prev, { ...line, at: Date.now() }].slice(-HISTORY_MAX));
    });
    const offInvite = api.on('invite', (data, msg) => {
      if (!data || typeof data !== 'object') return;
      const code = typeof data.code === 'string' ? data.code.trim() : '';
      if (!code) return;
      const item = {
        // 房间名由**发送方**推出来（服务端没有房间名这一格，见 ui/roomInvite.js 的文件头）；没给就退回密钥
        name: typeof data.name === 'string' && data.name ? data.name : code,
        code,
        by: typeof data.by === 'string' && data.by ? data.by : String(msg && msg.from != null ? msg.from : ''),
      };
      // 同一把密钥不重复占行：新到的那条把它顶到最前（列表是「现在还能进的那些」，不是流水账）
      setInvites((prev) => [item, ...prev.filter((x) => x.code !== code)].slice(0, INVITES_MAX));
    });
    return () => { offLobby(); offInvite(); };
  }, [api]);

  // 新消息 / 切页签时滚到底（按下标 scope，钩子不会因为 ref 换元素而乱跑）
  useEffect(() => {
    const el = listRef.current;
    if (el && typeof el.scrollTop === 'number') el.scrollTop = el.scrollHeight;
  }, [lines.length, tab]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');                       // 乐观清空：与房内聊天同一条
    // 帧上只有发送者的 `playerId`（`server/lobby.js` 的 `from`），所以**发信人自己**把显示名放进载荷 —— 否则
    // 大厅里每一行都只会显示一串 id。名字来自本地 `me`（`store` 里 `welcome` 的那一份）。
    const me = store.get().me;
    api.send('lobby', { name: (me && me.name) || '', text });
  };
  const insert = (emoji) => setDraft((d) => (d + emoji).slice(0, TEXT_MAX));

  return html`
    <div class="community-chat__head">
      <span class="community-chat__micro">LOBBY CHAT</span>
      <span class="community-chat__title">${'大厅聊天'}</span>
      <span class="community-chat__status"><i></i>${'在线'}</span>
    </div>
    <div class="community-chat__tabs" role="tablist">
      <button type="button" role="tab" aria-selected=${tab === 'chat'}
        class=${`community-chat__tab${tab === 'chat' ? ' is-on' : ''}`} onClick=${() => setTab('chat')}>${'大厅频道'}</button>
      <button type="button" role="tab" aria-selected=${tab === 'invite'}
        class=${`community-chat__tab${tab === 'invite' ? ' is-on' : ''}`} onClick=${() => setTab('invite')}>${'招募频道'}${invites.length ? ` ${invites.length}` : ''}</button>
    </div>
    ${tab === 'chat' ? html`
      <div class="community-chat__list" ref=${listRef}>
        ${lines.length === 0
          ? html`<div class="community-chat__empty">${'还没有人说话'}</div>`
          : lines.map((m, i) => html`
            <div class=${`community-chat__row${m.system ? ' is-system' : ''}`} key=${`${m.name}:${i}`}>
              <time class="community-chat__time">${timeOf(m.at)}</time>
              ${m.system
              ? html`<span class="community-chat__text">${m.text}</span>`
              : html`<span class="community-chat__name">${m.name}</span><span class="community-chat__text">${m.text}</span>`}
            </div>`)}
      </div>
      <div class="community-chat__emoji">
        ${EMOJI.map((e) => html`
          <button type="button" class="community-chat__emoji-btn" key=${e} title=${'插入表情'}
            onClick=${() => insert(e)}>${e}</button>`)}
      </div>
      <div class="community-chat__send">
        <input class="community-chat__input" value=${draft} maxlength=${TEXT_MAX} placeholder=${'和大厅的博士聊聊…'}
          onInput=${(e) => setDraft(e.currentTarget.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} />
        <button type="button" class="community-chat__go" disabled=${!draft.trim()} onClick=${send}>${'发送'}</button>
      </div>`
    : html`
      ${invites.length === 0
        ? html`<div class="community-chat__list"><div class="community-chat__empty">${'还没有收到同盟邀约'}</div></div>`
        : html`<div class="community-chat__list">
            ${invites.map((it) => html`
              <div class="community-chat__invite" key=${it.code}>
                <span class="community-chat__invite-name">${it.name}</span>
                <button type="button" class="community-chat__code" title=${'点击加入该同盟'}
                  onClick=${() => joinRoom(it.code)}>${it.code}</button>
                ${it.by ? html`<span class="community-chat__by">${`来自 ${it.by}`}</span>` : null}
              </div>`)}
          </div>`}`
    }
  `;
}

/**
 * 面板挂载：往 `ctx.host`（引擎给的 `.mod-panel`）里挂一层 `.community-chat`，用 Preact 画。
 * @param {{ host: any, net: any }} ctx
 * @returns {{ unmount?: () => void }}
 */
export function mount(ctx) {
  const host = ctx && ctx.host;
  if (!host || typeof host.appendChild !== 'function') return {};
  const root = host.ownerDocument.createElement('div');
  root.className = 'community-chat';
  host.appendChild(root);
  render(html`<${LobbyChat} net=${ctx.net} />`, root);
  return {
    unmount() {
      render(null, root);       // 收掉 Preact 树（顺带跑掉订阅的 cleanup）
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
