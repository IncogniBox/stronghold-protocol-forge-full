// 成就统计（真实模块）。
//
// 大厅那一格：橙色沙丘横幅 + 等级 + 成就统计条；横幅中间是**卫戍成就**的官方图标（statistics/headingIcon，
// 奖杯+星，带括号相框），左上/左下仍是按奖杯数分档的 TrophyBadge（图3 → 中间的换成图4）。
//
// 点开后的面板按官方「卫戍成就」页的版式（用户 2026-10-25 的参考图）：
//   账号条（头像 / 等级 / 昵称#编号 / 已获奖杯 / 获赞数）   |  称号六边形（卫戍之星 · 不朽盟约 · 坚若磐石 ·
//   独立模拟 / 同盟模拟：总模拟数 · 成功卫戍 · 绝境突破      |  精英云集 · 万事俱备 · 挥金如土）
//   卫戍成就（单局最多消耗资金 / 晋级次数 / 击败数）
//   盟约纪录 / 策略纪录
//   账号成就（本服账号库：注册、头像过审、名片、绑定、好友、账号年龄）—— 官方页没有这一段，但它是我们自己的数据
//   页脚：账号数据 · 本机累计 · 每局结束后更新
//
// 数据来源：对局侧 = 本机统计 `sp.pref.stats`（aggregateStats）；账号侧 = server-ext 的队长接口
// （`achievements` 与奖杯累计 `trophies/trophySync`）。没有账号服务或未登录时，账号成就一段说明原因，不伪造进度。
// 样式：`.hub-ach` / `.ach` 在 css/screens/lobby.css；官方版式（六边形、灰色标题条、纪录卡）复用
// css/screens/stats.css 的 `st-titlehex` / `st-record-heading` / `st-modegrid`，与统计页同一套。

import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { TrophyBadge, trophyLevel } from './trophies.js';
import { aggregateStats, loadStats, selfRowOf } from './stats.js';
import { accountLane, readToken } from './accounts.js';
import { data, useData } from '../data.js';
import { uiUrl } from './assetUrls.js';
import { Img } from './gameComponents.js';
import { TitleHexagon, RecordHeading } from '../screens/stats.js';
import { t, N_ } from '../../../shared/i18n.js';

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
/** 官方版式里的数字不做千分位（六边形与单局纪录的数值都很小）；缺值按 0 画。 */
const smallNum = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);

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
  useData('assets');
  const manifest = data.get('assets');
  const frame = uiUrl(manifest, 'statistics/headingIconFrame');
  const glyph = uiUrl(manifest, 'statistics/headingIcon');
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
      <span class="hub-ach__mark">${glyph
    ? html`<span class="hub-ach__achievement">
          ${frame ? html`<img class="hub-ach__achievement-frame" src=${frame} alt="" draggable=${false} />` : null}
          <img class="hub-ach__achievement-glyph" src=${glyph} alt="" draggable=${false} />
        </span>`
    : html`<${Icon} name="crown" />`}</span>
    </span>
    <span class="hub-ach__rank"><span class="hub-ach__rank-icon"><${TrophyBadge} count=${trophies} class="hub-ach__trophy" /></span><small>LV${level}</small></span>
    <span class="hub-ach__label">
      <${TrophyBadge} count=${trophies} class="hub-ach__badge" />
      <span>${t('成就统计')}</span>
      <span class="hub-ach__lv">LV${level}</span>
    </span>
  </button>`;
}

/** 账号条：头像 + 等级 + 昵称#编号，右边是「已获奖杯 / 获赞数」（参考图第一行）。 */
function AccountPlate({ account, trophies }) {
  const name = (account && account.name) || t('博士');
  const tag = account && Number.isFinite(account.tag) ? account.tag : null;
  const first = [...name][0] || '?';
  const level = Math.max(1, trophyLevel(trophies));
  const manifest = data.get('assets');
  const medal = uiUrl(manifest, 'statistics/headingIcon');
  return html`<div class="ach-plate">
    <div class="ach-card">
      <span class="ach-card__lv"><b>LV</b><small>${level}</small></span>
      <span class="ach-card__ava">${account && account.avatar
    ? html`<img src=${account.avatar} alt="" draggable=${false} />`
    : html`<span class="ach-card__glyph">${first}</span>`}</span>
      <span class="ach-card__who">
        <span class="ach-card__name">${name}${tag === null ? null : html`<span class="ach-card__tag">#${tag}</span>`}</span>
        <span class="ach-card__id">${tag === null ? t('未绑定账号') : html`${t('账号')} ${name}#${tag}`}</span>
      </span>
      <span class="ach-card__brand">STRONGHOLD<br />PROTOCOL</span>
    </div>
    <div class="ach-counts">
      <span class="ach-counts__badge is-trophy">${medal
    ? html`<img class="ach-counts__medal" src=${medal} alt="" draggable=${false} />`
    : html`<${TrophyBadge} count=${trophies} />`}</span>
      <span class="ach-counts__row"><small>${t('已获奖杯')}</small><b class="num">${trophies}</b></span>
      <span class="ach-counts__badge is-like"><svg viewBox="0 0 24 24" aria-hidden="true"><path
        d="M3 10h4v11H3zm5 0 4-8c1.7 0 2.7 1.1 2.5 2.6L13.9 8H19a2 2 0 0 1 2 2.3l-1 7.2A3 3 0 0 1 17 20H8z" /></svg></span>
      <span class="ach-counts__row"><small>${t('获赞数')}</small><b class="num">0</b></span>
    </div>
  </div>`;
}

/** 独立 / 同盟模拟的两行数字表（官方 `st-modegrid` 版式）。 */
function ModeGrid({ agg }) {
  const rows = [['solo', N_('独立模拟'), 'user'], ['coop', N_('同盟模拟'), 'users']];
  return html`<table class="st-modegrid ach-modegrid"><tbody>
    ${rows.map(([mode, label, icon]) => {
    const v = agg.byMode[mode];
    const metrics = [
      { value: v.games, label: N_('总模拟数') },
      { value: v.wins, label: N_('成功卫戍') },
      { value: v.hiddenCleared, label: N_('绝境突破') },
    ];
    return html`<tr key=${mode} class="st-modegrid__row">
      <th scope="row" class="st-modegrid__mode"><${Icon} name=${icon} /><span class="st-modegrid__name">${t(label)}</span></th>
      ${metrics.map(({ value, label: cell }) => html`<td key=${cell} class="st-modegrid__cell">
        <b class="st-modegrid__value num">${smallNum(value)}</b>
        <span class="st-modegrid__label">${t(cell)}</span>
      </td>`)}
    </tr>`;
  })}
  </tbody></table>`;
}

/** 单局纪录三张卡（官方 `recordFunds` / `recordPromotions` / `recordDefeats` 美术）。 */
function MaximaCards({ maxima, manifest }) {
  const rows = [
    ['gold', N_('单局最多消耗资金'), 'statistics/recordFunds'],
    ['merges', N_('单局最多晋级次数'), 'statistics/recordPromotions'],
    ['kills', N_('单局最多击败数'), 'statistics/recordDefeats'],
  ];
  return html`<div class="ach-maxima">
    ${rows.map(([key, label, art]) => html`<div key=${key} class=${`ach-max ach-max--${key}`}>
      <span class="ach-max__label">${t(label)}：</span>
      <span class="ach-max__num"><small>x</small><span class="num">${smallNum(maxima[key])}</span></span>
      <${Img} src=${uiUrl(manifest, art)} class="ach-max__art" />
    </div>`)}
  </div>`;
}

/** 账号成就卡片（本服账号库那六条；官方页没有这一段，放在最后不打断版式）。 */
function AccountCards({ items }) {
  return html`<div class="ach-maxima ach-maxima--account">
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
  useData('config', 'assets');

  useEffect(() => {
    if (!logged) { setItems([]); setNote(t('登录账号后可以查看账号成就。')); return undefined; }
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

  const trophies = useTrophies();
  const manifest = data.get('assets');
  const records = useMemo(() => { try { return loadStats().records; } catch { return []; } }, []);
  const agg = useMemo(() => aggregateStats(records), [records]);
  const titles = (Array.isArray(data.get('config')?.titles) ? data.get('config').titles : [])
    .map((x) => ({ ...x, name: t(x.name), count: agg.titles[x.id]?.count || 0 }));
  const done = doneOf(items || []);
  const level = Math.max(1, trophyLevel(trophies));
  const noMaxima = !agg.maxima.gold && !agg.maxima.merges && !agg.maxima.kills;

  return html`<div class="ach" role="dialog" aria-modal="true" aria-label=${t('成就统计')}>
    <div class="ach__box">
      <header class="ach__head">
        <span class="ach__logo"><${Icon} name="rook" /><b>STRONGHOLD<br />PROTOCOL</b></span>
        <span class="ach__band">
          <svg class="ach__dunes" viewBox="0 0 160 40" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 30 L20 20 L36 27 L52 15 L70 26 L88 18 L106 29 L124 21 L142 30 L160 24 L160 40 L0 40Z" />
            <path class="is-far" d="M0 34 L24 28 L44 33 L62 26 L82 34 L100 29 L118 35 L136 30 L154 34 L160 32 L160 40 L0 40Z" />
          </svg>
          <span class="ach__band-mark ach__band-level">${level}</span>
          <span class="ach__titles"><i>ALLIANCE</i><b>${t('卫戍协议：盟约')}</b></span>
        </span>
        <button type="button" class="ach__close" onClick=${onClose} aria-label=${t('关闭')} title=${t('关闭')}><${Icon} name="close" /></button>
      </header>
      <div class="ach__body">
        <div class="ach-top-area">
          <div class="ach-top-area__main">
            <${AccountPlate} account=${account} trophies=${trophies} />
            <${ModeGrid} agg=${agg} />
            ${note ? html`<p class="ach-note">${note}</p>` : null}
          </div>
          <div class="ach-hex">${titles.length && manifest
    ? html`<${TitleHexagon} titles=${titles} manifest=${manifest} />`
    : null}</div>
        </div>

        <${RecordHeading} title=${t('卫戍成就')} manifest=${manifest} class="st-record-heading--achievement" />
        ${noMaxima ? html`<p class="ach-hint">${t('还没有可展示的战绩：完成一局模拟后在这里记录盟约叠加最高的一局')}</p>` : null}
        <${MaximaCards} maxima=${agg.maxima} manifest=${manifest} />

        <${RecordHeading} title=${t('盟约纪录')} manifest=${manifest} class="st-record-heading--achievement" />
        <p class="ach-hint">${t('暂无盟约记录')}</p>

        <${RecordHeading} title=${t('策略纪录')} manifest=${manifest} class="st-record-heading--achievement" />
        <p class="ach-hint">${t('暂无策略记录')}</p>

        <${RecordHeading} title=${t('账号成就')} manifest=${manifest} class="st-record-heading--achievement" />
        ${items && items.length
    ? html`<p class="ach-hint">${t('已完成成就')} ${done} / ${items.length}</p>
            <${AccountCards} items=${items} />`
    : html`<p class="ach-hint">${note || t('还没有可展示的成就。')}</p>`}

        <div class="ach-footer"><span>${t('账号数据 · 本机累计 · 每局结束后更新')}</span></div>
      </div>
    </div>
  </div>`;
}
