// Active effects list (m.private.effects: band / 机变 / team / item / garrison effects with counters):
// compact icon column at the right edge, rich-text tooltip per effect. `counterText` (a 悬赏's "还剩 N 场作战", user
// playtest #6 item 4) replaces the bare counter in the tooltip's kind line.

import { html, Tooltip, MicroLabel } from './components.js';
import { Img, RichText, GIcon } from './gameComponents.js';
import { effectIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t, tName, N_ } from '../../../shared/i18n.js';
import { sentText } from './lang.js';

const KIND = { band: N_('策略'), choice: N_('机变'), recon: N_('重构决策'), team: N_('团队增益'), item: N_('道具'), garrison: N_('特质') };

/**
 * A 悬赏's counter line in the current language: the battles its enemies still come for (server/match/player/views.js
 * sends the same Chinese text as `counterText` beside the count; a multi-round card has no count).
 * @param {{ counter?: number|null }} e
 */
export const bountyCounterText = (e) => (e.counter == null ? t('之后的每场作战') : t('还剩 {left} 场作战', { left: e.counter }));

/** Data files whose records an effect entry copies its name / description from (by its id or icon id). */
const SOURCES = ['effects', 'bands', 'items', 'garrisons'];

/**
 * An effect entry's description in the current language (the server copies a record's Chinese text: an effect's, a
 * strategy's, an item's, a 特质's — sentText; a reworded one, such as a multi-round 悬赏's, stays as sent).
 * @param {{ id?: string, iconId?: string, desc?: string }} e
 */
export function effectDesc(e) {
  const desc = e.desc || '';
  if (!desc) return desc;
  for (const file of SOURCES) {
    for (const id of [e.id, e.iconId]) {
      const raw = typeof id === 'string' && id ? data.lookupRaw(file, id) : null;
      if (!raw) continue;
      const loc = data.lookup(file, id) || raw;
      for (const k of ['descRaw', 'desc']) {
        const v = sentText(desc, raw[k], loc[k]);
        if (v !== desc) return v;
      }
    }
  }
  return desc;
}

/**
 * 这名玩家本局选定的**重构协助 / 熔芯负载**（重构模拟）：跟在 EFFECTS 列下面，与局内效果同一套瓦片 + Tooltip 画法。
 * 行来自 screens/preRecon.js 的 `reconProtocolRows`（表与判定都在那边，这里只画）。
 * @param {{ rows: { id: string, key: string, kind: string, name: string, desc: string }[] }} props
 */
export function ReconProtocolList({ rows }) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && (r.name || r.desc));
  if (!list.length) return null;
  return html`<div class="effects effects--recon" aria-label=${t('重构协议')}>
    <${MicroLabel}>RECON</${MicroLabel}>
    ${list.map((r, i) => html`<${Tooltip} key=${r.id ?? i} placement="bottom" text=${html`<div class="efftip">
        <b>${r.name}</b><span class="efftip__kind">${r.kind}</span>
        <${RichText} as="p" text=${r.desc} />
      </div>`}>
      <span class=${`recon-eff recon-eff--${r.key || 'assist'}`}>
        <${GIcon} name=${r.key === 'load' ? 'skull' : 'dp'} />
      </span>
    <//>`)}
  </div>`;
}

/** @param {{ effects: any[] }} props */
export function EffectsList({ effects }) {
  const list = (Array.isArray(effects) ? effects : []).filter((e) => e && (e.name || e.desc));
  if (!list.length) return null;
  const m = data.get('assets');
  return html`<div class="effects" aria-label=${t('生效中的效果')}>
    <${MicroLabel}>EFFECTS</${MicroLabel}>
    ${list.slice(0, 10).map((e, i) => html`<${Tooltip} key=${e.id ?? i} placement="bottom" text=${html`<div class="efftip">
        <b>${tName(e.name) || t('效果')}</b><span class="efftip__kind">${t(KIND[e.iconKind] || '')}${e.counterText ? ` · ${bountyCounterText(e)}` : e.counter != null ? ` · ${e.counter}` : ''}</span>
        <${RichText} as="p" text=${effectDesc(e)} />
      </div>`}>
      <span class=${`effect effect--${e.iconKind || 'x'}`}>
        <${Img} src=${effectIconUrl(m, e)} fallback=${html`<${GIcon} name="bolt" />`} />
        ${e.counter != null && e.counter !== '' ? html`<b class="effect__n num">${e.counter}</b>` : null}
      </span>
    <//>`)}
  </div>`;
}
