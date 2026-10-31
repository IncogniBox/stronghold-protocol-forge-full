// The folded shop's little figure: the official event skeleton trap_1096_acshopup (Spine 3.8, pma false; its only clip
// `Idle`, 1 s, looped) on a transparent canvas inside the collapsed funds panel, played through our own PIXI 7 +
// pixi-spine (render/app/pixi.js ensurePixi). Sized against the recording's 08:28 frame at 1280 × 720: mirrored (its
// clipboard on the left), 0.43 px per skeleton unit, feet origin below the panel so the panel's lower edge cuts it at
// the chest. css/screens/official-hud.css (the package's section 19) sizes the canvas; the atlas PNG is body pieces only
// and is never shown on its own. Ported from the UI package (2026-10-29 snapshot).

import { html } from './components.js';
import { useEffect, useRef } from '../../vendor/hooks.module.js';
import { ensurePixi } from '../render/app/pixi.js';

const SKEL = new URL('../../assets/local/ui/battle/shopup/trap_1096_acshopup.skel', import.meta.url).href;
// at 1280 px: the canvas box (the panel's inside), the skeleton's origin in it, its scale
const BOX_W = 162;
const ORIGIN = { x: 123, y: 229 };
const SCALE = 0.43;

/** The figure's canvas; renders nothing visible until the skeleton has loaded (a failed load leaves the panel as it was). */
export function ShopUpFigure() {
  const ref = useRef(null);
  useEffect(() => {
    let dead = false;
    let app = null;
    let ro = null;
    (async () => {
      const PIXI = await ensurePixi();
      if (dead) return;
      const res = await PIXI.Assets.load(SKEL);
      const cv = ref.current;
      if (dead || !cv) return;
      const data = (res && res.spineData) || res;
      app = new PIXI.Application({ view: cv, backgroundAlpha: 0, antialias: true, width: 1, height: 1 });
      const sp = new PIXI.spine.Spine(data);
      sp.state.setAnimation(0, 'Idle', true);
      app.stage.addChild(sp);
      const fit = () => {
        const r = cv.getBoundingClientRect();
        const dpr = globalThis.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(r.width * dpr));
        const h = Math.max(1, Math.round(r.height * dpr));
        app.renderer.resize(w, h);
        const k = w / BOX_W;
        sp.scale.set(-SCALE * k, SCALE * k);
        sp.position.set(ORIGIN.x * k, ORIGIN.y * k);
      };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(cv);
    })().catch((e) => console.warn('[shop figure]', e && e.message ? e.message : e));
    return () => {
      dead = true;
      if (ro) ro.disconnect();
      if (app) app.destroy(false, { children: true });
    };
  }, []);
  return html`<canvas class="shopbar-tab__figure" ref=${ref} aria-hidden="true"></canvas>`;
}
