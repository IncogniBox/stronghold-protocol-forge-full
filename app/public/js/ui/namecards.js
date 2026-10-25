// 名片背景（真实模块）：官方「个人名片」34 个主题的静态预览图（`shared/namecards.js` 是目录，
// `public/assets/ui/namecard/<id>.png` 是美术）。席位卡 / 账号资料背后的那一层就是这张图。
//
// `.nc-layer` 的定位与左侧压暗在 css/screens/lobby.css（`.has-nc` 那一节），本模块只提供 `--nc` 那一条背景。
// 美术按原图使用，不整幅换色；账号没有选过时由 `ui/accounts.js` 按编号给一个默认主题。

import { html } from './components.js';
import { NAMECARDS } from '../../../shared/namecards.js';

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
