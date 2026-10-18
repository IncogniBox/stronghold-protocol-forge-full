// workshop/side-story/ui/badge.js — 「故事集」盟约前置包的**客户端预设**（组件级改写 `game.bondStrip`，DESIGN §28.19）。
//
// 它是这一层给独立故事集包的第二个预设接口：任何 `bondType === 'SIDE_STORY'` 的盟约（无论写在哪个包里），
// 在盟约条上都会自动获得统一的「故事集」外观 —— 故事集包**零客户端代码**。
//
// 做法：`wrap(ctx)` 返回 `(orig) => vnode`，把引擎那份盟约条**原样**包进一层查询容器（`display:contents`，
// 不参与布局），渲染后按合并后的 `bonds` 表把故事集圆盘打上 `mod-story`（样式在同目录 `badge.css`）。
// 不重画、不改引擎组件、不碰对局结果 —— 只是一个只读视图层。
//
// ⚠ 盟约弹窗（`BondPopup`）**不在**引擎可改写的具名组件名单里（`ui/modComponents.js MOD_COMPONENT_IDS`），
//    所以类型标记只落在盟约条的圆盘上；这一点是引擎能力边界，不是本包的取舍。

import { h } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import htm from 'htm';

const html = htm.bind(h);

/** 故事集类型标记（与 `battle/main.mjs` 的 `STORY_BOND_TYPE` 同一约定）。 */
const STORY_BOND_TYPE = 'SIDE_STORY';

/** 把 `orig`（引擎自己的盟约条）包一层，渲染后给故事集圆盘打上 `mod-story`。 */
function StoryBadges({ orig, recs }) {
  const ref = useRef(null);
  // 每次渲染都重跑：盟约条会随层数/在场成员变化重画，标记要跟着走。
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    for (const el of root.querySelectorAll('[data-bond]')) {
      const rec = recs ? recs[el.getAttribute('data-bond')] : null;
      if (rec && rec.bondType === STORY_BOND_TYPE) el.classList.add('mod-story');
      else el.classList.remove('mod-story');
    }
  });
  return html`<div ref=${ref} class="mod-story-wrap">${orig}</div>`;
}

/**
 * 组件级改写入口（`pack.json.client.panels[].wraps`）：`ctx.data.get('bonds')` 是合并后的盟约表，
 * 已在 `pack.json.client.panels[].data` 里声明；`orig` 是链条下方那一份（引擎自己的盟约条）。
 */
export function wrap(ctx) {
  const recs = ctx && ctx.data && typeof ctx.data.get === 'function' ? ctx.data.get('bonds') : null;
  return (orig) => html`<${StoryBadges} orig=${orig} recs=${recs} />`;
}