// workshop/side-story/ui/sweep.js — 「故事集」盟约前置包的**盟约报告分区**（组件级改写 DESIGN §28.19）。
//
// 它给独立故事集包补上第四个零代码预设：S.W.E.E.P.报告 →「盟约报告」里，故事集盟约从「附加盟约」行里**拿出来**，
// 在它下面新开一栏 **故事集盟约 SIDE STORY BONDS**（栏图标由本包自带）。改写引擎具名组件 `sweep.bonds`
// （`mode: "replace"`：引擎那两块分区由本模块重画，`orig` 是 `null`）。
//
// 与 `ui/briefing.js` 同一条做法、同一份判据（`bondType === "SIDE_STORY"`，读合并后的 `bonds` 表）：本模块只是
// **只读视图**，不碰对局结果。拼装单元 `Section` / `BondTile` 就是引擎自己那两个（由 `screens/sweep.js` 导出），
// 所以分区外壳与圆盘 tile 的结构与样式与报告其余部分逐字同源。
//
// ⚠ 引擎里没有「故事集」这个概念：这个模块与 `ui/badge.js` / `ui/briefing.js` / `battle/main.mjs` 是本包认识
//    `bondType` 的几处。

import { html, Icon } from '/js/ui/components.js';
import { Img, GIcon } from '/js/ui/gameComponents.js';
import { Section, BondTile } from '/js/screens/sweep.js';
import { t } from '/shared/i18n.js';

/** 故事集类型标记（与 `battle/main.mjs` 的 `STORY_BOND_TYPE` 同一约定）。 */
const STORY_BOND_TYPE = 'SIDE_STORY';

/** 本包自带的分区图标（`assets/icon_story.png`，走 /workshop-assets 那条唯一的包素材路由）。 */
const STORY_ICON = '/workshop-assets/side-story/icon_story.png';

/** `bonds` 是合并后的 bonds.json（以 bondId 为键）：这一条是不是故事集盟约。 */
const isStory = (bonds, id) => !!bonds && !!bonds[id] && bonds[id].bondType === STORY_BOND_TYPE;

/** 一栏的圆盘 tile 序列（`on` 那一张是当前选中的）。 */
const tiles = (items, { m, sel, onSel }) => items.map(
  (b) => html`<${BondTile} key=${b.bondId} bond=${b} m=${m} on=${sel === b.bondId} onSel=${onSel} />`,
);

/**
 * 三块分区：核心盟约 → 附加盟约（去掉故事集）→ 故事集盟约（无故事集盟约时这一栏不出现）。
 * @param {{ bonds: any[], sel: string|null, onSel: (bondId: string) => void, m: any, recs: any }} props
 */
function StorySections({ bonds, sel, onSel, m, recs }) {
  const list = Array.isArray(bonds) ? bonds : [];
  const core = list.filter((b) => b.isCore);
  const addon = list.filter((b) => !b.isCore);
  const story = addon.filter((b) => isStory(recs, b.bondId));
  const rest = addon.filter((b) => !isStory(recs, b.bondId));
  const pass = { m, sel, onSel };
  return html`${core.length ? html`<${Section} name=${t('核心盟约')} glyph=${html`<${GIcon} name="flag" />`} count=${core.length}>
      ${tiles(core, pass)}
    <//>` : null}
    ${rest.length ? html`<${Section} name=${t('附加盟约')} glyph=${html`<${Icon} name="link" />`} count=${rest.length}>
      ${tiles(rest, pass)}
    <//>` : null}
    ${story.length ? html`<${Section} name=${t('故事集盟约')} glyph=${html`<span class="mod-story-glyph"><${Img} src=${STORY_ICON} fallback=${html`<${GIcon} name="flag" />`} /></span>`} count=${story.length}>
      ${tiles(story, pass)}
    <//>` : null}`;
}

/**
 * 组件级改写入口（`pack.json.client.panels[].wraps`）：`ctx.data.get('bonds')` 是合并后的盟约表、
 * `ctx.data.get('assets')` 是素材清单（两张表都已在 `client.panels[].data` 里声明）；`ctx.props` 是引擎这一帧的
 * `{ bonds, sel, onSel }` 只读快照。`replace` 档的 `orig` 是 `null`，由本模块给出完整的三块分区。
 */
export function wrap(ctx) {
  const read = (table) => (ctx && ctx.data && typeof ctx.data.get === 'function' ? ctx.data.get(table) : null);
  const props = (ctx && ctx.props) || {};
  return () => html`<${StorySections} bonds=${props.bonds} sel=${props.sel} onSel=${props.onSel} m=${read('assets')} recs=${read('bonds')} />`;
}
