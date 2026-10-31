// 「协议已失效」 — the dialog the event shows when the player's own LP runs out while the team plays on (video 10:56.1–
// 10:59.0, round 16 = r16/set/down30, 30 fps): the panel is the official map (settle/settlemen_personal_fail, the
// panel's width, toned crimson / teal by #downm-tone), the teal grid, the red HUD bits and crosses round it; the face
// comes in calm, dims, and is knocked out (icon_dead, a red flash), 协议已失效 / dec_stronghold_protocol beside it, and
// under the panel btn_continue 继续观战 / btn_end fade in. The sprites are the event's own
// (public/assets/official/hub/ac/battle, mirrored from the UI package); the calm face is robo_head with CSS eyes and
// mouth [REBUILT], the grid and the teal axis lines are CSS [REBUILT]. Timeline and positions: css/screens/
// official-pages.css section 33.
// The official second button is 前往结算 (the player's own settlement at once); this project settles a match only when
// it ends, so the button here opens the existing 离开模拟 dialog (ui/matchChrome.js ExitModal) [ASSUMED]. 继续观战 (or
// Esc) fades the plate out (≈ .4 s, the footage's f092–f104) and the player watches on. It is the project's Modal
// (focus trap, focus returned). screens/game.js opens it once, when the player's `alive` turns false with a teammate
// still in, and only once the map sprite is in (downedArtReady): without the art pack 0.3.0's toast and pill stay.
// With prefers-reduced-motion it shows at once, without the motion.
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Modal } from './components.js';
import { holdBlob, blobOf } from './matchPopups.js';
import { uiUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.filter(Boolean).join(' ');
const MAP = 'settle/settlemen_personal_fail';
/** 继续观战's fade (the footage: the panel at once, face / title / buttons in ≈ .3 s, the dimming in ≈ .4 s). */
const LEAVE_MS = 400;
/** The plate's sprites, by the custom property section 33 reads (each with its plain URL as the fallback). */
const ART = {
  '--down-dead': 'battle/icon_dead', '--down-text': 'battle/icon_text', '--down-fdec': 'battle/face_lower_dec',
  '--down-sub': 'battle/dec_stronghold_protocol', '--down-watch': 'battle/btn_continue', '--down-end': 'battle/btn_end',
  '--down-ul1': 'battle/dec_text_upper_left_01', '--down-ul2': 'battle/dec_text_upper_left_02',
  '--down-num': 'battle/dec_text_side_num', '--down-corner': 'battle/dec_text_lower_corner', '--down-side': 'battle/dec_line_side',
  '--down-dots': 'battle/dec_tiny_text_01', '--down-cross': 'battle/img_dec_cross', '--down-brk': 'battle/left_frame',
  '--down-head': 'outer/robo_head',
};
/** The map's tone: the footage's colours fitted from the sprite's (a least-squares 3 × 3 + offset, f040–f080). */
const TONE = '.428 -.31 .33 0 .056  -.047 .244 .431 0 .044  .005 .165 .378 0 .055  0 0 0 1 0';
/** The official art root these sprites come from (mirrored into public/assets/official). */
const OFFICIAL = new URL('../../assets/official/hub/ac/', import.meta.url).href;

/** Whether the map sprite has loaded (preloadDownedArt): null = not fetched yet, false = missing or still loading. */
let mapArt = null;

/** True once the map sprite is in: without it screens/game.js keeps 0.3.0's toast and pill only. */
export const downedArtReady = () => mapArt === true;

/** Fetch the sprites when the match screen opens (screens/game.js, once per page). A missing pack never turns ready. */
export function preloadDownedArt() {
  if (mapArt !== null || typeof Image !== 'function') return;
  mapArt = false;
  const src = uiUrl(data.get('assets'), MAP);
  if (!src) return;
  const img = new Image();
  img.onload = () => { mapArt = true; };
  img.src = src;
  holdBlob(src);
  if (typeof document === 'undefined') return;
  for (const [v, n] of Object.entries(ART)) {
    holdBlob(`${OFFICIAL}${n}.png`, (u) => document.documentElement.style.setProperty(v, `url("${u}")`));
  }
}

/**
 * Whether the dialog is due: the player's own `alive` just turned false (not a spectator seat, not a reload that finds
 * the player out already) and a teammate is still in — when the whole team falls the match ends instead.
 * @param {{ was: boolean|undefined, alive: boolean, spectator: boolean, pub: any, myId: string|null }} o
 */
export function downedDue({ was, alive, spectator, pub, myId }) {
  if (spectator || was !== true || alive !== false) return false;
  const players = Array.isArray(pub?.players) ? pub.players : [];
  return players.some((p) => p && p.playerId !== myId && p.alive !== false);
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The 协议已失效 dialog.
 * @param {{ open: boolean, onWatch: Function, onLeave: Function }} props
 */
export function DownedPlate({ open, onWatch, onLeave }) {
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(0);
  useEffect(() => {
    if (!open) setLeaving(false);
    return () => clearTimeout(timer.current);
  }, [open]);
  const watch = () => {
    if (leaving) return;
    if (reduced()) { onWatch(); return; }
    setLeaving(true);
    timer.current = setTimeout(() => onWatch(), LEAVE_MS);
  };
  const src = uiUrl(data.get('assets'), MAP);
  const map = src ? blobOf(src) : null;
  const x = (pos) => html`<i class=${`downm__x downm__x--${pos}`}></i>`;
  return html`<${Modal} open=${open} onClose=${watch} closeOnBackdrop=${false} class=${cx('downm', leaving && 'is-leaving')}
      veilClass=${cx('downm-veil', leaving && 'is-leaving')} tone="red">
    <div class="downm__panel" data-testid="downed-plate">
      <svg class="downm__defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="downm-tone" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values=${TONE} /></filter>
      </svg>
      <span class="downm__bg" aria-hidden="true">
        ${map ? html`<img class="downm__map" src=${map} alt="" draggable="false" />` : null}
        <i class="downm__grid"></i><i class="downm__tint"></i>
      </span>
      <span class="downm__lines" aria-hidden="true">
        <i class="downm__axis downm__axis--l"></i><i class="downm__axis downm__axis--r"></i>
        <i class="downm__side downm__side--l"></i><i class="downm__side downm__side--r"></i>
        <i class="downm__brk downm__brk--l"></i><i class="downm__brk downm__brk--r"></i>
      </span>
      <span class="downm__deco" aria-hidden="true">
        <i class="downm__ul1"></i><i class="downm__ul2"></i><i class="downm__num"></i>
        <i class="downm__corner downm__corner--l"></i><i class="downm__corner downm__corner--r"></i>
        ${x('tl')}${x('tr')}${x('bl')}${x('br')}
      </span>
      <span class="downm__lead">
        <span class="downm__face" aria-hidden="true">
          <i class="downm__calm"><i class="downm__eye downm__eye--l"></i><i class="downm__eye downm__eye--r"></i><i class="downm__mouth"></i></i>
          <i class="downm__fill"></i><i class="downm__dead"></i><i class="downm__red"></i>
        </span>
        <i class="downm__fdec" aria-hidden="true"></i><i class="downm__ftext" aria-hidden="true"></i>
        <i class="downm__dots" aria-hidden="true"></i>
        <h2 class="downm__title">${t('协议已失效')}</h2>
        <i class="downm__sub" aria-hidden="true"></i>
      </span>
    </div>
    <div class="downm__btns">
      <button type="button" class="downm__btn downm__btn--watch" data-autofocus=${true} onClick=${watch}><span>${t('继续观战')}</span></button>
      <button type="button" class="downm__btn downm__btn--end downm__btn--leave" onClick=${onLeave}><span>${t('离开模拟')}</span></button>
    </div>
  <//>`;
}
