// server-ext —— 工坊包 server-ext 的房间侧小挂件（`pack.json.client.panels[]`，docs/WORKSHOP.md §1.9.3 / §1.9.6）。
//
// 挂在 `screen.room.chat`（`screens/chat.js` 的「房内聊天」`Panel` 的 `actions` 那一格）：房内一枚「同盟邀约」按钮。
// 点它就把**本房间**发到大厅 —— 走包通道 `invite`（pack.json 里声明成 `scope: "lobby"`），别处的大厅面板（本包
// `ui/chat.js` 的「同盟邀约」页签）据此列出「房间名 + 密钥」。
//
// **房间名是推出来的，不是引擎字段**：`room.state` 里只有 `code` / `mode` / `seats` / `hostId`，服务端**没有**
// 「房间名」这一格，也没有别的地方存过它。一个房间唯一稳定可读的身份是**房主那一席的显示名**（`seats` 里
// `playerId === hostId` 那一条的 `name`），所以名字取「<房主名> 的同盟」再缀上模式（独立模拟 / 同盟模拟）。
// 这是这里现算的**推导**：要在别处再算一遍就是第二个会漂的真相，所以本包只在发送这一处算。
//
// 状态不在包里：房间从引擎的 store 现读（`store.get().room`，与 `screens/chat.js` 同一个 store 单例），按钮只是
// 按它把 `{ name, code }` 组成一条载荷。

import { store } from '/js/store.js';

const CLS = 'se-invite';
/** 模式的中文名（引擎 `screens/room.js` 那一份：`coop ? '同盟模拟' : '独立模拟'`）。 */
const MODE_TEXT = { solo: '独立模拟', coop: '同盟模拟' };
/** 「已发送」确认挂多久（秒 × 1000）。 */
const CONFIRM_MS = 4000;

/**
 * 由房间现推一个展示名（见文件头：服务端没有房间名这一格）。
 * @param {any} room `room.state` 快照（`store.get().room`）
 * @returns {string}
 */
function roomDisplayName(room) {
  const seats = Array.isArray(room && room.seats) ? room.seats : [];
  const hostSeat = seats.find((s) => s && s.playerId === room.hostId) || null;
  const hostName = (hostSeat && typeof hostSeat.name === 'string' && hostSeat.name)
    || (room && room.hostId ? String(room.hostId) : '房主');
  const mode = MODE_TEXT[room && room.mode] || '';
  return mode ? `${hostName} 的同盟 · ${mode}` : `${hostName} 的同盟`;
}

/**
 * 挂载：往 `ctx.host` 里加一枚按钮。
 * @param {{ host: any, net: any }} ctx
 * @returns {{ unmount?: () => void }}
 */
export function mount(ctx) {
  const host = ctx && ctx.host;
  if (!host || typeof host.appendChild !== 'function') return {};
  const doc = host.ownerDocument;

  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = CLS;
  // 文案 + 一枚**箭头标识**（业主 2026-10-18：字后面跟一个箭头，像大厅那些「进入」入口）。箭头单独一个 span
  // 是为了能单独调它（小一点、淡一点）；点完的「已发送」只换文案那一半，箭头照旧。
  const label = doc.createElement('span');
  label.className = `${CLS}__t`;
  label.textContent = '同盟邀约';
  const arrow = doc.createElement('span');
  arrow.className = `${CLS}__a`;
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = '→';
  Object.assign(arrow.style, { marginLeft: '.06rem', opacity: '.75' });
  btn.append(label, arrow);
  // 本包没给这个面板写 `styles`（pack.json 里 room-invite 只有 module），而引擎把 `.mod-panel` 置
  // `pointer-events: none`（§1.9.3）—— 所以「能点」和观感都写在这几条行内样式上。配色取引擎的 CSS 变量。
  // 业主 2026-10-18：按钮**放大一些**（字号 / 内边距 / 字距都比原先大一档，箭头一起放大）。
  Object.assign(btn.style, {
    pointerEvents: 'auto',
    font: 'inherit',
    fontSize: '.18rem',
    lineHeight: '1.5',
    padding: '.04rem .16rem',
    letterSpacing: '.02em',
    color: 'var(--mint-400)',
    background: 'rgba(78, 216, 175, .12)',
    border: '1px solid rgba(78, 216, 175, .35)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  host.appendChild(btn);

  let timer = 0;
  btn.addEventListener('click', () => {
    const room = store.get().room;
    const code = room && typeof room.code === 'string' ? room.code.trim() : '';
    if (!code) return;   // 不在房间里（不该挂上，但别猜）
    // 帧上只有发送者的 `playerId`（`server/lobby.js` 的 `from`），所以显示名由**发送方**随载荷带上。
    const me = store.get().me;
    ctx.net.send('invite', { name: roomDisplayName(room), code, by: (me && me.name) || '' });
    // 短确认：把按钮停几秒、写「已发送」——同一条消息连点没有意义（每会话令牌桶也会限流）。
    // 只换文案那一半（`label`），箭头那一半留着 —— 它不是状态，是这枚按钮的标识。
    btn.disabled = true;
    label.textContent = '已发送';
    btn.style.color = 'var(--gold)';
    btn.style.borderColor = 'rgba(255, 198, 0, .35)';
    timer = doc.defaultView.setTimeout(() => {
      if (!btn.isConnected) return;
      btn.disabled = false;
      label.textContent = '同盟邀约';
      btn.style.color = 'var(--mint-400)';
      btn.style.borderColor = 'rgba(78, 216, 175, .35)';
    }, CONFIRM_MS);
  });

  return {
    unmount() {
      if (timer) doc.defaultView.clearTimeout(timer);
      timer = 0;
      if (btn.parentNode) btn.parentNode.removeChild(btn);
    },
  };
}
