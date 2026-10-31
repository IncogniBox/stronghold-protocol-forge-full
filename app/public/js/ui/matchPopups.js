// In-match popups (round / phase plates, redone with the official art — official-pages.css 26/27/30–34): one dark
// translucent plate in the middle of the field, built from the official `roundStartDialog/*` sprites (data/assets.json
// ui) and the event's own battle art:
//   * RoundPopup — at each round start (the event's footage, video 8:49 = tr/round30, round 16): [robot] · 回合 NN (the old
//     number squashes down, the new one drops in) · 获得 ⁂ +N, the funds the round start paid; it folds away by itself after
//     ≈ 1.9 s. An eliminated player and a spectator seat get no 获得 cell (no income reaches them, GitHub #236 / #237):
//     phaseBanner's line for them (gameLogic/phases.js, 观战中) stands under the plate instead. The red 剩余 N 回合 strip
//     shows while the final assault is three rounds or fewer away.
//   * PhasePopup — 联防阶段 (the footage, video 10:35.3–10:38.1): its own plate — round_bg_line under the whole panel, the
//     official 联防 faces assist_emoji_01 / 02 unfolding from the gap between them and bobbing in turn, the corner crosses /
//     brackets / round_text_01·02 in yellow, three chevrons racing through behind them; it dissolves after ≈ 2.6 s. The
//     footage has no plate for the other phases: they keep the banner.
//   * BattleOverPopup — 作战结束 at SETTLE (the footage: 完美作战! video 8:43.98–8:46.75, 生命值减少 10 video
//     10:53.10–10:55.90): the 联防 plate's chrome in teal, the official faces in its box — all_emoji_head with sword for a
//     perfect battle, miss_emoji_head over emoji_body with the sword turned for a battle that cost LP — and the line the
//     round's real charge gives (gameLogic/phases.js roundResultBox).
// The arrangement follows the footage; positions are measured from it. Every sprite has a CSS fallback (the masks: their
// plain URL). screens/game.js picks the moment; pointer-events none, so the field stays usable under them. With
// prefers-reduced-motion they still show (the information), without the motion.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { Sprite } from './gameComponents.js';
import { uiUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * How long the round popup holds before it folds away (ms), and the fold: together inside 回合开始's 2 s
 * (server/match/match/common.js DELAYS.ROUND_START), so the 休整期 banner after it never waits or overlaps.
 */
export const ROUND_POPUP_MS = 1720;
const LEAVE_MS = 280;
/** The round plate's own fold (tr/round30 f066–f073): ≈ .22 s. */
const ROUND_LEAVE_MS = 220;

/** Two-digit round number as the plate shows it (00 before the first round). */
export const roundDigits = (n) => String(Math.max(0, Math.trunc(Number(n) || 0)) % 100).padStart(2, '0');

/**
 * Rounds left before the final assault, for the red strip: 1–3, else null (no strip). `pub.bossRound` is the final
 * assault's round (server/match/match/views.js); the hidden core gets no strip.
 * @param {any} pub m.public
 */
export function roundsToBoss(pub) {
  const r = Math.trunc(Number(pub?.round));
  const b = Math.trunc(Number(pub?.bossRound));
  if (!Number.isFinite(r) || !Number.isFinite(b) || r <= 0) return null;
  const left = b - r;
  return left >= 1 && left <= 3 ? left : null;
}

/** Auto-dismiss: `leaving` after `ms`, onDone after the fold (`leave` ms). Re-key the popup to replay it. */
export function useTimedLeave(ms, onDone, leave = LEAVE_MS) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setLeaving(true), ms);
    const b = setTimeout(() => onDone?.(), ms + leave);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  return leaving;
}

const rsd = (name) => `roundStartDialog/${name}`;
/** The 联防 banner's own faces (the older plate drew them from the banner art; kept for the preload list). */
const FACES = ['hudPanel/trans_coop4', 'hudPanel/trans_coop3'];
const ART = ['round_bg', 'round_bg_line', 'round_cross', 'round_frame', 'round_emoji_head', 'round_emoji_body', 'round_emoji_hand',
  'round_emoji_book', 'round_text_01', 'round_sources_icon', 'round_plus', 'round_countdown_bg'].map(rsd).concat(FACES);
/** The 联防 plate's own sprites (CSS backgrounds and masks, official-pages.css 27), by the custom property the CSS reads. */
const UNITE_ART = { '--unite-face-1': 'battle/assist_emoji_01', '--unite-face-2': 'battle/assist_emoji_02', '--unite-tag-1': 'battle/round_text_01',
  '--unite-tag-2': 'battle/round_text_02', '--unite-lines': 'end/img_screen_line',
  // 作战结束 (official-pages.css 30)
  '--end-face': 'battle/all_emoji_head', '--end-miss': 'battle/miss_emoji_head', '--end-body': 'battle/emoji_body', '--end-sword': 'battle/sword',
  '--end-lp': 'battle/blood_icon',
  // 回合 / 获得 (official-pages.css 32)
  '--round-head': 'battle/round_emoji_head', '--round-body': 'battle/round_emoji_body', '--round-book': 'battle/round_emoji_book',
  '--round-hand': 'battle/round_emoji_hand', '--round-coin': 'battle/round_sources_icon', '--round-plus': 'battle/round_plus' };
/** The official art root these masks and backgrounds come from (mirrored into public/assets/official). */
const OFFICIAL = new URL('../../assets/official/hub/ac/', import.meta.url).href;

/**
 * Sprites held as blob: URLs. A CSS background or mask is fetched again each time a plate mounts when the response may
 * not be cached, and at the start of 联防 — while the field loads the helpers' units — that took seconds: the faces
 * showed up only as the plate was leaving. A blob: URL is always at hand; until one is ready (or if the fetch fails) the
 * plain URL is used.
 */
const blobs = new Map();
/** The held blob: URL of `src`, else `src` itself. */
export const blobOf = (src) => blobs.get(src) || src;
export function holdBlob(src, then) {
  if (blobs.has(src) || typeof fetch !== 'function' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  blobs.set(src, null);
  fetch(src).then((r) => (r.ok ? r.blob() : null)).then((b) => {
    if (!b) return;
    const u = URL.createObjectURL(b);
    blobs.set(src, u);
    then?.(u);
  }).catch(() => {});
}

/**
 * Fetch the plates' sprites ahead of their first use (screens/game.js, once a match screen opens): a plate lives ≈ 2 s, too
 * short to wait for its images the first time it shows. A missing pack (no ui sprites) fetches nothing.
 */
export function preloadPopupArt() {
  const assets = data.get('assets');
  for (const k of ART) {
    const src = uiUrl(assets, k);
    if (src && typeof Image === 'function') new Image().src = src;
  }
  for (const k of ['round_frame', 'round_cross']) {
    const src = uiUrl(assets, rsd(k));
    if (src) holdBlob(src);
  }
  if (typeof document === 'undefined') return;
  for (const [v, n] of Object.entries(UNITE_ART)) {
    holdBlob(`${OFFICIAL}${n}.png`, (u) => document.documentElement.style.setProperty(v, `url("${u}")`));
  }
}

/**
 * 回合's left block (the footage, video 8:49): the robot from round_emoji_head / body / book / hand, each a mask in one
 * teal, book and hand in front with a rim of the panel's colour, five pixel dots round the head; it grows out of one
 * square (.mpop__rseed) and goes back into it. The 联防 box round it, round_text_01 / 02 under it (official-pages.css 32).
 */
function RoundArt() {
  const cross = (pos) => html`<i class=${`mpop__x mpop__x--${pos}`}></i>`;
  return html`<div class="mpop__art mpop__art--round" aria-hidden="true">
    ${cross('tl')}${cross('tr')}${cross('bl')}${cross('br')}
    <i class="mpop__brk mpop__brk--l"></i><i class="mpop__brk mpop__brk--r"></i>
    <span class="mpop__rbot">
      <i class="mpop__rpart mpop__rpart--body"></i><i class="mpop__rpart mpop__rpart--head"></i>
      <span class="mpop__rrim mpop__rrim--book"><i class="mpop__rpart mpop__rpart--book"></i></span>
      <span class="mpop__rrim mpop__rrim--hand"><i class="mpop__rpart mpop__rpart--hand"></i></span>
      ${[0, 1, 2, 3, 4].map((i) => html`<i key=${i} class=${`mpop__rdot mpop__rdot--${i}`}></i>`)}
    </span>
    <i class="mpop__rseed"></i>
    <i class="mpop__utag mpop__utag--1"></i><i class="mpop__utag mpop__utag--2"></i>
  </div>`;
}

/**
 * 联防阶段's left block (the footage, video 10:35.3): the two official faces — assist_emoji_01 (yellow) and 02 (orange),
 * each in a wrapper that unfolds it from the gap between them while the face inside bobs — in the box of four corner
 * crosses and two brackets, round_text_01 / 02 under them. All painted by CSS (official-pages.css 27).
 */
function UniteArt() {
  const cross = (pos) => html`<i class=${`mpop__x mpop__x--${pos}`}></i>`;
  return html`<div class="mpop__art mpop__art--unite" aria-hidden="true">
    ${cross('tl')}${cross('tr')}${cross('bl')}${cross('br')}
    <i class="mpop__brk mpop__brk--l"></i><i class="mpop__brk mpop__brk--r"></i>
    <span class="mpop__fw mpop__fw--1"><i class="mpop__aface mpop__aface--1"></i></span>
    <span class="mpop__fw mpop__fw--2"><i class="mpop__aface mpop__aface--2"></i></span>
    <i class="mpop__utag mpop__utag--1"></i><i class="mpop__utag mpop__utag--2"></i>
  </div>`;
}

/** The plate's right-hand marks — the orange square, the 3×2 cells, SIGNAL and the bar: no sprite for them is in the packs ([REBUILT] in CSS). */
const UniteDeco = () => html`<span class="mpop__udeco" aria-hidden="true">
  <i class="mpop__usq"></i><span class="mpop__ugrid">${[0, 1, 2, 3, 4, 5].map((i) => html`<i key=${i}></i>`)}</span>
  <span class="mpop__usig">SIGNAL</span><i class="mpop__ubar"></i>
</span>`;

/**
 * 作战结束's left block in the 联防 box: a perfect battle's grinning all_emoji_head, three sparks and the sword raised
 * beside it; a battle that cost LP the skull — miss_emoji_head over emoji_body, a bar beside its foot — with the sword
 * turned point up behind it. Placed and sized off the footage (official-pages.css 30); the sparks and the bar are
 * [REBUILT] (no sprite).
 */
function EndArt({ hurt }) {
  const cross = (pos) => html`<i class=${`mpop__x mpop__x--${pos}`}></i>`;
  return html`<div class="mpop__art mpop__art--end" aria-hidden="true">
    ${cross('tl')}${cross('tr')}${cross('bl')}${cross('br')}
    <i class="mpop__brk mpop__brk--l"></i><i class="mpop__brk mpop__brk--r"></i>
    <span class="mpop__ebot">
      ${hurt ? html`<i class="mpop__esword mpop__esword--hurt"></i><i class="mpop__ebody"></i><i class="mpop__ehead mpop__ehead--miss"></i><i class="mpop__edash"></i>`
        : html`<i class="mpop__ehead mpop__ehead--all"></i><i class="mpop__espark mpop__espark--1"></i><i class="mpop__espark mpop__espark--2"></i>
          <i class="mpop__espark mpop__espark--3"></i><i class="mpop__esword"></i>`}
    </span>
    <i class="mpop__utag mpop__utag--1"></i><i class="mpop__utag mpop__utag--2"></i>
  </div>`;
}

/**
 * The plate's root props: round_frame (a white 「[」, 6×33) and round_cross as CSS masks the brackets (box, the cells'
 * labels) and the corner crosses are painted through, tinted like the footage (teal / orange, grey, gold); without the
 * sprites they are CSS borders.
 */
function frameMask() {
  const assets = data.get('assets');
  const frame = uiUrl(assets, rsd('round_frame'));
  const cross = uiUrl(assets, rsd('round_cross'));
  const held = (src) => blobs.get(src) || src;
  return frame && cross ? { cls: 'has-frame', style: `--mpop-frame:url("${held(frame)}");--mpop-cross:url("${held(cross)}")` } : { cls: null, style: null };
}

/** The plate itself: the contour lines of the official background over a dark translucent panel. */
function Panel({ children }) {
  return html`<div class="mpop__panel">
    <${Sprite} k=${rsd('round_bg_line')} class="mpop__lines" />
    ${children}
  </div>`;
}

/** 剩余 N 回合 with the number picked out (the footage: an orange 3). */
function RoundsLeft({ n }) {
  const [before, after = ''] = t('剩余 {n} 回合', { n: '\u0000' }).split('\u0000');
  return html`<span class="mpop__headtxt">${before}<b class="num">${n}</b>${after}</span>`;
}

/**
 * The round-start plate.
 * @param {{ round: number, gain?: number|null, left?: number|null, sub?: any, watching?: boolean, onDone?: Function }} props
 *   gain: the funds this round start paid (null = not known: the icon without a number)
 *   left: rounds before the final assault (roundsToBoss) — the red strip on top
 *   watching: an eliminated player or a spectator seat — no 获得 cell, `sub` (phaseBanner's 观战中) under the plate
 */
export function RoundPopup({ round, gain = null, left = null, sub = null, watching = false, onDone }) {
  const leaving = useTimedLeave(ROUND_POPUP_MS, onDone, ROUND_LEAVE_MS);
  const n = !watching && Number.isFinite(gain) && gain > 0 ? Math.trunc(gain) : null;
  const fm = frameMask();
  // the funds: round_sources_icon alone, then +N (round_plus as the "+", the number the round start paid) slides it left
  return html`<div class=${cx('mpop', 'mpop--round', watching && 'is-watching', fm.cls, leaving && 'is-leaving')} style=${fm.style} role="status" aria-live="polite"
      aria-label=${t('第 {r} 回合', { r: round })} data-testid="round-popup">
    <${Panel}>
      ${left ? html`<div class="mpop__head" data-testid="round-popup-left">
        <${Sprite} k=${rsd('round_countdown_bg')} class="mpop__headbg" fallback=${html`<i class="mpop__headbg mpop__headbg--css"></i>`} />
        <${RoundsLeft} n=${left} />
      </div>` : null}
      <${RoundArt} />
      <div class="mpop__cell mpop__cell--round">
        <span class="mpop__k">${t('回合')}</span>
        <span class="mpop__roll num"><b class="mpop__old">${roundDigits(round - 1)}</b><b class="mpop__new">${roundDigits(round)}</b></span>
      </div>
      ${watching ? null : html`<div class="mpop__cell mpop__cell--gold" data-testid="round-popup-gain">
        <span class="mpop__k">${t('获得')}</span>
        <i class="mpop__rflare" aria-hidden="true"></i>
        <span class="mpop__gain">
          <i class="mpop__rcoin" aria-hidden="true"></i>
          ${n ? html`<span class="mpop__rplusc"><b class="mpop__plus num"><i class="mpop__rplus">+</i>${n}</b></span>` : null}
        </span>
        ${n ? html`<span class="mpop__rsparks" aria-hidden="true">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => html`<i key=${i}></i>`)}</span>` : null}
      </div>`}
    <//>
    ${watching && sub ? html`<div class="mpop__line" data-testid="round-popup-sub">${sub}</div>` : null}
  </div>`;
}

/**
 * A phase plate: the robot or the 联防 faces, title (+ optional line), chevrons sweeping through on the right.
 * @param {{ tone?: 'mint'|'orange'|'red'|'gold', faces?: boolean, title: any, sub?: any, chev?: boolean, duration?: number, onDone?: Function }} props
 */
export function PhasePopup({ tone = 'mint', faces = false, title, sub = null, chev = false, duration = 2200, onDone }) {
  const leaving = useTimedLeave(duration, onDone);
  const fm = frameMask();
  // 联防 (faces): the footage's plate carries the title only — the helpers' names (phaseBanner's sub) stay for screen readers
  return html`<div class=${cx('mpop', 'mpop--phase', `mpop--${tone}`, faces && 'mpop--unite', fm.cls, chev && 'has-chev', leaving && 'is-leaving')} style=${fm.style} role="status" aria-live="polite"
      aria-label=${faces && sub ? `${title} ${sub}` : null} data-testid="phase-popup">
    <${Panel}>
      ${faces ? html`<${UniteArt} />` : html`<${RoundArt} />`}
      <div class="mpop__text">
        <span class="mpop__title">${title}</span>
        ${sub && !faces ? html`<span class="mpop__sub">${sub}</span>` : null}
      </div>
      ${chev ? html`<span class="mpop__chevs" aria-hidden="true"><i></i><i></i><i></i></span>` : null}
      ${faces ? html`<${UniteDeco} />` : null}
    <//>
  </div>`;
}

/** How long 作战结束 holds (ms) and its fold: it starts going 2.53 s after its first frame and is gone .23 s later in the
 * footage (e30 / d30 f005–f088, both kinds) — inside SETTLE's 3 s. */
export const BATTLE_OVER_MS = 2530;
const BATTLE_OVER_LEAVE_MS = 240;

/** 生命值减少 −N: the words of `t('生命值减少 −{n}')` without the sign — the footage has the LP tower in its place. */
function LossLine({ n }) {
  const [before, after = ''] = t('生命值减少 −{n}', { n: '\u0000' }).split('\u0000');
  return html`<span class="mpop__esub mpop__esub--loss">${before.replace(/[\s−-]+$/u, '')}<i class="mpop__lp"></i><b class="num">${n}</b>${after}</span>`;
}

/**
 * 作战结束 at SETTLE, from the round's own result (gameLogic/phases.js roundResultBox / uniteResultBox):
 *   kind 'perfect' — no LP lost: the teal border breathing, `sub` (全员无伤！) under the title;
 *   kind 'loss'    — `loss` LP charged: no border line, the skull, 生命值减少 ♜N in red, the panel flushing red once;
 *   kind 'plain'   — a 联防 that leaked without charging the viewer: the title alone ([ASSUMED]: no footage of it).
 * @param {{ kind?: 'perfect'|'loss'|'plain', loss?: number, title: any, sub?: any, onDone?: Function }} props
 */
export function BattleOverPopup({ kind = 'perfect', loss = 0, title, sub = null, onDone }) {
  const leaving = useTimedLeave(BATTLE_OVER_MS, onDone, BATTLE_OVER_LEAVE_MS);
  const fm = frameMask();
  const hurt = kind === 'loss';
  const n = Math.max(0, Math.trunc(Number(loss) || 0));
  return html`<div class=${cx('mpop', 'mpop--end', `mpop--end-${kind}`, fm.cls, leaving && 'is-leaving')} style=${fm.style} role="status" aria-live="polite"
      aria-label=${sub ? `${title} ${sub}` : title} data-testid="battle-over-popup" data-kind=${kind}>
    <${Panel}>
      <i class="mpop__eflush" aria-hidden="true"></i>
      <${EndArt} hurt=${hurt} />
      <div class=${cx('mpop__text', kind !== 'plain' && 'has-sub')} aria-hidden="true">
        <span class="mpop__title">${title}</span>
        ${hurt ? html`<${LossLine} n=${n} />` : kind === 'perfect' ? html`<span class="mpop__esub">${sub || t('全员无伤！')}</span>` : null}
      </div>
      <${UniteDeco} />
    <//>
  </div>`;
}

/**
 * The plate a phase starts with (screens/game.js), from its phaseBanner words — or null: 回合开始 has RoundPopup, and
 * the other phases keep the banner (ui/components.js PhaseBanner): the footage shows a plate for 联防 only.
 * @param {string} phase @param {{ title: any, sub?: any } | null } banner
 */
export function phasePopupOf(phase, banner) {
  if (!banner) return null;
  // on screen 10:35.30–10:38.07 in the footage: ≈ 2.63 s, then the dissolve (LEAVE_MS)
  if (phase === 'UNITE') return { tone: 'orange', faces: true, chev: true, duration: 2630, title: banner.title, sub: banner.sub || null };
  return null;
}
