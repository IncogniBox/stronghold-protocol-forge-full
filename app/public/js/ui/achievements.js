// 成就（真实模块）：条目与进度由 server-ext 的账号库推出来（`achievements`：注册 / 头像过审 / 名片 / 绑定 /
// 好友 / 账号年龄）。没有账号服务或未登录时，面板说明原因，不伪造任何进度。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon, ProgressBar } from './components.js';
import { accountLane } from './accounts.js';
import { t } from '../../../shared/i18n.js';

/** 服务端只回 id / progress / total，文案在这里（可以走 i18n）。 */
const META = Object.freeze({
  account: () => ({ name: t('编入名册'), desc: t('注册一个账号') }),
  avatar: () => ({ name: t('身份照'), desc: t('上传头像并通过审核') }),
  namecard: () => ({ name: t('名片'), desc: t('为账号设置一张名片背景') }),
  bind: () => ({ name: t('入席'), desc: t('把账号绑定到一次游戏会话') }),
  friends: () => ({ name: t('同僚'), desc: t('添加 3 位好友') }),
  veteran: () => ({ name: t('资深博士'), desc: t('账号满 30 天') }),
});

const metaOf = (id) => (META[id] ? META[id]() : { name: id, desc: '' });

function AchievementRow({ item }) {
  const meta = metaOf(item.id);
  const total = Number.isFinite(item.total) && item.total > 0 ? item.total : 1;
  const progress = Number.isFinite(item.progress) ? Math.min(total, Math.max(0, item.progress)) : 0;
  const done = progress >= total;
  return html`<div class=${`ach-card${done ? ' is-done' : ''}`}>
    <span class="ach-card__mark"><${Icon} name=${done ? 'check' : 'rook'} /></span>
    <span class="ach-card__body">
      <strong class="ach-card__name">${meta.name}</strong>
      <span class="ach-card__desc">${meta.desc}</span>
      <${ProgressBar} value=${progress} max=${total} size="sm" showValue=${total > 1} />
    </span>
  </div>`;
}

/**
 * The lobby's 成就 entry.
 * @param {{ onOpen?: () => void }} props
 */
export function AchievementEntry({ onOpen }) {
  return html`<button type="button" class="hub-entry" onClick=${onOpen} title=${t('成就')} aria-label=${t('成就')}>
    <span class="hub-entry__icon"><${Icon} name="rook" /></span>
    <span class="hub-entry__label">${t('成就')}</span>
  </button>`;
}

/**
 * The 成就 panel (lobby renders it while open).
 * @param {{ me?: any, onClose?: () => void }} props
 */
export function AchievementPanel({ me, onClose }) {
  const [items, setItems] = useState(null);
  const [note, setNote] = useState(t('正在读取成就…'));

  useEffect(() => {
    let alive = true;
    accountLane.request('achievements').then((res) => {
      if (!alive) return;
      if (!res) { setItems([]); setNote(t('账号服务未连接，或还没有登录账号')); return; }
      setItems(Array.isArray(res.achievements) ? res.achievements : []);
      setNote('');
    });
    return () => { alive = false; };
  }, []);

  const who = me?.name ? t('{name} 的账号成就', { name: me.name }) : t('账号成就');
  return html`<${Modal} open=${true} title=${who} micro="ACHIEVEMENTS" width="min(32rem, 94vw)" onClose=${onClose}
      actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('关闭')}<//>`}>
    <div class="achievements">
      ${note ? html`<p class="friends__note">${note}</p>` : null}
      ${items && items.length ? items.map((item) => html`<${AchievementRow} key=${item.id} item=${item} />`) : null}
      ${items && !items.length && !note ? html`<p class="friends__empty">${t('还没有可展示的成就。')}</p>` : null}
    </div>
  <//>`;
}
