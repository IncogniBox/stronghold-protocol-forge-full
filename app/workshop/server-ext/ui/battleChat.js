// server-ext —— 工坊包 server-ext 的**对局屏**面板（`pack.json.client.panels[]`，docs/WORKSHOP.md §1.9.3）。
//
// 挂在官方槽 `screen.game.overlay`（`screens/game.js` 根部那块 `.mod-host`），在对局界面**左下角、引擎「交流」按钮的
// 上方**放一块可折叠的半透明聊天框。它说的**不是**包自己的通道，而是**引擎的房间聊天**：
//   * 收：订阅引擎 S2C 的 `chat.msg`（实时）与 `chat.history`（重连补发）—— 与 `screens/chat.js` 的「房内聊天」是
//     **同一段对话**。
//   * 发：`ctx.session.send('room.chat', { text })` —— 与玩家自己在「房内聊天」面板里点「发送」走的是**同一条** C2S。
//     `room.chat` 是本刀新加进 `PANEL_SEND_TYPES` 的**用户动作**（`public/js/ui/extensions.js`），所以本包在
//     `pack.json` 里**不声明** `messages` / `scope`：它一个包通道都不用。
//   * **能不能说照实说**：是不是旁观者、房间 `chatMode` 允不允许打字，全从 `store.get()` 现读（`screens/chat.js` 同
//     一条：客户端只是照着摆样子，真正的裁决在服务端，所以本面板不做「本地说不行就不发」的第二份真相，只把状态画出来）。
//
// 两条与引擎同源的纪律（与 `ui/chat.js` 逐字相同）：
//   * **文本是数据，不是标记**：所有消息都经 Preact 的**文本节点**渲染（`${...}`），从不 `innerHTML`。
//   * **历史有界**：与 `screens/chat.js` 的 `-200` 同一口径。
//
// 折叠 / 展开的选择记在**模块级**变量里：它只活**这一次页面会话**（重挂、换一局都还记着），但不落 store、不落
// localStorage —— 它不是跨房间的全局状态。折叠态是一枚小芯片（照 `ui/combatMetrics.js` 那块统计面板的芯片尺寸 idiom：
// `public/css/screens/game.css` 的 `.gm__gear` / `.gm__metrics`），展开态是一块半透明面板。

import { h, render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import htm from 'htm';
import { store, isSpectating } from '/js/store.js';

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
/** 输入框上限（与引擎房内聊天同一个数量级）。 */
const TEXT_MAX = 120;

/** 折叠 / 展开只活**这一次页面会话**：模块级布尔，重挂（换一局）后仍记得，但不写进任何 store / localStorage。 */
let expanded = false;

/**
 * 现读房间事实（旁观 / 聊天模式）。**不缓存**：`chatMode` 会随 `room.state` 变，旁观身份也会变，
 * 所以每次 store 变化都重读一次（`ctx.me.room` 那份快照没有 `chatMode` 这一格，这里直接读引擎 store）。
 */
function roomFacts() {
  const s = store.get() || {};
  const room = s.room || null;
  const me = s.me || null;
  const spectating = isSpectating(room, me && me.playerId);
  const mode = (room && room.chatMode) || 'open';
  return {
    present: !!room,
    mode,
    spectating,
    // 本面板只有打字输入（没有快捷短语那一条），所以 `'quick'` 模式也说不了
    canType: !!room && mode === 'open' && !spectating,
  };
}

/** 说不了时那一行说明（与服务端那条判据逐条对应）。 */
function noteText(facts) {
  if (facts.spectating) return '观战中无法发言';
  if (!facts.present) return '不在房间内';
  if (facts.mode === 'quick') return '该房间只允许快捷短语';
  return '该房间已关闭聊天';
}

/**
 * 一条 `chat.msg` 的展示形状。`m.text` 是打字消息；快捷短语来的是 `{ quick: [id…], arg? }` —— 本包不引服务端的
 * 短语词表（那是第二个会漂的真相），所以照**原样**把 id 拼出来，绝不自己编一句翻译。
 * @param {any} m 引擎 `chat.msg` 帧
 * @returns {{ name: string, text: string }|null}
 */
function lineOf(m) {
  if (!m || typeof m !== 'object') return null;
  const name = typeof m.name === 'string' && m.name ? m.name : '博士';
  const text = Array.isArray(m.quick)
    ? m.quick.join(' · ') + (m.arg ? ` ${m.arg}` : '')
    : (typeof m.text === 'string' ? m.text : '');
  if (!text) return null;
  return { name, text };
}

/** 面板本体：折叠芯片 / 展开面板两态，订阅引擎房间聊天、发送走 `room.chat`。 */
function BattleChat({ net, session }) {
  const [lines, setLines] = useState([]);
  const [draft, setDraft] = useState('');
  const [facts, setFacts] = useState(roomFacts);
  const [open, setOpen] = useState(expanded);
  const listRef = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // 订阅引擎房间聊天：`chat.msg` 实时追加、`chat.history` 重连补发（整体替换，服务端那份才是真源）；
  // 离开房间（`room.state` 没有 code）就把记录清掉 —— 换一个房间不该看见上一个房间说的话。卸载时一并退订。
  useEffect(() => {
    const offMsg = net.on('chat.msg', (m) => {
      if (!alive.current) return;
      const line = lineOf(m);
      if (line) setLines((prev) => [...prev, line].slice(-HISTORY_MAX));
    });
    const offHist = net.on('chat.history', (m) => {
      if (!alive.current || !m || !Array.isArray(m.messages)) return;
      setLines(m.messages.map(lineOf).filter(Boolean).slice(-HISTORY_MAX));
    });
    const offState = net.on('room.state', (m) => {
      if (!alive.current) return;
      if (!m || !m.code) setLines([]);
    });
    return () => { offMsg(); offHist(); offState(); };
  }, [net]);

  // 房间状态现读（旁观 / chatMode 会变）：订阅引擎 store，把「能不能说」照实画出来
  useEffect(() => {
    const off = store.subscribe(() => setFacts(roomFacts()));
    return off;
  }, []);

  // 新消息 / 展开时滚到底（列表本身就是滚动容器）
  useEffect(() => {
    const el = listRef.current;
    if (el && typeof el.scrollTop === 'number') el.scrollTop = el.scrollHeight;
  }, [lines.length, open]);

  const toggle = () => setOpen((v) => { expanded = !v; return !v; });

  const send = () => {
    const text = draft.trim();
    if (!text || !facts.canType) return;
    setDraft('');                        // 乐观清空：与房内聊天同一条（失败时服务端会回一条错误，面板不去猜）
    session.send('room.chat', { text }); // 引擎消息那条路（`ctx.session.send`），不是 `ctx.net.send` 的包通道
  };

  if (!open) {
    return html`
      <div class="battle-chat">
        <button type="button" class="battle-chat__chip" aria-expanded="false" aria-label=${'展开房内聊天'}
          title=${'房内聊天'} onClick=${toggle}>
          <span class="battle-chat__chip-txt">${'聊天'}</span>
        </button>
      </div>`;
  }
  return html`
    <div class="battle-chat">
      <section class="battle-chat__panel" role="region" aria-label=${'房内聊天'}>
        <header class="battle-chat__head">
          <span class="battle-chat__micro">ROOM CHAT</span>
          <span class="battle-chat__title">${'房内聊天'}</span>
          <button type="button" class="battle-chat__toggle" aria-expanded="true" aria-label=${'收起聊天'}
            title=${'收起'} onClick=${toggle}>${'▾'}</button>
        </header>
        <div class="battle-chat__list" ref=${listRef}>
          ${lines.length === 0
            ? html`<div class="battle-chat__empty">${'还没有人说话'}</div>`
            : lines.map((m, i) => html`
              <div class="battle-chat__row" key=${`${m.name}:${i}`}>
                <span class="battle-chat__name">${m.name}</span>
                <span class="battle-chat__text">${m.text}</span>
              </div>`)}
        </div>
        ${facts.canType
          ? html`
            <div class="battle-chat__send">
              <input class="battle-chat__input" value=${draft} maxlength=${TEXT_MAX} placeholder=${'说点什么…'}
                onInput=${(e) => setDraft(e.currentTarget.value)}
                onKeyDown=${(e) => { if (e.key === 'Enter') send(); }} />
              <button type="button" class="battle-chat__go" disabled=${!draft.trim()} onClick=${send}>${'发送'}</button>
            </div>`
          : html`<div class="battle-chat__note">${noteText(facts)}</div>`}
      </section>
    </div>`;
}

/**
 * 面板挂载：往 `ctx.host`（引擎给的 `.mod-panel`）里挂一层 `.battle-chat`，用 Preact 画。
 * @param {{ host: any, net: any, session: any }} ctx
 * @returns {{ unmount?: () => void }}
 */
export function mount(ctx) {
  const host = ctx && ctx.host;
  if (!host || typeof host.appendChild !== 'function') return {};
  const root = host.ownerDocument.createElement('div');
  root.className = 'battle-chat__root';
  host.appendChild(root);
  render(html`<${BattleChat} net=${ctx.net} session=${ctx.session} />`, root);
  return {
    unmount() {
      render(null, root);       // 收掉 Preact 树（顺带跑掉订阅的 cleanup）
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
