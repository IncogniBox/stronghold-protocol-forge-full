// 好友（真实模块）：好友关系存在 server-ext 的账号库里（`friendList` / `friendAdd` / `friendRemove`），
// 在线状态取该账号是否还有活着的登录会话。没有账号服务时：入口不存在（`openFriends.unavailable`）。
//
// 外观对齐大厅左栏的「好友」卡与统计页式的面板（样式在 css/screens/lobby.css 的 `.fr` / `.frow` 一节）：
// 入口显示在线人数，面板按「全部 / 在线」分栏，邀请 = 复制当前同盟的房间链接。

import { render } from '../../vendor/preact.module.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, AvatarFrame } from './components.js';
import { accountLane } from './accounts.js';
import { store } from '../store.js';
import { t } from '../../../shared/i18n.js';

let mountRoot = null;

const roomCode = () => {
  const room = store.get()?.room;
  return room && typeof room.code === 'string' ? room.code : '';
};

const roomLink = (code) => `${globalThis.location.origin}${globalThis.location.pathname}?room=${encodeURIComponent(code)}`;

async function copyText(text) {
  try {
    if (globalThis.navigator?.clipboard?.writeText) { await globalThis.navigator.clipboard.writeText(text); return true; }
  } catch { /* 回落到下一行 */ }
  try {
    const input = globalThis.document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    globalThis.document.body.appendChild(input);
    input.select();
    const ok = globalThis.document.execCommand('copy');
    input.remove();
    return ok;
  } catch { return false; }
}

const onlineOf = (list) => (Array.isArray(list) ? list.filter((f) => f && f.online).length : 0);

function FriendRow({ friend, onRemove, onInvite, canInvite }) {
  return html`<li class=${`frow${friend.online ? ' is-on' : ''}`}>
    <${AvatarFrame} size="sm" name=${friend.name} src=${friend.avatar || undefined} seat=${0} />
    <span class="frow__who">
      <span class="frow__name">${friend.name}${Number.isFinite(friend.tag) ? html`<span class="acct-tag"> #${friend.tag}</span>` : null}</span>
      <small><span class="frow__dot"></span>${friend.online ? t('在线') : t('离线')}</small>
    </span>
    ${canInvite ? html`<${Button} size="sm" variant="secondary" onClick=${() => onInvite(friend)}>${t('邀请')}<//>` : null}
    <${Button} size="sm" variant="ghost" onClick=${() => onRemove(friend)} title=${t('移除好友')}><${Icon} name="close" /><//>
  </li>`;
}

function FriendsDialog({ onClose }) {
  const [friends, setFriends] = useState([]);
  const [tab, setTab] = useState('all');
  const [note, setNote] = useState(t('正在读取好友…'));
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const code = roomCode();
  const online = onlineOf(friends);
  const list = tab === 'online' ? friends.filter((f) => f && f.online) : friends;

  const load = async () => {
    const res = await accountLane.request('friendList');
    if (!res) { setNote(t('账号服务未就绪：请确认已登录；若服务器刚更新，重启后可用')); setFriends([]); return; }
    setFriends(Array.isArray(res.friends) ? res.friends : []);
    setNote('');
  };
  useEffect(() => { void load(); }, []);

  const add = async () => {
    const text = login.trim();
    if (!text || busy) return;
    setBusy(true);
    const res = await accountLane.request('friendAdd', { login: text });
    setBusy(false);
    if (!res) { setNote(t('添加失败：没有这个账号，或还没有登录')); return; }
    setLogin('');
    setFriends(Array.isArray(res.friends) ? res.friends : []);
    setNote('');
  };
  const remove = async (friend) => {
    const res = await accountLane.request('friendRemove', { id: friend.id });
    if (!res) { setNote(t('移除失败')); return; }
    setFriends(Array.isArray(res.friends) ? res.friends : []);
    setNote('');
  };
  const invite = async (friend) => {
    if (!code) return;
    const ok = await copyText(t('{name}，来同盟 {code} 一起模拟：{link}', { name: friend.name, code, link: roomLink(code) }));
    setNote(ok ? t('邀请链接已复制，发给好友即可') : t('复制失败，请手动发送房间号 {code}', { code }));
  };

  return html`<${Modal} open=${true} title=${t('好友')} micro="FRIENDS" width="min(36rem, 94vw)" onClose=${onClose}
      actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('关闭')}<//>`}>
    <div class="fr">
      <div class="fr__add">
        <input class="friends__input" type="text" value=${login} placeholder=${t('昵称、昵称#编号 或 QQ')}
          onInput=${(e) => setLogin(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') void add(); }} />
        <${Button} size="sm" disabled=${busy || !login.trim()} onClick=${add}>${t('添加好友')}<//>
      </div>
      <div class="fr__tabs" role="tablist">
        <button type="button" role="tab" aria-selected=${tab === 'all'} class=${tab === 'all' ? 'is-on' : ''}
          onClick=${() => setTab('all')}>${t('全部')}<span class="num">${friends.length}</span></button>
        <button type="button" role="tab" aria-selected=${tab === 'online'} class=${tab === 'online' ? 'is-on' : ''}
          onClick=${() => setTab('online')}>${t('在线')}<span class="num">${online}</span></button>
      </div>
      ${note ? html`<p class="fr__note is-warn">${note}</p>` : null}
      ${list.length
    ? html`<ul class="fr__list">${list.map((f) => html`<${FriendRow} key=${f.id} friend=${f}
        canInvite=${!!code} onInvite=${invite} onRemove=${remove} />`)}</ul>`
    : html`<p class="fr__empty">${tab === 'online' ? t('现在没有在线的好友。') : t('还没有好友。输入对方的昵称或 昵称#编号 添加。')}</p>`}
      ${code ? html`<p class="fr__note">${t('当前同盟 {code}：点好友右侧的「邀请」复制邀请语。', { code })}</p>` : null}
    </div>
  <//>`;
}

/**
 * Open the friends dialog. `mode` is accepted for signature compatibility with the hub (`'list'`).
 * @param {'list'|undefined} [_mode]
 */
export function openFriends(_mode) {
  if (mountRoot) { try { render(null, mountRoot); } catch { /* 已经拆过 */ } mountRoot.remove(); mountRoot = null; }
  mountRoot = globalThis.document.createElement('div');
  mountRoot.className = 'friends-root';
  globalThis.document.body.appendChild(mountRoot);
  const close = () => {
    try { render(null, mountRoot); } catch { /* 已经拆过 */ }
    mountRoot?.remove();
    mountRoot = null;
  };
  render(html`<${FriendsDialog} onClose=${close} />`, mountRoot);
}
openFriends.unavailable = false;

/** The hub's 好友 tile: users icon + 好友 + 在线人数 (the reference page's left column). */
export function FriendsTile() {
  const [online, setOnline] = useState(null);
  useEffect(() => {
    let alive = true;
    accountLane.request('friendList').then((res) => {
      if (alive && res) setOnline(onlineOf(res.friends));
    });
    return () => { alive = false; };
  }, []);
  return html`<button type="button" class="hub-tile hub-tile--friends" onClick=${() => openFriends('list')} title=${t('好友')} aria-label=${t('好友')}>
    <span class="hub-tile__icon"><${Icon} name="users" /></span>
    <span class="hub-tile__text">
      <span class="hub-tile__label">${t('好友')}${online === null ? html`<span class="hub-tile__sub">${t('在线')}</span>` : html`<span class="hub-tile__sub">${t('在线 {n}', { n: online })}</span>`}</span>
      <span class="hub-tile__en">FRIENDS</span>
    </span>
  </button>`;
}
