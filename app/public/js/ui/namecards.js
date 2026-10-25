// 名片背景（真实模块）：官方「个人名片」34 个主题的静态预览图（`shared/namecards.js` 是目录，
// `public/assets/ui/namecard/<id>.png` 是美术）。席位卡 / 账号资料背后的那一层就是这张图。
//
// `.nc-layer` 的定位与左侧压暗在 css/screens/lobby.css（`.has-nc` 那一节），本模块只提供 `--nc` 那一条背景。
// 美术按原图使用，不整幅换色；账号没有选过时由 `ui/accounts.js` 按编号给一个默认主题。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Panel } from './components.js';
import { NAMECARDS } from '../../../shared/namecards.js';
import { accountLane, readToken, refreshAccount } from './accounts.js';
import { useStore } from '../store.js';
import { t } from '../../../shared/i18n.js';

export { NAMECARDS };

/** 一张名片美术的 URL。 */
export const namecardUrl = (id) => `/assets/ui/namecard/${id}.png`;

/** id → 目录里的那一条（未知 id 返回 `null`）。 */
export function namecardOf(id) {
  return NAMECARDS.find((c) => c.id === id) || null;
}

/**
 * A seat plate's namecard layer (`null` when the seat has no namecard).
 * @param {{ card?: string|null }} props `card` = the account's `namecard` id
 */
export function NameCardLayer({ card }) {
  if (!card || !namecardOf(card)) return null;
  return html`<div class="nc-layer" style=${`--nc: url("${namecardUrl(card)}")`} aria-hidden="true"></div>`;
}

/**
 * 名片背景选择（统计页「名片背景」页签）。写的是账号资料（server-ext 的 `namecard`），不是本机偏好；
 * 换完刷新大厅右上角个人芯片与席位卡的缓存，当前页面立刻看到新图。
 */
export function NamecardPicker() {
  const me = useStore((s) => s.me);
  const [current, setCurrent] = useState(null);
  const [note, setNote] = useState('');
  const logged = !!readToken();

  useEffect(() => {
    if (!logged) return undefined;
    let alive = true;
    accountLane.request('profile').then((res) => {
      if (!alive) return;
      const id = res && res.profile && typeof res.profile.namecard === 'string' ? res.profile.namecard : null;
      setCurrent(id);
    });
    return () => { alive = false; };
  }, [logged]);

  if (!logged) return html`<p class="st-empty">${t('登录账号后可以更换名片背景。')}</p>`;

  const pick = async (id) => {
    setCurrent(id);
    const res = await accountLane.request('namecard', { namecard: id });
    if (!res) { setNote(t('保存失败：账号服务未连接')); return; }
    setNote('');
    refreshAccount(me && me.playerId);
  };

  return html`<${Panel} title=${t('名片背景')} micro="NAMECARD" tone="mint">
    <p class="st-note">${t('名片背景会显示在大厅右上角的个人信息、房间席位卡与账号资料上；同房的人都能看到。')}</p>
    <div class="set-namecards set-namecards--page" role="radiogroup" aria-label=${t('名片背景')}>
      ${NAMECARDS.map((c) => html`<button key=${c.id} type="button" role="radio"
        aria-checked=${current === c.id ? 'true' : 'false'} class=${`set-namecard${current === c.id ? ' is-on' : ''}`}
        title=${t(c.name)} onClick=${() => pick(c.id)}>
        <img class="set-namecard__img" src=${`/assets/ui/namecard/${c.id}.png`} alt="" loading="lazy" draggable=${false} />
        <span class="set-namecard__name">${t(c.name)}</span>
      </button>`)}
    </div>
    ${note ? html`<p class="st-note is-warn">${note}</p>` : null}
  <//>`;
}
