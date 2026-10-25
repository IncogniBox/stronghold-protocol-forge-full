// 成就统计（真实模块）：外观对齐大厅左栏的「成就统计」卡（橙色沙丘横幅 + 等级 + 成就统计条），
// 数据仍来自 server-ext 的账号库（`achievements`：注册 / 头像过审 / 名片 / 绑定 / 好友 / 账号年龄）。
// 没有账号服务或未登录时，面板说明原因，不伪造任何进度。
//
// 样式全部走 css/screens/lobby.css 已有的 `.hub-ach` / `.ach` 一节（这一节本来就是为这块界面写的）。

import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { TrophyBadge, trophyLevel } from './trophies.js';
import { aggregateStats, loadStats, selfRowOf } from './stats.js';
import { accountLane, readToken } from './accounts.js';
import { t } from '../../../shared/i18n.js';

/** 服务端只回 id / progress / total，文案与图标在这里（可以走 i18n）。 */
const META = Object.freeze({
  account: () => ({ name: t('编入名册'), desc: t('注册一个账号'), icon: 'user' }),
  avatar: () => ({ name: t('身份照'), desc: t('上传头像并通过审核'), icon: 'user' }),
  namecard: () => ({ name: t('名片'), desc: t('为账号设置一张名片背景'), icon: 'rook' }),
  bind: () => ({ name: t('入席'), desc: t('把账号绑定到一次游戏会话'), icon: 'users' }),
  friends: () => ({ name: t('同僚'), desc: t('添加 3 位好友'), icon: 'users' }),
  veteran: () => ({ name: t('资深博士'), desc: t('账号满 30 天'), icon: 'rook' }),
});
const metaOf = (id) => (META[id] ? META[id]() : { name: id, desc: '', icon: 'rook' });
const doneOf = (items) => (Array.isArray(items) ? items.filter((x) => x && Number(x.progress) >= Number(x.total)).length : 0);

/** 本机统计里的「获得奖杯」总额（与统计页 `获得奖杯 N` 同一份数据）。 */
function localTrophies() {
  try { return Math.max(0, Number(aggregateStats(loadStats().records).trophies) || 0); }
  catch { return 0; }
}

/** 本机记录里每一局自己拿到的奖杯（`id` 是跨设备去重键）。 */
function localTrophyRecords() {
  try {
    return loadStats().records
      .filter((r) => r && r.end !== 'quit' && r.roomMode === 'coop' && typeof r.id === 'string' && r.id)
      .map((r) => {
        const row = selfRowOf(r);
        const n = row ? Math.max(0, Math.floor(Number(row.trophies) || 0)) : 0;
        return n > 0 ? { id: r.id, trophies: n } : null;
      })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * 账号累计奖杯：登录后把本机记录上报给账号库（按对局 id 去重），再读服务端总数；
 * 未登录 / 服务器还没有这两个接口时回落到本机统计。
 */
function useTrophies() {
  const local = useMemo(localTrophies, []);
  const [server, setServer] = useState(null);
  useEffect(() => {
    if (!readToken()) return undefined;
    let alive = true;
    const records = localTrophyRecords();
    const req = records.length ? accountLane.request('trophySync', { records }) : accountLane.request('trophies');
    req.then((res) => {
      if (alive && res && Number.isFinite(res.trophies)) setServer(Math.max(0, Math.floor(res.trophies)));
    });
    return () => { alive = false; };
  }, []);
  return Number.isFinite(server) ? server : local;
}

/** The hub's 成就统计 card (the reference page's top-left entry). */
export function AchievementEntry({ onOpen }) {
  const trophies = useTrophies();
  const level = Math.max(1, trophyLevel(trophies));
  return html`<button type="button" class=${`hub-ach${readToken() ? '' : ' is-guest'}`} onClick=${onOpen} title=${t('成就统计')} aria-label=${t('成就统计')}>
    <span class="hub-ach__scene">
      <svg class="hub-ach__land" viewBox="0 0 160 40" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="achLand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#e29a43" /><stop offset=".55" stop-color="#b4601f" /><stop offset="1" stop-color="#5b2410" />
          </linearGradient>
        </defs>
        <rect width="160" height="40" fill="url(#achLand)" />
        <path d="M0 30 L18 20 L32 27 L48 14 L64 25 L82 17 L98 29 L116 21 L132 30 L148 24 L160 30 L160 40 L0 40Z" fill="#221812" opacity=".82" />
        <path d="M0 34 L24 28 L42 33 L60 26 L78 34 L96 29 L114 35 L132 30 L150 34 L160 31 L160 40 L0 40Z" fill="#0e0b09" opacity=".9" />
      </svg>
      <span class="hub-ach__mark"><${TrophyBadge} count=${trophies} class="hub-ach__trophy" /></span>
    </span>
    <span class="hub-ach__rank"><span class="hub-ach__rank-icon"><${TrophyBadge} count=${trophies} class="hub-ach__trophy" /></span><small>LV${level}</small></span>
    <span class="hub-ach__label">
      <${TrophyBadge} count=${trophies} class="hub-ach__badge" />
      <span>${t('成就统计')}</span>
      <span class="hub-ach__lv">LV${level}</span>
    </span>
  </button>`;
}

function AccountPlate({ account, items, done, trophies }) {
  const name = (account && account.name) || t('博士');
  const tag = account && Number.isFinite(account.tag) ? account.tag : null;
  const first = [...name][0] || '?';
  return html`<div class="ach-plate">
    <div class="ach-card">
      <span class="ach-card__lv"><b>LV</b><small>${Math.max(1, trophyLevel(trophies))}</small></span>
      <span class="ach-card__ava">${account && account.avatar
    ? html`<img src=${account.avatar} alt="" draggable=${false} />`
    : html`<span class="ach-card__glyph">${first}</span>`}</span>
      <span class="ach-card__who">
        <span class="ach-card__name">${name}${tag === null ? null : html`<span class="ach-card__tag">#${tag}</span>`}</span>
        <span class="ach-card__id">${tag === null ? t('未绑定账号') : html`${t('账号编号')} #${tag}`}</span>
      </span>
      <span class="ach-card__brand">STRONGHOLD<br />PROTOCOL</span>
    </div>
    <div class="ach-counts">
      <span class="ach-counts__badge is-trophy"><${TrophyBadge} count=${trophies} /></span>
      <span class="ach-counts__row"><small>${t('获得奖杯')}</small><b>${trophies}</b></span>
      <span class="ach-counts__badge"><${Icon} name="users" /></span>
      <span class="ach-counts__row"><small>${t('已完成成就')}</small><b>${done} / ${items.length}</b></span>
    </div>
  </div>`;
}

/**
 * The 成就统计 panel (lobby renders it while open).
 * @param {{ me?: any, onClose?: () => void }} props
 */
export function AchievementPanel({ me, onClose }) {
  const [items, setItems] = useState(null);
  const [account, setAccount] = useState(null);
  const [note, setNote] = useState('');
  const logged = !!readToken();

  useEffect(() => {
    if (!logged) { setItems([]); setNote(t('登录账号后可以查看成就。')); return undefined; }
    let alive = true;
    Promise.all([accountLane.request('achievements'), accountLane.request('profile')]).then(([res, prof]) => {
      if (!alive) return;
      if (!res) { setItems([]); setNote(t('账号服务未就绪：请确认已登录；若服务器刚更新，重启后可用')); return; }
      setItems(Array.isArray(res.achievements) ? res.achievements : []);
      setAccount(prof && prof.profile ? prof.profile : null);
      setNote('');
    });
    return () => { alive = false; };
  }, [logged]);

  const done = doneOf(items || []);
  const trophies = useTrophies();
  return html`<div class="ach" role="dialog" aria-modal="true" aria-label=${t('成就统计')}>
    <div class="ach__box">
      <header class="ach__head">
        <span class="ach__logo"><${Icon} name="rook" /><b>STRONGHOLD<br />ACHIEVEMENTS</b></span>
        <span class="ach__band">
          <svg class="ach__dunes" viewBox="0 0 160 40" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 30 L20 20 L36 27 L52 15 L70 26 L88 18 L106 29 L124 21 L142 30 L160 24 L160 40 L0 40Z" />
            <path class="is-far" d="M0 34 L24 28 L44 33 L62 26 L82 34 L100 29 L118 35 L136 30 L154 34 L160 32 L160 40 L0 40Z" />
          </svg>
          <span class="ach__band-mark"><${Icon} name="rook" /></span>
          <span class="ach__titles"><i>STRONGHOLD</i><b>${t('成就统计')}</b></span>
        </span>
        <button type="button" class="ach__close" onClick=${onClose} aria-label=${t('关闭')} title=${t('关闭')}><${Icon} name="close" /></button>
      </header>
      <div class="ach__body">
        ${items === null && !note ? html`<div class="ach__loader"><i></i><i></i><b></b></div>` : null}
        ${note ? html`<div class="ach-gate">
          <span class="ach-gate__title">${t('账号成就')}</span>
          <p>${note}</p>
        </div>` : null}
        ${items && items.length ? html`
          <${AccountPlate} account=${account} items=${items} done=${done} trophies=${trophies} />
          <div class="ach-bar">
            <span class="ach-bar__icon"><${TrophyBadge} count=${trophies} /></span>
            <span class="ach-bar__title">${t('卫戍成就')}</span>
            <span class="ach-bar__marks"><i class="num">${done}</i><i class="num">${items.length}</i></span>
          </div>
          <div class="ach-maxima">
            ${items.map((it) => {
    const meta = metaOf(it.id);
    const total = Number(it.total) > 0 ? Number(it.total) : 1;
    const progress = Math.min(total, Math.max(0, Number(it.progress) || 0));
    const finished = progress >= total;
    return html`<div class=${`ach-max ${finished ? 'is-mint' : 'is-gold'}`} key=${it.id} title=${meta.desc}>
                <span class="ach-max__label">${meta.name}</span>
                <span class="ach-max__num"><span class="num">${progress}</span><small>/${total}</small></span>
                <${Icon} name=${meta.icon} class="ach-max__glyph" />
              </div>`;
  })}
          </div>` : null}
        ${items && !items.length && !note ? html`<p class="ach-empty">${t('还没有可展示的成就。')}</p>` : null}
      </div>
      <button type="button" class="ach__foot" onClick=${onClose}>${t('关闭')}</button>
    </div>
  </div>`;
}
