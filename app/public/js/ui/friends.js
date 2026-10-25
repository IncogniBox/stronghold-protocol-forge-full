// 好友（真实模块）：好友关系存在 server-ext 的账号库里（`friendList` / `friendAdd` / `friendRemove`），
// 在线状态取该账号是否还有活着的登录会话。没有账号服务时：入口不存在（`openFriends.unavailable`）。
//
// 邀请 = 把当前同盟的房间链接复制给对方：好友是账号层的，房间是引擎层的，两者用一条链接接上；
// 这里不新增任何引擎协议类型。

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

function FriendRow({ friend, onRemove, onInvite, canInvite }) {
  return html`<div class=${`frow${friend.online ? ' is-on' : ''}`}>
    <${AvatarFrame} size="sm" name=${friend.name} src=${friend.avatar || undefined} seat=${0} />
    <span class="frow__who"><span class="frow__name">${friend.name}${Number.isFinite(friend.tag) ? html`<span class="acct-tag"> #${friend.tag}</span>` : null}</span>
      <small>${friend.online ? t('在线') : t('离线')}</small></span>
    <span class="frow__dot" title=${friend.online ? t('在线') : t('离线')}></span>
    ${canInvite ? html`<${Button} size="sm" variant="secondary" onClick=${() => onInvite(friend)}>${t('邀请')}<//>` : null}
    <${Button} size="sm" variant="ghost" onClick=${() => onRemove(friend)} title=${t('移除好友')}><${Icon} name="close" /><//>
  </div>`;
}

function FriendsDialog({ onClose }) {
  const [friends, setFriends] = useState([]);
  const [note, setNote] = useState(t('正在读取好友…'));
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const code = roomCode();

  const load = async () => {
    const res = await accountLane.request('friendList');
    if (!res) { setNote(t('账号服务未连接，或还没有登录账号')); setFriends([]); return; }
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
    setNote('');
    setFriends(Array.isArray(res.friends) ? res.friends : []);
  };
  const remove = async (friend) => {
    const res = await accountLane.request('friendRemove', { id: friend.id });
    if (!res) { setNote(t('移除失败')); return; }
    setFriends(Array.isArray(res.friends) ? res.friends : []);
  };
  const invite = async (friend) => {
    if (!code) return;
    const ok = await copyText(t('{name}，来同盟 {code} 一起模拟：{link}', { name: friend.name, code, link: roomLink(code) }));
    setNote(ok ? t('邀请链接已复制，发给好友即可') : t('复制失败，请手动发送房间号 {code}', { code }));
  };

  return html`<${Modal} open=${true} title=${t('好友')} micro="FRIENDS" width="min(34rem, 94vw)" onClose=${onClose}
      actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('关闭')}<//>`}>
    <div class="friends">
      <div class="friends__add">
        <input class="friends__input" type="text" value=${login} placeholder=${t('昵称、昵称#编号 或 QQ')}
          onInput=${(e) => setLogin(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') void add(); }} />
        <${Button} size="sm" disabled=${busy || !login.trim()} onClick=${add}>${t('添加好友')}<//>
      </div>
      ${note ? html`<p class="friends__note">${note}</p>` : null}
      ${friends.length
    ? html`<div class="friends__list">${friends.map((f) => html`<${FriendRow} key=${f.id} friend=${f}
        canInvite=${!!code} onInvite=${invite} onRemove=${remove} />`)}</div>`
    : html`<p class="friends__empty">${t('还没有好友。输入对方的昵称或 昵称#编号 添加。')}</p>`}
      ${code ? html`<p class="friends__invite">${t('当前同盟 {code}：点好友右侧的「邀请」复制邀请语。', { code })}</p>` : null}
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

/** The hub's 好友 tile. */
export function FriendsTile() {
  return html`<button type="button" class="hub-entry" onClick=${() => openFriends('list')} title=${t('好友')} aria-label=${t('好友')}>
    <span class="hub-entry__icon"><${Icon} name="users" /></span>
    <span class="hub-entry__label">${t('好友')}</span>
  </button>`;
}
