// 对局里左侧的玩家列（teamPanel）人数多时**上下滑动**，不再越出屏幕（业主 2026-10-26：「做成可以上下滑动的样式，
// 防止人数过多时超出屏幕」）。这条只钉样式契约：高度夹在顶栏与左下角控制条之间、纵向滚动、滚轮不带动画面、
// 横向留出表情气泡的位置（行右侧的 .team__bubble 不能被滚动区裁掉）。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../../public/css/screens/game.css', import.meta.url), 'utf8');
const block = (sel) => {
  const m = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(CSS);
  return m ? m[1] : '';
};

describe('player column: scrolls when the room is crowded', () => {
  test('the list is height-capped between the top bar and the bottom-left corner, and scrolls vertically', () => {
    const b = block('.team');
    assert.match(b, /max-height: calc\(100vh - 3\.56rem\)/, '顶栏 2.36rem + 左下角控制条约 1.2rem');
    assert.match(b, /max-height: calc\(100dvh - 3\.56rem\)/, '移动端动态视口');
    assert.match(b, /overflow-y: auto/);
    assert.match(b, /overscroll-behavior: contain/, '滚到底不再带动整个画面');
    assert.match(b, /scrollbar-width: thin/);
    assert.match(b, /scrollbar-gutter: stable/, '滚动条出现时不挤动头像');
  });

  test('rows keep their own width and the emote bubble keeps its horizontal room', () => {
    const b = block('.team');
    assert.match(b, /align-items: flex-start/, '不拉伸到整列宽（气泡靠 100% + … 定位）');
    const width = Number(/width: ([\d.]+)rem/.exec(b)?.[1] ?? 0);
    const pad = Number(/padding-right: ([\d.]+)rem/.exec(b)?.[1] ?? 0);
    assert.ok(width >= 4, `the scroll area is wider than a row + bubble (got ${width}rem)`);
    // row ≈ avatar .8 + gap .1 + info (.18 padding + name 1.5) ≈ 2.64; bubble 1.08 at 100% + .06
    assert.ok(width - pad >= 2.64 + 0.06 + 1.08, 'the bubble (1.08rem) stays inside the scroll port');
    assert.doesNotMatch(b, /overflow-x: auto/, 'no horizontal scrolling');
  });

  test('the emote bubble stays anchored to its row (placement did not move)', () => {
    assert.match(block('.team__bubble'), /position: absolute/);
    assert.match(block('.team__bubble'), /left: calc\(100% \+ \.06rem\)/);
    assert.match(block('.team__row'), /position: relative/);
  });
});
